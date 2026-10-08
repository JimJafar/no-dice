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
 * **The claim is a hard link, not a create and a write.** The lock's bytes are written
 * to a name of the run's own in the same directory and `link`ed into place: `link`
 * fails with EEXIST when a lock is already there, and the file it creates holds the
 * whole lock the instant it appears. `open(path, "wx")` and the write that fills the
 * file are two steps, and between them the lock is present and empty — a run reading
 * it in that gap sees a lock that names nobody, takes it over, and the two of them are
 * playing the same matches. So two runs starting at the same moment cannot both claim
 * the directory. A lock naming a live process means the run is refused, before
 * anything is played, with one line naming the pid that holds it. A lock whose process
 * is gone is stale: it is unlinked and the claim is retried once.
 *
 * **Every claim is checked afterwards.** A run that no longer finds its own bytes in
 * its own file has lost the directory — something removed what it claimed and claimed
 * it back — and refuses itself rather than plays. That is what makes a race for one
 * stale lock safe to be in the open: each run re-reads the file immediately before
 * unlinking and leaves alone anything that is no longer the stale lock it read, so the
 * loser's claim fails, it re-reads a lock naming a live process, and it is refused.
 *
 * **What that leaves open is one narrow window in a takeover, stated rather than
 * papered over.** A run decides a lock is stale by reading it, and the unlink that
 * follows cannot be made conditional on what the path holds at the moment of unlinking:
 * no POSIX call unlinks a file only if the path still names that file. If another run
 * claims the directory, and verifies its claim, inside the gap between this run's read
 * and its unlink, this run removes the lock that other run is holding and claims the
 * path itself, and both play. It takes two runs started at one directory within the
 * moment one of them is taking over a lock that belongs to nobody.
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
 * **A lock that cannot be read is taken over, not obeyed.** A file whose bytes are not
 * a lock — cut short by a hand edit, or written by something that is not this runner —
 * names no process, and a lock nobody can read must not hold a series directory shut
 * for ever. A pid outside the range a process can have on this system counts as
 * unreadable for the same reason: it names nothing, and no run is refused for it.
 *
 * **The lock is taken after `planSeries` and released in a `finally`.** After the plan,
 * because the plan has made the directory and written the seed fields, and a run that
 * is refused adds nothing of its own to that record. The plan itself is outside the
 * lock, which is what the task prescribes and what it costs: two first runs of one new
 * directory both write a seed list before one of them is refused, and the list that
 * lands last is the one the winner's record carries — which, if the two were started
 * with different `--seed-base`, is not the list the winner plays. In a `finally`,
 * because a run that throws — an unreadable log, a stop, anything — leaves no lock
 * behind, so the next run does not have to steal a stale one before it can play.
 */
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

/** The lock file of a series directory. */
export const seriesLockPath = (dir: string): string => join(dir, "series.lock");

/**
 * The lock as written. Unknown fields are ignored rather than refused, so a lock
 * written by a newer runner is still readable by this one.
 */
export const seriesLockSchema = z.object({
  /**
   * The process that took the lock: what decides live or stale. Bounded by the largest
   * pid this system can name, so a hand-written or corrupted lock naming an impossible
   * process reads as naming nothing and is taken over, rather than refusing the series
   * for ever with no stale path out.
   */
  pid: z.number().int().positive().max(0x7fff_ffff),
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

/** Remove a file that someone else may have removed a moment earlier. */
const unlinkQuietly = async (path: string): Promise<void> => {
  await unlink(path).catch((error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)));
};

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

/** The lock a run wrote, as the bytes it wrote it in. */
interface Take {
  lock: SeriesLock;
  body: string;
}

/**
 * A name of this run's own for the lock's bytes, before they are the lock.
 *
 * The counter keeps it unique among this process's own attempts — two runs of one
 * process taking one directory, as a test does — and the pid keeps it unique among
 * processes. A run killed between writing this and linking it leaves the file behind;
 * nothing reads it, and `.gitignore` keeps it out of a series.
 */
let claimCount = 0;
const claimName = (path: string): string => `${path}.${String(process.pid)}.${String(++claimCount)}`;

/**
 * Claim the lock file: write the bytes to a name of this run's own, and hard-link them
 * into place. `false` when someone else already holds the lock.
 *
 * The link is the claim, and it is why the lock is never seen half-written: the path
 * appears holding the whole lock, or it does not appear. `open(path, "wx")` would
 * create the path empty and fill it a step later, and a run that read the empty file
 * would find a lock naming nobody and take the directory from under the run that had
 * just claimed it.
 */
const create = async (path: string, take: Take): Promise<boolean> => {
  const claim = claimName(path);
  await writeFile(claim, take.body, "utf8");
  try {
    await link(claim, path);
  } catch (error) {
    if (isExists(error)) return false;
    throw error;
  } finally {
    // `path` now names the bytes in its own right; this name is only the route they
    // took here, and no reader looks at it.
    await unlinkQuietly(claim);
  }
  return true;
};

/** Whether the file on disk still holds the bytes this run wrote into it. */
const stillOurs = async (path: string, take: Take): Promise<boolean> =>
  (await readLockText(path)) === take.body;

/** Whether two readings of the lock file are the same lock. */
const sameLock = (left: SeriesLock, right: SeriesLock): boolean =>
  left.pid === right.pid && left.started_at === right.started_at;

/**
 * Remove the lock that was read as stale, and only if the file on disk is still the
 * lock that was read.
 *
 * A run racing for the same stale lock can have taken it in the meantime, and
 * unlinking what it wrote would let both runs end up believing they hold the
 * directory. An unreadable file is removed whatever it now holds unless the re-read
 * found a lock in it — which means a run has just written one. The re-read and the
 * unlink are two steps and cannot be made one, and the claim check in
 * `acquireSeriesLock` catches the case where the other run claimed before this
 * one checked its own claim; the header names the window that is still open.
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
 * refused here never reaches a match. A stale lock is unlinked and the claim is
 * retried once. And every claim — the uncontended one included — is checked against
 * the file before this returns: a run that no longer finds its own bytes in its own
 * file has lost the directory, and refuses itself rather than play against whoever
 * holds it now.
 */
export const acquireSeriesLock = async (
  dir: string,
  pid: number = process.pid,
): Promise<SeriesLock> => {
  const path = seriesLockPath(dir);
  const lock: SeriesLock = { pid, started_at: new Date().toISOString() };
  const take: Take = { lock, body: `${JSON.stringify(lock)}\n` };
  if ((await create(path, take)) && (await stillOurs(path, take))) return lock;

  const found = await look(path);
  if (found.kind === "lock" && processAlive(found.lock.pid)) throw held(path, found.lock);

  // Stale, unreadable, or let go while this run was looking: take it over.
  await unlinkStale(path, found);
  if ((await create(path, take)) && (await stillOurs(path, take))) return lock;

  const raced = await look(path);
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
 *
 * Nothing here throws. The run calling it has played, or has failed for a reason the
 * operator needs to see, and a lock this run cannot remove is recovered by the next
 * one — it names a process that has gone, and is taken over as stale. A failed
 * unlink reported as the run's own failure, replacing the reason the run really
 * stopped, would be the worse mistake.
 */
export const releaseSeriesLock = async (dir: string, pid: number = process.pid): Promise<void> => {
  const path = seriesLockPath(dir);
  const found = await look(path).catch((): Found => ({ kind: "unreadable" }));
  if (found.kind !== "lock" || found.lock.pid !== pid) return;
  await unlinkQuietly(path).catch(() => undefined);
};

/**
 * What a directory's lock says, without touching it — which is what lets the console
 * list a series another process is playing, and refuse to resume it.
 *
 * A lock that names nothing reads as free rather than as stale: there is no pid to
 * report, and a row claiming a stale run it cannot see would be the console inventing
 * a run that never happened.
 */
export const readSeriesLock = async (dir: string): Promise<LockState> => {
  const found = await look(seriesLockPath(dir));
  if (found.kind !== "lock") return { kind: "free" };
  if (!processAlive(found.lock.pid)) return { kind: "stale", lock: found.lock };
  return { kind: "held", lock: found.lock };
};
