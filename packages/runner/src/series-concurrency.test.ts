/**
 * Brief §6.5's concurrency knob: `--concurrency <n>`, a bounded pool over whole
 * pairs, default 1.
 *
 * A 150-match series played one pair at a time is about 48 hours of seat time
 * (`docs/pi-harness-notes.md` §7), so the pool is what makes a real series
 * runnable, and the provider's rate limits are what bound it. What has to stay
 * true when more than one pair is in flight is exactly what was true at 1, and
 * these tests are written against that rather than against the pool's internals:
 *
 * - **The pool is over pairs.** A pair's two matches run together — they are the
 *   same seed with the seats swapped and share nothing but the seed — and
 *   `--concurrency` says how many pairs run at once. The events a scripted
 *   `playMatch` records when each match starts and finishes say how many were
 *   ever in flight at once, and the same series at 1 and at 2 leaves the same
 *   logs and the same record.
 * - **The stopping test is still asked only at a batch boundary.** The same
 *   scripted results, keyed to the plan's seed order rather than to the order the
 *   pool happened to play them in, stop at the same pair count whatever the
 *   concurrency is, and a ceiling passed inside a batch still finishes that batch.
 * - **A failure stays local.** A match that throws is recorded as failed, its
 *   pair's other match and the rest of the batch are still played and recorded,
 *   and the series goes on to its next batch.
 * - **The record does not depend on the schedule.** Its pairs are in the plan's
 *   order even when the pool finished them in another one, and a `--concurrency`
 *   that is not a whole number of 1 or more is refused before a match is played.
 *
 * The scripted `playMatch` and the real log it leaves live in
 * `./scripted-series.ts`, shared with the runner and stopping-rule tests.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { MatchVoided } from "@no-dice/harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SeatArg } from "./args.ts";
import { runSeries } from "./series.ts";
import type { PlayMatch, SeriesMatchRecord, SeriesRecord } from "./series.ts";
import { planSeries } from "./series-plan.ts";
import { scripted } from "./scripted-series.ts";
import type { PlayCall, Scripted } from "./scripted-series.ts";

/** Model X: the model the series measures, and the one the seat swap moves. */
const X: SeatArg = { kind: "model", provider: "marvin", model: "subagent" };

/** The opponent every pair is played against. */
const OPPONENT: SeatArg = { kind: "bot", bot: "greedy" };

/** What one scripted match reports: 160 tokens over both seats, half a dollar. */
const WIN: Scripted = {
  type: "time",
  winner: "A",
  margin: 12,
  costUsd: 0.5,
  tokens: { input: 100, output: 10, cache_read: 50, cache_write: 0 },
};

/** Where a series is run, in a directory that is gone when the suite is done. */
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-series-concurrency-"));
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

/** The names of the logs a series has on disk, in name order. */
const logsOf = async (seriesDir: string): Promise<string[]> =>
  (await readdir(join(seriesDir, "matches"))).sort();

/** A scripted match starting, or finishing. */
interface MatchEvent {
  kind: "start" | "end";
  /** The seed the match was played on, which is what a pair is named by. */
  seed: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A scripted `playMatch` that records when each match starts and when it
 * finishes, and holds each one open for as long as the test asks. The hold is
 * what makes the answer about overlap a fact about the pool rather than about
 * scheduling luck: a pair whose matches are played together is in flight for the
 * whole of that hold.
 */
const timed = (
  events: MatchEvent[],
  calls: PlayCall[],
  decide: (call: PlayCall) => Scripted,
  holdFor: (call: PlayCall) => number = () => 10,
): PlayMatch => {
  const play = scripted(calls, async (call) => {
    await sleep(holdFor(call));
    return decide(call);
  });
  return async (options) => {
    events.push({ kind: "start", seed: options.seed });
    try {
      return await play(options);
    } finally {
      events.push({ kind: "end", seed: options.seed });
    }
  };
};

/** The most pairs ever in flight at once — a pair is one seed, played twice. */
const maxPairsInFlight = (events: readonly MatchEvent[]): number => {
  const open = new Set<number>();
  let max = 0;
  for (const event of events) {
    if (event.kind === "start") open.add(event.seed);
    else open.delete(event.seed);
    max = Math.max(max, open.size);
  }
  return max;
};

/** The most matches ever in flight at once, which is what a seat limit bounds. */
const maxMatchesInFlight = (events: readonly MatchEvent[]): number => {
  let open = 0;
  let max = 0;
  for (const event of events) {
    open += event.kind === "start" ? 1 : -1;
    max = Math.max(max, open);
  }
  return max;
};

/** The seeds a run finished its matches in, which is not the order it started them in. */
const finishedOrder = (events: readonly MatchEvent[]): number[] =>
  events.filter((event) => event.kind === "end").map((event) => event.seed);

/**
 * The part of a record that two runs of one series can be compared on: the pairs,
 * their results and the run's state, with the paths named by file rather than by
 * the directory each run was pointed at.
 */
const shapeOf = (record: SeriesRecord): unknown => ({
  seeds: record.seeds,
  pairs: record.pairs.map((pair) => ({
    seed: pair.seed,
    matches: pair.matches.map((match) => ({
      seat: match.seat,
      status: match.status,
      path: basename(match.path),
      ...(match.status === "played"
        ? { result: match.result, cost_usd: match.cost_usd, tokens: match.tokens }
        : { error: match.error }),
    })),
  })),
  state: record.state,
});

/** A recorded match the test expects to have been played. */
const playedMatch = (match: SeriesMatchRecord): Extract<SeriesMatchRecord, { status: "played" }> => {
  if (match.status !== "played") throw new Error(`expected a played match, got ${match.status}`);
  return match;
};

/** The same for a match the test expects to have failed. */
const failedMatch = (match: SeriesMatchRecord): Extract<SeriesMatchRecord, { status: "failed" }> => {
  if (match.status !== "failed") throw new Error(`expected a failed match, got ${match.status}`);
  return match;
};

describe("the pool is over whole pairs", () => {
  it("plays two pairs at a time under --concurrency 2 and one at a time by default", async () => {
    const atOne = await seriesAt("pool-one");
    const atTwo = await seriesAt("pool-two");
    const eventsOne: MatchEvent[] = [];
    const eventsTwo: MatchEvent[] = [];
    const callsOne: PlayCall[] = [];
    const callsTwo: PlayCall[] = [];

    // The same series, the same seed base, asked for twice: once at the default
    // and once with two pairs in flight.
    const runOne = await runSeries({
      dir: atOne,
      a: X,
      b: OPPONENT,
      maxPairs: 6,
      seedBase: 4242,
      playMatch: timed(eventsOne, callsOne, (call) => ({ ...WIN, winner: call.seat })),
    });
    const runTwo = await runSeries({
      dir: atTwo,
      a: X,
      b: OPPONENT,
      maxPairs: 6,
      seedBase: 4242,
      concurrency: 2,
      playMatch: timed(eventsTwo, callsTwo, (call) => ({ ...WIN, winner: call.seat })),
    });

    // Never more pairs in flight than the operator asked for, and never one pair
    // at a time when two were asked for.
    expect(maxPairsInFlight(eventsOne)).toBe(1);
    expect(maxPairsInFlight(eventsTwo)).toBe(2);
    // The two matches of a pair run together, so a pool of one pair is already
    // two matches, and a pool of two is four — which is why the default stays 1:
    // every one of those matches seats a Pi process of its own.
    expect(maxMatchesInFlight(eventsOne)).toBe(2);
    expect(maxMatchesInFlight(eventsTwo)).toBe(4);

    // Concurrency changes when the matches were played, not what the series is.
    expect(callsTwo).toHaveLength(callsOne.length);
    expect(await logsOf(atTwo)).toEqual(await logsOf(atOne));
    expect(runTwo.played).toBe(runOne.played);
    expect(runTwo.failed).toBe(0);

    const [first, second] = [await readRecord(atOne), await readRecord(atTwo)];
    expect(shapeOf(second)).toEqual(shapeOf(first));
  });

  it("never plays more pairs than it was given, across a batch boundary", async () => {
    const seriesDir = await seriesAt("pool-bounded");
    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 12, seedBase: 606 });
    const events: MatchEvent[] = [];
    const calls: PlayCall[] = [];
    // An even pairing, so it is the pair limit that ends this run and not the
    // interval: 12 pairs is three batches of 5, 5 and 2, so the pool is emptied
    // and refilled at every boundary as well as being bounded inside one.
    const won = new Set(plan.seeds.filter((_seed, at) => at % 2 === 0));

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 12,
      seedBase: 606,
      concurrency: 3,
      playMatch: timed(events, calls, (call) => ({
        ...WIN,
        winner: won.has(call.seed) ? call.seat : call.seat === "A" ? "B" : "A",
      })),
    });

    expect(maxPairsInFlight(events)).toBe(3);
    expect(calls).toHaveLength(24);
    const record = await readRecord(seriesDir);
    expect(record.state).toEqual({
      pairs_played: 12,
      matches_played: 24,
      matches_failed: 0,
      stop_reason: "max_pairs",
      stopped_early: false,
    });
  });

  it("records its pairs in the plan's order, whatever order the pool finished them in", async () => {
    const seriesDir = await seriesAt("pool-order");
    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 6, seedBase: 31_337 });
    const events: MatchEvent[] = [];
    const calls: PlayCall[] = [];

    // The first pair of the batch is held open longest, so the pool finishes the
    // batch in something other than the order the plan named.
    const held = new Map(plan.seeds.map((seed, at) => [seed, (plan.seeds.length - at) * 25]));
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 6,
      seedBase: 31_337,
      concurrency: 3,
      playMatch: timed(
        events,
        calls,
        (call) => ({ ...WIN, winner: call.seat }),
        (call) => held.get(call.seed) ?? 5,
      ),
    });

    // The matches really did come back out of order — otherwise this test would
    // be proving nothing about the record.
    expect(finishedOrder(events)).not.toEqual(plan.seeds);

    // The record is the series' memory, and it reads the same however the pool
    // happened to schedule the batch.
    const record = await readRecord(seriesDir);
    expect(record.pairs.map((pair) => pair.seed)).toEqual(plan.seeds);
    expect(record.seeds).toEqual(plan.seeds);
  });
});

describe("the stopping rules are unmoved by concurrency", () => {
  it("stops at the same pair count whatever the concurrency is", async () => {
    const atOne = await seriesAt("stop-one");
    const atThree = await seriesAt("stop-three");

    // The results are keyed to the plan's seed order, not to the order the pool
    // plays them in: two of the first ten pairs lose one match each, which is 18
    // wins in the first 20 matches and the 99% interval excluding 50% at the
    // second boundary.
    const plan = await planSeries({ dir: atOne, a: X, b: OPPONENT, maxPairs: 12, seedBase: 20_260_107 });
    const losing = new Set([plan.seeds[2], plan.seeds[8]]);
    const script = (events: MatchEvent[], calls: PlayCall[]): PlayMatch =>
      timed(events, calls, (call) =>
        losing.has(call.seed) && call.seat === "A"
          ? { ...WIN, winner: "B" }
          : { ...WIN, winner: call.seat },
      );

    const eventsOne: MatchEvent[] = [];
    const eventsThree: MatchEvent[] = [];
    const callsOne: PlayCall[] = [];
    const callsThree: PlayCall[] = [];

    await runSeries({
      dir: atOne,
      a: X,
      b: OPPONENT,
      maxPairs: 12,
      seedBase: 20_260_107,
      playMatch: script(eventsOne, callsOne),
    });
    await runSeries({
      dir: atThree,
      a: X,
      b: OPPONENT,
      maxPairs: 12,
      seedBase: 20_260_107,
      concurrency: 3,
      playMatch: script(eventsThree, callsThree),
    });

    // The same 20 matches and no more: the test is asked at the boundary, and a
    // pair is never split across one, so the pool cannot have played into the
    // next batch or stopped short of the boundary.
    expect(maxPairsInFlight(eventsThree)).toBe(3);
    expect(callsOne).toHaveLength(20);
    expect(callsThree).toHaveLength(20);

    const [first, third] = [await readRecord(atOne), await readRecord(atThree)];
    expect(third.pairs.map((pair) => pair.seed)).toEqual(first.pairs.map((pair) => pair.seed));
    expect(first.pairs).toHaveLength(10);
    expect(third.state).toEqual(first.state);
    expect(third.state).toEqual({
      pairs_played: 10,
      matches_played: 20,
      matches_failed: 0,
      stop_reason: "wilson_interval",
      stopped_early: true,
    });
    if (first.stop?.reason !== "wilson_interval" || third.stop?.reason !== "wilson_interval") {
      throw new Error("expected the interval to end both runs");
    }
    expect(third.stop.test.win_rate).toEqual(first.stop.test.win_rate);
    expect(third.stop.test.win_rate).toEqual({ wins: 18, losses: 2, draws: 0, n: 20, successes: 18, rate: 0.9 });
  });

  it("finishes a batch a ceiling was passed inside, with pairs in flight", async () => {
    const seriesDir = await seriesAt("ceiling-batch");
    const events: MatchEvent[] = [];
    const calls: PlayCall[] = [];

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 12,
      seedBase: 4242,
      // Passed by the third match of the batch, and still not acted on until the
      // batch of 5 pairs is done.
      maxTokens: 400,
      concurrency: 2,
      playMatch: timed(events, calls, (call) => ({ ...WIN, winner: call.seat })),
    });

    // Nothing was cut short: 5 pairs, 10 matches, and the ceiling named at the
    // boundary the whole batch had reached.
    expect(calls).toHaveLength(10);
    expect(await logsOf(seriesDir)).toHaveLength(10);
    const record = await readRecord(seriesDir);
    expect(record.pairs).toHaveLength(5);
    expect(record.state).toEqual({
      pairs_played: 5,
      matches_played: 10,
      matches_failed: 0,
      stop_reason: "max_tokens",
      stopped_early: true,
    });
    if (record.stop?.reason !== "max_tokens") throw new Error("expected the token ceiling to stop the series");
    expect(record.stop.totals.tokens.total).toBe(1600);
  });
});

describe("a match that throws under concurrency", () => {
  it("is recorded as failed while its batch is played and recorded around it", async () => {
    const seriesDir = await seriesAt("throwing");
    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 7, seedBase: 7777 });
    // One match of a pair in the first batch, and the pair it belongs to.
    const broken = plan.pairs[1].matches[1];
    const events: MatchEvent[] = [];
    const calls: PlayCall[] = [];

    const failing: PlayMatch = timed(events, calls, (call) => {
      if (call.seed === broken.seed && call.seat === broken.seat) {
        throw new MatchVoided("tool_surface", "seat A reached outside the seven tools");
      }
      return { ...WIN, winner: call.seat };
    });

    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 7,
      seedBase: 7777,
      concurrency: 2,
      playMatch: failing,
    });

    // Every match of both batches was asked for: the throw took nothing down with
    // it, not the match it was played beside and not the batch after.
    expect(maxPairsInFlight(events)).toBe(2);
    expect(calls).toHaveLength(14);
    expect(run.failed).toBe(1);
    expect(run.played).toBe(13);
    expect(await logsOf(seriesDir)).toHaveLength(13);
    expect(existsSync(join(seriesDir, "matches", basename(broken.out)))).toBe(false);

    const record = await readRecord(seriesDir);
    const pair = record.pairs.find((each) => each.seed === broken.seed);
    if (pair === undefined) throw new Error("the pair of the match that threw is not in the record");
    const [first, second] = pair.matches;
    // The match that was played alongside the throw is still a played match.
    expect(playedMatch(first).path).toBe(plan.pairs[1].matches[0].out);
    const failed = failedMatch(second);
    expect(failed.path).toBe(broken.out);
    expect(failed.error).toBe("MatchVoided: seat A reached outside the seven tools (tool_surface)");

    // A failed match makes its pair unplayed, and the series still ran its length.
    expect(record.state).toEqual({
      pairs_played: 6,
      matches_played: 13,
      matches_failed: 1,
      stop_reason: "max_pairs",
      stopped_early: false,
    });
    for (const other of record.pairs.filter((each) => each.seed !== broken.seed)) {
      for (const match of other.matches) playedMatch(match);
    }
  });
});

describe("the --concurrency flag itself", () => {
  it("refuses a concurrency that is not a whole number of 1 or more, before playing anything", async () => {
    const seriesDir = await seriesAt("bad-concurrency");
    const calls: PlayCall[] = [];

    for (const value of [0, -1, 1.5, Number.NaN]) {
      await expect(
        runSeries({
          dir: seriesDir,
          a: X,
          b: OPPONENT,
          maxPairs: 2,
          seedBase: 5,
          concurrency: value,
          playMatch: scripted(calls, () => WIN),
        }),
      ).rejects.toThrow(`--concurrency takes a whole number of 1 or more, not ${String(value)}`);
    }

    // Nothing was played and nothing was recorded: a series that cannot be
    // scheduled is a mistake on the command line, not a run that started.
    expect(calls).toEqual([]);
    expect(existsSync(join(seriesDir, "series.json"))).toBe(false);
    expect(existsSync(join(seriesDir, "matches"))).toBe(false);
  });
});
