/**
 * A finished series becomes brief §6.7's report: `series/<name>/series.json` and
 * every match log it names, read into one object and one markdown file.
 *
 * The inputs are the log format and the series record, and nothing else — no
 * engine, no server, no Pi. Nothing here replays a turn or recomputes a score:
 * the log's own `result` decides who won and by how much, and the per-model rows
 * are `./match-metrics.ts`'s counts summed over the series' matches, so the
 * figures a series report prints are the same figures the report on one match of
 * that series prints.
 *
 * **What counts, and what does not.** A match enters the win rate only when it
 * was played and stands. A match the series recorded as `failed` — a voided
 * match, a provider that never answered — left no log, and a log that carries a
 * match-level pass (`tool_surface`, `harness_crash`) is the partial log of a
 * match the harness voided. Neither is a result: folding ten voided matches into
 * 150 moves the win rate by up to three points and, worse, reports a series that
 * lost a fifteenth of its matches as one that played them. They are counted as
 * *missing*, grouped by the reason they went missing, and said on the report's
 * face — `docs/pi-harness-notes.md` §7 measured `marvin/subagent` shortening a
 * tool name often enough to void a match, so a 150-match series against that
 * model should expect to lose matches this way and has to show it.
 *
 * **Two intervals, two confidences.** The report quotes the 95% Wilson interval
 * over the matches it counted, and prints beside it the 99% interval the series
 * *stopped* on, copied out of `series.json` — the test that ended the run
 * (brief §6.5). They are not the same interval and are not meant to be: the
 * stopping test is applied after every batch of 5 pairs, so it is stricter, and
 * it counted every match the series played rather than only the ones this report
 * stands behind. A reader who cannot see which test ended a run cannot tell a
 * series that found its answer from one that merely ran out of pairs.
 *
 * **The seat split** is the check that the swap cancelled the board: model X's
 * record in seat A and in seat B, each with its own interval. If the two are
 * nowhere near each other, the series has measured the board rather than the
 * model, and the headline win rate above it is not a fact about the model.
 *
 * **Showcase selection is not here.** Brief §6.7's "which match to render" needs
 * a real series to pick from and belongs to milestone 06.
 *
 * The series record is read with a *reader's* schema: only the fields this
 * report uses, and non-strict, so a `series.json` carrying more than the report
 * reads still reports. The runner owns the writer's schema, and `@no-dice/stats`
 * must not depend on `@no-dice/runner` — the runner already depends on stats for
 * its stopping test, so that edge would be a cycle.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import { matchLogSchema, passReasonSchema, seatSchema, wasteReasonSchema } from "@no-dice/log";
import type { MatchLog, PassReason, PlayerHeader, Seat } from "@no-dice/log";

import { DEPTH_BANDS, metricsOfLog, zeroCounts } from "./match-metrics.ts";
import type { BandMetrics, BandName, SeatMetrics, TurnMetrics } from "./match-metrics.ts";
import { KNOCKOUT_MARGIN, bootstrapMargin, marginOf } from "./margin.ts";
import type { BootstrapMargin } from "./margin.ts";
import { outcomeOf, wilsonInterval, winRateOf, zOf } from "./wilson.ts";
import type { Confidence, Outcome, WilsonInterval, WinRate } from "./wilson.ts";

/** The confidence brief §6.7's report quotes, as against the stopping test's 99%. */
export const REPORT_CONFIDENCE = 0.95 satisfies Confidence;

/** Resamples the margin interval draws. Fixed, so a report is one number. */
export const BOOTSTRAP_SAMPLES = 2000;

/**
 * The bootstrap's seed. A published figure has to be reproducible: the same
 * matches and this seed give the same interval a year later, which is the whole
 * reason `bootstrapMargin` takes a seed at all.
 */
export const BOOTSTRAP_SEED = 1;

/** The pass reasons that void a match rather than pass one turn (the harness's `VoidReason`). */
const VOID_REASONS: readonly PassReason[] = ["harness_crash", "tool_surface"];

/** A seat of the pairing, as `series.json` records it. */
export type SeatRef = { kind: "bot"; bot: string } | { kind: "model"; provider: string; model: string };

/** How a reader names a seat of the pairing. */
export const seatLabel = (seat: SeatRef): string =>
  seat.kind === "bot" ? `bot:${seat.bot}` : `${seat.provider}/${seat.model}`;

/** How a reader names one seat's header, as a match log records it. */
export const playerLabel = (player: PlayerHeader): string =>
  player.kind === "bot" ? `bot:${player.bot}` : player.model;

/** The part of `series.json` this report reads. Non-strict on purpose: see the header. */
const seatRefSchema = z.union([
  z.object({ kind: z.literal("bot"), bot: z.string() }),
  z.object({ kind: z.literal("model"), provider: z.string(), model: z.string() }),
]);

const playedMatchSchema = z.object({
  /** The seat model X played in this match of the pair. */
  seat: seatSchema,
  path: z.string(),
  status: z.literal("played"),
  result: z.object({
    type: z.enum(["time", "knockout"]),
    winner: seatSchema.nullable(),
    margin: z.number().int(),
  }),
});

const failedMatchSchema = z.object({
  seat: seatSchema,
  path: z.string(),
  status: z.literal("failed"),
  error: z.string(),
});

const matchRecordSchema = z.discriminatedUnion("status", [playedMatchSchema, failedMatchSchema]);
export type MatchRecord = z.infer<typeof matchRecordSchema>;

/** The interval test as the runner recorded it at the boundary the series stopped at. */
const intervalTestSchema = z.object({
  confidence: z.number(),
  interval: z.object({ low: z.number(), high: z.number() }),
  excludes_half: z.boolean(),
  /** Only the count is read: the rate the test went on is the report's own row. */
  win_rate: z.object({ n: z.number().int().nonnegative() }),
});

const seriesRecordSchema = z.object({
  max_pairs: z.number().int().nonnegative(),
  seeds: z.array(z.number().int()),
  pairing: z.object({ a: seatRefSchema, b: seatRefSchema }),
  pairs: z.array(z.object({ seed: z.number().int(), matches: z.array(matchRecordSchema) })),
  state: z.object({
    stop_reason: z.string(),
    stopped_early: z.boolean(),
  }),
  stop: z
    .object({
      reason: z.string(),
      test: intervalTestSchema.nullable(),
      ceiling_usd: z.number().optional(),
      ceiling_tokens: z.number().optional(),
    })
    .optional(),
});
type SeriesRecord = z.infer<typeof seriesRecordSchema>;

/** What the stopping rules decided, and the interval they decided it on. */
export interface SeriesStop {
  /** `max_pairs`, `wilson_interval`, `max_cost` or `max_tokens`, as the record named it. */
  reason: string;
  /** Whether the series ended short of `--max-pairs`, which is brief §6.7's row. */
  stoppedEarly: boolean;
  /** The 99% test at the boundary the run stopped at, or null if it never reached one. */
  test: {
    confidence: number;
    interval: WilsonInterval;
    excludes_half: boolean;
    /** Matches that test counted — every match played, not only the ones this report counts. */
    counted: number;
  } | null;
  /** The ceiling that fired, when one did. */
  ceilingUsd?: number;
  ceilingTokens?: number;
}

/** Why a match is not in the figures: it never happened, or it was voided. */
export type MissingKind = "failed" | "voided" | "missing_log" | "unreadable_log";

/** The kinds, in the order the report prints them. */
const MISSING_KINDS = ["failed", "voided", "missing_log", "unreadable_log"] as const;

/** One match left out of the win rate, and why. */
export interface MissingMatch {
  seed: number;
  /** The seat model X played in it. */
  seat: Seat;
  path: string;
  kind: MissingKind;
  /** The reason the series or the log gave, in a form worth grouping by. */
  reason: string;
}

/** Every match left out of the win rate, and how many there are. */
export interface MissingMatches {
  total: number;
  byKind: Record<MissingKind, number>;
  /** Missing matches grouped by reason — the ten `tool_surface` losses in one row. */
  byReason: { reason: string; kinds: MissingKind[]; count: number }[];
  matches: MissingMatch[];
}

/** Model X's record over a scope of matches, with the interval brief §6.7 quotes. */
export interface ResultRow {
  winRate: WinRate;
  /** The 95% Wilson interval, or null when the scope is empty. */
  interval: WilsonInterval | null;
  confidence: Confidence;
}

/** One knockout: which match, which seat won it, and when. */
export interface Knockout {
  seed: number;
  /** The seat model X played. */
  seat: Seat;
  winner: Seat | null;
  turn: number;
  /** The log's own margin; the mean above counts a won knockout as 93. */
  margin: number;
}

/** Knockout count and the turns they happened on (brief §6.7). */
export interface Knockouts {
  count: number;
  turns: number[];
  matches: Knockout[];
}

/**
 * One turn of one match, named by the match it belongs to.
 *
 * The seed alone does not name a match: it names a *pair*, and a pair is two
 * matches that model X plays from opposite seats. A series that lost one of them
 * — voided, or never logged — has turns from one match of a seed and no turns
 * from the other, and a line that cited only the seed read as though it cited
 * the match that is not in the figures. `seat` is the seat *this model* played
 * in that match, which is what makes the pair of figures one match.
 */
export interface SeriesTurnRef {
  seed: number;
  /** The seat the model whose row this is played in that match of the pair. */
  seat: Seat;
  turn: number;
}

/** Context size across a series: the same figures, over more than one match. */
export interface SeriesContext {
  byTurn: { seed: number; seat: Seat; turn: number; tokens: number | null; compacted: boolean }[];
  compactionTurns: SeriesTurnRef[];
  unstatedTurns: SeriesTurnRef[];
  mean: number | null;
  min: number | null;
  max: number | null;
  first: number | null;
  last: number | null;
}

/**
 * One model's counts over a scope of matches. `match-metrics`'s rows, summed:
 * `turns` becomes a count rather than a list of turn numbers, because a scope
 * that spans matches has no single turn numbering, and the context figures name
 * the match each sample came from.
 */
export type ModelMetrics = Omit<TurnMetrics, "turns" | "context"> & {
  /** Turns the scope covers, over every match in it. */
  turnCount: number;
  context: SeriesContext;
};

/** One model's rows: the whole series, and the same counts split by turn depth. */
export interface ModelRow {
  label: string;
  /** Matches counted for this model, and how many of them it played from each seat. */
  matches: number;
  seats: Record<Seat, number>;
  metrics: ModelMetrics;
  bands: Record<BandName, ModelMetrics>;
}

/** What `seriesReport` returns: brief §6.7's report for one pairing. */
export interface SeriesReport {
  dir: string;
  recordPath: string;
  /** Where `renderSeriesReport` writes the markdown: `<dir>/report.md`. */
  reportPath: string;
  /** Model X — the pairing's first seat, and the one the swap moves. */
  x: SeatRef;
  opponent: SeatRef;
  xLabel: string;
  opponentLabel: string;
  /** The series' recorded seed list, and the pair limit it was run for. */
  seeds: number[];
  maxPairs: number;
  /** Pairs the record lists, and matches it lists in total. */
  pairs: number;
  matches: number;
  stop: SeriesStop;
  /** The matches every figure below is taken over, and the ones left out. */
  counted: number;
  missing: MissingMatches;
  result: ResultRow;
  /** Mean margin with its bootstrap interval, or null when no match was counted. */
  margin: (BootstrapMargin & { knockoutsCountedAs: number }) | null;
  knockouts: Knockouts;
  /** Model X's record from each seat — the check that the swap cancelled the board. */
  seatSplit: Record<Seat, ResultRow>;
  models: ModelRow[];
}

/** What `seriesReport` takes. */
export interface SeriesReportOptions {
  /** Bootstrap resamples for the margin interval. Default `BOOTSTRAP_SAMPLES`. */
  samples?: number;
  /** Bootstrap seed. Default `BOOTSTRAP_SEED`. */
  seed?: number;
}

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";

/**
 * The series record, read and checked. A directory with no `series.json` is not
 * a series. Exported for `./rules-evidence.ts`, which reports the same matches
 * and must not grow its own idea of where a series lives.
 */
export const readSeriesRecord = async (dir: string): Promise<SeriesRecord> => {
  const path = join(dir, "series.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) throw new Error(`${path} is not there, so there is no series to report`);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not JSON, so there is no series to report`);
  }
  const record = seriesRecordSchema.safeParse(parsed);
  if (!record.success) {
    throw new Error(
      `${path} is not a series record: ${record.error.issues
        .map((issue) => `${issue.path.join(".") || "series"} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return record.data;
};

/**
 * The reason a failed match went missing, in a form worth grouping by.
 *
 * The runner writes a voided match's reason code in brackets at the end of its
 * error (`reasonOf` in `packages/runner/src/series.ts`), so a message ending
 * `(tool_surface)` groups as `tool_surface`. Anything else is grouped under its
 * own message, which is the most that can honestly be said about it.
 */
export const reasonOfFailure = (error: string): string => {
  const bracketed = /\(([^()]+)\)\s*$/.exec(error)?.[1];
  return bracketed !== undefined && VOID_REASONS.includes(bracketed as PassReason)
    ? bracketed
    : error;
};

/** The match-level reason a played log carries, if it carries one: that match was voided. */
export const voidReasonOf = (log: MatchLog): PassReason | null => {
  for (const turn of log.turns) {
    for (const seat of ["A", "B"] as const) {
      const passed = turn.players[seat].passed;
      if (passed !== null && VOID_REASONS.includes(passed)) return passed;
    }
  }
  return null;
};

/**
 * One match that counts, holding only what the report goes on to read.
 *
 * The parsed log is not kept. Brief §6.5's default series is 150 matches, and
 * `docs/pi-harness-notes.md` §7 records a real match log at about a megabyte, so
 * holding every parsed log for the length of a report is hundreds of megabytes of
 * boards and events that nothing below reads again. Every figure is taken from
 * the result and from `match-metrics`'s counts, which are read as the log is read.
 */
interface CountedMatch {
  seed: number;
  /** The seat model X played. */
  seat: Seat;
  /** The log's own result: how it ended, who won, and by how much. */
  result: MatchLog["result"];
  /** How each seat's header names its player. */
  players: Record<Seat, string>;
  /** `match-metrics`'s counts for each seat of the match. */
  metrics: Record<Seat, SeatMetrics>;
}

/** Every match the record names, in the order it names them. */
export const seriesMatchRecords = (record: SeriesRecord): { seed: number; match: MatchRecord }[] =>
  record.pairs.flatMap((pair) => pair.matches.map((match) => ({ seed: pair.seed, match })));

/**
 * Where a record's log can be, in the order to try.
 *
 * The runner writes the path it was handed for `--dir`, joined with `matches/`
 * and the match's seat-map name (`matchOf` in `packages/runner/src/series-plan.ts`),
 * and `series-cli` defaults `--dir` to the relative `series/<a>-vs-<b>`. So a
 * record's path is relative to the directory the run was started in, and it
 * already carries the series directory's own prefix:
 * `series/x-vs-greedy/matches/101-marvin-subagent-greedy.json`. Re-joining that
 * whole path under the series directory doubles the prefix and finds nothing, so
 * the log is looked for by its place under `matches/` as well — which is what
 * lets a series directory be reported from anywhere, including after it has been
 * moved. The path as written is tried first, because that is the file the record
 * is naming, and the whole path relative to the series directory is tried too,
 * for a record whose paths are written relative to the directory itself.
 */
export const logPathsOf = (dir: string, path: string): string[] => {
  const candidates = [resolve(path), resolve(dir, path)];
  const underMatches = /(?:^|[/\\])matches[/\\](.+)$/.exec(path);
  if (underMatches !== null) candidates.push(join(dir, "matches", underMatches[1]));
  return [...new Set(candidates)];
};

/** Why a file the record names did not parse as a log, in one line. */
const parseFailureOf = (error: unknown): string => {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return `not a salient-log/1 log: ${issue.path.join(".") || "log"} ${issue.message}`;
  }
  if (error instanceof SyntaxError) return "not JSON";
  return error instanceof Error ? error.message : String(error);
};

/**
 * The log one record names, tried at every path it could be at (see
 * `logPathsOf`). `log` is null when none of them held one, and `why` says what
 * went wrong: the empty string means no file was there at all, rather than a
 * file that would not parse. `path` is the file the log was read from, or null
 * when none was — the path a caller hands on to a reader has to be one that is
 * actually there, which the record's own path is not always.
 */
export const readLogOf = async (
  dir: string,
  path: string,
): Promise<{ log: MatchLog | null; path: string | null; why: string }> => {
  let why = "";
  for (const candidate of logPathsOf(dir, path)) {
    try {
      const json: unknown = JSON.parse(await readFile(candidate, "utf8"));
      return { log: matchLogSchema.parse(json), path: candidate, why: "" };
    } catch (error) {
      if (!isMissing(error)) why = parseFailureOf(error);
    }
  }
  return { log: null, path: null, why };
};

/** Read every log, and sort the matches into the ones that count and the ones that do not. */
async function readMatches(
  dir: string,
  records: readonly { seed: number; match: MatchRecord }[],
): Promise<{ counted: CountedMatch[]; missing: MissingMatch[] }> {
  const counted: CountedMatch[] = [];
  const missing: MissingMatch[] = [];
  for (const { seed, match } of records) {
    const paths = logPathsOf(dir, match.path);
    const leftOut = (kind: MissingKind, reason: string): void => {
      // The path the log should have been at: the record's own when it is
      // absolute, and the series directory's when it is relative.
      missing.push({ seed, seat: match.seat, path: paths.at(-1)!, kind, reason });
    };
    if (match.status === "failed") {
      leftOut("failed", reasonOfFailure(match.error));
      continue;
    }
    const { log, why } = await readLogOf(dir, match.path);
    if (log === null) {
      leftOut(
        why === "" ? "missing_log" : "unreadable_log",
        why === "" ? "the record names a log that is not on disk" : why,
      );
      continue;
    }
    const voided = voidReasonOf(log);
    if (voided !== null) {
      leftOut("voided", voided);
      continue;
    }
    const metrics = metricsOfLog(log);
    counted.push({
      seed,
      seat: match.seat,
      result: log.result,
      players: { A: playerLabel(log.players.A), B: playerLabel(log.players.B) },
      metrics: { A: metrics.seats.A, B: metrics.seats.B },
    });
  }
  return { counted, missing };
}

/** The missing matches, counted by kind and by reason. */
export const missingOf = (matches: readonly MissingMatch[]): MissingMatches => {
  const byKind = zeroCounts(MISSING_KINDS);
  const grouped = new Map<string, { reason: string; kinds: MissingKind[]; count: number }>();
  for (const match of matches) {
    byKind[match.kind] += 1;
    const seen = grouped.get(match.reason);
    if (seen === undefined) grouped.set(match.reason, { reason: match.reason, kinds: [match.kind], count: 1 });
    else {
      seen.count += 1;
      if (!seen.kinds.includes(match.kind)) seen.kinds.push(match.kind);
    }
  }
  return {
    total: matches.length,
    byKind,
    // Most first: the reason a series lost ten matches is the row a reader needs.
    byReason: [...grouped.values()].sort((left, right) => right.count - left.count),
    matches: [...matches],
  };
};

/** The win rate over a scope of outcomes, with the report's 95% interval. */
const resultOf = (outcomes: readonly Outcome[]): ResultRow => {
  const winRate = winRateOf(outcomes);
  return {
    winRate,
    interval:
      winRate.n === 0
        ? null
        : wilsonInterval({ successes: winRate.successes, n: winRate.n, z: zOf(REPORT_CONFIDENCE) }),
    confidence: REPORT_CONFIDENCE,
  };
};

/** The knockouts, and the turns they happened on. */
const knockoutsOf = (counted: readonly CountedMatch[]): Knockouts => {
  const matches = counted
    .filter(({ result }) => result.type === "knockout")
    .map(({ seed, seat, result }) => ({
      seed,
      seat,
      winner: result.winner,
      turn: result.turn,
      margin: result.margin,
    }));
  return { count: matches.length, turns: matches.map((each) => each.turn), matches };
};

/**
 * Context size over several matches, each sample still naming the match it came
 * from — the seed and the seat this model held in it, since a seed names a
 * pair. The parts come in the order the series record gives its matches, and the
 * rows below keep that order, so a report of one series is one report.
 */
const contextOf = (
  parts: readonly { seed: number; seat: Seat; context: TurnMetrics["context"] }[],
): SeriesContext => {
  const byTurn: SeriesContext["byTurn"] = [];
  const compactionTurns: SeriesTurnRef[] = [];
  const unstatedTurns: SeriesTurnRef[] = [];
  const stated: number[] = [];
  for (const { seed, seat, context } of parts) {
    for (const sample of context.byTurn) {
      byTurn.push({ seed, seat, turn: sample.turn, tokens: sample.tokens, compacted: sample.compacted });
      if (sample.compacted) compactionTurns.push({ seed, seat, turn: sample.turn });
      if (sample.tokens === null) unstatedTurns.push({ seed, seat, turn: sample.turn });
      else stated.push(sample.tokens);
    }
  }
  return {
    byTurn,
    compactionTurns,
    unstatedTurns,
    mean: stated.length === 0 ? null : stated.reduce((total, n) => total + n, 0) / stated.length,
    min: stated.length === 0 ? null : Math.min(...stated),
    max: stated.length === 0 ? null : Math.max(...stated),
    first: stated.length === 0 ? null : stated[0],
    last: stated.length === 0 ? null : stated.at(-1)!,
  };
};

/**
 * The same counts over several matches: every total summed, every per-turn mean
 * taken over every turn those matches played, and the context figures kept per
 * match so a compaction turn still says which match it happened in.
 *
 * The sums come out of `match-metrics`'s per-match counts rather than by
 * counting the turns again here: one place counts a tool error, and a series
 * report that disagreed with the match report it was built from would be
 * unreadable.
 */
const aggregate = (
  parts: readonly { seed: number; seat: Seat; metrics: TurnMetrics }[],
): ModelMetrics => {
  const passes = zeroCounts(passReasonSchema.options);
  const wastedByReason = zeroCounts(wasteReasonSchema.options);
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 };
  let turnCount = 0;
  let passedTurns = 0;
  let wastedOrders = 0;
  let rejectedSubmissions = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let scouts = 0;
  let simulations = 0;
  let costUsd = 0;
  let wallMs = 0;

  for (const { metrics } of parts) {
    turnCount += metrics.turns.length;
    for (const reason of passReasonSchema.options) passes[reason] += metrics.passes[reason];
    for (const reason of wasteReasonSchema.options) {
      wastedByReason[reason] += metrics.wastedByReason[reason];
    }
    passedTurns += metrics.passedTurns;
    wastedOrders += metrics.wastedOrders;
    rejectedSubmissions += metrics.rejectedSubmissions;
    toolCalls += metrics.toolCalls;
    toolErrors += metrics.toolErrors;
    scouts += metrics.scouts;
    simulations += metrics.simulations;
    costUsd += metrics.costUsd;
    wallMs += metrics.wallMs;
    tokens.input += metrics.tokens.input;
    tokens.output += metrics.tokens.output;
    tokens.cache_read += metrics.tokens.cache_read;
    tokens.cache_write += metrics.tokens.cache_write;
  }
  tokens.total = tokens.input + tokens.output + tokens.cache_read + tokens.cache_write;

  const perTurn = (total: number): number => (turnCount === 0 ? 0 : total / turnCount);
  return {
    turnCount,
    passes,
    passedTurns,
    wastedOrders,
    wastedByReason,
    rejectedSubmissions,
    toolCalls,
    toolErrors,
    scouts,
    simulations,
    tokens,
    costUsd,
    wallMs,
    perTurn: {
      toolCalls: perTurn(toolCalls),
      scouts: perTurn(scouts),
      simulations: perTurn(simulations),
      tokens: perTurn(tokens.total),
      costUsd: perTurn(costUsd),
      wallMs: perTurn(wallMs),
    },
    context: contextOf(parts.map(({ seed, seat, metrics }) => ({ seed, seat, context: metrics.context }))),
  };
};

/** One seat's counts in one match of a series, named by the match it came from. */
interface SeatScope {
  seed: number;
  seat: Seat;
  metrics: TurnMetrics;
  bands: Record<BandName, BandMetrics>;
}

/**
 * One model's rows over the series.
 *
 * A model plays both seats across a series — that is what the seat swap is — so
 * its rows are the counts of the seat it actually held in each match, never one
 * seat's rows read for every match. The depth split is `match-metrics`'s own
 * bands summed across the matches, which is what brief §6.7's "decline with
 * depth" asks for: a model that falls apart from turn 18 on shows in the
 * `18-25` column instead of being averaged into the series figure.
 */
const modelRowOf = (label: string, played: readonly SeatScope[]): ModelRow => {
  const bands = {} as Record<BandName, ModelMetrics>;
  for (const band of DEPTH_BANDS) {
    bands[band.name] = aggregate(
      played.map((each) => ({ seed: each.seed, seat: each.seat, metrics: each.bands[band.name].metrics })),
    );
  }
  return {
    label,
    matches: played.length,
    seats: {
      A: played.filter((each) => each.seat === "A").length,
      B: played.filter((each) => each.seat === "B").length,
    },
    metrics: aggregate(played),
    bands,
  };
};

/**
 * Read a series directory and produce brief §6.7's report for the pairing.
 *
 * Every match the record names is read: the ones that count, and the ones that
 * do not, which are reported rather than dropped.
 */
export async function seriesReport(
  dir: string,
  options: SeriesReportOptions = {},
): Promise<SeriesReport> {
  const record = await readSeriesRecord(dir);
  const records = seriesMatchRecords(record);
  const { counted, missing } = await readMatches(dir, records);

  const outcomes = counted.map((match) => outcomeOf(match.result, match.seat));
  const margins = counted.map((match) => marginOf(match.result));

  // Model X is the pairing's first seat, and the one the swap moves. Which model
  // actually sat in each seat of each match is the log header's to say.
  const byModel = new Map<string, SeatScope[]>();
  for (const { seed, players, metrics } of counted) {
    for (const each of ["A", "B"] as const) {
      const label = players[each];
      const scopes = byModel.get(label) ?? [];
      scopes.push({
        seed,
        seat: each,
        metrics: metrics[each].metrics,
        bands: metrics[each].bands,
      });
      byModel.set(label, scopes);
    }
  }
  const xLabel = seatLabel(record.pairing.a);
  const labels = [...byModel.keys()].sort((left, right) => {
    // Model X's row first: it is the one the series was run to measure.
    const order = Number(right === xLabel) - Number(left === xLabel);
    return order !== 0 ? order : left.localeCompare(right);
  });

  const stop = record.stop;
  return {
    dir,
    recordPath: join(dir, "series.json"),
    reportPath: join(dir, "report.md"),
    x: record.pairing.a,
    opponent: record.pairing.b,
    xLabel,
    opponentLabel: seatLabel(record.pairing.b),
    seeds: record.seeds,
    maxPairs: record.max_pairs,
    pairs: record.pairs.length,
    matches: records.length,
    stop: {
      reason: record.state.stop_reason,
      stoppedEarly: record.state.stopped_early,
      test:
        stop?.test == null
          ? null
          : {
              confidence: stop.test.confidence,
              interval: stop.test.interval,
              excludes_half: stop.test.excludes_half,
              counted: stop.test.win_rate.n,
            },
      ...(stop?.ceiling_usd === undefined ? {} : { ceilingUsd: stop.ceiling_usd }),
      ...(stop?.ceiling_tokens === undefined ? {} : { ceilingTokens: stop.ceiling_tokens }),
    },
    counted: counted.length,
    missing: missingOf(missing),
    result: resultOf(outcomes),
    margin:
      margins.length === 0
        ? null
        : {
            ...bootstrapMargin(margins, {
              samples: options.samples ?? BOOTSTRAP_SAMPLES,
              seed: options.seed ?? BOOTSTRAP_SEED,
            }),
            knockoutsCountedAs: KNOCKOUT_MARGIN,
          },
    knockouts: knockoutsOf(counted),
    seatSplit: {
      A: resultOf(
        counted.filter((match) => match.seat === "A").map((match) => outcomeOf(match.result, "A")),
      ),
      B: resultOf(
        counted.filter((match) => match.seat === "B").map((match) => outcomeOf(match.result, "B")),
      ),
    },
    models: labels.map((label) => modelRowOf(label, byModel.get(label)!)),
  };
}

/** The report as markdown: brief §6.7's rows, in the order a reader wants them. */
export const renderSeriesReportMarkdown = (report: SeriesReport): string => {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const num = (n: number, dp = 1): string => n.toFixed(dp);
  const maybe = (n: number | null): string => (n === null ? "—" : String(Math.round(n)));
  const money = (n: number): string => `$${n.toFixed(4)}`;
  const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  const out: string[] = [];

  out.push(`# Series report: ${report.xLabel} vs ${report.opponentLabel}`, "");
  out.push(`Series directory \`${report.dir}\`.`, "");
  out.push(
    `${String(report.pairs)} pairs recorded, ${String(report.matches)} matches: ` +
      `**${String(report.counted)} counted**, **${String(report.missing.total)} missing**.`,
    "",
  );
  out.push(
    `Stopped on \`${report.stop.reason}\` — ` +
      `${report.stop.stoppedEarly ? "short of its pair limit" : "its full length"}.`,
    "",
  );

  out.push(`## Result for ${report.xLabel}`, "");
  const rate = report.result.winRate;
  out.push(row(["wins", "losses", "draws", "matches", "win rate", "95% Wilson interval"]));
  out.push(row(["---:", "---:", "---:", "---:", "---:", "---:"]));
  out.push(
    row([
      String(rate.wins),
      String(rate.losses),
      String(rate.draws),
      String(rate.n),
      rate.rate === null ? "—" : pct(rate.rate),
      report.result.interval === null
        ? "—"
        : `${pct(report.result.interval.low)} – ${pct(report.result.interval.high)}`,
    ]),
    "",
  );
  out.push("A draw counts as half a win.", "");
  if (report.stop.test !== null) {
    const test = report.stop.test;
    out.push(
      `The series stopped on its ${pct(test.confidence)} interval, ` +
        `${pct(test.interval.low)} – ${pct(test.interval.high)} over ${String(test.counted)} matches, ` +
        `which ${test.excludes_half ? "excludes" : "does not exclude"} 50%.`,
      "",
    );
  } else {
    out.push("The series never reached the interval test, so it recorded no stopping interval.", "");
  }

  out.push("## Missing matches", "");
  if (report.missing.total === 0) {
    out.push("No match failed or was voided: every match the series recorded is counted above.", "");
  } else {
    out.push(
      `**${String(report.missing.total)} of the series' ${String(report.matches)} matches are not in ` +
        "the figures above.**",
      "",
    );
    out.push(row(["reason", "how", "matches"]));
    out.push(row(["---", "---", "---:"]));
    for (const group of report.missing.byReason) {
      out.push(row([group.reason, group.kinds.join(", "), String(group.count)]));
    }
    out.push("");
    for (const match of report.missing.matches) {
      out.push(
        `- seed \`${String(match.seed)}\`, ${report.xLabel} in seat ${match.seat}, ` +
          `\`${match.path}\` — ${match.kind}: ${match.reason}`,
      );
    }
    out.push("");
  }

  out.push("## Margin", "");
  if (report.margin === null) {
    out.push("No match was counted, so there is no margin to report.", "");
  } else {
    out.push(row(["matches", "mean margin", "bootstrap interval", "resamples", "confidence"]));
    out.push(row(["---:", "---:", "---:", "---:", "---:"]));
    out.push(
      row([
        String(report.margin.n),
        num(report.margin.mean),
        `${num(report.margin.low)} – ${num(report.margin.high)}`,
        String(report.margin.samples),
        pct(report.margin.confidence),
      ]),
      "",
    );
    out.push(`A knockout counts as ${String(report.margin.knockoutsCountedAs)} points.`, "");
  }

  out.push("## Knockouts", "");
  if (report.knockouts.count === 0) {
    out.push("No match ended in a knockout.", "");
  } else {
    out.push(
      `${String(report.knockouts.count)} knockouts, on turns ` +
        `${report.knockouts.turns.map((turn) => String(turn)).join(", ")}.`,
      "",
    );
    out.push(row(["seed", "X's seat", "winner", "turn", "log margin"]));
    out.push(row(["---:", "---:", "---", "---:", "---:"]));
    for (const knockout of report.knockouts.matches) {
      out.push(
        row([
          String(knockout.seed),
          knockout.seat,
          knockout.winner === null ? "draw" : knockout.winner,
          String(knockout.turn),
          String(knockout.margin),
        ]),
      );
    }
    out.push("");
  }

  out.push("## Per model", "");
  for (const model of report.models) {
    out.push(`### ${model.label}`, "");
    out.push(
      `${String(model.matches)} matches counted — ${String(model.seats.A)} in seat A, ` +
        `${String(model.seats.B)} in seat B.`,
      "",
    );
    out.push(row(["", "series", "turns 1-8", "turns 9-17", "turns 18-25"]));
    out.push(row(["---", "---:", "---:", "---:", "---:"]));
    const across = (label: string, pick: (metrics: ModelMetrics) => string): string =>
      row([
        label,
        pick(model.metrics),
        pick(model.bands["1-8"]),
        pick(model.bands["9-17"]),
        pick(model.bands["18-25"]),
      ]);
    const counts: [string, (metrics: ModelMetrics) => string][] = [
      ["turns", (m) => String(m.turnCount)],
      ["turns passed", (m) => String(m.passedTurns)],
      ...passReasonSchema.options.map(
        (reason): [string, (metrics: ModelMetrics) => string] => [
          `passed: ${reason}`,
          (m) => String(m.passes[reason]),
        ],
      ),
      ["wasted orders", (m) => String(m.wastedOrders)],
      ...wasteReasonSchema.options.map(
        (reason): [string, (metrics: ModelMetrics) => string] => [
          `wasted: ${reason}`,
          (m) => String(m.wastedByReason[reason]),
        ],
      ),
      ["rejected submissions", (m) => String(m.rejectedSubmissions)],
      ["tool calls", (m) => String(m.toolCalls)],
      ["tool errors", (m) => String(m.toolErrors)],
      ["scouts", (m) => String(m.scouts)],
      ["simulations", (m) => String(m.simulations)],
      ["tokens", (m) => String(m.tokens.total)],
      ["cost", (m) => money(m.costUsd)],
      ["tool calls per turn", (m) => num(m.perTurn.toolCalls, 2)],
      ["scouts per turn", (m) => num(m.perTurn.scouts, 2)],
      ["simulations per turn", (m) => num(m.perTurn.simulations, 2)],
      ["tokens per turn", (m) => num(m.perTurn.tokens, 0)],
      ["cost per turn", (m) => money(m.perTurn.costUsd)],
      ["context mean tokens", (m) => maybe(m.context.mean)],
      ["context first / last", (m) => `${maybe(m.context.first)} / ${maybe(m.context.last)}`],
      ["context max", (m) => maybe(m.context.max)],
      ["compaction turns", (m) => String(m.context.compactionTurns.length)],
    ];
    for (const [label, pick] of counts) out.push(across(label, pick));
    out.push("");
    if (model.metrics.context.compactionTurns.length > 0) {
      // A seed names a pair, so each turn is named by its match: the seed and
      // the seat this model played in it, in the words the "Missing matches"
      // list already uses for a match. Entries are separated by `; ` because the
      // entry itself now carries commas.
      out.push(
        `Compaction turns: ${model.metrics.context.compactionTurns
          .map(
            (each) =>
              `seed ${String(each.seed)}, ${model.label} in seat ${each.seat}, turn ${String(each.turn)}`,
          )
          .join("; ")}.`,
        "",
      );
    }
  }

  out.push("## Seat effect", "");
  out.push(row(["X's seat", "wins", "losses", "draws", "matches", "win rate", "95% Wilson interval"]));
  out.push(row(["---", "---:", "---:", "---:", "---:", "---:", "---:"]));
  for (const seat of ["A", "B"] as const) {
    const split = report.seatSplit[seat];
    out.push(
      row([
        seat,
        String(split.winRate.wins),
        String(split.winRate.losses),
        String(split.winRate.draws),
        String(split.winRate.n),
        split.winRate.rate === null ? "—" : pct(split.winRate.rate),
        split.interval === null
          ? "—"
          : `${pct(split.interval.low)} – ${pct(split.interval.high)}`,
      ]),
    );
  }
  out.push(
    "",
    "The two rows are one pairing seen from each seat. A gap between them is the board, " +
      "not the model, and it is why every pair is played twice.",
    "",
  );

  return `${out.join("\n")}\n`;
};

/**
 * The report as markdown, written to `<dir>/report.md` beside the `series.json`
 * it was read from.
 */
export async function renderSeriesReport(
  dir: string,
  options: SeriesReportOptions = {},
): Promise<{ report: SeriesReport; markdown: string; path: string }> {
  const report = await seriesReport(dir, options);
  const markdown = renderSeriesReportMarkdown(report);
  await writeFile(report.reportPath, markdown, "utf8");
  return { report, markdown, path: report.reportPath };
}
