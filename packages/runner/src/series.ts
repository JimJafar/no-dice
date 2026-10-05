/**
 * The series runner: brief §6.5's loop over the plan, and the record that makes a
 * stopped series resumable.
 *
 * `planSeries` works out what is missing and this plays it. The one seam that
 * matters is `playMatch`, which defaults to `runMatch` and takes every match a
 * series plays: brief §8's series tests are written with scripted results because
 * one bot-versus-bot match already takes about 1.3 s and a model match nineteen
 * minutes (`docs/pi-harness-notes.md` §7), so the 75-pair series this runs by
 * default can never be a test fixture. The seam is the real one though — a
 * scripted `playMatch` is handed the plan's path, `matchDir` and seat order, and
 * is expected to leave a log there, which is what lets the resume test run against
 * the same on-disk state a real run leaves.
 *
 * `series/<name>/series.json` is the series' memory and the report brief §6.5 asks
 * for: the pairing, the seed list, and for every pair its two matches with their
 * path, result, cost and token totals, plus the run's own state — pairs played,
 * the stop reason, whether it stopped early. It is written atomically after every
 * batch of 5 pairs, the way `match.ts` writes a log, so a series killed at any
 * moment can be restarted from what is on disk. A match whose log is already there
 * is not played again; its entry is read back out of that log rather than
 * remembered, so the record describes the matches on disk even when the run that
 * played them finished days ago.
 *
 * A match that throws — `MatchVoided` from a seat reaching outside the seven tools,
 * a provider that never answered — leaves no log, is recorded as failed with its
 * reason, and is played again by the next run. It is never counted as a match that
 * was played, and it does not take the rest of its batch down with it.
 *
 * The stopping rules are brief §6.5's and live beside this loop: a run currently
 * plays to `--max-pairs` and records that it did, with the interval and the cost
 * and token ceilings to be added there rather than guessed at here.
 */
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { matchLogSchema, seatSchema } from "@no-dice/log";
import type { MatchLog, Seat } from "@no-dice/log";

import { BOTS } from "./args.ts";
import type { SeatArg } from "./args.ts";
import { runMatch, seatSpec } from "./match.ts";
import type { MatchOutcome, RunMatchOptions, SeatSpec } from "./match.ts";
import { planSeries, seriesRecordPath, writeSeriesRecord } from "./series-plan.ts";
import type { PlannedMatch } from "./series-plan.ts";

/** Brief §6.5's batch: matches are played in batches of 5 pairs. */
const BATCH_PAIRS = 5;

/**
 * How one match of a series is played. It takes what `runMatch` takes — the
 * plan's `out`, `seed`, `matchDir` and seat order — and hands back what it wrote.
 * A scripted one is expected to write a real `salient-log/1` at `out`, because a
 * log on disk is what tells the next run that this match has been played.
 */
export type PlayMatch = (options: RunMatchOptions) => Promise<MatchOutcome>;

/** What `runSeries` takes: the pairing, the limits, and how a match is played. */
export interface RunSeriesOptions {
  /** The series directory: `series/<name>`, or wherever `--dir` pointed it. */
  dir: string;
  /** Model X — the pairing's first seat, and the one the swap moves. */
  a: SeatArg;
  /** The opponent X is measured against. */
  b: SeatArg;
  /** Brief §6.5's `--max-pairs`, default 75. */
  maxPairs?: number;
  /** What the seed list is drawn from, `--seed-base`. */
  seedBase?: number;
  /** How a match is played. Defaults to the real `runMatch`. */
  playMatch?: PlayMatch;
}

/** What a run reports: the record it left, and what this run did to get it. */
export interface SeriesRun {
  dir: string;
  /** The `series.json` this run wrote last. */
  recordPath: string;
  record: SeriesRecord;
  /** Matches this run played, skipped because their log was already there, and failed. */
  played: number;
  skipped: number;
  failed: number;
}

/** The tokens one match's two seats used, over every turn, and their sum. */
const tokensSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cache_read: z.number().int().nonnegative(),
    cache_write: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type SeriesTokens = z.infer<typeof tokensSchema>;

/** How a match ended, as its own log says — the log is never second-guessed. */
const outcomeSchema = z
  .object({
    type: z.enum(["time", "knockout"]),
    winner: seatSchema.nullable(),
    margin: z.number().int(),
  })
  .strict();
export type SeriesOutcome = z.infer<typeof outcomeSchema>;

/** One match as the series remembers it: played, with its figures, or failed. */
const matchRecordSchema = z.discriminatedUnion("status", [
  z
    .object({
      /** The seat model X played in this match of the pair. */
      seat: seatSchema,
      /** The log's path, which is what a resume checks. */
      path: z.string(),
      status: z.literal("played"),
      result: outcomeSchema,
      cost_usd: z.number(),
      tokens: tokensSchema,
    })
    .strict(),
  z
    .object({
      seat: seatSchema,
      path: z.string(),
      status: z.literal("failed"),
      /** Why the match did not produce a log, which is why the next run plays it again. */
      error: z.string(),
    })
    .strict(),
]);
export type SeriesMatchRecord = z.infer<typeof matchRecordSchema>;

/** One seed and its two seat-swapped matches, in the order a run plays them. */
const pairRecordSchema = z
  .object({
    seed: z.number().int(),
    matches: z.tuple([matchRecordSchema, matchRecordSchema]),
  })
  .strict();
export type SeriesPairRecord = z.infer<typeof pairRecordSchema>;

/**
 * Why the run stopped. `max_pairs` is the only reason a run has today; brief
 * §6.5's interval and ceiling reasons are recorded by the stopping rules.
 */
const stopReasonSchema = z.enum(["max_pairs"]);

/** The run's own state, which is what tells a report whether to trust the sample. */
const stateSchema = z
  .object({
    /** Pairs whose two matches both have a log — the unit brief §6.5 counts in. */
    pairs_played: z.number().int().nonnegative(),
    matches_played: z.number().int().nonnegative(),
    matches_failed: z.number().int().nonnegative(),
    stop_reason: stopReasonSchema,
    stopped_early: z.boolean(),
  })
  .strict();
export type SeriesState = z.infer<typeof stateSchema>;

/** A seat as the command line named it, which is what makes a pairing reproducible. */
const seatArgSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot"), bot: z.enum(BOTS) }).strict(),
  z.object({ kind: z.literal("model"), provider: z.string(), model: z.string() }).strict(),
]);

/**
 * The whole `series.json`. The seed fields are `series-plan.ts`'s and are carried
 * through untouched; a field this module does not know about is left as it was,
 * which is what lets the stopping rules record their own state in the same file.
 */
const seriesRecordSchema = z.object({
  seed_base: z.number().int(),
  max_pairs: z.number().int().nonnegative(),
  seeds: z.array(z.number().int()),
  pairing: z.object({ a: seatArgSchema, b: seatArgSchema }).strict(),
  pairs: z.array(pairRecordSchema),
  state: stateSchema,
});
export type SeriesRecord = z.infer<typeof seriesRecordSchema>;

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";

/** The record as it stands on disk, or `{}` when the series has just started. */
const readRawRecord = async (dir: string): Promise<Record<string, unknown>> => {
  let text: string;
  try {
    text = await readFile(seriesRecordPath(dir), "utf8");
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // `planSeries` has already refused a file that is not JSON, so the only way
    // here is a record that is not a full one yet — nothing to carry over.
    return {};
  }
};

/** The log of a match that is already on disk, read back as the record's figures. */
const readLog = async (path: string): Promise<MatchLog> => {
  const text = await readFile(path, "utf8");
  try {
    return matchLogSchema.parse(JSON.parse(text) as unknown);
  } catch {
    // A log is brief §6.5's proof that a match was played. One that cannot be
    // read cannot be reported as played, and replaying over it would quietly
    // replace a match the series already counted.
    throw new Error(
      `the log at ${path} is not a salient-log/1 log, so the series cannot be resumed from it`,
    );
  }
};

/** A match's cost and tokens, summed over both seats of every turn of its log. */
const totalsOf = (log: MatchLog): { cost_usd: number; tokens: SeriesTokens } => {
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let cost = 0;
  for (const turn of log.turns) {
    for (const seat of ["A", "B"] as const) {
      const played = turn.players[seat];
      tokens.input += played.usage.input;
      tokens.output += played.usage.output;
      tokens.cache_read += played.usage.cache_read;
      tokens.cache_write += played.usage.cache_write;
      cost += played.cost_usd;
    }
  }
  return {
    cost_usd: cost,
    tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cache_read + tokens.cache_write },
  };
};

/** A match that has a log, as the record holds it. */
const playedRecord = (match: PlannedMatch, log: MatchLog): SeriesMatchRecord => ({
  seat: match.seat,
  path: match.out,
  status: "played",
  result: { type: log.result.type, winner: log.result.winner, margin: log.result.margin },
  ...totalsOf(log),
});

/**
 * Why a match did not produce a log, in one line the report can print: the
 * error's name and message, and for a voided match the reason code it was
 * voided for.
 */
const reasonOf = (error: unknown): string => {
  const { name, message, reason } = (error ?? {}) as {
    name?: string;
    message?: string;
    reason?: string;
  };
  const text =
    name !== undefined && message !== undefined
      ? `${name}: ${message}`
      : (message ?? name ?? String(error));
  return reason === undefined ? text : `${text} (${reason})`;
};

/** Every pair of a record, by seed, so a rerun can carry the ones it did not plan. */
const pairsBySeed = (pairs: readonly SeriesPairRecord[]): Map<number, SeriesPairRecord> =>
  new Map(pairs.map((pair) => [pair.seed, pair]));

/** The run's state, counted over every pair the record holds. */
const stateOf = (pairs: readonly SeriesPairRecord[]): SeriesState => {
  const matches = pairs.flatMap((pair) => pair.matches);
  return {
    pairs_played: pairs.filter((pair) => pair.matches.every((match) => match.status === "played")).length,
    matches_played: matches.filter((match) => match.status === "played").length,
    matches_failed: matches.filter((match) => match.status === "failed").length,
    stop_reason: "max_pairs",
    stopped_early: false,
  };
};

/** Brief §6.5's batches of 5 pairs, in the order a run plays them. */
const batchesOf = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size));
  return batches;
};

/**
 * Play a series: plan it, play what the plan says is missing, and record every
 * pair after every batch of 5.
 *
 * The plan is the whole list, including the pairs already on disk, so the record
 * a restart leaves describes the whole series rather than only the part this run
 * played. Pairs from an earlier record that this plan does not cover — a lowered
 * `--max-pairs` — are carried over rather than dropped: a played match is never
 * erased from the series' memory.
 */
export async function runSeries(options: RunSeriesOptions): Promise<SeriesRun> {
  const playMatch = options.playMatch ?? runMatch;
  const plan = await planSeries({
    dir: options.dir,
    a: options.a,
    b: options.b,
    ...(options.maxPairs === undefined ? {} : { maxPairs: options.maxPairs }),
    ...(options.seedBase === undefined ? {} : { seedBase: options.seedBase }),
  });

  // What the record already said, so the seed fields `planSeries` wrote and the
  // pairs this plan does not plan both survive being rewritten.
  const existing = await readRawRecord(plan.dir);
  const previous = seriesRecordSchema.safeParse(existing);
  const bySeed = pairsBySeed(previous.success ? previous.data.pairs : []);

  let played = 0;
  let skipped = 0;
  let failed = 0;

  /** The seats of one match as the runner plays them. */
  const seatsOf = (match: PlannedMatch): Record<Seat, SeatSpec> => ({
    A: seatSpec(match.seats.A),
    B: seatSpec(match.seats.B),
  });

  /** One match: read its log if it has one, otherwise play it. */
  const recordOf = async (match: PlannedMatch): Promise<SeriesMatchRecord> => {
    if (match.played) {
      skipped++;
      return playedRecord(match, await readLog(match.out));
    }
    try {
      const { log } = await playMatch({
        out: match.out,
        seed: match.seed,
        seats: seatsOf(match),
        matchDir: match.matchDir,
      });
      played++;
      return playedRecord(match, log);
    } catch (error) {
      // Brief §6.5's resume rule is a log on disk, and a match that threw left
      // none, so the next run plays it again. Counting it as played here would
      // make a voided match a result.
      failed++;
      return { seat: match.seat, path: match.out, status: "failed", error: reasonOf(error) };
    }
  };

  const recordPath = seriesRecordPath(plan.dir);

  /** Write what is known so far: this plan's pairs, plus any older played ones. */
  const writeRecord = async (): Promise<SeriesRecord> => {
    const pairs = [...bySeed.values()];
    const written = {
      ...existing,
      pairing: { a: options.a, b: options.b },
      pairs,
      state: stateOf(pairs),
    };
    // Checked before it lands, so the only record a later run can read is one
    // that says what this run knows.
    const record = seriesRecordSchema.parse(written);
    await writeSeriesRecord(plan.dir, written);
    return record;
  };

  // Written once before anything is played, so a series killed in its first match
  // still has a record, and again after every batch of 5 pairs.
  let record = await writeRecord();

  for (const batch of batchesOf(plan.pairs, BATCH_PAIRS)) {
    for (const pair of batch) {
      bySeed.set(pair.seed, {
        seed: pair.seed,
        matches: [await recordOf(pair.matches[0]), await recordOf(pair.matches[1])],
      });
    }
    record = await writeRecord();
  }

  return { dir: plan.dir, recordPath, record, played, skipped, failed };
}
