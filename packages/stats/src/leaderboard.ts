/**
 * The leaderboard: one row per model, pooled over the series reports the CLI
 * already makes.
 *
 * **No formula here.** Every figure a pooled row carries is a sum of the same
 * reports' own figures, put back through the report's own `resultOf` — which is
 * `winRateOf` and `wilsonInterval` at the report's 95%, the same two calls
 * `series-report.ts` makes for model X and the runner's stopping test makes for a
 * series. A leaderboard that worked out its own win rate, or took an average of
 * per-series win rates, would be a second account of the same matches and would
 * drift; averaging rates is wrong anyway, since a series of two matches and a
 * series of two hundred would count the same. So the pooled `n` is the pooled
 * `n`, and the interval is a Wilson interval over it and nothing else.
 *
 * **Why the pooled interval is not the report's.** A series that stopped early
 * quotes the 99% interval its stopping test ran on, and a report quotes 95% over
 * the matches it counted. A pooled row quotes 95% over the counted matches of
 * every series it came from — more matches than any one of them, and a statement
 * about the model rather than about one pairing on one board. It is still not a
 * rating: it says how this model did against whichever opponents the series under
 * this root happened to play, and the per-pairing view — one row per series,
 * which `seriesReport` already answers — is where an opponent is named.
 *
 * **What `missing` means, and what it does not.** A missing match has no log, so
 * it has no header to attribute it to: the series record attributes it to a
 * *pairing*. A pooled row therefore counts, for a model, the missing matches of
 * every series whose pairing names that model — the match was denied to both of
 * its seats, so it is missing for both. That includes a series which lost every
 * match it recorded, and so adds missing matches to a row without adding a single
 * counted one. It is the rule `series-report.ts` already applies (failed, voided,
 * missing log and unreadable log are *missing*, never a loss), and `missingNote`
 * says it in words on the row itself, because a number beside a win rate reads as
 * a match this model lost unless the row says otherwise.
 *
 * **A model with no counted match has no row.** A rate of `null` over nothing is
 * not a leaderboard entry: a series that failed every match of a pairing says
 * nothing about that pairing's models, and a row of noughts would read as a
 * model that played and lost.
 */
import type { Seat } from "@no-dice/log";

import { resultOf } from "./series-report.ts";
import type { ResultRow, SeriesReport } from "./series-report.ts";
import type { Outcome, WinRate } from "./wilson.ts";

/** One model, pooled over every report that counted a match for it. */
export interface PooledModelRow {
  /** The label as the log headers spell it: `<provider>/<id>`, or `bot:<name>`. */
  label: string;
  /** Counted matches over every series this row was pooled from. */
  matches: number;
  /** How many of them this model played from each seat; they add up to `matches`. */
  seats: Record<Seat, number>;
  /** The pooled win rate, with the report's 95% interval over the pooled `n`. */
  result: ResultRow;
  /** The same pooled counts, over only the matches this model played from each seat. */
  seatSplit: Record<Seat, ResultRow>;
  /**
   * The missing matches of every series whose pairing names this model, which can
   * include a series that contributed no counted match to this row. Not a count
   * of matches this model failed to play — see `missingNote`.
   */
  missing: number;
  /** The row's own words for what `missing` is: an attribution to the pairing. */
  missingNote: string;
  /**
   * The series directories whose counted matches this row is made of, in the
   * order the reports were given. A series that played this model and lost every
   * match of it is in `missing` and not here.
   */
  series: string[];
}

/**
 * A `WinRate`'s counts, back out as the outcome list they came from.
 *
 * Pooling has to add counts, and `winRateOf` takes outcomes; expanding is how
 * the sums go through that one function rather than through an arithmetic copy of
 * it here. A `WinRate` always came from exactly that many outcomes — `n` is
 * `wins + losses + draws` — so nothing is invented by the round trip.
 */
const outcomesOf = (rate: WinRate): Outcome[] => {
  const of = (count: number, outcome: Outcome): Outcome[] => Array.from({ length: count }, () => outcome);
  return [...of(rate.wins, "win"), ...of(rate.losses, "loss"), ...of(rate.draws, "draw")];
};

/** What one model's rows add up to, before the interval is taken. */
interface Pool {
  matches: number;
  seats: Record<Seat, number>;
  outcomes: Outcome[];
  seatOutcomes: Record<Seat, Outcome[]>;
  missing: number;
  series: string[];
}

const emptyPool = (): Pool => ({
  matches: 0,
  seats: { A: 0, B: 0 },
  outcomes: [],
  seatOutcomes: { A: [], B: [] },
  missing: 0,
  series: [],
});

/** The row's words for its missing matches, so the number cannot read as losses. */
const missingNoteOf = (missing: number): string => {
  if (missing === 0) return "No match of the series this pairing names went missing.";
  const plural = missing === 1 ? "match" : "matches";
  return (
    `${String(missing)} missing ${plural} attributed to the pairing rather than to this model: ` +
    "a match that never produced a log was denied to both of its seats, and is not a loss."
  );
};

/**
 * Pool the per-model rows of several series reports into one row per model.
 *
 * The reports are what `seriesReport` returned — this reads no disk, and the
 * caller that walked a series root hands the same reports to it that it turned
 * into per-pairing rows, so each series is read once.
 *
 * Sorted by pooled win rate descending and then by label, so the same disk gives
 * the same table. A model that appears in no report's rows — a pairing whose
 * every match went missing, say — gets no row.
 */
export const pooledModelRows = (reports: readonly SeriesReport[]): PooledModelRow[] => {
  const pools = new Map<string, Pool>();

  // The counted matches, attributed by each log's header: that is the only thing
  // that says which model sat where, and it spells a model the same way in every
  // series, which is what makes one row out of two series that put it in
  // opposite seats.
  for (const report of reports) {
    for (const model of report.models) {
      const pool = pools.get(model.label) ?? emptyPool();
      pools.set(model.label, pool);
      pool.matches += model.matches;
      pool.seats.A += model.seats.A;
      pool.seats.B += model.seats.B;
      pool.outcomes.push(...outcomesOf(model.result.winRate));
      for (const seat of ["A", "B"] as const) {
        pool.seatOutcomes[seat].push(...outcomesOf(model.seatSplit[seat].winRate));
      }
      pool.series.push(report.dir);
    }
  }

  // The missing matches, attributed by the series record's pairing instead — a
  // second pass, because a missing match has no header to read a label off. The
  // match was denied to both seats of the pairing, so it is missing for both of
  // the models it names, and it joins the counted matches of a series that did
  // play them. A pairing of one model against itself names that label twice and
  // is still one match missing, hence the set.
  for (const report of reports) {
    for (const label of new Set([report.xLabel, report.opponentLabel])) {
      const pool = pools.get(label);
      if (pool !== undefined) pool.missing += report.missing.total;
    }
  }

  const rows: PooledModelRow[] = [];
  for (const [label, pool] of pools) {
    // Nothing counted for this model, so there is no rate to rank it by. The
    // reports cannot give a row with no matches in it; the check is here because
    // an interval over no matches is a call that throws.
    if (pool.matches === 0) continue;
    rows.push({
      label,
      matches: pool.matches,
      seats: pool.seats,
      result: resultOf(pool.outcomes),
      seatSplit: { A: resultOf(pool.seatOutcomes.A), B: resultOf(pool.seatOutcomes.B) },
      missing: pool.missing,
      missingNote: missingNoteOf(pool.missing),
      series: pool.series,
    });
  }

  return rows.sort((left, right) => {
    // Best first, and label to settle a tie: a table that reordered itself
    // between two reads of one disk would read as the models moving.
    const byRate = (right.result.winRate.rate ?? 0) - (left.result.winRate.rate ?? 0);
    return byRate !== 0 ? byRate : left.label.localeCompare(right.label);
  });
};
