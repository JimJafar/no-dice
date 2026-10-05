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
 * The stopping rules are brief §6.5's and live beside this loop, in
 * `./series-stop.ts`. They are asked at the end of every batch of 5 pairs, and
 * their ceilings also before the next batch starts, never in the middle of a
 * pair, and what they decide is written into the record: which rule ended the
 * run, the 99% interval if the interval test had been reached at that boundary
 * (and it is what decided the run when the result came out clear), the cost and
 * token totals there, and whether the series stopped short of `--max-pairs`.
 *
 * `--concurrency <n>` is brief §6.5's "run several matches at once, limited by
 * provider rate limits", and it bounds **pairs**, not matches: the pool keeps at
 * most `n` pairs in flight, and the two matches of a pair are played together,
 * since they are the same seed with the seats swapped and share nothing but the
 * seed. So `n` pairs is up to `2n` matches and `4n` Pi seats, which is why the
 * default is 1 — every seat is a child process with a home and an MCP connection
 * of its own, and no provider's rate limit has been measured yet
 * (`docs/pi-harness-notes.md` §7 measured one match at 19 minutes and 4.59M
 * tokens, which makes a 150-match series about 48 hours end to end at 1). The
 * pool is emptied at every batch boundary, so a pair is never split across one
 * and the stopping rules are asked at exactly the same points however the batch
 * was scheduled. The record is written once a batch has all of its matches in, so
 * a stop in the middle of one still leaves a complete record, and the pairs it
 * lists are in the plan's order rather than the order the pool happened to
 * finish them in.
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
import type { PlannedMatch, PlannedPair } from "./series-plan.ts";
import {
  BATCH_PAIRS,
  ceilingsPassed,
  checkCeilings,
  decideStop,
  stopReasonSchema,
  stopRecordSchema,
  tokensSchema,
} from "./series-stop.ts";
import type { Ceilings, SeriesTokens, StopInput, StopRecord } from "./series-stop.ts";

/**
 * How one match of a series is played. It takes what `runMatch` takes — the
 * plan's `out`, `seed`, `matchDir` and seat order — and hands back what it wrote.
 * A scripted one is expected to write a real `salient-log/1` at `out`, because a
 * log on disk is what tells the next run that this match has been played.
 */
export type PlayMatch = (options: RunMatchOptions) => Promise<MatchOutcome>;

/**
 * How many pairs a series plays at once when nothing says otherwise. One, because
 * each Pi seat is a child process with its own home and its own MCP connection
 * and the provider's rate limits are unknown until milestone 06 runs a real
 * series: the flag exists so the operator can raise it, not so the default can
 * overload Marvin.
 */
export const DEFAULT_CONCURRENCY = 1;

/**
 * Check `--concurrency` the way `planSeries` checks `--max-pairs`. Anything below
 * 1 would play nothing, and a fraction would quietly mean a pool of a size no
 * one asked for.
 */
export const checkConcurrency = (concurrency: number): void => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency takes a whole number of 1 or more, not ${String(concurrency)}`);
  }
};

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
  /** Brief §6.5's cost guard, `--max-cost <usd>`: summed cost over the matches played. */
  maxCostUsd?: number;
  /** `--max-tokens <n>`: summed tokens, the ceiling that binds on unpriced hardware. */
  maxTokens?: number;
  /** What the seed list is drawn from, `--seed-base`. */
  seedBase?: number;
  /**
   * Brief §6.5's concurrency: how many **pairs** are in flight at once, default
   * 1. A pair's two matches always run together, so this is `2n` matches and up
   * to `4n` Pi seats at `n`.
   */
  concurrency?: number;
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
  /**
   * What the stopping rules decided, and what they had to go on: which rule
   * fired, the interval test at that boundary if the series had reached 10 pairs,
   * and the cost and token totals there. Absent while a run is still playing.
   */
  stop: stopRecordSchema.optional(),
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

/** A pair counts towards the series only when both its matches have a log. */
const completePairs = (pairs: readonly SeriesPairRecord[]): SeriesPairRecord[] =>
  pairs.filter((pair) => pair.matches.every((match) => match.status === "played"));

/** The run's state, counted over every pair the record holds. */
const stateOf = (pairs: readonly SeriesPairRecord[], stop: StopRecord | null): SeriesState => {
  const matches = pairs.flatMap((pair) => pair.matches);
  return {
    pairs_played: completePairs(pairs).length,
    matches_played: matches.filter((match) => match.status === "played").length,
    matches_failed: matches.filter((match) => match.status === "failed").length,
    stop_reason: stop?.reason ?? "max_pairs",
    // Reaching `--max-pairs` is the series running the length it was asked for;
    // any other reason means it ended short of it, which is what brief §6.5 has
    // the report say.
    stopped_early: stop !== null && stop.reason !== "max_pairs",
  };
};

/** Brief §6.5's batches of 5 pairs, in the order a run plays them. */
const batchesOf = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size));
  return batches;
};

/**
 * Run `items` through at most `limit` workers at a time, and hand back their
 * results in the order the items came in.
 *
 * This is the whole of `--concurrency`, and the unit it schedules is a pair: a
 * pair is never split across a batch boundary, and the pool is empty by the time
 * a batch is over, which is where the stopping rules are asked. A worker stops
 * taking work as soon as one has thrown, but every worker is still awaited before
 * the error is rethrown — a match left running unawaited would keep a seat
 * writing a log after the run had reported a failure, and the record would say
 * nothing about it. (A match that fails is not what throws here: `recordOf`
 * catches that. What can throw past it is a log that cannot be read back.)
 */
const mapPool = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  /** The first worker's failure, kept in a box so the workers can leave one. */
  const failed: { error: unknown }[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed.length > 0) return;
      const at = next++;
      if (at >= items.length) return;
      try {
        results[at] = await work(items[at]);
      } catch (error) {
        if (failed.length === 0) failed.push({ error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (failed.length > 0) throw failed[0].error;
  return results;
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
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const ceilings: Ceilings = {
    ...(options.maxCostUsd === undefined ? {} : { maxCostUsd: options.maxCostUsd }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
  };
  checkCeilings(ceilings);
  checkConcurrency(concurrency);
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

  /**
   * One pair: its two matches together, and its record entry once both are in.
   *
   * The two matches of a pair are the same seed with the seats swapped, so they
   * share nothing but the seed and are played together — which is what makes a
   * pair, and not a match, the unit `--concurrency` bounds. A match that throws
   * is caught by `recordOf`, so one failing match never takes its partner, or its
   * batch, down with it.
   */
  const pairRecordOf = async (pair: PlannedPair): Promise<SeriesPairRecord> => ({
    seed: pair.seed,
    matches: await Promise.all([recordOf(pair.matches[0]), recordOf(pair.matches[1])]),
  });

  /**
   * The pairs as the record holds them: in the order the plan named, whatever
   * order the pool finished them in. A `series.json` that read differently
   * depending on how a batch happened to be scheduled would make a resumed series
   * look like a different one.
   */
  const plannedAt = new Map(plan.pairs.map((pair, at) => [pair.seed, at]));
  const pairsOf = (): SeriesPairRecord[] =>
    [...bySeed.values()].sort(
      (left, right) =>
        (plannedAt.get(left.seed) ?? Number.MAX_SAFE_INTEGER) -
        (plannedAt.get(right.seed) ?? Number.MAX_SAFE_INTEGER),
    );

  const recordPath = seriesRecordPath(plan.dir);

  /**
   * What the stopping rules ask about, counted over the record as it now stands:
   * every match this run played and every one an earlier run left on disk, since
   * a series resumed a week later has spent all of that already.
   */
  const stopInput = (): StopInput => {
    const pairs = pairsOf();
    const playedMatches = pairs
      .flatMap((pair) => pair.matches)
      .filter(
        (match): match is Extract<SeriesMatchRecord, { status: "played" }> => match.status === "played",
      );
    const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 };
    let costUsd = 0;
    for (const match of playedMatches) {
      tokens.input += match.tokens.input;
      tokens.output += match.tokens.output;
      tokens.cache_read += match.tokens.cache_read;
      tokens.cache_write += match.tokens.cache_write;
      tokens.total += match.tokens.total;
      costUsd += match.cost_usd;
    }
    return {
      pairsPlayed: completePairs(pairs).length,
      // Every match with a result counts towards the win rate, including one
      // whose pair is not complete: it was played, and the report counts it too.
      matches: playedMatches.map((match) => ({ seat: match.seat, result: { winner: match.result.winner } })),
      totals: { cost_usd: costUsd, tokens },
      maxPairs: plan.maxPairs,
      ceilings,
    };
  };

  /**
   * Write what is known so far: this plan's pairs, plus any older played ones.
   * `stop` is what the rules decided at the last boundary this run reached, or
   * null while it has not reached one that stopped.
   */
  const writeRecord = async (stop: StopRecord | null): Promise<SeriesRecord> => {
    const pairs = pairsOf();
    const written = {
      ...existing,
      pairing: { a: options.a, b: options.b },
      pairs,
      state: stateOf(pairs, stop),
      // A boundary that stopped nothing leaves no decision behind, and clears the
      // one an earlier run left, so the field always describes this series as it
      // now stands rather than the last run that happened to stop.
      ...(stop === null ? { stop: undefined } : { stop }),
    };
    // Checked before it lands, so the only record a later run can read is one
    // that says what this run knows.
    const record = seriesRecordSchema.parse(written);
    await writeSeriesRecord(plan.dir, written);
    return record;
  };

  // Written once before anything is played, so a series killed in its first match
  // still has a record, and again after every batch of 5 pairs. That first write
  // asks the rules about the series as it stands on disk, under this run's flags,
  // rather than copying what an earlier run decided: a match takes 19 minutes, so
  // a rerun interrupted inside its first batch has to leave a record that says
  // what the series actually did — an early stop that still binds under these
  // flags, or no stop at all, not an earlier run's ceiling that this run raised.
  const standing = decideStop(stopInput());
  let record = await writeRecord(standing.stopped ? standing.stop : null);

  for (const batch of batchesOf(plan.pairs, BATCH_PAIRS)) {
    // The ceilings are asked before the batch as well as after it, so a series
    // resumed onto totals it has already passed does not spend another batch of
    // matches finding that out. The pair limit and the interval are not asked
    // here; they ask about what has been played, and nothing has been played
    // since the boundary that last answered them.
    const spent = ceilingsPassed(stopInput());
    if (spent !== null) {
      record = await writeRecord(spent);
      break;
    }
    // The batch goes through the pool, and the pool is empty again by the time it
    // is awaited: the record is written once every match of the batch is in, and
    // the rules are asked at a boundary that is the same one however the batch was
    // scheduled.
    await mapPool(batch, concurrency, async (pair) => {
      bySeed.set(pair.seed, await pairRecordOf(pair));
    });
    // Brief §6.5's rules are asked at a batch boundary, never inside a pair, so a
    // series always stops with every pair it started complete on disk.
    const decision = decideStop(stopInput());
    record = await writeRecord(decision.stopped ? decision.stop : null);
    if (decision.stopped) break;
  }

  return { dir: plan.dir, recordPath, record, played, skipped, failed };
}
