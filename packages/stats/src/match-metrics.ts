/**
 * One `salient-log/1` becomes brief §6.7's per-model counts.
 *
 * The log is the only input: it is parsed with `matchLogSchema` and never read
 * by hand, so a field this module counts on that the format does not carry is a
 * parse failure rather than a `undefined` that quietly counts as nought. The
 * counts are then taken over the turn records, per seat, twice over: once for
 * the whole match, and once per depth band — brief §6.7's **turns 1-8, 9-17 and
 * 18-25**, which is the part of the report that shows a model falling apart as
 * the conversation grows instead of averaging it away.
 *
 * Two rules worth their weight:
 *
 * - **Every played turn lands in exactly one band.** The bands are the brief's,
 *   and the deepest one is open at the top: a match configured for more than 25
 *   turns keeps its extra turns in `18-25` rather than dropping out of the
 *   split, and a match that ended in a knockout on turn 7 simply leaves the two
 *   deeper bands empty. A turn counted nowhere is a turn no reader will see.
 * - **A `context_tokens` of 0 on a `compacted: true` turn is not a context of
 *   nought.** Pi will not state a context size it has just rewritten
 *   (`docs/pi-harness-notes.md` §3, measured), and the frozen format has no way
 *   to say unknown, so the runner writes 0 for it. Such a turn is reported as a
 *   compaction turn with no figure, and is kept out of the mean, the minimum and
 *   the maximum over context size — otherwise one compaction drags a model's
 *   average context down and hides the very thing the depth split exists to
 *   show. A 0 on a turn that did not compact is a stated figure: a bot seat has
 *   no provider, so its context really is nought, and so is counted.
 *
 * Nothing here reads a file: the caller hands over the parsed JSON of a log, so
 * the same counts are available to a report that read the file, to the series
 * runner that has the log in memory, and to a browser.
 */
import { matchLogSchema, passReasonSchema, wasteReasonSchema } from "@no-dice/log";
import type {
  MatchLog,
  PassReason,
  PlayerHeader,
  Seat,
  TurnPlayerRecord,
  WasteReason,
} from "@no-dice/log";

/**
 * The tool a simulation is logged under. The log stores the name the seat called
 * without any `mcp__salient__` prefix (`toolCallSchema` in `@no-dice/log`), so a
 * seat that reached the same tool by its full name is logged differently and is
 * not counted as a simulation.
 */
const SIMULATE_TOOL = "simulate";

/** Brief §6.7's three depth bands, named the way the report prints them. */
export type BandName = "1-8" | "9-17" | "18-25";

/** One depth band: the turns it holds, inclusive at both ends. */
export interface DepthBand {
  readonly name: BandName;
  readonly from: number;
  /**
   * Inclusive, and `Infinity` for the deepest band: a match played longer than
   * the brief's 25 turns has its extra turns here rather than in no band at all.
   */
  readonly to: number;
}

/** The bands, in the order the report prints them. */
export const DEPTH_BANDS: readonly DepthBand[] = [
  { name: "1-8", from: 1, to: 8 },
  { name: "9-17", from: 9, to: 17 },
  { name: "18-25", from: 18, to: Number.POSITIVE_INFINITY },
];

/** The band one turn belongs to. Every positive turn number has exactly one. */
export const bandOf = (turn: number): DepthBand => {
  const band = DEPTH_BANDS.find((each) => turn >= each.from && turn <= each.to);
  if (band === undefined) {
    throw new Error(`turn ${String(turn)} falls in no depth band`);
  }
  return band;
};

/** Provider tokens over a scope of turns, as the log's `usage` names them. */
export interface TokenCounts {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  /** The four summed: the figure brief §11's token ceiling is set against. */
  total: number;
}

/** Totals divided by the turns in scope — brief §6.7's "per turn". */
export interface PerTurnMeans {
  toolCalls: number;
  scouts: number;
  simulations: number;
  tokens: number;
  costUsd: number;
  wallMs: number;
}

/** One turn's context size, in the order the log has the turns. */
export interface ContextSample {
  turn: number;
  /** The size Pi stated, or `null` when a compaction had just rewritten it. */
  tokens: number | null;
  compacted: boolean;
}

/** Context size by turn, and the turns compaction happened on. */
export interface ContextStats {
  /** Brief §6.7's context size by turn: one entry per turn in scope, in order. */
  byTurn: ContextSample[];
  /** The turns whose record says `compacted: true`. */
  compactionTurns: number[];
  /**
   * The turns whose figure is missing because Pi could not state it: compacted,
   * and logged as 0. Excluded from every figure below.
   */
  unstatedTurns: number[];
  /** Over the stated figures only, so a compaction cannot drag the mean down. */
  mean: number | null;
  min: number | null;
  max: number | null;
  /** The first and last stated figures: where the conversation started, and ended. */
  first: number | null;
  last: number | null;
}

/** Everything brief §6.7 asks for, over one scope of turns. */
export interface TurnMetrics {
  /** The turn numbers in scope, in the order the log has them. */
  turns: number[];
  /** Turns the seat played no orders on, by brief §6.3's reason. */
  passes: Record<PassReason, number>;
  /** Turns that ended in a pass, whatever the reason. */
  passedTurns: number;
  /** Orders the engine dropped, in total and by the reason it gave. */
  wastedOrders: number;
  wastedByReason: Record<WasteReason, number>;
  /** Turns whose first submission was refused whole. */
  rejectedSubmissions: number;
  /** Tool calls of every kind, and the ones that came back an error. */
  toolCalls: number;
  toolErrors: number;
  /** Hexes scouted, and calls of the `simulate` tool. */
  scouts: number;
  simulations: number;
  tokens: TokenCounts;
  costUsd: number;
  wallMs: number;
  perTurn: PerTurnMeans;
  context: ContextStats;
}

/** One band's counts. */
export interface BandMetrics {
  band: DepthBand;
  metrics: TurnMetrics;
}

/** One seat's counts: the whole match, and the same split by depth. */
export interface SeatMetrics {
  seat: Seat;
  /** The seat as the log's header records it, so a report can name the row. */
  player: PlayerHeader;
  metrics: TurnMetrics;
  bands: Record<BandName, BandMetrics>;
}

/** One match's counts. */
export interface MatchMetrics {
  /** The turns the match played, in the order the log has them. */
  turns: number[];
  seats: Record<Seat, SeatMetrics>;
}

/** One turn's record, held with the turn number it was played on. */
interface Played {
  turn: number;
  record: TurnPlayerRecord;
}

/** Every reason of an enum, at nought, so a report prints the reasons that did not happen. */
const zeroCounts = <K extends string>(keys: readonly K[]): Record<K, number> => {
  const counts = {} as Record<K, number>;
  for (const key of keys) counts[key] = 0;
  return counts;
};

/** The mean of a total over the turns in scope; nought when the scope is empty. */
const perTurn = (total: number, turns: number): number => (turns === 0 ? 0 : total / turns);

/** Context size by turn, with the figures Pi could not state kept out of the mean. */
const contextOf = (played: readonly Played[]): ContextStats => {
  const byTurn: ContextSample[] = [];
  const compactionTurns: number[] = [];
  const unstatedTurns: number[] = [];
  const stated: number[] = [];
  for (const { turn, record } of played) {
    // A nought beside `compacted: true` is Pi declining to state a size it has
    // just rewritten, not a measurement. A nought anywhere else is a measurement
    // — a bot seat has no provider, and its context is nought.
    const unstated = record.compacted && record.context_tokens === 0;
    byTurn.push({
      turn,
      tokens: unstated ? null : record.context_tokens,
      compacted: record.compacted,
    });
    if (record.compacted) compactionTurns.push(turn);
    if (unstated) unstatedTurns.push(turn);
    else stated.push(record.context_tokens);
  }
  const mean = stated.length === 0 ? null : stated.reduce((total, n) => total + n, 0) / stated.length;
  return {
    byTurn,
    compactionTurns,
    unstatedTurns,
    mean,
    min: stated.length === 0 ? null : Math.min(...stated),
    max: stated.length === 0 ? null : Math.max(...stated),
    first: stated.length === 0 ? null : stated[0],
    last: stated.length === 0 ? null : stated.at(-1)!,
  };
};

/** The counts over one scope of turns: the whole match, or one band of it. */
const metricsOf = (played: readonly Played[]): TurnMetrics => {
  const passes = zeroCounts(passReasonSchema.options);
  const wastedByReason = zeroCounts(wasteReasonSchema.options);
  const tokens: TokenCounts = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 };
  let passedTurns = 0;
  let wastedOrders = 0;
  let rejectedSubmissions = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let scouts = 0;
  let simulations = 0;
  let costUsd = 0;
  let wallMs = 0;

  for (const { record } of played) {
    if (record.passed !== null) {
      passes[record.passed] += 1;
      passedTurns += 1;
    }
    wastedOrders += record.wasted.length;
    for (const dropped of record.wasted) wastedByReason[dropped.reason] += 1;
    if (record.rejected_submission !== null) rejectedSubmissions += 1;
    for (const call of record.tool_calls) {
      toolCalls += 1;
      if (call.error) toolErrors += 1;
      if (call.tool === SIMULATE_TOOL) simulations += 1;
    }
    scouts += record.scouts.length;
    tokens.input += record.usage.input;
    tokens.output += record.usage.output;
    tokens.cache_read += record.usage.cache_read;
    tokens.cache_write += record.usage.cache_write;
    costUsd += record.cost_usd;
    wallMs += record.wall_ms;
  }
  tokens.total = tokens.input + tokens.output + tokens.cache_read + tokens.cache_write;

  const turns = played.map(({ turn }) => turn);
  return {
    turns,
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
      toolCalls: perTurn(toolCalls, turns.length),
      scouts: perTurn(scouts, turns.length),
      simulations: perTurn(simulations, turns.length),
      tokens: perTurn(tokens.total, turns.length),
      costUsd: perTurn(costUsd, turns.length),
      wallMs: perTurn(wallMs, turns.length),
    },
    context: contextOf(played),
  };
};

/** One seat's turns, in the order the log has them. */
const turnsOf = (log: MatchLog, seat: Seat): Played[] =>
  log.turns.map((turn) => ({ turn: turn.n, record: turn.players[seat] }));

/** The counts for one seat of an already-parsed log. */
export const seatMetricsOf = (log: MatchLog, seat: Seat): SeatMetrics => {
  const played = turnsOf(log, seat);
  const bands = {} as Record<BandName, BandMetrics>;
  for (const band of DEPTH_BANDS) {
    bands[band.name] = {
      band,
      metrics: metricsOf(played.filter(({ turn }) => turn >= band.from && turn <= band.to)),
    };
  }
  return { seat, player: log.players[seat], metrics: metricsOf(played), bands };
};

/** The counts for both seats of an already-parsed log. */
export const metricsOfLog = (log: MatchLog): MatchMetrics => ({
  turns: log.turns.map((turn) => turn.n),
  seats: { A: seatMetricsOf(log, "A"), B: seatMetricsOf(log, "B") },
});

/**
 * The counts for one match log. The source is the parsed JSON of the file, and is
 * checked against `salient-log/1` here: a log that does not validate throws, and
 * nothing is counted out of an object the format does not describe.
 */
export const matchMetrics = (source: unknown): MatchMetrics => metricsOfLog(matchLogSchema.parse(source));
