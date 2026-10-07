/**
 * The counters of the run in flight, read out of the series' own record.
 *
 * The lines a run shows are `runCli`'s own. These are not a second reading of
 * them: `runSeries` writes `<dir>/series.json` once before anything is played and
 * again at every batch of 5 pairs (`writeSeriesRecord` in
 * `packages/runner/src/series-plan.ts`), and this reads that file. So the numbers
 * on the page are the numbers the series is itself keeping — the same ones a
 * resume and `no-dice stats` will read — and they move at the batch boundaries the
 * runner writes at, which is coarser than the pair lines. Nothing here interpolates
 * between two writes: a progress bar that pretended to finer granularity would be
 * a lie about what the runner writes.
 *
 * A single match has no record at all, so it has no counters: its progress is its
 * lines, and its end is the log path and the result line. That is why this is
 * asked only for a series run.
 *
 * **The read is lenient, and that is deliberate.** The file is written atomically
 * — bytes to `series.json.tmp`, renamed into place — so a reader never sees half a
 * record, but it is not a *full* record until the run has reached its first batch
 * boundary: `planSeries` writes the seed fields first. A record holding only those
 * is a series that has drawn its pairs and played none of them, and the counters
 * say exactly that. A file that is missing, or that is not JSON, or that does not
 * even record a pair limit, is no record to read, and the answer is `null` — the
 * page says it has no record rather than drawing zeroes for a series it cannot
 * see.
 *
 * The read is synchronous: the run slot answers a snapshot synchronously, and the
 * file is a few kilobytes read once per poll.
 */
import { readFileSync } from "node:fs";

import { z } from "zod";

import { seriesRecordPath } from "@no-dice/runner/series-plan";

/** What a series' record says about how far that series has got. */
export interface RunCounters {
  /** The pair limit the series was asked for — `max_pairs` in the record. */
  maxPairs: number;
  /** Pairs whose two matches both have a log — `state.pairs_played`. */
  pairsPlayed: number;
  /** `maxPairs - pairsPlayed`: the pairs the series still means to play. */
  pairsRemaining: number;
  /** Matches with a log — `state.matches_played`. */
  matchesPlayed: number;
  /** Matches that threw and left no log — `state.matches_failed`. */
  matchesFailed: number;
  /** `cost_usd` summed over every played match entry. */
  costUsd: number;
  /** Tokens summed over the same entries, the total `--max-tokens` bounds. */
  tokens: number;
  /** Which rule ended it, once the stopping rules have decided; `null` before. */
  stopReason: string | null;
  /** Whether it stopped short of its pair limit, once they have decided. */
  stoppedEarly: boolean | null;
}

/** One played match entry, as far as this file cares about it. */
const playedShape = z.object({
  status: z.literal("played"),
  cost_usd: z.number().finite(),
  tokens: z.object({ total: z.number().int().nonnegative() }).passthrough(),
});

/**
 * The part of `series.json` the counters come from. `pairs` and `state` are
 * optional because the first write of a series has neither: `planSeries` records
 * the seed list before anything is played, and `runSeries` adds its own state at
 * the first batch boundary.
 */
const recordShape = z.object({
  max_pairs: z.number().int().nonnegative(),
  pairs: z.array(z.object({ matches: z.array(z.unknown()).optional() }).passthrough()).optional(),
  state: z
    .object({
      pairs_played: z.number().int().nonnegative(),
      matches_played: z.number().int().nonnegative(),
      matches_failed: z.number().int().nonnegative(),
      stopped_early: z.boolean(),
    })
    .passthrough()
    .optional(),
  /** Which rule fired. `stopped_early` is not here — the record keeps it in `state`. */
  stop: z.object({ reason: z.string() }).passthrough().optional(),
});

/** What a match entry contributes to the totals: nothing, unless it was played. */
const totalsOf = (pairs: readonly unknown[] | undefined): { costUsd: number; tokens: number } => {
  let costUsd = 0;
  let tokens = 0;
  for (const pair of pairs ?? []) {
    const matches = (pair as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) continue;
    for (const match of matches) {
      const played = playedShape.safeParse(match);
      if (!played.success) continue;
      costUsd += played.data.cost_usd;
      tokens += played.data.tokens.total;
    }
  }
  return { costUsd, tokens };
};

/**
 * What the series in `dir` says about itself, or `null` when it has said nothing
 * yet. A record that is only the seed list is read as a series that has played
 * nothing, which is what it is.
 */
export const readRunCounters = (dir: string): RunCounters | null => {
  let text: string;
  try {
    text = readFileSync(seriesRecordPath(dir), "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  const record = recordShape.safeParse(parsed);
  if (!record.success) return null;

  const { max_pairs: maxPairs, state, stop, pairs } = record.data;
  const totals = totalsOf(pairs);
  return {
    maxPairs,
    pairsPlayed: state?.pairs_played ?? 0,
    pairsRemaining: maxPairs - (state?.pairs_played ?? 0),
    matchesPlayed: state?.matches_played ?? 0,
    matchesFailed: state?.matches_failed ?? 0,
    costUsd: totals.costUsd,
    tokens: totals.tokens,
    stopReason: stop?.reason ?? null,
    stoppedEarly: state?.stopped_early ?? null,
  };
};
