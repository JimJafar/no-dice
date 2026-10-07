/**
 * The leaderboard: both views over the series under the console's root, in one
 * answer — one row per series, and one row per model pooled over every one of
 * them.
 *
 * **No arithmetic in this file.** Not one win counted, rate divided or interval
 * taken: `series` rows are the report figures `results.ts` already answers
 * `/api/series` with, and `models` rows are `pooledModelRows`' in
 * `@no-dice/stats/leaderboard`, which sums the reports' own counts and puts the
 * sums back through the report's own `resultOf`. The epic's acceptance is that
 * both tables agree with `no-dice stats` to the digit, and a second account of a
 * win rate — here or on the page — is how two tables drift apart. A pooled row
 * that averaged the per-series rates instead would be wrong anyway: a series of
 * two matches and a series of two hundred would count the same.
 *
 * **One read, not two.** `seriesReport` reads `series.json` and every log it
 * names — about a megabyte each for a real match (`docs/pi-harness-notes.md` §7)
 * — so this calls `seriesEntries` once and hands the reports that walk already
 * read to `pooledModelRows`. The per-pairing rows and the pooled rows are two
 * views of one walk of the disk, which is why the page can read this when it is
 * opened rather than on its one-second poll.
 *
 * **What is in scope, and what says it is not.** Only directories under the
 * console's `--series-root`: a series started with `--dir` somewhere else is real
 * work this page will never show, and the answer carries `seriesRoot` so the
 * page can say so in as many words — the same rule and the same wording
 * `results.ts` already applies. A directory under the root whose record cannot be
 * read is listed in `unreadable` with the line it failed on, and contributes
 * nothing to the pooled rows: it has no report to pool, and a row that quietly
 * left it out would read to the operator as a model that never played it.
 */
import { pooledModelRows } from "@no-dice/stats/leaderboard";
import type { PooledModelRow } from "@no-dice/stats/leaderboard";

import { reportsOf, seriesEntries, seriesListingOf } from "./results.ts";
import type { SeriesRow, UnreadableSeries } from "./results.ts";
import type { UiRoots } from "./state.ts";

/** The route the page reads both leaderboard views at. */
export const LEADERBOARD_PATH = "/api/leaderboard";

/** What `GET /api/leaderboard` answers. */
export interface LeaderboardListing {
  /** The root both views were read from, as an absolute path. */
  seriesRoot: string;
  /** The per-pairing view: one row per series under the root, as `/api/series` lists it. */
  series: SeriesRow[];
  /** The per-model view: one row per model, pooled over every one of those series. */
  models: PooledModelRow[];
  /** Directories under the root that hold a `series.json` this console could not report. */
  unreadable: UnreadableSeries[];
}

/**
 * Both tables, from one walk of the series root.
 *
 * `inFlight` is the series directory the console has a run in, if any; it is
 * passed through to the walk, which is where the resumable flag is settled, and
 * a series mid-run is listed like any other — its figures are the matches it has
 * written so far, which is what the report says about them too.
 */
export const leaderboardRows = async (
  roots: UiRoots,
  inFlight: string | null,
): Promise<LeaderboardListing> => {
  const walk = await seriesEntries(roots, inFlight);
  const listing = seriesListingOf(walk);
  return {
    seriesRoot: listing.seriesRoot,
    series: listing.series,
    models: pooledModelRows(reportsOf(walk)),
    unreadable: listing.unreadable,
  };
};
