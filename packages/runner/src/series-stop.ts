/**
 * Brief §6.5's stopping rules: what ends a series, and what the record says
 * about the moment it ended.
 *
 * Three rules, each applied at a batch boundary in the loop in `series.ts` (the
 * ceilings also before the next batch starts, which is what `ceilingsPassed`
 * is for):
 *
 * - **The result is clear.** From 10 pairs on, model X's win rate over every
 *   match played — a draw counting half a win — gets a Wilson score interval,
 *   and when that interval excludes 50% the series has its answer. The interval
 *   and the win rate are `@no-dice/stats`', not a copy here: the report quotes
 *   the same interval at 95%, and two copies of one formula drift apart, which
 *   would leave a series stopped by a different figure from the one printed
 *   beside its own result.
 * - **The pair limit.** `--max-pairs`, default 75, which is 150 matches.
 * - **The ceiling.** `--max-cost <usd>` sums the logged cost of every match
 *   played, and `--max-tokens <n>` sums input + output + cache-read +
 *   cache-write across them.
 *
 * **Why the test is at 99% and the report quotes 95%.** Brief §6.5 is explicit:
 * the stopping test is applied after *every* batch, so a series gets up to
 * fifteen bites at a false positive, and the test has to be harder to pass than
 * the one read out of a finished run. `STOP_CONFIDENCE` is the only place that
 * number is written, and `zOf` takes it from the stats package next to the 95%
 * the report uses, so the two levels sit together and the difference between
 * them is visible rather than folklore.
 *
 * **Why a token ceiling beside the cost one.** The one real match measured so far
 * (`docs/pi-harness-notes.md` §7) records `cost_usd: 0` on every turn, because
 * Marvin is Jim's own unpriced hardware, while it burns 4.59M tokens and 19
 * minutes of seat time. A 150-match series at that rate is roughly 688M tokens
 * and 48 hours, and a money ceiling would never have fired on it. Tokens are the
 * ceiling that actually protects a run, so they get a flag of their own.
 *
 * Nothing here stops a run in the middle of a pair, or even in the middle of a
 * batch: the loop asks this file at a batch boundary, so a series always stops
 * with every pair it started complete and a record that matches the logs on
 * disk. When two rules fire at the same boundary the ceiling is named first — a
 * run that has passed its ceiling cannot play another match whatever the
 * interval says — and where both ceilings have been passed the token one is
 * named, because on the only hardware measured so far it is the one that binds.
 * The interval is recorded at that boundary either way, so a report can say what
 * the result looked like when the ceiling stopped the series.
 *
 * The ceilings are asked twice at each boundary, before the next batch as well as
 * after the last one, because a series resumed a week later has already spent
 * what the matches on disk cost it: `ceilingsPassed` is that earlier ask, and it
 * asks only the ceilings, for the reason written there.
 */
import { z } from "zod";

import type { Seat } from "@no-dice/log";
import { outcomeOf, wilsonInterval, winRateOf, zOf } from "@no-dice/stats/wilson";
import type { Confidence, Outcome } from "@no-dice/stats/wilson";

/** Brief §6.5's batch: matches are played in batches of 5 pairs. */
export const BATCH_PAIRS = 5;

/** Brief §6.5: the interval test is applied "after each batch from 10 pairs on". */
export const MIN_TEST_PAIRS = 10;

/**
 * The confidence the stopping test is taken at — 99%, deliberately stricter than
 * the 95% the report quotes, because the test is applied after every batch of 5
 * pairs rather than once at the end (brief §6.5).
 */
export const STOP_CONFIDENCE = 0.99 satisfies Confidence;

/** The rate a series has no answer about: model X and its opponent even. */
const EVEN_RATE = 0.5;

/**
 * Why a series stopped: brief §6.5's three rules, named. A run that ends with
 * pairs it planned but never played — because every match of a pair has to have
 * a log for the pair to count, and a voided match leaves one without — records
 * `max_pairs` too: brief §6.5 gives that case no reason of its own, and
 * `matches_failed` beside `pairs_played` is what says the pairs ran out rather
 * than the series running its length.
 */
export const stopReasonSchema = z.enum(["max_pairs", "wilson_interval", "max_cost", "max_tokens"]);
export type StopReason = z.infer<typeof stopReasonSchema>;

/** The tokens the matches played so far used, over both seats of every turn. */
export const tokensSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cache_read: z.number().int().nonnegative(),
    cache_write: z.number().int().nonnegative(),
    /** input + output + cache_read + cache_write — what `--max-tokens` bounds. */
    total: z.number().int().nonnegative(),
  })
  .strict();
export type SeriesTokens = z.infer<typeof tokensSchema>;

/** What the matches played so far cost, in money and in tokens. */
export const totalsSchema = z
  .object({
    cost_usd: z.number(),
    tokens: tokensSchema,
  })
  .strict();
export type SeriesTotals = z.infer<typeof totalsSchema>;

/** Model X's record over the matches played, as `winRateOf` gives it. */
const winRateSchema = z
  .object({
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    draws: z.number().int().nonnegative(),
    n: z.number().int().nonnegative(),
    successes: z.number().nonnegative(),
    rate: z.number().nullable(),
  })
  .strict();

/**
 * The interval test as it stood at one batch boundary: the rate, the interval
 * around it, and the verdict the stop turns on. Recorded so a series that
 * stopped early can be checked against the figures it stopped on.
 */
export const intervalTestSchema = z
  .object({
    /** Which interval decided it — 99%, the stopping level, not the report's 95%. */
    confidence: z.literal(STOP_CONFIDENCE),
    win_rate: winRateSchema,
    interval: z
      .object({
        low: z.number(),
        high: z.number(),
      })
      .strict(),
    /** Whether that interval excludes 50%, which is what stops the series. */
    excludes_half: z.boolean(),
  })
  .strict();
export type IntervalTest = z.infer<typeof intervalTestSchema>;

/**
 * What the record keeps about the boundary a run stopped at: which rule fired,
 * the totals at that point, and the interval test if the series had reached the
 * 10 pairs it starts at.
 */
export const stopRecordSchema = z.discriminatedUnion("reason", [
  z
    .object({
      reason: z.literal("max_pairs"),
      totals: totalsSchema,
      test: intervalTestSchema.nullable(),
    })
    .strict(),
  z
    .object({
      reason: z.literal("wilson_interval"),
      totals: totalsSchema,
      /** The interval that decided it, which for this reason is never absent. */
      test: intervalTestSchema,
    })
    .strict(),
  z
    .object({
      reason: z.literal("max_cost"),
      /** The `--max-cost` the summed cost passed, in usd. */
      ceiling_usd: z.number(),
      totals: totalsSchema,
      test: intervalTestSchema.nullable(),
    })
    .strict(),
  z
    .object({
      reason: z.literal("max_tokens"),
      /** The `--max-tokens` the summed tokens passed. */
      ceiling_tokens: z.number().int(),
      totals: totalsSchema,
      test: intervalTestSchema.nullable(),
    })
    .strict(),
]);
export type StopRecord = z.infer<typeof stopRecordSchema>;

/** What to do at a batch boundary: stop, or play the next batch. */
export type StopDecision =
  | { stopped: false; test: IntervalTest | null }
  | { stopped: true; stop: StopRecord };

/** What a run may spend before it stops: brief §6.5's cost guard and its sibling. */
export interface Ceilings {
  /** `--max-cost <usd>`: summed `cost_usd` over the matches played. */
  maxCostUsd?: number;
  /** `--max-tokens <n>`: summed input + output + cache-read + cache-write. */
  maxTokens?: number;
}

/**
 * Check the ceilings a caller gave, the way `planSeries` checks `--max-pairs`.
 * A negative one would stop the series at its first boundary without playing
 * anything, which reads as a finished series rather than as a mistake.
 *
 * `--max-tokens` has to be a whole number, because the record keeps it as one:
 * a fractional ceiling would pass this check, spend a batch, and then be refused
 * by `series.json`'s own schema when the run came to write down the ceiling that
 * stopped it — which is the worst possible time to find out.
 */
export const checkCeilings = (ceilings: Ceilings): void => {
  const { maxCostUsd, maxTokens } = ceilings;
  if (maxCostUsd !== undefined && (!Number.isFinite(maxCostUsd) || maxCostUsd < 0)) {
    throw new Error(`--max-cost takes a number of 0 or more, not ${String(maxCostUsd)}`);
  }
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 0)) {
    throw new Error(`--max-tokens takes a whole number of 0 or more, not ${String(maxTokens)}`);
  }
};

/** The part of a played match the stopping rules read: X's seat, and who won. */
export interface PlayedMatch {
  /** The seat model X played, which is what makes the result X's rather than the board's. */
  seat: Seat;
  result: { winner: Seat | null };
}

/** What the rules are asked about: the series as it stands at a batch boundary. */
export interface StopInput {
  /** Pairs whose two matches both have a log — the unit brief §6.5 counts in. */
  pairsPlayed: number;
  /** Every match played, including one whose pair is not complete. */
  matches: readonly PlayedMatch[];
  /** Cost and tokens summed over every match played. */
  totals: SeriesTotals;
  /** `--max-pairs`, which the plan already resolved to a number. */
  maxPairs: number;
  ceilings?: Ceilings;
}

/**
 * The 99% test over every match played so far, from the seat X played each one
 * in. Only asked once the series has 10 complete pairs, so there are always
 * matches enough for `wilsonInterval` to have something to take an interval of.
 */
const intervalTestOf = (matches: readonly PlayedMatch[]): IntervalTest => {
  const outcomes: Outcome[] = matches.map((match) => outcomeOf(match.result, match.seat));
  const win_rate = winRateOf(outcomes);
  const interval = wilsonInterval({
    successes: win_rate.successes,
    n: win_rate.n,
    z: zOf(STOP_CONFIDENCE),
  });
  return {
    confidence: STOP_CONFIDENCE,
    win_rate,
    interval,
    // An interval excludes 50% when the whole of it is on one side of it.
    excludes_half: interval.low > EVEN_RATE || interval.high < EVEN_RATE,
  };
};

/**
 * The ceiling the totals have passed, and the record of the boundary that found
 * it out. Tokens are asked before cost because they are the ceiling that binds on
 * unpriced hardware (`docs/pi-harness-notes.md` §7), so they are the one a report
 * should read.
 */
const ceilingFired = (
  ceilings: Ceilings,
  totals: SeriesTotals,
  test: IntervalTest | null,
): StopRecord | null => {
  if (ceilings.maxTokens !== undefined && totals.tokens.total > ceilings.maxTokens) {
    return { reason: "max_tokens", ceiling_tokens: ceilings.maxTokens, totals, test };
  }
  if (ceilings.maxCostUsd !== undefined && totals.cost_usd > ceilings.maxCostUsd) {
    return { reason: "max_cost", ceiling_usd: ceilings.maxCostUsd, totals, test };
  }
  return null;
};

/**
 * Decide what happens at the end of a batch.
 *
 * A ceiling is passed only when the total is *over* it: a run that lands exactly
 * on the number it was given has spent what it was allowed and stops at the next
 * boundary, not at this one.
 */
export const decideStop = (input: StopInput): StopDecision => {
  const { pairsPlayed, maxPairs, totals } = input;
  const ceilings = input.ceilings ?? {};

  // The test is computed at every boundary from 10 pairs on, whether or not it is
  // the reason the run stops, so a series stopped by its ceiling still records
  // what the result looked like when it stopped.
  const test = pairsPlayed >= MIN_TEST_PAIRS ? intervalTestOf(input.matches) : null;

  if (pairsPlayed >= maxPairs) {
    return { stopped: true, stop: { reason: "max_pairs", totals, test } };
  }

  const ceiling = ceilingFired(ceilings, totals, test);
  if (ceiling !== null) {
    return { stopped: true, stop: ceiling };
  }

  if (test !== null && test.excludes_half) {
    return { stopped: true, stop: { reason: "wilson_interval", totals, test } };
  }

  return { stopped: false, test };
};

/**
 * Whether the ceilings are already passed, asked *before* a batch is played, and
 * null when they are not or when the series is already at its pair limit.
 *
 * Only the ceilings are asked here. The pair limit and the interval ask about what
 * has been played, so before a batch they can only repeat what the boundary after
 * the last batch answered, and a series resumed onto logs it has already played
 * still has to walk its batches to count them. A ceiling is different: it is about
 * what has been spent, and a series resumed a week later has spent all of that
 * already — a batch is around 1.6 hours and 23M tokens (`docs/pi-harness-notes.md`
 * §7), so learning that only after playing one costs the most it can.
 *
 * The pair limit still outranks the ceilings, exactly as it does at a boundary.
 * A series that has already played its `--max-pairs` ran the length it was asked
 * for, so a rerun given a ceiling those matches happen to pass must not relabel a
 * complete sample as an early stop: that returns null, the loop walks its batches
 * and counts the logs it finds, and `decideStop` writes `max_pairs`.
 */
export const ceilingsPassed = (input: StopInput): StopRecord | null => {
  const { pairsPlayed, maxPairs, matches, totals } = input;
  if (pairsPlayed >= maxPairs) return null;
  const test = pairsPlayed >= MIN_TEST_PAIRS ? intervalTestOf(matches) : null;
  return ceilingFired(input.ceilings ?? {}, totals, test);
};
