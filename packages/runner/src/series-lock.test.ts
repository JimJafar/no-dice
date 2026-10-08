/**
 * The lock a series run holds on its own directory.
 *
 * Two halves, and they are the two halves of the promise:
 *
 * - **The file itself.** `<dir>/series.lock` names the pid that took it and when it
 *   took it; a lock naming a live process refuses a second take and is left exactly as
 *   it was; a lock naming a process that is gone — or naming nothing at all — is taken
 *   over; and a run lets go of its own lock and never of another run's. The liveness
 *   probe is `process.kill(pid, 0)`, so these tests use this process's own pid for
 *   "alive" and a pid checked first to name nothing for "gone".
 * - **The run.** `runSeries` holds the lock across every match it plays, leaves no lock
 *   behind when it ends, throws, or is refused on a bad flag, and is refused by a second
 *   run into the same directory without playing a match or rewriting the record. Every
 *   match here is played by the scripted `playMatch` of the other series tests
 *   (`./scripted-series.ts`), which leaves a real log at the plan's path — a real match
 *   takes nineteen minutes and cannot be a fixture.
 *
 * The race the module header describes — two runs stealing one stale lock — is run for
 * real here, with two takes overlapping on one directory, because "only one of them
 * wins" is the whole reason the take is an exclusive create.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Seat } from "@no-dice/log";

import type { SeatArg } from "./args.ts";
import { runSeries } from "./series.ts";
import type { PlayMatch } from "./series.ts";
import { planSeries } from "./series-plan.ts";
import {
  acquireSeriesLock,
  processAlive,
  readSeriesLock,
  releaseSeriesLock,
  seriesLockPath,
} from "./series-lock.ts";
import type { SeriesLock } from "./series-lock.ts";
import { scripted } from "./scripted-series.ts";
import type { PlayCall } from "./scripted-series.ts";

/** Model X, and the opponent it is measured against — as in the other series tests. */
const X: SeatArg = { kind: "model", provider: "marvin", model: "subagent" };
const OPPONENT: SeatArg = { kind: "bot", bot: "greedy" };

/** What every scripted match reports: X wins seat A's match by 12 on time. */
const WIN = {
  type: "time" as const,
  winner: "A" as Seat | null,
  margin: 12,
  costUsd: 0.75,
  tokens: { input: 300, output: 30, cache_read: 1200, cache_write: 3 },
};

/** Where the series directories are, gone when the suite is done. */
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-series-lock-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A series directory of its own, so no test sees another one's files. */
const seriesAt = async (name: string): Promise<string> => {
  const path = join(dir, name);
  await mkdir(path, { recursive: true });
  return path;
};

/** The lock file as written, or `null` when there is none. */
const lockText = async (seriesDir: string): Promise<string | null> => {
  try {
    return await readFile(seriesLockPath(seriesDir), "utf8");
  } catch {
    return null;
  }
};

/** The names of a series' match logs, in name order — empty if it has played none. */
const logNames = async (seriesDir: string): Promise<string[]> => {
  try {
    return (await readdir(join(seriesDir, "matches"))).sort();
  } catch {
    return [];
  }
};

/** A pid that names no process on this machine: what a lock left by a killed run names. */
const aGonePid = (): number => {
  for (const candidate of [999_999, 4_194_303]) {
    if (!processAlive(candidate)) return candidate;
  }
  throw new Error("every candidate pid names a live process on this machine");
};

/** Leave a lock belonging to a run that is not playing here, and say what it says. */
const aStaleLock = async (seriesDir: string): Promise<SeriesLock> => {
  const lock: SeriesLock = { pid: aGonePid(), started_at: "2026-01-01T00:00:00.000Z" };
  await writeFile(seriesLockPath(seriesDir), `${JSON.stringify(lock)}\n`, "utf8");
  return lock;
};

/** `series.json` as written. */
const recordText = async (seriesDir: string): Promise<string> =>
  readFile(join(seriesDir, "series.json"), "utf8");

describe("the lock file", () => {
  it("names the process that took it, the minute it took it, and nothing else", async () => {
    const seriesDir = await seriesAt("taken");
    const before = new Date().toISOString();

    const lock = await acquireSeriesLock(seriesDir);
    const text = await lockText(seriesDir);

    // One line of JSON, and the whole of it: the pid is what decides live or stale,
    // and `started_at` is there for the human reading a lock a killed run left behind.
    expect(text?.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(text ?? "") as unknown).toEqual({
      pid: process.pid,
      started_at: lock.started_at,
    });
    expect(lock.started_at >= before).toBe(true);

    await releaseSeriesLock(seriesDir);
    expect(existsSync(seriesLockPath(seriesDir))).toBe(false);
  });

  it("refuses a second take while the first run lives, and leaves the file alone", async () => {
    const seriesDir = await seriesAt("held");
    const first = await acquireSeriesLock(seriesDir);
    const written = `${JSON.stringify({ pid: process.pid, started_at: first.started_at })}\n`;

    await expect(acquireSeriesLock(seriesDir)).rejects.toThrow(
      new RegExp(`another series run holds .*series\\.lock: pid ${String(process.pid)} started at`),
    );
    expect(await lockText(seriesDir)).toBe(written);
    expect(await readSeriesLock(seriesDir)).toEqual({
      kind: "held",
      lock: { pid: process.pid, started_at: first.started_at },
    });

    await releaseSeriesLock(seriesDir);
  });

  it("is taken over when it names a process that is gone", async () => {
    const seriesDir = await seriesAt("stale");
    await aStaleLock(seriesDir);

    const lock = await acquireSeriesLock(seriesDir);

    expect(lock.pid).toBe(process.pid);
    expect(JSON.parse((await lockText(seriesDir)) ?? "") as unknown).toEqual({
      pid: process.pid,
      started_at: lock.started_at,
    });
    await releaseSeriesLock(seriesDir);
  });

  it("reads a lock whose process is gone as stale, with the pid that left it", async () => {
    const seriesDir = await seriesAt("stale-read");
    const stale = await aStaleLock(seriesDir);

    expect(await readSeriesLock(seriesDir)).toEqual({ kind: "stale", lock: stale });
    // Reading tells nobody anything about the directory: the lock is still there,
    // still stale, and still the next run's to take.
    expect(await lockText(seriesDir)).toBe(`${JSON.stringify(stale)}\n`);
  });

  it("is taken over when it names nothing readable", async () => {
    const seriesDir = await seriesAt("garbage");
    await writeFile(seriesLockPath(seriesDir), "not a lock\n", "utf8");

    const lock = await acquireSeriesLock(seriesDir);

    expect(lock.pid).toBe(process.pid);
    await releaseSeriesLock(seriesDir);
  });

  it("reads as free when there is no lock file", async () => {
    expect(await readSeriesLock(await seriesAt("free"))).toEqual({ kind: "free" });
  });

  it("is left alone by a release that is not its own", async () => {
    // A run whose stale lock was stolen must not delete the lock of the run that stole
    // it, or the two of them are back to playing the same matches.
    const seriesDir = await seriesAt("foreign");
    const stale = await aStaleLock(seriesDir);

    await releaseSeriesLock(seriesDir);

    expect(JSON.parse((await lockText(seriesDir)) ?? "") as unknown).toEqual(stale);
  });

  it("lets only one of two runs racing for one stale lock take it", async () => {
    const seriesDir = await seriesAt("race");
    await aStaleLock(seriesDir);

    // Two takes overlapping in time. The gap between them is only so that the two lock
    // files cannot be the same bytes, which is what tells a run that the file on disk
    // is no longer the one it wrote.
    const first = acquireSeriesLock(seriesDir);
    await new Promise((done) => setTimeout(done, 5));
    const second = acquireSeriesLock(seriesDir);
    const settled = await Promise.allSettled([first, second]);

    const taken = settled.filter((each) => each.status === "fulfilled");
    const refused = settled.filter((each) => each.status === "rejected");
    expect(taken).toHaveLength(1);
    expect(refused).toHaveLength(1);

    // The directory is held by exactly one run, and it is this one.
    const winner = taken[0] as PromiseFulfilledResult<SeriesLock>;
    expect(await readSeriesLock(seriesDir)).toEqual({
      kind: "held",
      lock: { pid: process.pid, started_at: winner.value.started_at },
    });
    await releaseSeriesLock(seriesDir);
  });
});

describe("a runSeries holds a lock on the directory it plays", () => {
  /** A scripted match that reports the lock as it stands the moment it is asked for. */
  const playWatchingTheLock = (
    seriesDir: string,
    calls: PlayCall[],
    seen: (string | null)[],
  ): PlayMatch => {
    const play = scripted(calls, () => WIN);
    return async (options) => {
      seen.push(await lockText(seriesDir));
      return play(options);
    };
  };

  it("takes it before the first match and leaves no lock behind when the run ends", async () => {
    const seriesDir = await seriesAt("run-plays");
    const calls: PlayCall[] = [];
    const seen: (string | null)[] = [];

    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 2,
      seedBase: 7,
      playMatch: playWatchingTheLock(seriesDir, calls, seen),
    });

    expect(run.played).toBe(4);
    // Every match was played with this run's pid in the lock file, so a second run
    // started at any point inside this one is refused.
    expect(seen).toHaveLength(4);
    for (const text of seen) {
      expect(text, "a match was played with no lock held").not.toBeNull();
      expect(JSON.parse(text ?? "") as unknown).toEqual({
        pid: process.pid,
        started_at: expect.any(String),
      });
    }
    expect(existsSync(seriesLockPath(seriesDir))).toBe(false);
  });

  it("leaves no lock behind when the run throws", async () => {
    const seriesDir = await seriesAt("run-throws");
    const first: PlayCall[] = [];
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 1,
      seedBase: 31,
      playMatch: scripted(first, () => WIN),
    });

    // A log a match left, then something else wrote over it: a resume cannot count it,
    // and the run throws rather than replaying over a match it already counted.
    const [broken] = await logNames(seriesDir);
    await writeFile(join(seriesDir, "matches", broken), "not a log\n", "utf8");

    const again: PlayCall[] = [];
    await expect(
      runSeries({
        dir: seriesDir,
        a: X,
        b: OPPONENT,
        maxPairs: 1,
        seedBase: 31,
        playMatch: scripted(again, () => WIN),
      }),
    ).rejects.toThrow(/not a salient-log\/1 log/);

    expect(existsSync(seriesLockPath(seriesDir))).toBe(false);
  });

  it("leaves no lock behind when a flag is refused", async () => {
    const seriesDir = await seriesAt("run-bad-flag");
    const calls: PlayCall[] = [];

    await expect(
      runSeries({
        dir: seriesDir,
        a: X,
        b: OPPONENT,
        maxPairs: 2,
        seedBase: 5,
        concurrency: 0,
        playMatch: scripted(calls, () => WIN),
      }),
    ).rejects.toThrow(/--concurrency takes a whole number of 1 or more/);

    expect(calls).toEqual([]);
    expect(existsSync(seriesLockPath(seriesDir))).toBe(false);
  });

  it("refuses a second run into the same directory, and rewrites nothing", async () => {
    const seriesDir = await seriesAt("run-refused");
    const first: PlayCall[] = [];
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 2,
      seedBase: 11,
      playMatch: scripted(first, () => WIN),
    });

    // The lock of a run that is playing this directory right now — this process.
    await acquireSeriesLock(seriesDir);
    const recordBefore = await recordText(seriesDir);
    const logsBefore = await logNames(seriesDir);

    const second: PlayCall[] = [];
    await expect(
      runSeries({
        dir: seriesDir,
        a: X,
        b: OPPONENT,
        maxPairs: 2,
        seedBase: 11,
        playMatch: scripted(second, () => WIN),
      }),
    ).rejects.toThrow(/another series run holds .*series\.lock/);

    // Nothing was played, and the record is the bytes the first run left: a refused run
    // does not get to rewrite the pairs or the run state.
    expect(second).toEqual([]);
    expect(await recordText(seriesDir)).toBe(recordBefore);
    expect(await logNames(seriesDir)).toEqual(logsBefore);

    await releaseSeriesLock(seriesDir);
    expect(existsSync(seriesLockPath(seriesDir))).toBe(false);
  });

  it("plays when the lock it finds names a process that is gone", async () => {
    const seriesDir = await seriesAt("run-takes-over");
    await aStaleLock(seriesDir);

    const calls: PlayCall[] = [];
    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 2,
      seedBase: 13,
      playMatch: scripted(calls, () => WIN),
    });

    expect(run.played).toBe(4);
    expect(existsSync(seriesLockPath(seriesDir))).toBe(false);
  });

  it("takes the lock after the plan, so a refused run leaves the record as it found it", async () => {
    const seriesDir = await seriesAt("run-refused-fresh");
    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 2, seedBase: 17 });
    const recordBefore = await recordText(seriesDir);
    await acquireSeriesLock(seriesDir);

    const calls: PlayCall[] = [];
    await expect(
      runSeries({
        dir: seriesDir,
        a: X,
        b: OPPONENT,
        maxPairs: 2,
        seedBase: 17,
        playMatch: scripted(calls, () => WIN),
      }),
    ).rejects.toThrow(/another series run holds/);

    // `planSeries` runs before the lock is taken, so the seed fields it writes are on
    // disk. What the refused run must not add is its own half of the record: a pairing,
    // a set of pairs, and a state for a series it never played.
    expect(plan.matches).toHaveLength(4);
    expect(calls).toEqual([]);
    expect(await recordText(seriesDir)).toBe(recordBefore);
    expect(JSON.parse(recordBefore) as Record<string, unknown>).not.toHaveProperty("state");
    expect(await logNames(seriesDir)).toEqual([]);
    // The lock the refused run found is still there, still naming its holder.
    expect((await readSeriesLock(seriesDir)).kind).toBe("held");

    await releaseSeriesLock(seriesDir);
  });
});
