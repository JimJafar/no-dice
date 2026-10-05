/**
 * Brief §6.5's stopping rules, and brief §8's adaptive-stop test.
 *
 * The rules are asked at the end of every batch of 5 pairs, so the tests are
 * written the way brief §8 asks — with scripted results through the `playMatch`
 * seam, each leaving a real `salient-log/1` on disk (the fixture is
 * `./scripted-series.ts`, shared with the resume tests). Three things end a
 * series, and each is proved at the level it lives at:
 *
 * - **The interval.** 18 wins in the first 20 matches stop the series at 10
 *   pairs, and `series.json` says it stopped early and names the 99% interval
 *   that decided it — the 99% one, not the report's 95%, which is the difference
 *   between a low of 0.62 and one of 0.70. Alternating wins run to `--max-pairs`
 *   and say they did not stop early.
 * - **The ceilings.** A run whose summed tokens or cost pass `--max-tokens` or
 *   `--max-cost` stops at the *next batch boundary*, names which ceiling fired
 *   and what the totals were there, and never splits a pair — a ceiling passed
 *   on the third match still finishes its batch of 5 pairs. Totals are counted
 *   over the matches on disk, so a series resumed a week later is bounded by
 *   what it has already spent, not only by what this run played.
 * - **The order they are asked in**, which is a pure decision and tested as one:
 *   the pair limit, then the ceilings, then the interval.
 */
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Seat } from "@no-dice/log";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SeatArg } from "./args.ts";
import { runSeries } from "./series.ts";
import type { PlayMatch, SeriesRecord } from "./series.ts";
import { checkCeilings, decideStop } from "./series-stop.ts";
import type { PlayedMatch, SeriesTotals, StopRecord } from "./series-stop.ts";
import { scripted } from "./scripted-series.ts";
import type { PlayCall } from "./scripted-series.ts";

/** Model X: the model the series measures, and the one the seat swap moves. */
const X: SeatArg = { kind: "model", provider: "marvin", model: "subagent" };

/** The opponent every pair is played against. */
const OPPONENT: SeatArg = { kind: "bot", bot: "greedy" };

/** What one scripted match reports: 160 tokens over both seats, half a dollar. */
const TOKENS = { input: 100, output: 10, cache_read: 50, cache_write: 0 };
const COST = 0.5;

/** Where a series is run, in a directory that is gone when the suite is done. */
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-series-stop-"));
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

/** `series.json` as written, typed as the record the runner defines. */
const readRecord = async (seriesDir: string): Promise<SeriesRecord> =>
  JSON.parse(await readFile(join(seriesDir, "series.json"), "utf8")) as SeriesRecord;

/** The logs a series has on disk, in name order. */
const logsOf = async (seriesDir: string): Promise<string[]> =>
  (await readdir(join(seriesDir, "matches"))).sort();

/** The seat model X's opponent plays. */
const other = (seat: Seat): Seat => (seat === "A" ? "B" : "A");

/**
 * A script that hands match number `n` (1-based, as counted when the call is
 * made) to model X unless it is in `losses`. The winner is named for the seat X
 * played in that match, so the seat swap does not decide the result.
 */
const xWins = (calls: PlayCall[], losses: readonly number[] = []): PlayMatch =>
  scripted(calls, (call) => {
    const won = !losses.includes(calls.length);
    return {
      type: "time",
      winner: won ? call.seat : other(call.seat),
      margin: 12,
      costUsd: COST,
      tokens: TOKENS,
    };
  });

/** A script where model X takes every other match, which is an even pairing. */
const alternating = (calls: PlayCall[]): PlayMatch =>
  scripted(calls, (call) => ({
    type: "time",
    winner: calls.length % 2 === 1 ? call.seat : other(call.seat),
    margin: 12,
    costUsd: COST,
    tokens: TOKENS,
  }));

/**
 * The record's stop, narrowed to the reason the test expects. A rule that did
 * not fire is a failure with a message, rather than a property access on
 * `undefined` in the middle of an assertion.
 */
const stoppedFor = <R extends StopRecord["reason"]>(
  record: SeriesRecord,
  reason: R,
): Extract<NonNullable<SeriesRecord["stop"]>, { reason: R }> => {
  const stop = record.stop;
  if (stop === undefined || stop.reason !== reason) {
    throw new Error(`expected the series to stop for "${reason}", got ${stop?.reason ?? "no stop"}`);
  }
  return stop as Extract<NonNullable<SeriesRecord["stop"]>, { reason: R }>;
};

/** The 99% Wilson interval for 18 wins in 20 matches, worked out by hand. */
const WILSON_99_OF_18_IN_20 = { low: 0.6205, high: 0.9802 };

/** `wins` wins and `losses` losses, every one of them played by X in seat A. */
const played = (wins: number, losses: number): PlayedMatch[] => [
  ...Array.from({ length: wins }, () => ({ seat: "A" as Seat, result: { winner: "A" as Seat | null } })),
  ...Array.from({ length: losses }, () => ({ seat: "A" as Seat, result: { winner: "B" as Seat | null } })),
];

/** The totals over `matches` played at `TOKENS` and `COST` each. */
const totalsOf = (matches: number): SeriesTotals => ({
  cost_usd: COST * matches,
  tokens: {
    input: TOKENS.input * matches,
    output: TOKENS.output * matches,
    cache_read: TOKENS.cache_read * matches,
    cache_write: 0,
    total: 160 * matches,
  },
});

describe("the 99% interval ends a series once the result is clear", () => {
  it("stops at 10 pairs when 18 of the first 20 matches are wins", async () => {
    const seriesDir = await seriesAt("adaptive-stop");
    const calls: PlayCall[] = [];

    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      // Well past the 10 pairs the test starts at, so the interval is the only
      // thing that can end this run.
      maxPairs: 20,
      seedBase: 20_260_107,
      playMatch: xWins(calls, [5, 17]),
    });

    // Brief §8's adaptive stop: the series ends at the 10-pair boundary and never
    // plays the pair that follows it.
    expect(calls).toHaveLength(20);
    expect(await logsOf(seriesDir)).toHaveLength(20);
    expect(run.played).toBe(20);

    const record = await readRecord(seriesDir);
    expect(record.pairs).toHaveLength(10);
    expect(record.state).toEqual({
      pairs_played: 10,
      matches_played: 20,
      matches_failed: 0,
      stop_reason: "wilson_interval",
      stopped_early: true,
    });

    const stop = stoppedFor(record, "wilson_interval");
    expect(stop.test.win_rate).toEqual({
      wins: 18,
      losses: 2,
      draws: 0,
      n: 20,
      successes: 18,
      rate: 0.9,
    });
    expect(stop.test.confidence).toBe(0.99);
    expect(stop.test.excludes_half).toBe(true);
    expect(stop.test.interval.low).toBeGreaterThan(0.5);
    // The 99% figure, not the report's 95%: at 95% the same 18 in 20 gives a low
    // of 0.699, and a series that stopped on that would have stopped on a test it
    // was not supposed to apply.
    expect(stop.test.interval).toEqual({
      low: expect.closeTo(WILSON_99_OF_18_IN_20.low, 4),
      high: expect.closeTo(WILSON_99_OF_18_IN_20.high, 4),
    });
  });

  it("runs to --max-pairs when the wins alternate, and says it did not stop early", async () => {
    const seriesDir = await seriesAt("alternating");
    const calls: PlayCall[] = [];

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      // Past 10 pairs, so the interval is applied twice and declines both times.
      maxPairs: 12,
      seedBase: 606,
      playMatch: alternating(calls),
    });

    expect(calls).toHaveLength(24);
    const record = await readRecord(seriesDir);
    expect(record.pairs).toHaveLength(12);
    expect(record.state).toEqual({
      pairs_played: 12,
      matches_played: 24,
      matches_failed: 0,
      stop_reason: "max_pairs",
      stopped_early: false,
    });

    // The record still says what the test found at the boundary it stopped at, so
    // a report can show the interval the series was measured by.
    const stop = stoppedFor(record, "max_pairs");
    expect(stop.test).not.toBeNull();
    expect(stop.test?.confidence).toBe(0.99);
    expect(stop.test?.excludes_half).toBe(false);
    expect(stop.test?.win_rate.rate).toBe(0.5);
  });

  it("applies the test at every boundary from 10 pairs on, not before", async () => {
    // A unit view of the same rule: 18 straight wins over 9 pairs is a result no
    // interval would dispute, and the series plays on to the next batch.
    const matches = played(18, 0);
    const early = decideStop({
      pairsPlayed: 9,
      matches,
      totals: totalsOf(18),
      maxPairs: 75,
    });
    if (early.stopped) throw new Error("9 pairs of straight wins must not stop the series");
    expect(early.test).toBeNull();

    const atTen = decideStop({
      pairsPlayed: 10,
      matches: played(20, 0),
      totals: totalsOf(20),
      maxPairs: 75,
    });
    if (!atTen.stopped) throw new Error("20 straight wins must stop the series at 10 pairs");
    if (atTen.stop.reason !== "wilson_interval") {
      throw new Error(`expected the interval to decide it, got ${atTen.stop.reason}`);
    }
    expect(atTen.stop.test.excludes_half).toBe(true);
    expect(atTen.stop.test.win_rate).toEqual({ wins: 20, losses: 0, draws: 0, n: 20, successes: 20, rate: 1 });
  });
});

describe("the cost and token ceilings", () => {
  it("stops at the next batch boundary once the tokens pass --max-tokens", async () => {
    const seriesDir = await seriesAt("token-ceiling");
    const calls: PlayCall[] = [];

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 12,
      seedBase: 4242,
      // Passed by the third match (480 tokens), and still not acted on until the
      // batch of 5 pairs is done.
      maxTokens: 400,
      playMatch: xWins(calls),
    });

    // A pair is never split and a batch is never cut short: 5 pairs, 10 matches.
    expect(calls).toHaveLength(10);
    const record = await readRecord(seriesDir);
    expect(record.pairs).toHaveLength(5);
    for (const pair of record.pairs) {
      expect(pair.matches.map((match) => match.status)).toEqual(["played", "played"]);
    }
    expect(record.state).toEqual({
      pairs_played: 5,
      matches_played: 10,
      matches_failed: 0,
      stop_reason: "max_tokens",
      stopped_early: true,
    });

    const stop = stoppedFor(record, "max_tokens");
    expect(stop.ceiling_tokens).toBe(400);
    expect(stop.totals).toEqual({
      cost_usd: 5,
      tokens: { input: 1000, output: 100, cache_read: 500, cache_write: 0, total: 1600 },
    });
    // The series had not reached the 10 pairs the interval test starts at, so
    // there is no interval to record at this boundary.
    expect(stop.test).toBeNull();
  });

  it("stops at the next batch boundary once the cost passes --max-cost", async () => {
    const seriesDir = await seriesAt("cost-ceiling");
    const calls: PlayCall[] = [];

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 12,
      seedBase: 909,
      // $5 for the first batch, against a $2 ceiling.
      maxCostUsd: 2,
      playMatch: xWins(calls),
    });

    expect(calls).toHaveLength(10);
    const record = await readRecord(seriesDir);
    expect(record.state).toEqual({
      pairs_played: 5,
      matches_played: 10,
      matches_failed: 0,
      stop_reason: "max_cost",
      stopped_early: true,
    });

    const stop = stoppedFor(record, "max_cost");
    expect(stop.ceiling_usd).toBe(2);
    expect(stop.totals.cost_usd).toBe(5);
    expect(stop.totals.tokens.total).toBe(1600);
  });

  it("plays on when the total lands exactly on the ceiling", async () => {
    const seriesDir = await seriesAt("at-ceiling");
    const calls: PlayCall[] = [];

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      // The first batch comes to exactly 1600 tokens, which is what it was
      // allowed to spend: the ceiling stops a run that passes it, not one that
      // reaches it.
      maxTokens: 1600,
      maxPairs: 6,
      seedBase: 33,
      playMatch: xWins(calls),
    });

    expect(calls).toHaveLength(12);
    const record = await readRecord(seriesDir);
    // The pair limit ends it, which is the series running its full length, with
    // the tokens it spent on the way recorded at that boundary.
    const stop = stoppedFor(record, "max_pairs");
    expect(stop.totals.tokens.total).toBe(1920);
    expect(record.state.stopped_early).toBe(false);
  });

  it("counts what an earlier run already spent, so a resumed series stops at once", async () => {
    const seriesDir = await seriesAt("resumed-ceiling");
    const first: PlayCall[] = [];
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 5,
      seedBase: 71,
      playMatch: xWins(first),
    });

    // The same series asked for longer, with a ceiling it has already passed on
    // the matches that are on disk.
    const again: PlayCall[] = [];
    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 12,
      maxTokens: 1500,
      seedBase: 71,
      playMatch: xWins(again),
    });

    expect(again).toEqual([]);
    expect(run.played).toBe(0);
    expect(run.skipped).toBe(10);

    const record = await readRecord(seriesDir);
    const stop = stoppedFor(record, "max_tokens");
    expect(stop.ceiling_tokens).toBe(1500);
    expect(stop.totals.tokens.total).toBe(1600);
    expect(record.state.stopped_early).toBe(true);
  });

  it("names the token ceiling before the cost one, and before the interval", () => {
    const both = decideStop({
      pairsPlayed: 5,
      matches: played(5, 5),
      totals: totalsOf(10),
      maxPairs: 75,
      ceilings: { maxTokens: 1000, maxCostUsd: 1 },
    });
    if (!both.stopped) throw new Error("a passed ceiling must stop the series");
    // Tokens are the ceiling that binds on unpriced hardware
    // (`docs/pi-harness-notes.md` §7), so they are the one a report reads.
    expect(both.stop.reason).toBe("max_tokens");

    // A ceiling stops a run that has passed it whatever the interval says, and
    // the interval is still recorded at that boundary.
    const clear = decideStop({
      pairsPlayed: 10,
      matches: played(18, 2),
      totals: totalsOf(20),
      maxPairs: 75,
      ceilings: { maxTokens: 100 },
    });
    if (!clear.stopped) throw new Error("a passed ceiling must stop the series");
    expect(clear.stop.reason).toBe("max_tokens");
    expect(clear.stop.test?.excludes_half).toBe(true);
  });

  it("refuses a ceiling that is not a number of 0 or more", () => {
    expect(() => checkCeilings({ maxCostUsd: -1 })).toThrow(
      "--max-cost takes a number of 0 or more, not -1",
    );
    expect(() => checkCeilings({ maxTokens: Number.NaN })).toThrow(
      "--max-tokens takes a number of 0 or more, not NaN",
    );
  });
});
