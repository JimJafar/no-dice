/**
 * Brief §6.7's margin, and the bootstrap interval around its mean.
 *
 * **A knockout counts as 93.** The engine already scores one that way: when a
 * Base falls it records the winner as holding every point on the board
 * (`pointsOnBoard` in `games/salient/engine/src/resolve.ts`), and on the default
 * map that is 93 — 70 plain hexes at 1, 2 Bases at 1, 7 Nodes at 3, the 12
 * blocked hexes worth nothing. So on a full map the log's own `margin` for a
 * knockout is already 93, and the constant is what makes a match played on a
 * smaller map, or a log whose score was written by hand, count the same way as
 * one played to the brief's config. A margin is a statement about how decisively
 * a match ended, not about how many hexes happened to be on the board.
 *
 * A knockout that took both Bases in the same turn is a draw, and the engine
 * scores it 0–0: it stays 0. Counting it as 93 would give a drawn match the
 * largest margin in the series.
 *
 * The log's own `result` is the only input — the board is never replayed and the
 * margin is never recomputed from the score, which is the engine's job and has
 * already been done.
 *
 * The interval is a bootstrap, and it is seeded. `Math.random()` would make every
 * run of `report.md` print a different interval over the same matches, which is
 * the opposite of what a published figure is for: the same margins and the same
 * seed have to give the same numbers a year later.
 */
import type { LogResult } from "@no-dice/log";

/** Brief §6.7: a knockout counts as 93 — every point on the default board. */
export const KNOCKOUT_MARGIN = 93;

/**
 * One match's margin, as its log says it ended: 93 for a knockout someone won,
 * and the log's own `margin` for anything else — a match that ran out of time,
 * and a knockout that took both Bases, which the engine scored 0–0.
 */
export const marginOf = (result: LogResult): number =>
  result.type === "knockout" && result.winner !== null ? KNOCKOUT_MARGIN : result.margin;

/**
 * `mulberry32`, following the convention of `games/salient/engine/src/rng.ts`
 * rather than importing it: `@no-dice/stats` has one dependency, `@no-dice/log`,
 * so reading a directory of logs never pulls the engine in. It hands out unsigned
 * 32-bit integers and the draw below takes the modulus of that, exactly as
 * `generateMap` does — the same generator, the same convention, so a seed means
 * the same stream everywhere in this repository.
 */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
};

/** What `bootstrapMargin` takes. */
export interface BootstrapOptions {
  /** Resamples to draw. Fixed by the caller, so an interval is one number. */
  readonly samples: number;
  /** The generator's seed: same margins and seed, same interval. */
  readonly seed: number;
  /** The level the two percentile bounds are taken at. Default 0.95. */
  readonly confidence?: number;
}

/** Brief §6.7's "mean margin with a bootstrap interval". */
export interface BootstrapMargin {
  /** Margins the mean was taken over. */
  readonly n: number;
  /** The mean of the margins as given — not the mean of the resamples. */
  readonly mean: number;
  /** The percentile bounds of the resampled means. */
  readonly low: number;
  readonly high: number;
  /** The resamples drawn, and the level `low` and `high` were taken at. */
  readonly samples: number;
  readonly confidence: number;
}

/**
 * The nearest-rank percentile of an ascending list: the value at rank
 * `ceil(p * length)`, clamped into the list. Nearest-rank rather than an
 * interpolated one, because the resampled means of a dozen margins are a coarse,
 * discrete set and a value between two of them describes a margin no match had.
 */
const percentile = (sorted: readonly number[], p: number): number => {
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
};

/**
 * The mean of `margins` and a percentile interval for it, from `samples`
 * resamples with replacement of the whole list.
 *
 * A bootstrap rather than a normal-theory interval because a series' margins are
 * nothing like a normal: they pile up at 93 (every knockout), sit on the small
 * margins a match decided on points, and include 0 for a draw. The resample
 * distribution of the mean is whatever those margins actually make.
 */
export const bootstrapMargin = (
  margins: readonly number[],
  options: BootstrapOptions,
): BootstrapMargin => {
  const { samples, seed } = options;
  const confidence = options.confidence ?? 0.95;
  if (margins.length === 0) {
    throw new Error("a bootstrap interval needs at least one margin");
  }
  for (const margin of margins) {
    if (!Number.isFinite(margin)) {
      throw new Error(`a margin of ${String(margin)} is not a finite number`);
    }
  }
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new Error(`a bootstrap needs a positive whole number of resamples, not ${String(samples)}`);
  }
  if (!(confidence > 0 && confidence < 1)) {
    throw new Error(`a bootstrap interval needs a confidence between 0 and 1, not ${String(confidence)}`);
  }

  const n = margins.length;
  const mean = margins.reduce((total, margin) => total + margin, 0) / n;

  const random = mulberry32(seed);
  const means: number[] = [];
  for (let drawn = 0; drawn < samples; drawn++) {
    let total = 0;
    for (let pick = 0; pick < n; pick++) total += margins[random() % n];
    means.push(total / n);
  }
  means.sort((left, right) => left - right);

  const tail = (1 - confidence) / 2;
  return {
    n,
    mean,
    low: percentile(means, tail),
    high: percentile(means, 1 - tail),
    samples,
    confidence,
  };
};
