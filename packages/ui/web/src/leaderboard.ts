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
 * **What the row declares.** Only what the console answers with. The per-pairing
 * row carries the pairing, the counts, the rate with its interval and the stop,
 * plus `reportUrl` — the `report.md` this console serves — and leaves out the
 * ceilings and the resume flag, which the results section owns. It keeps `dir`
 * for one reason: a pooled row names the series it pooled from by
 * directory, and this is the answer that says which name each of those
 * directories goes by. The pooled row is kept whole — the counts,
 * the pooled result with the wins, losses and draws it is made of, the seat
 * split, the missing count with the stats package's own note about what it
 * means, and the series it was pooled from — because the headline table draws
 * seven figures of it and the detail a row opens draws the rest. A model with no
 * counted match is in no row at all, which is the stats package's rule and not
 * one this page gets an opinion on.
 *
 * **How a label is spelled.** `modelPartsOf` is here rather than in a renderer
 * because two views spell the same model — the headline table and the detail a
 * row opens — and a model spelled two ways on one page reads as two models. It
 * splits the label the log header wrote; it invents nothing.
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
 *
 * `won`, `lost` and `drawn` are the answer's own `wins`, `losses` and `draws`,
 * kept under the words the table calls them. They are read and drawn, never
 * added up or subtracted from `n` here: `n` is their sum because the stats
 * package made it so, not because this page checked.
 */
export interface ResultCell {
  /** Every outcome counted: the `n` the interval was taken over. */
  n: number;
  /** How many of them this model won, lost and drew — the answer's, not a difference. */
  won: number;
  lost: number;
  drawn: number;
  rate: number | null;
  interval: Interval | null;
  confidence: number;
}

/** One series — one pairing — as the leaderboard lists it. */
export interface SeriesRow {
  /** The directory's own name, which is what `--name` gave it. */
  name: string;
  /**
   * Where the series lives. The page never shows it: it is read because a pooled
   * row names the series it pooled from *by directory*, and this is the only
   * answer that says which name each of those directories goes by.
   */
  dir: string;
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
  /**
   * The label as the log headers spell it: `<provider>/<id>`, or `bot:<name>`.
   * Its parts — how the model is called and who offers it — come from `modelPartsOf`.
   */
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
 * One result as the console answers it: `winRate`'s `n`, its counts and its rate,
 * and the interval and confidence beside them. Every one of those figures is
 * taken as it arrived — the won/lost/drawn a table shows and the rate beside it
 * are two readings of the same `winRate`, and a count worked out from the
 * others would be a figure this page made up.
 */
const resultOf = (value: unknown, what: string): ResultCell => {
  const result = recordOf(value, what);
  const winRate = recordOf(result["winRate"], `${what}.winRate`);
  return {
    n: countOf(winRate["n"], `${what}.winRate.n`),
    won: countOf(winRate["wins"], `${what}.winRate.wins`),
    lost: countOf(winRate["losses"], `${what}.winRate.losses`),
    drawn: countOf(winRate["draws"], `${what}.winRate.draws`),
    rate: rateOf(winRate["rate"], `${what}.winRate.rate`),
    interval: intervalOf(result["interval"], `${what}.interval`),
    confidence: countOf(result["confidence"], `${what}.confidence`),
  };
};

/**
 * The seat split, as its two parts: the same counts, over only the matches this
 * model played from each seat. The headline table has no room for them; the
 * detail a row opens does.
 */
const seatPartsOf = (value: unknown, what: string): { A: ResultCell; B: ResultCell } => {
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
    dir: stringOf(row["dir"], `${what}.dir`),
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
    seatSplit: seatPartsOf(row["seatSplit"], `${what}.seatSplit`),
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

/** What both views say when a label carries no provider to name. */
export const NO_PROVIDER = "the log never named a provider";

/** A model label, split into the two columns the leaderboard gives it. */
export interface ModelParts {
  /** What the model is called, with its provider taken off the front. */
  model: string;
  /** Who offers it — or `NO_PROVIDER`, which is what the page says out loud. */
  provider: string;
}

/**
 * Split a model label into its model and its provider.
 *
 * A label is what a log header wrote, and it comes in two shapes: a bot as
 * `bot:<name>`, and anything else the console can seat as `<provider>/<id>`,
 * which is how a seat is addressed everywhere else in this repository —
 * split on the *first* slash, because a model id may carry one. A label with
 * neither in it is drawn as it came and said to have no provider rather than
 * guessed at: a provider this page invented would be a fact about a model no
 * log supports, and a model nobody prices still gets its row.
 *
 * Both views call this, so neither can spell a model the other does not.
 */
export const modelPartsOf = (label: string): ModelParts => {
  if (label.startsWith("bot:")) return { model: label.slice("bot:".length), provider: "bot" };
  const at = label.indexOf("/");
  if (at > 0) return { model: label.slice(at + 1), provider: label.slice(0, at) };
  return { model: label, provider: NO_PROVIDER };
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
