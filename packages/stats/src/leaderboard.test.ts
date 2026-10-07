/**
 * The leaderboard rows pooled out of several series reports.
 *
 * Three series on disk, in the shape the runner leaves one, chosen so that every
 * rule here is exercised by a case that could not be confused with another:
 *
 * - **`g-vs-r`** — Greedy (model X) against the Random bot, two pairs, four
 *   counted matches, nothing missing. Greedy wins two, loses one, draws one.
 * - **`o-vs-g`** — the model `acme/one` (model X) against Greedy, one pair of
 *   which one match was voided for `tool_surface`. `acme/one` loses the
 *   match that counts, and Greedy wins it from the other seat.
 * - **`hollow`** — Greedy against Random again, and both matches failed: nothing
 *   counted, so this series contributes no model rows at all, only missing
 *   matches to the two models its pairing names.
 *
 * A fourth series, `tied`, is pooled on its own: Random (model X) against
 * Greedy with both matches drawn, so both models sit at the same rate and only
 * the label can order the table.
 *
 * That gives three labels with three different histories. Greedy is in all three
 * pairings, Random in two, `acme/one` in one — so the missing counts separate
 * the attribution rule from the sums: Random's missing comes from `g-vs-r` and
 * `hollow` and not from `o-vs-g`, which never played it.
 *
 * Every expected figure is re-counted in this file off the fixture, and the
 * pooled interval is recomputed from the textbook Wilson formula rather than
 * taken from the module, so a pooled row that quietly averaged the per-series
 * intervals instead of taking one over the pooled `n` fails here.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PassReason, Seat } from "@no-dice/log";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pooledModelRows } from "./leaderboard.ts";
import type { PooledModelRow } from "./leaderboard.ts";
import { seriesReport } from "./series-report.ts";
import type { SeriesReport } from "./series-report.ts";

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

/** The three seats of the fixture, as a series record names them. */
const GREEDY = { kind: "bot", bot: "greedy" } as const;
const RANDOM = { kind: "bot", bot: "random" } as const;
const ONE = { kind: "model", provider: "acme", model: "one" } as const;
type SeatRef = typeof GREEDY | typeof RANDOM | typeof ONE;

/** The label a series record gives a seat — `seatLabel`'s spelling. */
const refLabel = (seat: SeatRef): string =>
  seat.kind === "bot" ? `bot:${seat.bot}` : `${seat.provider}/${seat.model}`;

/** The label a match log's header gives that same seat, which is what pools it. */
const headerOf = (seat: SeatRef): Record<string, unknown> =>
  seat.kind === "bot"
    ? { kind: "bot", bot: seat.bot }
    : { kind: "pi", model: `${seat.provider}/${seat.model}`, thinking: "medium", context_window: 131072 };

/** The file-name slug of a seat, as the runner spells it in a match file name. */
const slugOf = (seat: SeatRef): string =>
  (seat.kind === "bot" ? seat.bot : `${seat.provider}-${seat.model}`).replaceAll("/", "-");

/** How one fixture match ended. */
interface FixtureResult {
  type: "time" | "knockout";
  winner: Seat | null;
  margin: number;
}

/** One match of a fixture series. */
interface FixtureMatch {
  seed: number;
  /** The seat model X played in it. */
  xSeat: Seat;
  /** The score after every turn, starting from a level 0-0 board. */
  scores: readonly (readonly [number, number])[];
  result?: FixtureResult;
  /** Recorded as failed rather than played: no log, and missing. */
  failed?: boolean;
  /** A voiding pass reason on one turn, so the log exists and is still not a result. */
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
const logOf = (match: FixtureMatch, x: SeatRef, opponent: SeatRef): Record<string, unknown> => {
  const scores = match.scores;
  const last = scores.at(-1)!;
  const at = (seat: Seat): SeatRef => (seat === match.xSeat ? x : opponent);
  return {
    format: "salient-log/1",
    ruleset: "v0",
    engine_version: "0.1.0",
    created: "2026-10-07T00:00:00.000Z",
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
    // The header says who sat where, which is the only thing that lets the
    // same model be pooled across two series that put it in opposite seats.
    players: { A: headerOf(at("A")), B: headerOf(at("B")) },
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

/** The log file name of one fixture match: `<seed>-<seat A>-<seat B>.json`. */
const logName = (match: FixtureMatch, x: SeatRef, opponent: SeatRef): string => {
  const seats = match.xSeat === "A" ? [x, opponent] : [opponent, x];
  return `${String(match.seed)}-${slugOf(seats[0])}-${slugOf(seats[1])}.json`;
};

/** One match as `series.json` records it. */
const recordOf = (match: FixtureMatch, x: SeatRef, opponent: SeatRef): Record<string, unknown> =>
  match.failed === true
    ? {
        seat: match.xSeat,
        path: `matches/${logName(match, x, opponent)}`,
        status: "failed",
        error: "seat B: turn 1: the seat called `simulate` (tool_surface)",
      }
    : {
        seat: match.xSeat,
        path: `matches/${logName(match, x, opponent)}`,
        status: "played",
        result: {
          type: match.result?.type ?? "time",
          winner: match.result?.winner ?? null,
          margin: match.result?.margin ?? 0,
        },
      };

/** Write one fixture series: its logs, and the `series.json` that names them. */
const writeSeries = async (
  root: string,
  name: string,
  x: SeatRef,
  opponent: SeatRef,
  matches: readonly FixtureMatch[],
): Promise<string> => {
  const dir = join(root, name);
  await mkdir(join(dir, "matches"), { recursive: true });
  for (const match of matches) {
    if (match.failed === true) continue;
    await writeFile(
      join(dir, "matches", logName(match, x, opponent)),
      JSON.stringify(logOf(match, x, opponent)),
      "utf8",
    );
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
      created: "2026-10-07T00:00:00.000Z",
      max_pairs: bySeed.size,
      seeds: [...bySeed.keys()],
      pairing: { a: x, b: opponent },
      pairs: [...bySeed.entries()].map(([seed, pair]) => ({
        seed,
        matches: pair.map((match) => recordOf(match, x, opponent)),
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
 * Greedy's four counted matches: it wins both matches of seed 201, draws seed
 * 202's match from seat A and loses seed 202's from seat B — so it holds each
 * seat twice, which is what the seat swap is for.
 */
const GREEDY_VS_RANDOM: FixtureMatch[] = [
  { seed: 201, xSeat: "A", scores: [[1, 0], [2, 0]], result: { type: "time", winner: "A", margin: 2 } },
  { seed: 201, xSeat: "B", scores: [[0, 1], [0, 3]], result: { type: "time", winner: "B", margin: 3 } },
  { seed: 202, xSeat: "A", scores: [[1, 1], [2, 2]], result: { type: "time", winner: null, margin: 0 } },
  { seed: 202, xSeat: "B", scores: [[1, 0], [1, 4]], result: { type: "time", winner: "A", margin: 4 } },
];

/** `acme/one` loses the one match that counts and has the other voided. */
const ONE_VS_GREEDY: FixtureMatch[] = [
  { seed: 301, xSeat: "A", scores: [[0, 1], [1, 4]], result: { type: "time", winner: "B", margin: 3 } },
  {
    seed: 301,
    xSeat: "B",
    scores: [[1, 0], [3, 0]],
    result: { type: "time", winner: "B", margin: 3 },
    voided: "tool_surface",
  },
];

/** A pairing that played nothing: both matches failed. */
const HOLLOW: FixtureMatch[] = [
  { seed: 401, xSeat: "A", scores: [[0, 0]], failed: true },
  { seed: 401, xSeat: "B", scores: [[0, 0]], failed: true },
];

/** Both models drew both matches, so both sit at the same pooled rate. */
const BOTH_DREW: FixtureMatch[] = [
  { seed: 501, xSeat: "A", scores: [[1, 1], [2, 2]], result: { type: "time", winner: null, margin: 0 } },
  { seed: 501, xSeat: "B", scores: [[1, 1], [3, 3]], result: { type: "time", winner: null, margin: 0 } },
];

/**
 * The Wilson score interval, from the textbook formula rather than from the
 * module, so a pooled interval is proved to be one over the pooled `n`.
 */
const wilson = (successes: number, n: number, z: number): { low: number; high: number } => {
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
};

/** The row for one label, or a failure that names the label. */
const rowFor = (rows: readonly PooledModelRow[], label: string): PooledModelRow => {
  const row = rows.find((each) => each.label === label);
  if (row === undefined) throw new Error(`no pooled row for ${label}`);
  return row;
};

/** One model's row of one report, which is what a pooled row is the sum of. */
type ModelPart = SeriesReport["models"][number];

/** The reports of the fixture, in the order they were pooled. */
const reportsOf = (reports: readonly SeriesReport[], label: string): ModelPart[] =>
  reports
    .map((report) => report.models.find((model) => model.label === label))
    .filter((model): model is ModelPart => model !== undefined);

let root: string;
let gre: SeriesReport;
let one: SeriesReport;
let hollow: SeriesReport;
let tied: SeriesReport;
let pooled: PooledModelRow[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "no-dice-leaderboard-"));
  const greDir = await writeSeries(root, "g-vs-r", GREEDY, RANDOM, GREEDY_VS_RANDOM);
  const oneDir = await writeSeries(root, "o-vs-g", ONE, GREEDY, ONE_VS_GREEDY);
  const hollowDir = await writeSeries(root, "hollow", GREEDY, RANDOM, HOLLOW);
  const tiedDir = await writeSeries(root, "tied", RANDOM, GREEDY, BOTH_DREW);
  gre = await seriesReport(greDir);
  one = await seriesReport(oneDir);
  hollow = await seriesReport(hollowDir);
  tied = await seriesReport(tiedDir);
  pooled = pooledModelRows([gre, one, hollow]);
});

afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe("the fixture", () => {
  it("is three series with the histories the pooling needs", () => {
    expect([gre.counted, gre.missing.total]).toEqual([4, 0]);
    expect([one.counted, one.missing.total]).toEqual([1, 1]);
    expect([hollow.counted, hollow.missing.total]).toEqual([0, 2]);
    // The same model spelled the same way in both places it appears: the record
    // spells the pairing one way and the log header spells it the other, and it
    // is the agreement between them that makes one row rather than two.
    expect([gre.xLabel, gre.opponentLabel]).toEqual([refLabel(GREEDY), refLabel(RANDOM)]);
    expect(one.xLabel).toBe(refLabel(ONE));
    expect(gre.models.map((model) => model.label)).toEqual(["bot:greedy", "bot:random"]);
    expect(one.models.map((model) => model.label)).toEqual(["acme/one", "bot:greedy"]);
    expect(hollow.models).toEqual([]);
    expect(tied.models.map((model) => model.label)).toEqual(["bot:random", "bot:greedy"]);
  });
});

describe("the pooled rows", () => {
  it("has one row per model with a counted match, best rate first", () => {
    // Greedy 3 wins, 1 loss and 1 draw over five matches (0.7); Random 1, 2
    // and 1 over four (0.375); `acme/one` 0 for 1. Not label order, which is the
    // point: the rate decides, and the label only settles a tie.
    expect(pooled.map((row) => row.label)).toEqual(["bot:greedy", "bot:random", "acme/one"]);
    expect(pooled.map((row) => row.result.winRate.rate)).toEqual([0.7, 0.375, 0]);
  });

  it("sums each model's counted matches, wins, losses and draws over the reports", () => {
    const greedy = rowFor(pooled, "bot:greedy");
    // Three counted matches from `g-vs-r` and one from `o-vs-g`, where Greedy
    // held seat B of the match `acme/one` lost.
    expect(greedy.matches).toBe(4 + 1);
    expect(greedy.result.winRate).toEqual({
      wins: 3,
      losses: 1,
      draws: 1,
      n: 5,
      successes: 3.5,
      rate: 0.7,
    });
    expect(greedy.seats).toEqual({ A: 2, B: 3 });

    // The same statement for every row, in the general form: the pooled figures
    // are the sums of the reports' own per-model figures, and nothing else.
    const all = [gre, one, hollow];
    for (const row of pooled) {
      const parts = reportsOf(all, row.label);
      const sum = (pick: (model: ModelPart) => number): number =>
        parts.reduce((total, model) => total + pick(model), 0);
      expect(row.matches, row.label).toBe(sum((model) => model.matches));
      for (const key of ["wins", "losses", "draws"] as const) {
        const where = `${row.label} ${key}`;
        expect(row.result.winRate[key], where).toBe(sum((model) => model.result.winRate[key]));
      }
      expect(row.seats.A, `${row.label} seat A`).toBe(sum((model) => model.seats.A));
      expect(row.seats.B, `${row.label} seat B`).toBe(sum((model) => model.seats.B));
      expect(row.seats.A + row.seats.B, row.label).toBe(row.matches);
      expect(row.result.winRate.n, row.label).toBe(row.matches);
    }
  });

  it("takes one Wilson interval over the pooled matches, not an average of the reports'", () => {
    const greedy = rowFor(pooled, "bot:greedy");
    expect(greedy.result.confidence).toBe(0.95);
    expect(greedy.result.interval).toEqual(wilson(3.5, 5, 1.96));
    // The pooled interval is over the pooled `n`, so it is narrower than the
    // interval of either report it came from — an average of the two intervals
    // would not be, and would not be a Wilson interval at all.
    const alone = pooledModelRows([gre])[0];
    const width = (row: PooledModelRow): number => row.result.interval!.high - row.result.interval!.low;
    // Five counted matches against four, at a near rate: the pooled interval is
    // the tighter one, which an average of the reports' intervals need not be.
    expect(width(greedy)).toBeLessThan(width(alone));
    for (const row of pooled) {
      const rate = row.result.winRate.rate!;
      expect(row.result.interval!.low <= rate && rate <= row.result.interval!.high, row.label).toBe(true);
    }
  });

  it("pools the seat split too, over only the matches that model held each seat", () => {
    const greedy = rowFor(pooled, "bot:greedy");
    // Seat A: the two matches of `g-vs-r` it held A for — seed 201 won, seed 202
    // drawn. Seat B: seed 201 of that series won, seed 202 lost, and the one
    // counted match of `o-vs-g`, which it won from seat B as the opponent.
    expect(greedy.seatSplit.A.winRate).toEqual({
      wins: 1,
      losses: 0,
      draws: 1,
      n: 2,
      successes: 1.5,
      rate: 0.75,
    });
    expect(greedy.seatSplit.B.winRate).toEqual({
      wins: 2,
      losses: 1,
      draws: 0,
      n: 3,
      successes: 2,
      rate: 2 / 3,
    });
    expect(greedy.seatSplit.A.interval).toEqual(wilson(1.5, 2, 1.96));
    expect(greedy.seatSplit.B.interval).toEqual(wilson(2, 3, 1.96));

    for (const row of pooled) {
      expect(row.seatSplit.A.winRate.n + row.seatSplit.B.winRate.n, row.label).toBe(row.matches);
      expect(row.seatSplit.A.winRate.n + row.seatSplit.B.winRate.n).toBe(row.seats.A + row.seats.B);
    }
  });

  it("names the series it was pooled from, in the order the reports came in", () => {
    expect(rowFor(pooled, "bot:greedy").series).toEqual([gre.dir, one.dir]);
    expect(rowFor(pooled, "bot:random").series).toEqual([gre.dir]);
    expect(rowFor(pooled, "acme/one").series).toEqual([one.dir]);
  });

  it("attributes a missing match to the pairing, not to a model that failed to play it", () => {
    // `hollow` played nothing and its pairing is Greedy against Random, so its
    // two missing matches belong to both of those models. `o-vs-g`'s voided match
    // belongs to `acme/one` and Greedy, and never to Random, who was not in it.
    expect(rowFor(pooled, "bot:greedy").missing).toBe(0 + 1 + 2);
    expect(rowFor(pooled, "bot:random").missing).toBe(0 + 2);
    expect(rowFor(pooled, "acme/one").missing).toBe(1);
    // Missing never moves a win rate: Random's rate is over its four counted
    // matches, and its two missing matches are neither a win nor a loss.
    const random = rowFor(pooled, "bot:random");
    expect(random.result.winRate.n).toBe(4);
    expect(random.result.winRate.losses).toBe(2);
  });

  it("says in words on the row what its missing count is", () => {
    const note = rowFor(pooled, "bot:random").missingNote;
    expect(note).toContain("2 missing matches");
    expect(note).toContain("pairing");
    expect(note).toContain("not a loss");
    // And says so in the singular when there is one, which is the case a reader
    // is likeliest to misread as one lost match.
    expect(rowFor(pooled, "acme/one").missingNote).toContain("1 missing match attributed to the pairing");
    // A model with nothing missing is told that too, rather than shown a nought.
    expect(pooledModelRows([gre])[0].missingNote).toContain("No match");
  });

  it("gives no row to a model with no counted match", () => {
    // `hollow` recorded a pairing and lost both matches: it says nothing about
    // either model, and a row of noughts would read as a model that played and
    // lost. Its missing matches still belong to the models that do have rows.
    expect(pooledModelRows([hollow])).toEqual([]);
    expect(pooledModelRows([])).toEqual([]);
  });

  it("settles a tie of rates by the label, not by the order the reports came in", () => {
    // Both models drew both matches, so both sit at 0.5 and only the label can
    // decide. The report lists model X — Random — first, because that is the
    // seat the series was run to measure; the table puts Greedy first.
    expect(tied.models.map((model) => model.label)).toEqual(["bot:random", "bot:greedy"]);
    expect(pooledModelRows([tied]).map((row) => row.label)).toEqual(["bot:greedy", "bot:random"]);
  });

  it("gives the same table for the same disk", () => {
    expect(pooledModelRows([gre, one, hollow])).toEqual(pooled);
  });
});

describe("pooled over one series", () => {
  it("reproduces that series' own report figures for each model", () => {
    const rows = pooledModelRows([gre]);
    expect(rows.map((row) => row.label)).toEqual(["bot:greedy", "bot:random"]);

    // Model X's row is the report's headline row, to the digit.
    const x = rowFor(rows, gre.xLabel);
    expect(x.result.winRate).toEqual(gre.result.winRate);
    expect(x.result.interval).toEqual(gre.result.interval);
    expect(x.seatSplit).toEqual(gre.seatSplit);
    expect(x.matches).toBe(gre.counted);
    expect(x.missing).toBe(gre.missing.total);
    expect(x.series).toEqual([gre.dir]);

    // And the opponent's row is that model's own, which the report already
    // carries: pooling one series is the identity, and a pooled row that
    // re-derived anything would show up here.
    const opponent = rowFor(rows, gre.opponentLabel);
    const model = gre.models.find((each) => each.label === gre.opponentLabel)!;
    expect(opponent.result).toEqual(model.result);
    expect(opponent.seatSplit).toEqual(model.seatSplit);
    expect(opponent.matches).toBe(model.matches);
  });

  it("counts a model's missing matches as that series' missing, when it names it", () => {
    const rows = pooledModelRows([one]);
    expect(rowFor(rows, "acme/one").missing).toBe(one.missing.total);
    expect(rowFor(rows, "bot:greedy").missing).toBe(one.missing.total);
    // The match was denied to both seats of the pairing, so it is missing for
    // both of them — and it is not in either model's counted matches.
    expect(rowFor(rows, "bot:greedy").matches).toBe(one.counted);
  });
});
