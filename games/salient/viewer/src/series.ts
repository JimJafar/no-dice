/**
 * The series a showcase match came from: the `salient-showcase/1` sidecar the
 * stats package writes beside a finished series, read here through a schema the
 * viewer owns.
 *
 * The sidecar's shape is declared in this file rather than imported. The viewer
 * is allowed exactly one package specifier — `@no-dice/log` — and that rule is
 * what keeps it from reaching the engine or the stats package and recomputing a
 * series it was handed; `z` comes out of the log package for the same reason,
 * since that package depends on zod and is the only one the viewer may name.
 *
 * Unlike `matchLogSchema`, this schema is not strict, and that is deliberate. A
 * log is a closed format that every writer has to match field for field; the
 * sidecar is one producer's working file — it carries the whole ranking, every
 * candidate with its result and its excitement score, and the header shows one
 * line out of it. The viewer declares the fields it reads and ignores the rest,
 * so a producer that adds a field leaves the series line alone instead of
 * blanking it.
 *
 * The header's line is built here from the figures rather than copied out of the
 * sidecar's own one-line summary, for two reasons: the header's sentence also
 * has to say that the match on the screen is the one that was picked, which no
 * producer's line can know; and a line assembled from the numbers beside it
 * cannot disagree with them.
 */
import { seatSchema, z } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

/** The sidecar's format tag, as the stats package writes it. */
export const SHOWCASE_FORMAT = "salient-showcase/1";

/** The counts the series was measured over, and the rate they come to. */
const winRateSchema = z.object({
  n: z.number().int().nonnegative(),
  rate: z.number().nullable(),
});

/** The interval around that rate, or null when nothing was counted. */
const intervalSchema = z.object({ low: z.number(), high: z.number() });

/** The pairing, and how the run that produced the match went. */
const seriesSchema = z.object({
  /** Model X, as the series record names it. */
  x: z.string().min(1),
  opponent: z.string().min(1),
  win_rate: winRateSchema,
  interval: intervalSchema.nullable(),
  /** The confidence the interval is quoted at — 0.95 for the report's figure. */
  confidence: z.number(),
  pairs: z.number().int().nonnegative(),
  stop_reason: z.string().min(1),
});

/** The one match the series picked to be rendered. */
const matchSchema = z.object({
  /** The seed of the pair it was played from — the log's own `seed`. */
  seed: z.number().int(),
  /** Which seat model X played in this match of the pair. */
  x_seat: seatSchema,
});

/** The part of `showcase.json` the viewer reads. */
export const showcaseSchema = z.object({
  format: z.literal(SHOWCASE_FORMAT),
  series: seriesSchema,
  /** Null for a series that counted no match, and so picked none. */
  match: matchSchema.nullable(),
});

/** A sidecar the viewer can use. */
export type Showcase = z.infer<typeof showcaseSchema>;

/** A rate as the series report and the sidecar both write it: `90.0%`. */
const percent = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A confidence, named the way a report names one: `95%`, not `95.0%`. */
const confidenceLabel = (n: number): string => `${String(Math.round(n * 100))}%`;

/** The win rate and its interval, in the report's form. */
function winRateText(series: Showcase["series"]): string {
  if (series.win_rate.rate === null || series.interval === null) {
    // A series that counted nothing has no rate to quote, and a zero would read
    // as a model that lost every match it never played.
    return "— over no counted match";
  }
  return (
    `${percent(series.win_rate.rate)} (${confidenceLabel(series.confidence)} ` +
    `${percent(series.interval.low)} – ${percent(series.interval.high)}) ` +
    `over ${String(series.win_rate.n)} counted matches`
  );
}

/**
 * The sentence that puts the match on the screen in the series.
 *
 * The seed is the only handle the two have in common, and it names a pair rather
 * than a match — a pair is the same seed played twice with the seats swapped —
 * so the seat X played is said with it. A log from anywhere else in the series,
 * or from another series, is named as one rather than claimed as the choice.
 */
function pickedText(showcase: Showcase, log: MatchLog): string {
  if (showcase.match === null) return "The series counted no match, so it picked none.";
  const { seed, x_seat: xSeat } = showcase.match;
  if (seed !== log.seed) {
    return `The series picked seed ${String(seed)}; this log is seed ${String(log.seed)}.`;
  }
  return `This is the match the series picked: seed ${String(seed)}, with ${showcase.series.x} in seat ${xSeat}.`;
}

/**
 * The header's series line: model X against its opponent, the win rate with its
 * interval, the pairs played, the reason the run stopped, and where the match on
 * the screen sits in that series.
 */
export function seriesLineOf(showcase: Showcase, log: MatchLog): string {
  const series = showcase.series;
  return (
    `${series.x} vs ${series.opponent} — win rate ${winRateText(series)}, ` +
    `${String(series.pairs)} pairs, stopped on ${series.stop_reason}. ${pickedText(showcase, log)}`
  );
}
