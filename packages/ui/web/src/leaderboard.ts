/**
 * The leaderboard section's read: `GET /api/leaderboard`, and the shapes the page
 * accepts from it. Drawing them is `render-leaderboard.ts`'s business.
 *
 * **The page does no arithmetic.** Not one win counted, rate divided or interval
 * taken. The per-pairing rows are the figures `seriesReport` prints for that
 * directory — the same ones `no-dice stats` prints and `report.md` holds — and
 * the pooled rows are `pooledModelRows`' in `@no-dice/stats/leaderboard`, which
 * sums the reports' own counts and puts the sums back through the report's own
 * `resultOf`. A rate worked out here would be a second account of the same
 * matches, and the section's whole claim is that there is only one. The only
 * arithmetic left is turning a rate into a percentage for reading.
 *
 * **One read, at the listings' clock.** That answer reads `series.json` and every
 * match log each record names — about a megabyte each (`docs/pi-harness-notes.md`
 * §7) — so the page asks for it when it asks for `/api/series` and `/api/matches`
 * and at no other moment: on open, and when a run it was watching ends. The two
 * tables come back in one answer because they are two views of one walk of the
 * disk; a page that read them separately would pay for the walk twice and
 * could be shown two answers that disagree.
 *
 * **What the row declares.** Only what this section draws. The
 * per-pairing row carries the pairing, the counts, the rate with its interval and
 * the stop, plus `reportUrl` — the `report.md` this console serves — and leaves
 * out the ceilings and the resume flag, which the results section owns. The
 * pooled row carries the counts, the pooled result, the seat split, the missing
 * count with the stats package's own note about what it means, and the series it
 * was pooled from. A model with no counted match is in no row at all, which is
 * the stats package's rule and not one this page gets an opinion on.
 *
 * The shapes below are declared here rather than imported from
 * `packages/ui/src/leaderboard.ts`, which reads the filesystem and pulls in
 * `@no-dice/stats`; a browser bundle may not. `parseLeaderboard` is what keeps the
 * two halves from drifting quietly: an answer missing a field is one readable
 * line, not an `undefined` drawn into the page.
 */
import { getJson } from "./api.ts";
import type { FetchJson } from "./api.ts";

/** Where the page reads both leaderboard views. */
export const LEADERBOARD_PATH = "/api/leaderboard";

/** The 95% interval the report quotes, or `null` when nothing was counted. */
export interface Interval {
  low: number;
  high: number;
}

/**
 * One result as the console answers it: the rate, the interval over the same
 * matches, and the confidence that interval was taken at. `rate` and `interval`
 * are `null` together, over no counted match, which is when there is no rate to
 * quote rather than a rate of nought.
 */
export interface ResultCell {
  /** Every outcome counted: the `n` the interval was taken over. */
  n: number;
  rate: number | null;
  interval: Interval | null;
  confidence: number;
}

/** One series — one pairing — as the leaderboard lists it. */
export interface SeriesRow {
  /** The directory's own name, which is what `--name` gave it. */
  name: string;
  /** The pairing, spelled as `--a` and `--b` spell it. */
  a: string;
  b: string;
  /** The pair limit the record holds, and the pairs and matches it lists. */
  maxPairs: number;
  pairs: number;
  matches: number;
  /** The matches every figure below is taken over, and the ones left out of it. */
  counted: number;
  missing: number;
  /** Which rule ended it, and whether that was short of `maxPairs`. */
  stopReason: string;
  stoppedEarly: boolean;
  /** The headline row of the series' own report, with its 95% interval. */
  winRate: number | null;
  interval: Interval | null;
  confidence: number;
  /** The `report.md` this console serves for the series, under `/logs/`. */
  reportUrl: string;
}

/** One model, pooled over every series under the root that counted a match for it. */
export interface ModelRow {
  /** The label as the log headers spell it: `<provider>/<id>`, or `bot:<name>`. */
  label: string;
  /** Counted matches over every series this row was pooled from. */
  matches: number;
  /** The pooled rate, with the 95% interval over the pooled `n`. */
  result: ResultCell;
  /** The same pooled counts, over only the matches this model played from each seat. */
  seatSplit: { A: ResultCell; B: ResultCell };
  /** The missing matches of every series whose pairing names this model. */
  missing: number;
  /** The stats package's own words for what `missing` is: drawn as they came. */
  missingNote: string;
  /** The series directories whose counted matches this row is made of. */
  series: string[];
}

/** A directory under the root that holds a `series.json` this console could not read. */
export interface UnreadableRow {
  name: string;
  dir: string;
  /** The one line the report failed on, which the page shows as it stands. */
  error: string;
}

/** Both views, from one walk of the series root. */
export interface Leaderboard {
  seriesRoot: string;
  /** The per-pairing view: one row per series under the root. */
  series: SeriesRow[];
  /** The per-model view: one row per model, pooled over every one of those series. */
  models: ModelRow[];
  /** Directories under the root whose record this console could not report. */
  unreadable: UnreadableRow[];
}

/** Anything that should have been an object, as the line that says it was not. */
const recordOf = (value: unknown, what: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
};

/** A word, or the line that says the answer is not one. */
const stringOf = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw new Error(`${what} is not a string`);
  return value;
};

/** A count, or the line that says the answer is not one. */
const countOf = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a count`);
  return value;
};

/** A yes or no, or the line that says the answer is neither. */
const boolOf = (value: unknown, what: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${what} is not a yes or no`);
  return value;
};

/** A rate that may be absent, or the line that says it is neither. */
const rateOf = (value: unknown, what: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a rate`);
  return value;
};

/** The interval a result quotes, or `null` for a result over nothing counted. */
const intervalOf = (value: unknown, what: string): Interval | null => {
  if (value === null) return null;
  const interval = recordOf(value, what);
  return { low: countOf(interval["low"], `${what}.low`), high: countOf(interval["high"], `${what}.high`) };
};

/** A list of words, each named in a failure. */
const stringsOf = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list`);
  return value.map((each, at) => stringOf(each, `${what}[${String(at)}]`));
};

/**
 * One result as the console answers it: `winRate`'s `n` and `rate`, and the
 * interval and confidence beside them. The counts of wins and losses are left
 * out because this section never states them — a win rate quoted over a pooled
 * `n` is the figure, and the wins behind it are in the series' own report.
 */
const resultOf = (value: unknown, what: string): ResultCell => {
  const result = recordOf(value, what);
  const winRate = recordOf(result["winRate"], `${what}.winRate`);
  return {
    n: countOf(winRate["n"], `${what}.winRate.n`),
    rate: rateOf(winRate["rate"], `${what}.winRate.rate`),
    interval: intervalOf(result["interval"], `${what}.interval`),
    confidence: countOf(result["confidence"], `${what}.confidence`),
  };
};

/** The seat split: the same counts, over only the matches from each seat. */
const seatSplitOf = (value: unknown, what: string): { A: ResultCell; B: ResultCell } => {
  const split = recordOf(value, what);
  return {
    A: resultOf(split["A"], `${what}.A`),
    B: resultOf(split["B"], `${what}.B`),
  };
};

/** One row of the leaderboard's per-pairing view. */
const seriesRowOf = (value: unknown, what: string): SeriesRow => {
  const row = recordOf(value, what);
  return {
    name: stringOf(row["name"], `${what}.name`),
    a: stringOf(row["a"], `${what}.a`),
    b: stringOf(row["b"], `${what}.b`),
    maxPairs: countOf(row["maxPairs"], `${what}.maxPairs`),
    pairs: countOf(row["pairs"], `${what}.pairs`),
    matches: countOf(row["matches"], `${what}.matches`),
    counted: countOf(row["counted"], `${what}.counted`),
    missing: countOf(row["missing"], `${what}.missing`),
    stopReason: stringOf(row["stopReason"], `${what}.stopReason`),
    stoppedEarly: boolOf(row["stoppedEarly"], `${what}.stoppedEarly`),
    winRate: rateOf(row["winRate"], `${what}.winRate`),
    interval: intervalOf(row["interval"], `${what}.interval`),
    confidence: countOf(row["confidence"], `${what}.confidence`),
    reportUrl: stringOf(row["reportUrl"], `${what}.reportUrl`),
  };
};

/** One row of the leaderboard's pooled per-model view. */
const modelRowOf = (value: unknown, what: string): ModelRow => {
  const row = recordOf(value, what);
  return {
    label: stringOf(row["label"], `${what}.label`),
    matches: countOf(row["matches"], `${what}.matches`),
    result: resultOf(row["result"], `${what}.result`),
    seatSplit: seatSplitOf(row["seatSplit"], `${what}.seatSplit`),
    missing: countOf(row["missing"], `${what}.missing`),
    missingNote: stringOf(row["missingNote"], `${what}.missingNote`),
    series: stringsOf(row["series"], `${what}.series`),
  };
};

/**
 * The answer from `GET /api/leaderboard`: both tables and the two things that
 * say what is not in them. A field the page reads is named in the line when the
 * answer is missing it, because whoever reads it is the one who can go and fix
 * what the console read.
 */
export const parseLeaderboard = (value: unknown): Leaderboard => {
  const listing = recordOf(value, "the answer from /api/leaderboard");
  const series = listing["series"];
  const models = listing["models"];
  const unreadable = listing["unreadable"];
  if (!Array.isArray(series)) throw new Error("series is not a list");
  if (!Array.isArray(models)) throw new Error("models is not a list");
  if (!Array.isArray(unreadable)) throw new Error("unreadable is not a list");
  return {
    seriesRoot: stringOf(listing["seriesRoot"], "seriesRoot"),
    series: series.map((each, at) => seriesRowOf(each, `series[${String(at)}]`)),
    models: models.map((each, at) => modelRowOf(each, `models[${String(at)}]`)),
    unreadable: unreadable.map((each, at) => {
      const row = recordOf(each, `unreadable[${String(at)}]`);
      return {
        name: stringOf(row["name"], `unreadable[${String(at)}].name`),
        dir: stringOf(row["dir"], `unreadable[${String(at)}].dir`),
        error: stringOf(row["error"], `unreadable[${String(at)}].error`),
      };
    }),
  };
};

/**
 * Both leaderboard views, in one read.
 *
 * The page holds the answer rather than the two tables separately: they came from
 * one walk of the disk, and drawing one table from an older read than the other
 * is how a page ends up showing a model that beat an opponent its own per-pairing
 * row says it never played.
 */
export const fetchLeaderboard = async (fetchJson: FetchJson = fetch): Promise<Leaderboard> =>
  parseLeaderboard(await getJson<unknown>(LEADERBOARD_PATH, fetchJson));
