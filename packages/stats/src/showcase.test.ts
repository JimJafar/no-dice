/**
 * Which match of a finished series gets rendered.
 *
 * Four series directories on disk, in the shape the runner leaves one, because
 * every rule here is about a set of matches rather than one:
 *
 * - **A series with a winner and a middle half.** Ten counted matches — model X
 *   winning nine, one lost, plus a failed match and a voided one that must not be
 *   candidates. X's win rate is 9/10, whose 95% interval starts at 59.6%, so X
 *   won; its nine margins are 2, 3, 4, 5, 6, 7, 8, 9 and 93, so the quartiles are
 *   4 and 8 and the pool is the three wins between them. The most exciting match
 *   in the series (the knockout, score 64) and the joint-second (score 12, margin
 *   4, exactly on the lower quartile) are both filtered out, which is the whole
 *   point of the filter, and the choice lands on the 11-point match inside the
 *   middle half. The ranking list also settles a tie: two matches score 12 with
 *   the same final lead change, and the smaller margin ranks first.
 * - **A series with no winner.** Four matches, two won and two lost, so the
 *   interval covers 50% and there is no side whose margins define a middle half:
 *   every counted match is ranked, and the match that wins is one the series
 *   *loser* took. The output has to say there was no winner rather than let the
 *   choice look like a pick from the winner's matches.
 * - **A short series whose filter came up empty.** Five counted matches, all won
 *   by X, with margins 2, 4, 4, 4 and 93: both quartiles are 4, so nothing lies
 *   strictly between them and the rule widens to all five — and says it did.
 * - **A series that counted nothing.** Both matches failed, so there is no win
 *   rate, no winner and no match to render, and the sidecar still gets written
 *   with the reason rather than the command failing.
 *
 * Every expected figure is counted out again in this file — the lead changes,
 * swings and final lead changes off the fixture's own score lists, and the Wilson
 * interval off the textbook formula — so a change in either module shows up as a
 * failing expectation rather than a changed constant.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PassReason, Seat } from "@no-dice/log";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SHOWCASE_FORMAT,
  percentileOf,
  rankByExcitement,
  seriesShowcase,
  seriesWinnerOf,
  writeSeriesShowcase,
} from "./showcase.ts";
import type { Excitement, Showcase, ShowcaseMatch } from "./showcase.ts";
import { seriesReport } from "./series-report.ts";

/** Model X and its opponent, as the series record names them. */
const X = { kind: "bot", bot: "greedy" } as const;
const OPPONENT = { kind: "bot", bot: "random" } as const;
const X_LABEL = "bot:greedy";
const OPPONENT_LABEL = "bot:random";

/** The fixture map: two hexes, one Base each, and the board every turn leaves alone. */
const MAP = [
  { id: "A1", q: 0, r: 0, terrain: "base" },
  { id: "B2", q: 1, r: 0, terrain: "plain" },
];
const CELLS = [
  [1, 5, 0, 0],
  [2, 5, 0, 0],
];
const TROOPS = { A: 5, B: 5 };

/** How one fixture match ended. */
interface FixtureResult {
  type: "time" | "knockout";
  winner: Seat | null;
  margin: number;
}

/** One match of a fixture series. */
interface FixtureMatch {
  seed: number;
  /** The seat model X played in it, which is how the record says who won. */
  xSeat: Seat;
  /** The score after every turn, starting from a level 0-0 board. */
  scores: readonly (readonly [number, number])[];
  result?: FixtureResult;
  /** Recorded as failed rather than played. */
  failed?: boolean;
  /** A voiding pass reason on one turn, which is what makes the log not count. */
  voided?: PassReason;
}

/** One seat's turn record, empty apart from the pass that voids a match. */
const playerOf = (seat: Seat, voided: PassReason | undefined): unknown => ({
  tool_calls: [],
  scouts: [],
  rejected_submission: null,
  orders: [],
  wasted: [],
  intent: "",
  prediction: "",
  passed: seat === "A" ? (voided ?? null) : null,
  notes_after: "",
  usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  cost_usd: 0,
  context_tokens: 0,
  compacted: false,
  wall_ms: 0,
});

/** A `salient-log/1` the schema accepts, played out of the score list. */
const logOf = (match: FixtureMatch): Record<string, unknown> => {
  const scores = match.scores;
  const last = scores.at(-1)!;
  return {
    format: "salient-log/1",
    ruleset: "v0",
    engine_version: "0.1.0",
    created: "2026-10-06T00:00:00.000Z",
    seed: match.seed,
    config: {
      turns: scores.length,
      action_points: 6,
      start_troops: 5,
      base_production: 2,
      node_production: 1,
      node_garrison: 3,
      home_bonus: 1,
      points: { plain: 1, base: 1, node: 3 },
    },
    harness: {
      pi_version: null,
      context: "continuous",
      compaction: false,
      tool_call_cap: 12,
      simulate_cap: 3,
      resubmissions: 1,
      turn_timeout_s: 300,
      output_token_budget: null,
    },
    // X sits in the seat the record says it played, so the header and the record
    // tell the same story about who was where.
    players:
      match.xSeat === "A"
        ? { A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "random" } }
        : { A: { kind: "bot", bot: "random" }, B: { kind: "bot", bot: "greedy" } },
    map: MAP,
    bases: { A: "A1", B: "B2" },
    start: { cells: CELLS, score: { A: 0, B: 0 } },
    turns: scores.map(([a, b], i) => ({
      n: i + 1,
      players: { A: playerOf("A", match.voided), B: playerOf("B", match.voided) },
      events: [],
      after: { cells: CELLS, score: { A: a, B: b }, troops: TROOPS },
    })),
    result: {
      type: match.result?.type ?? "time",
      winner: match.result?.winner ?? null,
      turn: scores.length,
      score: { A: last[0], B: last[1] },
      margin: match.result?.margin ?? 0,
    },
  };
};

/** The log file name of one fixture match. */
const logName = (match: FixtureMatch): string =>
  `${String(match.seed)}-${match.xSeat === "A" ? "greedy-random" : "random-greedy"}.json`;

/** One match as `series.json` records it. */
const recordOf = (match: FixtureMatch): Record<string, unknown> =>
  match.failed === true
    ? {
        seat: match.xSeat,
        path: `matches/${logName(match)}`,
        status: "failed",
        error: "seat B: turn 1: model call failed (tool_surface)",
      }
    : {
        seat: match.xSeat,
        path: `matches/${logName(match)}`,
        status: "played",
        result: {
          type: match.result?.type ?? "time",
          winner: match.result?.winner ?? null,
          margin: match.result?.margin ?? 0,
        },
      };

/** Write one fixture series: its logs, and the `series.json` that names them. */
const writeSeries = async (root: string, name: string, matches: readonly FixtureMatch[]): Promise<string> => {
  const dir = join(root, name);
  await mkdir(join(dir, "matches"), { recursive: true });
  for (const match of matches) {
    if (match.failed === true) continue;
    await writeFile(join(dir, "matches", logName(match)), JSON.stringify(logOf(match)), "utf8");
  }
  const bySeed = new Map<number, FixtureMatch[]>();
  for (const match of matches) {
    const pair = bySeed.get(match.seed) ?? [];
    pair.push(match);
    bySeed.set(match.seed, pair);
  }
  await writeFile(
    join(dir, "series.json"),
    JSON.stringify({
      format: "salient-series/1",
      ruleset: "v0",
      created: "2026-10-06T00:00:00.000Z",
      max_pairs: bySeed.size,
      seeds: [...bySeed.keys()],
      pairing: { a: X, b: OPPONENT },
      pairs: [...bySeed.entries()].map(([seed, pair]) => ({
        seed,
        matches: pair.map(recordOf),
      })),
      state: {
        pairs_played: bySeed.size,
        matches_played: matches.filter((each) => each.failed !== true).length,
        matches_failed: matches.filter((each) => each.failed === true).length,
        stop_reason: "complete",
        stopped_early: false,
      },
    }),
    "utf8",
  );
  return dir;
};

/**
 * The ten counted matches. X wins nine — margins 2, 3, 4, 5, 6, 7, 8, 9 and the
 * 93 knockout — and loses one; a twelfth match failed and a thirteenth was voided
 * after X had won it, and neither may be a candidate.
 */
const CHOSEN: FixtureMatch[] = [
  // A quiet win by 2: the lead never changed and nothing swung more than a point.
  { seed: 301, xSeat: "A", scores: [[1, 0], [2, 0]], result: { type: "time", winner: "A", margin: 2 } },
  // The most exciting match in the series, and a knockout: its log's own margin is
  // the 57-point score gap, which `marginOf` turns into 93, so it sits outside the
  // middle half on its own however good a watch it would be.
  { seed: 301, xSeat: "B", scores: [[0, 1], [3, 1], [3, 60]], result: { type: "knockout", winner: "B", margin: 57 } },
  // 12 points of excitement at margin 4 — exactly the lower quartile, so out.
  { seed: 302, xSeat: "A", scores: [[1, 0], [1, 4], [8, 4]], result: { type: "time", winner: "A", margin: 4 } },
  // Also 12, with the same final lead change: the smaller margin ranks first.
  { seed: 302, xSeat: "B", scores: [[0, 1], [4, 0], [10, 13]], result: { type: "time", winner: "B", margin: 3 } },
  // 11 at margin 5: inside the middle half, and the match the series picks.
  { seed: 303, xSeat: "A", scores: [[1, 0], [1, 2], [6, 1]], result: { type: "time", winner: "A", margin: 5 } },
  { seed: 303, xSeat: "B", scores: [[0, 1], [0, 10], [0, 9]], result: { type: "time", winner: "B", margin: 9 } },
  { seed: 304, xSeat: "A", scores: [[1, 0], [2, 0], [6, 0]], result: { type: "time", winner: "A", margin: 6 } },
  // X's one loss, and an exciting one: not a candidate whatever it scores.
  { seed: 304, xSeat: "B", scores: [[0, 1], [5, 1], [5, 4]], result: { type: "time", winner: "A", margin: 1 } },
  { seed: 305, xSeat: "A", scores: [[1, 0], [7, 0], [7, 0]], result: { type: "time", winner: "A", margin: 7 } },
  { seed: 305, xSeat: "B", scores: [[0, 1], [0, 8], [0, 8]], result: { type: "time", winner: "B", margin: 8 } },
  // A match that never happened, and one that happened and was voided after X
  // won it by 40. Neither is a candidate, and the win rate is not moved by them.
  { seed: 306, xSeat: "A", scores: [[1, 0]], failed: true },
  {
    seed: 306,
    xSeat: "B",
    scores: [[0, 40]],
    result: { type: "time", winner: "B", margin: 40 },
    voided: "tool_surface",
  },
];

/** The four matches of a series that separated nothing: X won two and lost two. */
const DRAWN: FixtureMatch[] = [
  { seed: 401, xSeat: "A", scores: [[2, 0]], result: { type: "time", winner: "A", margin: 2 } },
  // The most exciting match of the four, and one X lost — which is only possible
  // because a series with no winner has no side whose wins get filtered.
  { seed: 401, xSeat: "B", scores: [[0, 1], [9, 1], [12, 9]], result: { type: "time", winner: "A", margin: 3 } },
  { seed: 402, xSeat: "A", scores: [[0, 1]], result: { type: "time", winner: "B", margin: 1 } },
  { seed: 402, xSeat: "B", scores: [[0, 1], [0, 5]], result: { type: "time", winner: "B", margin: 5 } },
];

/** Five counted matches, all won by X, with both quartiles landing on 4. */
const WIDENED: FixtureMatch[] = [
  { seed: 501, xSeat: "A", scores: [[2, 0]], result: { type: "time", winner: "A", margin: 2 } },
  { seed: 501, xSeat: "B", scores: [[0, 4]], result: { type: "time", winner: "B", margin: 4 } },
  { seed: 502, xSeat: "A", scores: [[4, 0]], result: { type: "time", winner: "A", margin: 4 } },
  { seed: 502, xSeat: "B", scores: [[0, 1]], failed: true },
  { seed: 503, xSeat: "A", scores: [[4, 0], [4, 0]], result: { type: "time", winner: "A", margin: 4 } },
  { seed: 503, xSeat: "B", scores: [[0, 1], [3, 60]], result: { type: "knockout", winner: "B", margin: 57 } },
];

/** A series whose two matches both failed: nothing counted, nothing to render. */
const EMPTY: FixtureMatch[] = [
  { seed: 601, xSeat: "A", scores: [[1, 0]], failed: true },
  { seed: 601, xSeat: "B", scores: [[1, 0]], failed: true },
];

/**
 * The lead figures counted off a fixture score list by plain loops, the way the
 * rules count them: a level board leaves the side ahead where it was, and the
 * first time a side goes ahead from a level start is not a change.
 */
const excitementOfScores = (scores: readonly (readonly [number, number])[]): Excitement => {
  let ahead: Seat | null = null;
  let differential = 0;
  let changes = 0;
  let finalChangeTurn = 0;
  let largestSwing = 0;
  for (const [turn, [a, b]] of scores.entries()) {
    const next = a - b;
    largestSwing = Math.max(largestSwing, Math.abs(next - differential));
    differential = next;
    const now: Seat | null = a === b ? null : a > b ? "A" : "B";
    if (now !== null) {
      if (ahead !== null && now !== ahead) {
        changes += 1;
        finalChangeTurn = turn + 1;
      }
      ahead = now;
    }
  }
  return {
    score: changes + largestSwing + finalChangeTurn,
    leadChanges: changes,
    largestSwing,
    finalChangeTurn,
  };
};

/** The 95% Wilson interval, off the textbook formula rather than off `wilson.ts`. */
const wilson = (successes: number, n: number): { low: number; high: number } => {
  const z = 1.96;
  const p = successes / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
};

/** One candidate as this file names it, so expectations read as seeds and seats. */
const at = (showcase: Showcase, seed: number, seat: Seat): ShowcaseMatch => {
  const match = showcase.ranked.find((each) => each.seed === seed && each.seat === seat);
  if (match === undefined) throw new Error(`the ranking holds no seed ${String(seed)} seat ${seat}`);
  return match;
};

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "no-dice-showcase-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the quartiles and the score", () => {
  it("takes a percentile by interpolating between the closest ranks", () => {
    const margins = [2, 3, 4, 5, 6, 7, 8, 9, 93];
    expect(percentileOf(margins, 0.25)).toBe(4);
    expect(percentileOf(margins, 0.75)).toBe(8);
    // Unsorted in, sorted out, and one value is its own quartile.
    expect(percentileOf([93, 2, 5], 0.5)).toBe(5);
    expect(percentileOf([7], 0.25)).toBe(7);
    expect(percentileOf([7], 0.75)).toBe(7);
    expect(percentileOf([1, 2], 0.5)).toBeCloseTo(1.5, 10);
  });

  it("refuses a percentile with nothing to take it over, or outside 0 and 1", () => {
    expect(() => percentileOf([], 0.5)).toThrow(/at least one margin/);
    expect(() => percentileOf([1], 1.5)).toThrow(/between 0 and 1/);
  });

  it("ranks by score, then the later final lead change, then the smaller margin", () => {
    const match = (
      seed: number,
      seat: Seat,
      score: number,
      finalChangeTurn: number,
      margin: number,
    ): ShowcaseMatch => ({
      seed,
      seat,
      path: `matches/${String(seed)}.json`,
      players: { A: X_LABEL, B: OPPONENT_LABEL },
      result: { type: "time", winner: "A", turn: 3, score: { A: margin, B: 0 }, margin },
      margin,
      excitement: { score, leadChanges: 0, largestSwing: 0, finalChangeTurn },
      kept: false,
    });
    const ranked = rankByExcitement([
      match(1, "A", 5, 2, 9),
      match(2, "A", 5, 7, 9),
      match(3, "A", 5, 7, 2),
      match(4, "A", 6, 0, 40),
    ]);
    // Highest first; on a tie the match still being decided later wins; on a tie
    // again the smaller margin; and the order is total, so it is one list.
    expect(ranked.map((each) => [each.seed, each.excitement.score])).toEqual([
      [4, 6],
      [3, 5],
      [2, 5],
      [1, 5],
    ]);
  });
});

describe("a series with a winner and a middle half", () => {
  let dir: string;
  let showcase: Showcase;

  beforeAll(async () => {
    dir = await writeSeries(root, "chosen", CHOSEN);
    showcase = await seriesShowcase(dir);
  });

  it("names the winner out of the report's interval", async () => {
    const report = await seriesReport(dir);
    expect(report.counted).toBe(10);
    expect(report.matches).toBe(12);
    expect(report.missing.total).toBe(2);

    const winner = seriesWinnerOf(report);
    expect(winner).not.toBeNull();
    expect(winner!.label).toBe(X_LABEL);
    expect(winner!.side).toBe("x");

    const interval = wilson(9, 10);
    expect(report.result.interval!.low).toBeCloseTo(interval.low, 10);
    expect(report.result.interval!.high).toBeCloseTo(interval.high, 10);
    expect(interval.low).toBeGreaterThan(0.5);
    expect(showcase.selection.winner).toEqual(winner);
    expect(showcase.series.winnerLabel).toBe(X_LABEL);
  });

  it("keeps only the winner's wins, and only those in the middle half of them", () => {
    // Nine of the ten counted matches were won by X: the loss at seed 304 is not
    // a candidate, and neither is the voided match X won by 40.
    expect(showcase.ranked).toHaveLength(9);
    expect(showcase.ranked.map((each) => [each.seed, each.seat]).sort()).toEqual(
      [
        [301, "A"],
        [301, "B"],
        [302, "A"],
        [302, "B"],
        [303, "A"],
        [303, "B"],
        [304, "A"],
        [305, "A"],
        [305, "B"],
      ].sort(),
    );

    const margins = showcase.ranked.map((each) => each.margin).sort((left, right) => left - right);
    expect(margins).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 93]);
    expect(showcase.selection.margins).toEqual({
      count: 9,
      low: 4,
      high: 8,
      kept: 3,
      widened: false,
    });
    // The kept ones, in the order they were ranked: 5, then 7, then 6.
    expect(showcase.ranked.filter((each) => each.kept).map((each) => each.margin)).toEqual([5, 7, 6]);
  });

  it("counts the excitement off the log's own scores, in three components", () => {
    for (const match of CHOSEN) {
      if (match.failed === true || match.voided !== undefined) continue;
      const ranked = showcase.ranked.find((each) => each.seed === match.seed && each.seat === match.xSeat);
      if (ranked === undefined) continue;
      expect([ranked.seed, ranked.excitement]).toEqual([
        match.seed,
        excitementOfScores(match.scores),
      ]);
    }
    expect(at(showcase, 301, "B").excitement).toEqual({
      score: 64,
      leadChanges: 2,
      largestSwing: 59,
      finalChangeTurn: 3,
    });
  });

  it("filters out the most exciting match when its margin is outside the middle half", () => {
    // The knockout scores 64 and the margin-4 match scores 12, both more than
    // anything inside the middle half, and neither is chosen.
    expect(at(showcase, 301, "B").kept).toBe(false);
    expect(at(showcase, 302, "A").kept).toBe(false);
    expect(at(showcase, 302, "B").kept).toBe(false);
    expect(at(showcase, 303, "B").kept).toBe(false);

    const chosen = showcase.match!;
    expect([chosen.seed, chosen.seat]).toEqual([303, "A"]);
    expect(chosen.margin).toBe(5);
    expect(chosen.excitement).toEqual({ score: 11, leadChanges: 2, largestSwing: 6, finalChangeTurn: 3 });
    // The choice is the best of the kept ones, and the ranking is the whole pool
    // in one order so a reader can see what was passed over.
    expect(showcase.ranked.map((each) => each.excitement.score)).toEqual([64, 12, 12, 11, 9, 7, 6, 4, 1]);
    expect(showcase.ranked.map((each) => [each.seed, each.seat])).toEqual([
      [301, "B"],
      [302, "B"],
      [302, "A"],
      [303, "A"],
      [303, "B"],
      [305, "B"],
      [305, "A"],
      [304, "A"],
      [301, "A"],
    ]);
  });

  it("hands over the path of the log rather than a copy of it", () => {
    const chosen = showcase.match!;
    expect(chosen.path).toBe(join(dir, "matches", "303-greedy-random.json"));
    expect(chosen.players).toEqual({ A: X_LABEL, B: OPPONENT_LABEL });
    expect(chosen.result).toEqual({
      type: "time",
      winner: "A",
      turn: 3,
      score: { A: 6, B: 1 },
      margin: 5,
    });
  });

  it("writes the sidecar, and writes the same bytes when run again", async () => {
    const first = await writeSeriesShowcase(dir);
    const written = await readFile(join(dir, "showcase.json"), "utf8");
    expect(first.path).toBe(join(dir, "showcase.json"));
    expect(first.json).toBe(written);

    const parsed = JSON.parse(written) as Record<string, any>;
    expect(parsed.format).toBe(SHOWCASE_FORMAT);
    expect(parsed.series.line).toBe(first.showcase.seriesLine);
    expect(parsed.series.line).toContain(`${X_LABEL} vs ${OPPONENT_LABEL}`);
    expect(parsed.series.line).toContain("90.0%");
    expect(parsed.series.line).toContain("95% 59.6% – 98.2%");
    expect(parsed.series.line).toContain("6 pairs");
    expect(parsed.series.line).toContain("stopped on complete");
    expect(parsed.series.pairs).toBe(6);
    expect(parsed.series.counted).toBe(10);
    expect(parsed.series.missing).toBe(2);
    expect(parsed.series.winner).toBe(X_LABEL);
    expect(parsed.selection.margins).toEqual({ count: 9, low: 4, high: 8, kept: 3, widened: false });
    expect(parsed.selection.note).toContain("bot:greedy won the series");
    expect(parsed.selection.note).toContain("3 of bot:greedy's 9 wins");
    expect(parsed.match.path).toBe(join(dir, "matches", "303-greedy-random.json"));
    expect(parsed.match.excitement).toEqual({
      score: 11,
      lead_changes: 2,
      largest_swing: 6,
      final_change_turn: 3,
    });
    expect(parsed.ranked).toHaveLength(9);

    // Idempotent: the file is a function of the series, so a second run over the
    // same series changes nothing on disk.
    const second = await writeSeriesShowcase(dir);
    expect(await readFile(join(dir, "showcase.json"), "utf8")).toBe(written);
    expect(second.json).toBe(written);
  });
});

describe("a series whose interval covers 50%", () => {
  let dir: string;
  let showcase: Showcase;

  beforeAll(async () => {
    dir = await writeSeries(root, "drawn", DRAWN);
    showcase = await seriesShowcase(dir);
  });

  it("says there is no winner and ranks every counted match", () => {
    const interval = wilson(2, 4);
    expect(interval.low).toBeLessThan(0.5);
    expect(interval.high).toBeGreaterThan(0.5);

    expect(showcase.selection.winner).toBeNull();
    expect(showcase.selection.basis).toBe("no_series_winner");
    expect(showcase.series.winnerLabel).toBeNull();
    expect(showcase.selection.margins).toEqual({ count: 0, low: null, high: null, kept: 4, widened: false });
    expect(showcase.selection.note).toContain("no series winner");
    expect(showcase.selection.note).toContain("covers 50%");
    expect(showcase.selection.note).toContain("every counted match was ranked");

    // All four counted matches are candidates, and the one that wins is a match X
    // lost: with no winner there is no side whose wins get filtered.
    expect(showcase.ranked).toHaveLength(4);
    expect(showcase.ranked.every((each) => each.kept)).toBe(true);
    expect(showcase.match!.seed).toBe(401);
    expect(showcase.match!.seat).toBe("B");
    expect(showcase.match!.result.winner).toBe("A");
    expect(showcase.match!.excitement).toEqual(excitementOfScores(DRAWN[1]!.scores));
  });

  it("still writes a series line, with the win rate it did have", async () => {
    const { json } = await writeSeriesShowcase(dir);
    const parsed = JSON.parse(json) as Record<string, any>;
    expect(parsed.series.winner).toBeNull();
    expect(parsed.series.line).toContain("50.0%");
    expect(parsed.series.line).toContain("2 pairs");
    expect(parsed.match.path).toBe(join(dir, "matches", "401-random-greedy.json"));
  });
});

describe("a short series whose middle half is empty", () => {
  let dir: string;
  let showcase: Showcase;

  beforeAll(async () => {
    dir = await writeSeries(root, "widened", WIDENED);
    showcase = await seriesShowcase(dir);
  });

  it("widens to all of the winner's matches and says that it did", () => {
    // Both quartiles are 4, so nothing lies strictly between them.
    expect(showcase.selection.margins).toEqual({
      count: 5,
      low: 4,
      high: 4,
      kept: 0,
      widened: true,
    });
    expect(showcase.selection.note).toContain("no win of bot:greedy had a margin strictly between");
    expect(showcase.selection.note).toContain("all 5 of its wins were ranked");

    expect(showcase.ranked).toHaveLength(5);
    expect(showcase.ranked.every((each) => each.kept)).toBe(true);
    // Widened, the knockout is back in play, and it is the best of them.
    expect(showcase.match!.seed).toBe(503);
    expect(showcase.match!.seat).toBe("B");
    expect(showcase.match!.margin).toBe(93);
    expect(showcase.match!.result.type).toBe("knockout");
  });

  it("counts a knockout as margin 93, not as the score gap its log records", () => {
    const knockout = showcase.ranked.find((each) => each.result.type === "knockout")!;
    expect(knockout.result.margin).toBe(57);
    expect(knockout.margin).toBe(93);
  });
});

describe("a series that counted nothing", () => {
  it("writes a sidecar that says so, rather than choosing or failing", async () => {
    const dir = await writeSeries(root, "empty", EMPTY);
    const showcase = await seriesShowcase(dir);

    expect(showcase.series.counted).toBe(0);
    expect(showcase.series.missing).toBe(2);
    expect(showcase.selection.winner).toBeNull();
    expect(showcase.selection.note).toContain("the series counted no match");
    expect(showcase.seriesLine).toContain("win rate — over no counted match");
    expect(showcase.ranked).toEqual([]);
    expect(showcase.match).toBeNull();

    const { json } = await writeSeriesShowcase(dir);
    const parsed = JSON.parse(json) as Record<string, any>;
    expect(parsed.match).toBeNull();
    expect(parsed.ranked).toEqual([]);
    expect(parsed.series.interval).toBeNull();
  });
});

describe("a directory that is not a series", () => {
  it("says so in one line, the way the report does", async () => {
    await expect(seriesShowcase(join(root, "no-such-series"))).rejects.toThrow(
      /is not there, so there is no series to report/,
    );
  });
});
