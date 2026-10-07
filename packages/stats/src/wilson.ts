/**
 * Brief §6.5's win rate, and the Wilson score interval both the stopping test
 * and the report are read from.
 *
 * The two callers are deliberate about different confidences: the series runner
 * asks for 99% because it applies the test after every batch of 5 pairs, and
 * checking after every batch makes a false early stop likelier, while the report
 * quotes 95%. That is why `z` is a parameter rather than a constant buried in the
 * formula, and why the interval lives here and nowhere else — an interval
 * reimplemented in the runner is an interval that can drift from the one the
 * report prints beside it.
 *
 * A draw counts as half a win (§6.5), so `successes` is fractional: 10 wins and
 * 4 draws out of 20 is 12 successes out of 20, and the interval takes 12. The
 * Wilson score interval is defined for a count of successes out of a whole number
 * of trials, and a half-win count is still one — the formula never asks whether
 * its input is an integer.
 */
import type { LogResult, Seat } from "@no-dice/log";

/** How one match went for the seat the series is measuring — model X. */
export type Outcome = "win" | "loss" | "draw";

/**
 * One match's result, from one seat's side of the board. The log's own `result`
 * is the only input and is never second-guessed: a `winner` of `null` is a draw
 * the engine recorded, whether the match ran out of time level or both Bases fell
 * in the same turn, and is not inferred from the score.
 *
 * Only `winner` is read, so that is the whole parameter: the series runner keeps
 * the winner it copied out of a log in `series.json` without the score and turn
 * that go with it, and its stopping test classifies from that record rather than
 * re-reading a megabyte of log for every match it has already counted.
 */
export const outcomeOf = (result: Pick<LogResult, "winner">, seat: Seat): Outcome => {
  if (result.winner === null) return "draw";
  return result.winner === seat ? "win" : "loss";
};

/** Brief §6.7's first row: the counts, and the win rate they come to. */
export interface WinRate {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Every outcome counted: `wins + losses + draws`. */
  readonly n: number;
  /** `wins + draws / 2` — the possibly fractional `successes` the interval takes. */
  readonly successes: number;
  /**
   * `successes / n`, or `null` when nothing has been played. A rate of 0 over no
   * matches would read as a model that lost every one.
   */
  readonly rate: number | null;
}

/** The win rate over a list of match outcomes, a draw counting half a win. */
export const winRateOf = (outcomes: readonly Outcome[]): WinRate => {
  const wins = outcomes.filter((outcome) => outcome === "win").length;
  const losses = outcomes.filter((outcome) => outcome === "loss").length;
  const draws = outcomes.filter((outcome) => outcome === "draw").length;
  const n = wins + losses + draws;
  const successes = wins + draws / 2;
  return {
    wins,
    losses,
    draws,
    n,
    successes,
    rate: n === 0 ? null : successes / n,
  };
};

/**
 * The Wilson score interval: a binomial proportion's bounds, not a normal one.
 *
 * Chosen over the plain Wald interval because it behaves at the ends — a model
 * 5 for 5 has an interval that stops at 1 rather than running past it, and a 99%
 * test that excludes 50% has to be trusted near the edges of the sample.
 */
export interface WilsonInterval {
  readonly low: number;
  readonly high: number;
}

/** The interval for `successes` out of `n` trials at the `z` of a confidence. */
export const wilsonInterval = (input: { successes: number; n: number; z: number }): WilsonInterval => {
  const { successes, n, z } = input;
  // Checked rather than assumed: an interval out of a nonsense sample is what a
  // series stops on, so a wrong `n` has to fail at the call, not in the report.
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`a Wilson interval needs a positive whole number of matches, not ${String(n)}`);
  }
  if (!(successes >= 0) || successes > n) {
    throw new Error(`${String(successes)} successes is not a count out of ${String(n)} matches`);
  }
  if (!(z > 0)) {
    throw new Error(`a Wilson interval needs a positive z, not ${String(z)}`);
  }
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // The interval is mathematically inside [0, 1] — that is the point of it — but
  // the arithmetic lands a hair outside at the ends, and a report that prints a
  // win rate above 1 is a report nobody can read. At the two ends of the sample
  // the bounds are not merely inside [0, 1], they are 1 and 0: `p * (1 - p)` is
  // nought and the two `z2` terms cancel exactly. They are named rather than
  // rounded to, because which side of 1 the rounding falls on depends on `n` and
  // `z` — 5 for 5 at 99% lands a hair past and clamps to 1, 6 for 6 at 95% lands
  // a hair short — and a model that won every match it played cannot be
  // allowed to sit outside its own interval.
  return {
    low: successes === 0 ? 0 : Math.max(0, centre - half),
    high: successes === n ? 1 : Math.min(1, centre + half),
  };
};

/**
 * The two confidences the milestone uses. The report's 95% and the stopping
 * test's 99% are the only levels §6.5 and §6.7 name, so a level outside them is
 * a change to the method rather than a number to look up.
 */
export type Confidence = 0.95 | 0.99;

/** The two figures §6.5 names, spelled out so a report can quote them. */
const Z_OF: Record<Confidence, number> = { 0.95: 1.96, 0.99: 2.5758 };

/** `z` for a confidence level: 1.96 at 95%, 2.5758 at 99%. */
export const zOf = (confidence: Confidence): number => Z_OF[confidence];
