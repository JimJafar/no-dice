/**
 * The lock a series run holds on its own directory.
 *
 * `runSeries` owns `<dir>/series.json` and rewrites it at every batch of 5 pairs,
 * and nothing outside the process playing it knows the directory is busy. A second
 * `no-dice series --dir <same dir>` — or the console's Resume — therefore starts a
 * second run over the matches the first is still playing: both write the same logs,
 * both rewrite the same record, and the series that comes out is the two of them
 * interleaved. One small file says the directory is taken.
 *
 * **The file** is `<dir>/series.lock`, one line of JSON: `{"pid": <number>,
 * "started_at": "<ISO timestamp>"}`. The pid is what decides live or stale.
 * `started_at` decides nothing: it is there so that a human who finds a lock left by
 * a run that was killed can tell which run left it.
 *
 * **The take is an exclusive create** — `open(path, "wx")`, which fails with EEXIST
 * if the file is already there — so two runs starting at the same moment cannot both
 * claim it. A lock naming a live process means the run is refused, before anything is
 * played, with one line naming the pid that holds it. A lock whose process is gone is
 * stale: it is unlinked and the create is retried once. Two runs racing to steal one
 * stale lock cannot both win: each re-reads the file immediately before unlinking and
 * leaves alone anything that is no longer the stale lock it read, so the loser's
 * create fails, it re-reads a lock naming a live process, and it is refused. What
 * that leaves open — a steal that lands between one run's re-read and its unlink — is
 * caught by the same re-read afterwards: a take that no longer finds its own bytes in
 * its own file has lost, and says so.
 *
 * **Liveness is `process.kill(pid, 0)`.** `ESRCH` is gone; `EPERM` is alive but not
 * this user's, which is still alive; anything else is treated as alive, because a
 * probe that could not tell is not evidence that a run has died.
 *
 * **What this cannot rule out is pid reuse.** On a long-lived machine the pid a dead
 * run wrote into its lock can, in time, belong to something else — a shell, a build,
 * an editor — and then a lock that is stale reads as held and the series is refused
 * until someone notices. The other direction is the worse one, and is what a cleverer
 * scheme would have to solve: a lock stolen from a run that is in fact still playing,
 * because its pid was recycled the moment it died. Neither is ruled out here, and that
 * is why the lock is one small file an operator can read — `cat series/<name>/series.lock`
 * names the pid and the minute the run started, and `ps -p <pid>` answers it — rather
 * than a fact nobody can check. Removing that file by hand is the whole recovery, and
 * it is safe once the run it names has gone.
 *
 * **A lock that cannot be read is taken over, not obeyed.** `open(path, "wx")` and the
 * write that fills the file are two steps, so a reader can catch a lock that has just
 * been created and holds nothing yet; such a file is re-read once after a short grace.
 * A file still unreadable after that names no process, and a lock nobody can read must
 * not hold a series directory shut for ever.
 *
 * **The lock is taken after `planSeries` and released in a `finally`.** After the plan,
 * because the plan has made the directory and written the seed fields, and a run that
 * is refused leaves those as it found them rather than drawing a second seed list into
 * a series it was not allowed to play. In a `finally`, because a run that throws — an
 * unreadable log, a stop, anything — leaves no lock behind, so the next run does not
 * have to steal a stale one before it can play.
 */
import { open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

/** The lock file of a series directory. */
export const seriesLockPath = (dir: string): string => join(dir, "series.lock");

/**
 * The lock as written. Unknown fields are ignored rather than refused, so a lock
 * written by a newer runner is still readable by this one.
 */
export const seriesLockSchema = z.object({
  /** The process that took the lock: what decides live or stale. */
  pid: z.number().int().positive(),
  /** When it took it, for the human reading a lock a killed run left behind. */
  started_at: z.string(),
});
export type SeriesLock = z.infer<typeof seriesLockSchema>;

/** What a directory's lock says about who is playing it. */
export type LockState =
  | { kind: "free" }
  /** A lock naming a process that is alive: the directory is being played. */
  | { kind: "held"; lock: SeriesLock }
  /** A lock naming a process that is gone: the run that wrote it died. */
  | { kind: "stale"; lock: SeriesLock };

/** What one read of the lock file found — including that it found nothing readable. */
type Found =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "lock"; lock: SeriesLock };

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;

const isExists = (error: unknown): boolean => codeOf(error) === "EEXIST";

const isMissing = (error: unknown): boolean => codeOf(error) === "ENOENT";

/**
 * Whether a process is alive. `ESRCH` is gone; `EPERM` is alive but not this user's;
 * anything else — including a probe that could not answer — counts as alive, because
 * stealing a lock from a run that is in fact still playing is the expensive mistake.
 */
export const processAlive = (pid: number): boolean => {
  // `process.kill(0, 0)` signals the whole process group, and a pid that is not a
  // positive integer is not a process at all: a lock naming one names nothing,
  // which is stale rather than alive.
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) !== "ESRCH";
  }
};

/** The bytes of the lock file, or `null` when there is no lock file. */
const readLockText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

/** The lock a file names, or `null` when it names nothing readable. */
const parseLock = (text: string): SeriesLock | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const lock = seriesLockSchema.safeParse(parsed);
  return lock.success ? lock.data : null;
};

/** Read the lock file once, and say what was in it. */
const look = async (path: string): Promise<Found> => {
  const text = await readLockText(path);
  if (text === null) return { kind: "absent" };
  const lock = parseLock(text);
  return lock === null ? { kind: "unreadable" } : { kind: "lock", lock };
};

/** How long a lock caught mid-write is given to finish being written. */
const WRITE_GRACE_MS = 25;

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * The lock in `path`, re-read once if it is there but names nothing.
 *
 * The grace is for the one gap `wx` leaves: the file exists the instant it is
 * created and its bytes land a step later, so a reader can catch an empty file
 * belonging to a run that has just taken the lock. A file still unreadable after the
 * grace names no process, and is treated the way a dead one is.
 */
const lookSettled = async (path: string): Promise<Found> => {
  const first = await look(path);
  if (first.kind !== "unreadable") return first;
  await wait(WRITE_GRACE_MS);
  return look(path);
};

/** The lock a run wrote, as the bytes it wrote it in. */
interface Take {
  lock: SeriesLock;
  body: string;
}

/** Claim the lock file. `false` when someone else already holds it. */
const create = async (path: string, take: Take): Promise<boolean> => {
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    if (isExists(error)) return false;
    throw error;
  }
  try {
    await handle.writeFile(take.body, "utf8");
  } finally {
    await handle.close();
  }
  return true;
};

/** Whether the file on disk still holds the bytes this run wrote into it. */
const stillOurs = async (path: string, take: Take): Promise<boolean> =>
  (await readLockText(path)) === take.body;

/** Whether two readings of the lock file are the same lock. */
const sameLock = (left: SeriesLock, right: SeriesLock): boolean =>
  left.pid === right.pid && left.started_at === right.started_at;

/** Remove the lock file, which someone else may have removed a moment earlier. */
const unlinkQuietly = async (path: string): Promise<void> => {
  await unlink(path).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)));
};

/**
 * Remove the lock that was read as stale, and only if the file on disk is still the
 * lock that was read.
 *
 * A run racing for the same stale lock can have taken it in the meantime, and
 * unlinking what it wrote would let both runs end up believing they hold the
 * directory. An unreadable file is removed whatever it now holds unless the re-read
 * found a lock in it — which means a run has just written one.
 */
const unlinkStale = async (path: string, found: Found): Promise<void> => {
  if (found.kind === "absent") return;
  const now = await look(path);
  if (now.kind === "absent") return;
  if (now.kind === "lock" && (found.kind !== "lock" || !sameLock(found.lock, now.lock))) return;
  await unlinkQuietly(path);
};

/** The line a refused run prints: who holds the lock, and where it says so. */
const held = (path: string, lock: SeriesLock): Error =>
  new Error(
    `another series run holds ${path}: pid ${String(lock.pid)} started at ` +
      `${lock.started_at} and is still playing this directory`,
  );

/** A take that failed for a reason the lock file cannot answer. */
const changedHands = (path: string, dir: string): Error =>
  new Error(
    `${path} changed hands while this run tried to take it, so the run is refused: ` +
      `check that no series is playing in ${dir}, and remove that file if none is`,
  );

/**
 * Take the lock of `dir`, or throw with one line naming the run that holds it.
 *
 * The throw is what `runCli` turns into an error line and exit code 1, so a run
 * refused here never reaches a match. A stale lock is unlinked and the create is
 * retried once, and the take is then checked against the file: a run that no
 * longer finds its own bytes in its own file has lost the race, and refuses itself.
 */
export const acquireSeriesLock = async (
  dir: string,
  pid: number = process.pid,
): Promise<SeriesLock> => {
  const path = seriesLockPath(dir);
  const lock: SeriesLock = { pid, started_at: new Date().toISOString() };
  const take: Take = { lock, body: `${JSON.stringify(lock)}\n` };
  if (await create(path, take)) return lock;

  const found = await lookSettled(path);
  if (found.kind === "lock" && processAlive(found.lock.pid)) throw held(path, found.lock);

  // Stale, unreadable, or let go while this run was looking: take it over.
  await unlinkStale(path, found);
  if ((await create(path, take)) && (await stillOurs(path, take))) return lock;

  const raced = await lookSettled(path);
  if (raced.kind === "lock" && processAlive(raced.lock.pid)) throw held(path, raced.lock);
  throw changedHands(path, dir);
};

/**
 * Let go of the lock, if it is still this process's.
 *
 * A run whose stale lock was stolen from it while it played must not delete the lock
 * of the run that stole it, so the unlink is asked only of a file naming this pid. A
 * file that names nothing is left as it is: the next run reads it as stale and takes
 * it over, which is the recovery, and deleting a lock this run did not write is not.
 */
export const releaseSeriesLock = async (dir: string, pid: number = process.pid): Promise<void> => {
  const path = seriesLockPath(dir);
  const found = await look(path);
  if (found.kind !== "lock" || found.lock.pid !== pid) return;
  await unlinkQuietly(path);
};

/**
 * What a directory's lock says, without touching it — which is what lets the console
 * list a series another process is playing, and refuse to resume it.
 *
 * A lock that names nothing after the grace reads as free rather than as stale: there
 * is no pid to report, and a row claiming a stale run it cannot see would be the
 * console inventing a run that never happened.
 */
export const readSeriesLock = async (dir: string): Promise<LockState> => {
  const found = await lookSettled(seriesLockPath(dir));
  if (found.kind !== "lock") return { kind: "free" };
  if (!processAlive(found.lock.pid)) return { kind: "stale", lock: found.lock };
  return { kind: "held", lock: found.lock };
};
