/**
 * Which one match of a finished series gets rendered — brief §6.7's showcase
 * selection — and the `showcase.json` sidecar that hands the viewer its path.
 *
 * `series-report.ts` left this out on purpose: picking a match needs a series to
 * pick from. Three steps, in the brief's order.
 *
 * **Who won.** The series winner comes out of `seriesReport`, not out of a fresh
 * win rate: the report's 95% Wilson interval is the same one `report.md` prints,
 * so a showcase can never name a winner the report disagrees with. A model whose
 * interval lies wholly above 50% won the series; its opponent, if the interval
 * lies wholly below, won it. An interval that covers 50% is a series that did not
 * separate the pairing — brief §6.5 stops a run on exactly that test, and a run
 * that stopped for another reason can end with an interval that does not exclude
 * it — and then there is no winner to take matches from: every counted match is
 * ranked instead, and the output says so rather than quietly presenting one
 * model's wins as the interesting ones.
 *
 * **Which of its matches are worth showing.** The winner's wins, keeping the ones
 * whose margin falls between the 25th and 75th percentile of that winner's own
 * margins. The quartiles are taken over the winner's margins and nobody else's,
 * because "typical for this pairing" is the question: a 40-point win in a series
 * that usually ends 40-0 is ordinary, and the same win in a series that usually
 * ends 6-4 is the outlier a viewer would be misled by. A margin sitting exactly on
 * a quartile is at the edge of the middle half rather than in it, which is what
 * makes a short series' filter come up empty — two wins of different margins have
 * nothing strictly between their quartiles at all — and the rule then widens to
 * every one of the winner's matches and says that it did. A series that widened
 * has shown a match outside the middle half, and the file says which.
 *
 * Knockouts are margin 93 (`marginOf`, as in the report) and so sit outside the
 * middle half of a series whose wins usually end by a few points, on their own and
 * without needing anything else to push them out. That is the right outcome: a
 * knockout is a board that collapsed, not a match that was contested.
 *
 * **Which of those is the one.** Brief §6.7's excitement score: lead changes, plus
 * the largest single-turn swing, plus the turn of the final lead change — all
 * three read out of `rules-evidence.ts`, so the showcase and `evidence.md` count
 * the same lead. The sum has no unit of its own (it adds turns to points) and is
 * only ever a ranking; the three components are carried in the file beside it so a
 * reader can see what made a match the one it picked. Ties go to the later final
 * lead change — a match still decided at turn 24 is the better watch — then to the
 * smaller margin, then to the record's own order so the choice is one match and
 * not a coin toss.
 *
 * **Idempotence.** Nothing here reads a clock or a random number: the choice is a
 * function of `series.json` and the logs it names, and the file is written from a
 * fixed key order. Running `no-dice showcase` twice on one series leaves the same
 * bytes, which is what lets the sidecar be committed, diffed and re-run.
 *
 * The log is read once for the selection and once more by `seriesReport` for the
 * series line. That is deliberate: the winner has to come from the report, and
 * `@no-dice/stats` keeps one reader of `series.json` rather than a cache shared
 * between two modules.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LogResult, Seat } from "@no-dice/log";

import { marginOf } from "./margin.ts";
import { evidenceOfLog } from "./rules-evidence.ts";
import type { LeadEvidence } from "./rules-evidence.ts";
import {
  playerLabel,
  readLogOf,
  readSeriesRecord,
  seriesMatchRecords,
  seriesReport,
  voidReasonOf,
} from "./series-report.ts";
import type { SeriesReport } from "./series-report.ts";
import type { WilsonInterval, WinRate } from "./wilson.ts";

/** The sidecar's format tag, in the style of `salient-log/1` and `salient-series/1`. */
export const SHOWCASE_FORMAT = "salient-showcase/1";

/** The win rate a series is measured against: half its matches. */
export const EVEN_CHANCE = 0.5;

/** The quartiles the middle-half filter keeps matches between. */
export const LOWER_QUARTILE = 0.25;
export const UPPER_QUARTILE = 0.75;

/** A rate as the report and the series line write it. */
const percent = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A confidence level, named the way a report names one: `95%`, not `95.0%`. */
const confidenceLabel = (n: number): string => `${String(Math.round(n * 100))}%`;

/**
 * The `p`'th percentile, by linear interpolation between the closest ranks — the
 * one definition every quartile here uses, so the middle half is one interval
 * rather than whichever of the percentile conventions was reached for. A single
 * value is its own 25th and 75th percentile.
 */
export const percentileOf = (values: readonly number[], p: number): number => {
  if (values.length === 0) throw new Error("a percentile needs at least one margin to take it over");
  if (!(p >= 0 && p <= 1)) {
    throw new Error(`a percentile is taken between 0 and 1, not ${String(p)}`);
  }
  const sorted = [...values].sort((left, right) => left - right);
  const at = (sorted.length - 1) * p;
  const below = Math.floor(at);
  const above = Math.ceil(at);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (at - below);
};

/**
 * Brief §6.7's excitement score, and the three figures it adds.
 *
 * The sum has no unit of its own — it adds turns to points — and is only ever a
 * ranking, which is why the three components are carried beside it rather than
 * folded away.
 *
 * `finalChangeTurn` is 0 when the lead never changed, and `largestSwing` is 0 only
 * for a match with no turns at all: a match that was never behind contributes
 * nothing for lateness, which is the score's way of saying "it never came back".
 */
export interface Excitement {
  score: number;
  leadChanges: number;
  largestSwing: number;
  finalChangeTurn: number;
}

/** The score, from the lead `rules-evidence.ts` walked out of one log. */
export const excitementOf = (lead: LeadEvidence): Excitement => {
  const largestSwing = lead.largestSwing === null ? 0 : lead.largestSwing.points;
  return {
    score: lead.changes + largestSwing + lead.finalChangeTurn,
    leadChanges: lead.changes,
    largestSwing,
    finalChangeTurn: lead.finalChangeTurn,
  };
};

/** One match the selection could choose, with everything it is ranked on. */
export interface ShowcaseMatch {
  seed: number;
  /** The seat model X played in this match of the pair, as the record says. */
  seat: Seat;
  /** The log on disk, which is what the viewer is handed. */
  path: string;
  /** How each seat's header names its player. */
  players: Record<Seat, string>;
  /** The log's own result: how it ended, who won, and by how much. */
  result: LogResult;
  /** `marginOf(result)` — 93 for a won knockout, as in the report. */
  margin: number;
  excitement: Excitement;
  /** Whether the middle-half filter kept it in the pool the choice came from. */
  kept: boolean;
}

/** Which seat of the pairing won the series. */
export type WinnerSide = "x" | "opponent";

/** The series winner, and the interval that made it one. */
export interface SeriesWinner {
  label: string;
  side: WinnerSide;
  interval: WilsonInterval;
}

/**
 * The series winner, out of the report's 95% interval.
 *
 * `null` when the interval covers 50% — including the case of no counted match at
 * all, which has no interval and so has separated nothing.
 */
export const seriesWinnerOf = (report: SeriesReport): SeriesWinner | null => {
  const interval = report.result.interval;
  if (interval === null) return null;
  if (interval.low > EVEN_CHANCE) return { label: report.xLabel, side: "x", interval };
  if (interval.high < EVEN_CHANCE) return { label: report.opponentLabel, side: "opponent", interval };
  return null;
};

/** Whether one match was won by the side the series says won it. */
const wonBy = (match: Pick<ShowcaseMatch, "seat" | "result">, side: WinnerSide): boolean =>
  match.result.winner !== null &&
  (side === "x" ? match.result.winner === match.seat : match.result.winner !== match.seat);

/**
 * The ranking: highest excitement first, then the later final lead change, then
 * the smaller margin, then the record's order.
 *
 * The last step is not decoration. Two matches can tie on all three of the
 * brief's figures, and a choice that depended on the order the logs happened to be
 * read in is a choice that changes when `series.json` is rewritten.
 */
export const rankByExcitement = (matches: readonly ShowcaseMatch[]): ShowcaseMatch[] =>
  [...matches].sort(
    (left, right) =>
      right.excitement.score - left.excitement.score ||
      right.excitement.finalChangeTurn - left.excitement.finalChangeTurn ||
      left.margin - right.margin ||
      left.seed - right.seed ||
      left.seat.localeCompare(right.seat),
  );

/** How the margin filter went, in the numbers as well as the sentence. */
export interface MarginFilter {
  /** The winner's counted wins the quartiles were taken over; 0 when there is no winner. */
  count: number;
  /** Its 25th and 75th percentile margins, or null when there were none to take. */
  low: number | null;
  high: number | null;
  /** How many of those wins fell between them. */
  kept: number;
  /** Whether the filter came up empty and every one of the winner's wins was ranked. */
  widened: boolean;
}

/** How the pool the choice came from was arrived at, and why. */
export interface ShowcaseSelection {
  /** The series winner, or null when its interval covers 50%. */
  winner: SeriesWinner | null;
  /** Whether the margin filter ran over one side's wins or over every counted match. */
  basis: "series_winner" | "no_series_winner";
  margins: MarginFilter;
  /** One line saying what the selection did, printed and written rather than implied. */
  note: string;
}

/** The series figures the sidecar carries, and the line the header shows. */
export interface ShowcaseSeries {
  xLabel: string;
  opponentLabel: string;
  /** The side that won, or null when the interval covers 50%. */
  winnerLabel: string | null;
  winRate: WinRate;
  interval: WilsonInterval | null;
  confidence: number;
  pairs: number;
  matches: number;
  counted: number;
  missing: number;
  stopReason: string;
  stoppedEarly: boolean;
}

/** What `seriesShowcase` returns. */
export interface Showcase {
  dir: string;
  /** Where `writeSeriesShowcase` writes the sidecar: `<dir>/showcase.json`. */
  showcasePath: string;
  series: ShowcaseSeries;
  /** The one-line series result: X versus opponent, win rate and interval, pairs, stop. */
  seriesLine: string;
  selection: ShowcaseSelection;
  /** Every candidate, best first, each marked with whether the filter kept it. */
  ranked: ShowcaseMatch[];
  /** The match to render, or null when the series counted none. */
  match: ShowcaseMatch | null;
}

/**
 * The series as one line, in the form the viewer's header shows: model X against
 * its opponent, the win rate with its interval, the pairs played and the reason the
 * run stopped.
 */
export const seriesLineOf = (series: ShowcaseSeries): string => {
  const rate =
    series.winRate.rate === null || series.interval === null
      ? "— over no counted match"
      : `${percent(series.winRate.rate)} (${confidenceLabel(series.confidence)} ` +
        `${percent(series.interval.low)} – ${percent(series.interval.high)}) ` +
        `over ${String(series.winRate.n)} counted matches`;
  return (
    `${series.xLabel} vs ${series.opponentLabel} — win rate ${rate}, ` +
    `${String(series.pairs)} pairs, stopped on ${series.stopReason}`
  );
};

/**
 * Every match that counts, with its result and its excitement.
 *
 * A match that failed, went missing or was voided is passed over rather than
 * listed: it is not a candidate, and `report.md` is where missing matches are
 * reported — with the same rules, over the same `series.json`, so the count in
 * the series line and the pool here cannot disagree.
 */
async function readCounted(dir: string): Promise<ShowcaseMatch[]> {
  const record = await readSeriesRecord(dir);
  const counted: ShowcaseMatch[] = [];
  for (const { seed, match } of seriesMatchRecords(record)) {
    if (match.status === "failed") continue;
    const { log, path } = await readLogOf(dir, match.path);
    // `readLogOf` names the file the log was read from, so the path handed to the
    // viewer is one that is there rather than the one the record hoped for.
    if (log === null || path === null) continue;
    if (voidReasonOf(log) !== null) continue;
    counted.push({
      seed,
      seat: match.seat,
      path,
      players: { A: playerLabel(log.players.A), B: playerLabel(log.players.B) },
      result: log.result,
      margin: marginOf(log.result),
      excitement: excitementOf(evidenceOfLog(log).lead),
      kept: false,
    });
  }
  return counted;
}

/** The sentence that says who won, or that nobody did. */
const winnerNote = (series: ShowcaseSeries, winner: SeriesWinner | null): string => {
  if (winner !== null) {
    return (
      `${winner.label} won the series: win rate ` +
      `${series.winRate.rate === null ? "—" : percent(series.winRate.rate)}, ` +
      `${confidenceLabel(series.confidence)} interval ` +
      `${percent(winner.interval.low)} – ${percent(winner.interval.high)}, clear of 50%`
    );
  }
  return series.interval === null
    ? "no series winner: the series counted no match, so no win rate separates the pairing"
    : `no series winner: its ${confidenceLabel(series.confidence)} interval ` +
        `${percent(series.interval.low)} – ${percent(series.interval.high)} covers 50%`;
};

/** The sentence that says what the margin filter did. */
const filterNote = (winner: SeriesWinner | null, filter: MarginFilter): string => {
  if (winner === null) {
    return "every counted match was ranked, since no winner's margins define a middle half";
  }
  if (filter.count === 0) {
    return "the winner won no counted match, so every counted match was ranked instead";
  }
  const between = `between the 25th and 75th percentiles of its margins (${String(filter.low)}, ${String(filter.high)})`;
  return filter.widened
    ? `no win of ${winner.label} had a margin strictly ${between}, so all ${String(filter.count)} of its wins were ranked`
    : `${String(filter.kept)} of ${winner.label}'s ${String(filter.count)} wins had a margin strictly ${between}`;
};

/**
 * Read a series directory and decide which one of its matches gets rendered.
 *
 * The winner, the pool and the ranking are all reported, so a reader of the file
 * can see that the match in it was arrived at rather than picked.
 */
export async function seriesShowcase(dir: string): Promise<Showcase> {
  const report = await seriesReport(dir);
  const counted = await readCounted(dir);

  const series: ShowcaseSeries = {
    xLabel: report.xLabel,
    opponentLabel: report.opponentLabel,
    winnerLabel: null,
    winRate: report.result.winRate,
    interval: report.result.interval,
    confidence: report.result.confidence,
    pairs: report.pairs,
    matches: report.matches,
    counted: report.counted,
    missing: report.missing.total,
    stopReason: report.stop.reason,
    stoppedEarly: report.stop.stoppedEarly,
  };

  const winner = seriesWinnerOf(report);
  series.winnerLabel = winner === null ? null : winner.label;

  // With no winner there is no side whose margins define a middle half, so the
  // filter does not run at all and every counted match is a candidate — as it is
  // in the case the interval rules out but the code does not rely on, of a winner
  // with no counted win at all.
  const wins = winner === null ? [] : counted.filter((match) => wonBy(match, winner.side));
  const candidates = wins.length === 0 ? counted : wins;
  const margins = wins.map((match) => match.margin);
  const filtering = margins.length > 0;
  const low = filtering ? percentileOf(margins, LOWER_QUARTILE) : null;
  const high = filtering ? percentileOf(margins, UPPER_QUARTILE) : null;
  const kept =
    low === null || high === null
      ? candidates
      : wins.filter((match) => match.margin > low && match.margin < high);
  const widened = filtering && kept.length === 0;
  const pool = widened ? wins : kept;

  const filter: MarginFilter = {
    count: wins.length,
    low,
    high,
    // How many fell inside the middle half, before widening: a widened series is
    // one whose figure here is nought, which is what the note has to be about.
    kept: kept.length,
    widened,
  };

  // Ranking every candidate and marking the kept ones is the same order as
  // ranking the kept ones alone: the comparator is a total order over the same
  // matches, so the first kept match in the full ranking is the best of the pool.
  const poolSet = new Set(pool);
  const ranked = rankByExcitement(candidates).map((match) => ({ ...match, kept: poolSet.has(match) }));
  const match = ranked.find((each) => each.kept) ?? null;

  return {
    dir,
    showcasePath: join(dir, "showcase.json"),
    series,
    seriesLine: seriesLineOf(series),
    selection: {
      winner,
      basis: winner === null ? "no_series_winner" : "series_winner",
      margins: filter,
      note: `${winnerNote(series, winner)}; ${filterNote(winner, filter)}`,
    },
    ranked,
    match,
  };
}

/** The sidecar's excitement: the sum, and what went into it. */
export interface ExcitementJson {
  score: number;
  lead_changes: number;
  largest_swing: number;
  final_change_turn: number;
}

/** One match as the sidecar names it. */
export interface ShowcaseMatchJson {
  /** The log to render, where it is on disk. The log is not copied. */
  path: string;
  seed: number;
  /** The seat model X played in this match of the pair. */
  x_seat: Seat;
  players: Record<Seat, string>;
  result: LogResult;
  margin: number;
  excitement: ExcitementJson;
  kept: boolean;
}

/** The whole `showcase.json`. Snake-cased, as every data format in this repo is. */
export interface ShowcaseJson {
  format: typeof SHOWCASE_FORMAT;
  series: {
    dir: string;
    x: string;
    opponent: string;
    winner: string | null;
    /** The one-line result the header shows beside the match. */
    line: string;
    win_rate: WinRate;
    interval: WilsonInterval | null;
    confidence: number;
    pairs: number;
    matches: number;
    counted: number;
    missing: number;
    stop_reason: string;
    stopped_early: boolean;
  };
  selection: {
    basis: "series_winner" | "no_series_winner";
    winner: { label: string; side: WinnerSide; interval: WilsonInterval } | null;
    margins: MarginFilter;
    note: string;
  };
  match: ShowcaseMatchJson | null;
  /** Every candidate, best first: the ranking the choice came out of. */
  ranked: ShowcaseMatchJson[];
}

/** The excitement as the sidecar writes it. */
const excitementJsonOf = (excitement: Excitement): ExcitementJson => ({
  score: excitement.score,
  lead_changes: excitement.leadChanges,
  largest_swing: excitement.largestSwing,
  final_change_turn: excitement.finalChangeTurn,
});

/** One match as the sidecar writes it. */
const matchJsonOf = (match: ShowcaseMatch): ShowcaseMatchJson => ({
  path: match.path,
  seed: match.seed,
  x_seat: match.seat,
  players: { A: match.players.A, B: match.players.B },
  result: match.result,
  margin: match.margin,
  excitement: excitementJsonOf(match.excitement),
  kept: match.kept,
});

/**
 * The sidecar's contents. Key order is fixed here rather than left to a
 * `Map`, and nothing reads a clock, so the same series gives the same text every
 * time it is written.
 */
export const showcaseJsonOf = (showcase: Showcase): ShowcaseJson => ({
  format: SHOWCASE_FORMAT,
  series: {
    dir: showcase.dir,
    x: showcase.series.xLabel,
    opponent: showcase.series.opponentLabel,
    winner: showcase.series.winnerLabel,
    line: showcase.seriesLine,
    win_rate: showcase.series.winRate,
    interval: showcase.series.interval,
    confidence: showcase.series.confidence,
    pairs: showcase.series.pairs,
    matches: showcase.series.matches,
    counted: showcase.series.counted,
    missing: showcase.series.missing,
    stop_reason: showcase.series.stopReason,
    stopped_early: showcase.series.stoppedEarly,
  },
  selection: {
    basis: showcase.selection.basis,
    winner:
      showcase.selection.winner === null
        ? null
        : {
            label: showcase.selection.winner.label,
            side: showcase.selection.winner.side,
            interval: showcase.selection.winner.interval,
          },
    margins: showcase.selection.margins,
    note: showcase.selection.note,
  },
  match: showcase.match === null ? null : matchJsonOf(showcase.match),
  ranked: showcase.ranked.map(matchJsonOf),
});

/**
 * The choice for a series directory, written to `<dir>/showcase.json` beside the
 * `series.json` it was read from.
 *
 * Idempotent by construction: the text is a function of the series alone, so
 * running the command again over an unchanged series changes nothing on disk.
 */
export async function writeSeriesShowcase(
  dir: string,
): Promise<{ showcase: Showcase; json: string; path: string }> {
  const showcase = await seriesShowcase(dir);
  const json = `${JSON.stringify(showcaseJsonOf(showcase), null, 2)}\n`;
  await writeFile(showcase.showcasePath, json, "utf8");
  return { showcase, json, path: showcase.showcasePath };
}
