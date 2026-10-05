/**
 * The match as the server holds it: the engine's board, what each seat has been
 * shown, what each seat has submitted, and the counters that say what it may
 * still do this turn.
 *
 * A turn opens with `openTurn`, which resets the per-turn counters and starts
 * accepting calls. Every player-facing tool call goes through `call`, which is
 * the one place a seat's usage is counted, so the limits brief §6.2 sets have a
 * single home to be enforced from. `resolveTurn` hands both seats' submissions
 * to the engine — a seat that never submitted simply passes — and `turnRecord`
 * gives back what the log needs for the turn.
 *
 * Nothing here is an MCP tool: the runner reaches a session in-process. All
 * seven player tools are wired up here, and every limit brief §6.2 sets is
 * enforced here — in `refusal`, which turns a call away before it reaches a
 * tool, and in the tools that spend something. A refused call changes nothing:
 * the gate runs before any handler, and a handler that answers an error returns
 * before it writes.
 */
import {
  generateMap,
  resolveTurn as engineResolveTurn,
  validateOrders,
  visibleHexes,
} from "@no-dice/salient-engine";
import type { Config, HexKey, MatchResult, MatchState, Order, Seat } from "@no-dice/salient-engine";
import { orderSchema } from "@no-dice/log";
import type {
  HexLabel,
  LogEvent,
  LogOrder,
  LogResult,
  RejectedSubmission,
  ToolCallRecord,
  TurnPlayerRecord,
  WastedLogOrder,
} from "@no-dice/log";

import { eventsToLog, labelToKey, ordersToEngine, wastedToLog } from "./labels.ts";
import { NOTES_CHAR_LIMIT, SIMULATE_LIMIT, SUBMISSION_NOTE_CHARS, TOOL_CALL_LIMIT } from "./limits.ts";
import { simulateTurn } from "./simulate.ts";
import { rulesView, scoutView, stateView, type StateView } from "./view.ts";

/** The seven tools a player can call, named as the log names them. */
export const TOOL_NAMES = [
  "get_rules",
  "get_state",
  "scout",
  "simulate",
  "submit_orders",
  "read_notes",
  "write_notes",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const KNOWN_TOOLS: ReadonlySet<string> = new Set<string>(TOOL_NAMES);

/** What a seat handed in when it submitted: the orders to play, and why. */
export interface Submission {
  orders: LogOrder[];
  intent: string;
  prediction: string;
}

/** What one tool call gave the player, and whether it was refused. */
export interface ToolOutcome {
  ok: boolean;
  /** The result the player sees; for a refused call, `{ error: <code> }`. */
  result: unknown;
  /** The error code, or `null` when the call went through. */
  error: string | null;
  ms: number;
}

/** What a seat has used since the turn opened. Brief §6.2's limits count from here. */
export interface TurnCounters {
  toolCalls: number;
  simulations: number;
  apSpentOnScouts: number;
  /** The hexes the seat scouted this turn, in the order it scouted them. */
  scouted: HexLabel[];
}

/** What one seat did last turn, kept for `get_state`'s `last_turn`. */
export interface LastTurnReport {
  events: LogEvent[];
  orders: Record<Seat, LogOrder[]>;
  wasted: Record<Seat, WastedLogOrder[]>;
}

/**
 * Last turn, as `get_state` reports it: what happened, and what each seat could
 * see when the turn that produced it began. The rules tell a player about the
 * fights on hexes it could see, so the visibility the turn started with has to
 * outlive it — the board the seat could not see has since moved on.
 */
export interface SettledTurn {
  report: LastTurnReport;
  visible: Record<Seat, Set<HexKey>>;
}

/** Both seats' records for one turn, in the log's per-player shape. */
export type TurnPlayerRecords = Record<Seat, TurnPlayerRecord>;

/** A tool's answer: a result for the player, or the reason it was refused. */
type HandlerResult = { ok: true; result: unknown } | { ok: false; error: string };

/** Everything one seat did in the turn that is open now. */
interface SeatTurn {
  toolCalls: number;
  simulations: number;
  apSpentOnScouts: number;
  scouted: HexLabel[];
  transcript: ToolCallRecord[];
  submission: Submission | null;
  /**
   * The seat's first submission, when it was refused: what it carried and why it
   * was refused. Held for the log, and as the mark that says the seat's next
   * submission is the last one it gets.
   */
  rejected: RejectedSubmission | null;
}

const emptySeatTurn = (): SeatTurn => ({
  toolCalls: 0,
  simulations: 0,
  apSpentOnScouts: 0,
  scouted: [],
  transcript: [],
  submission: null,
  rejected: null,
});

/** A call refused before it reached a tool: nothing was spent, nothing was seen. */
const refused = (error: string): ToolOutcome => ({ ok: false, result: { error }, error, ms: 0 });

/** One of `submit_orders`' two notes: required, and 1 to 280 characters. */
const isSubmissionNote = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= SUBMISSION_NOTE_CHARS;

/**
 * What `submit_orders` carried, in the log's shape, or `null` when it is not a
 * submission at all: a field missing, an order the log could not hold, or a note
 * outside the length brief §6.2 asks for. A call that fails here is an error and
 * not a submission, so it does not use up the seat's one rejected attempt.
 */
const parseSubmission = (args: unknown): Submission | null => {
  const called = args as { orders?: unknown; intent?: unknown; prediction?: unknown } | null;
  const { orders, intent, prediction } = called ?? {};
  if (!Array.isArray(orders) || !isSubmissionNote(intent) || !isSubmissionNote(prediction)) {
    return null;
  }
  const parsed: LogOrder[] = [];
  for (const order of orders) {
    const checked = orderSchema.safeParse(order);
    if (!checked.success) return null;
    parsed.push(checked.data);
  }
  return { orders: parsed, intent, prediction };
};

/** The hex a `scout` call asked for, as whatever the caller passed. */
const scoutHex = (args: unknown): string => {
  const hex = (args as { hex?: unknown } | null)?.hex;
  return typeof hex === "string" ? hex : "";
};

/** A finished match's result in the log's shape, which adds the margin. */
const toLogResult = (result: MatchResult | null): LogResult | null =>
  result === null
    ? null
    : {
        type: result.type,
        winner: result.winner,
        turn: result.turn,
        score: { A: result.score.A, B: result.score.B },
        margin: Math.abs(result.score.A - result.score.B),
      };

export class MatchSession {
  readonly matchId: string;
  readonly seed: number;
  readonly config: Config;

  /** The tools wired up so far; the rest answer `unknown_tool` until they land. */
  private readonly handlers: Partial<Record<ToolName, (seat: Seat, args: unknown) => HandlerResult>> =
    {
      get_rules: (seat) => ({ ok: true, result: rulesView(this.board, seat, this.config) }),
      get_state: (seat) => ({ ok: true, result: this.viewFor(seat) }),
      scout: (seat, args) => this.scout(seat, args),
      simulate: (seat, args) => this.simulate(seat, args),
      submit_orders: (seat, args) => this.submitOrders(seat, args),
      read_notes: (seat) => ({ ok: true, result: { notes: this.notes[seat] } }),
      write_notes: (seat, args) => this.writeNotes(seat, args),
    };

  private board: MatchState;
  private readonly notes: Record<Seat, string> = { A: "", B: "" };
  private live: { turn: number; seats: Record<Seat, SeatTurn> };
  private accepting = false;
  /** Each resolved turn's records, kept so the log can be written turn by turn. */
  private readonly settled = new Map<number, TurnPlayerRecords>();
  private previous: SettledTurn | null = null;

  constructor(matchId: string, seed: number, config: Config) {
    this.matchId = matchId;
    this.seed = seed;
    this.config = config;
    this.board = generateMap(seed, config);
    this.live = { turn: this.board.turn, seats: { A: emptySeatTurn(), B: emptySeatTurn() } };
  }

  /** The engine's board, as it stands for the turn that has not been resolved yet. */
  get state(): MatchState {
    return this.board;
  }

  /** What each seat did last turn, or `null` before the first turn resolves. */
  get lastTurn(): LastTurnReport | null {
    return this.previous === null ? null : this.previous.report;
  }

  /**
   * Open the turn the board is on: the per-turn counters start again and calls
   * are accepted. The runner calls it once per turn, after the one before it has
   * been resolved.
   */
  openTurn(): void {
    this.live = { turn: this.board.turn, seats: { A: emptySeatTurn(), B: emptySeatTurn() } };
    this.accepting = true;
  }

  /** Which seats have a submission in for this turn. */
  status(): { submitted: Record<Seat, boolean> } {
    return {
      submitted: {
        A: this.live.seats.A.submission !== null,
        B: this.live.seats.B.submission !== null,
      },
    };
  }

  /** What `seat` has used since the turn opened, as a snapshot the caller can keep. */
  counters(seat: Seat): TurnCounters {
    const live = this.live.seats[seat];
    return {
      toolCalls: live.toolCalls,
      simulations: live.simulations,
      apSpentOnScouts: live.apSpentOnScouts,
      scouted: live.scouted.slice(),
    };
  }

  /**
   * One player-facing tool call. The seat is not something the player chooses:
   * the caller resolves it from the seat's token and passes it here, so a call
   * can only ever be for that seat. A call a limit refuses is still counted and
   * still logged: brief §6.2 counts every call but `submit_orders`, including
   * the ones that answer an error.
   */
  call(seat: Seat, tool: string, args: unknown): ToolOutcome {
    if (!this.accepting) return refused("turn_not_open");
    const started = performance.now();
    const handler = KNOWN_TOOLS.has(tool) ? this.handlers[tool as ToolName] : undefined;
    const blocked = this.refusal(seat, tool);
    const handled: HandlerResult =
      blocked !== null
        ? { ok: false, error: blocked }
        : handler === undefined
          ? { ok: false, error: "unknown_tool" }
          : handler(seat, args);
    const ms = Math.max(0, Math.round(performance.now() - started));
    this.count(seat, tool, args, handled, ms);
    return {
      ok: handled.ok,
      result: handled.ok ? handled.result : { error: handled.error },
      error: handled.ok ? null : handled.error,
      ms,
    };
  }

  /**
   * Resolve the turn that is open. Each seat's submitted orders go to the engine
   * along with the action points it spent on scouts; a seat that never submitted
   * passes. The engine's answer comes back with hexes named by label, which is
   * what both the players and the log use.
   */
  resolveTurn(): { events: LogEvent[]; result: LogResult | null } {
    const radius = this.config.radius;
    const turn = this.board.turn;
    // What each seat can see is taken before the engine moves anything, because
    // it is the turn as the seat played it that `get_state` reports on.
    const visible: Record<Seat, Set<HexKey>> = {
      A: visibleHexes(this.board, "A"),
      B: visibleHexes(this.board, "B"),
    };
    const orders: Record<Seat, Order[]> = {
      A: ordersToEngine(this.live.seats.A.submission?.orders ?? [], radius),
      B: ordersToEngine(this.live.seats.B.submission?.orders ?? [], radius),
    };
    const spentOnScouts: Record<Seat, number> = {
      A: this.live.seats.A.apSpentOnScouts,
      B: this.live.seats.B.apSpentOnScouts,
    };

    const outcome = engineResolveTurn(this.board, orders, spentOnScouts, this.config);
    this.board = outcome.state;

    const events = eventsToLog(outcome.events, radius);
    const wasted: Record<Seat, WastedLogOrder[]> = {
      A: wastedToLog(outcome.wasted.A, radius),
      B: wastedToLog(outcome.wasted.B, radius),
    };
    this.settled.set(turn, this.recordsFor(wasted));
    this.previous = {
      report: {
        events,
        orders: {
          A: this.live.seats.A.submission?.orders.slice() ?? [],
          B: this.live.seats.B.submission?.orders.slice() ?? [],
        },
        wasted,
      },
      visible,
    };
    this.accepting = false;
    return { events, result: toLogResult(outcome.state.result) };
  }

  /**
   * What the server saw of each seat's `turn`, in the log's per-player shape. It
   * reads the same whether the turn has been resolved or is still open; an open
   * turn has no `wasted` yet, because only resolution computes it.
   *
   * The harness fields — usage, cost, context size, wall time — come out as
   * zeros: the server never sees a provider, and the runner replaces them with
   * what the seat's own process measured.
   */
  turnRecord(turn: number): TurnPlayerRecords {
    const settled = this.settled.get(turn);
    if (settled !== undefined) return settled;
    if (this.live.turn !== turn) {
      throw new Error(`match ${this.matchId} has no turn ${turn} to record`);
    }
    return this.recordsFor({ A: [], B: [] });
  }

  /**
   * The transcript entry for a call, and the counters it spends. The counting
   * lives here rather than in the tools so brief §6.2's limits have one place to
   * be enforced from: every call counts, including one that returns an error,
   * except `submit_orders`.
   */
  private count(seat: Seat, tool: string, args: unknown, handled: HandlerResult, ms: number): void {
    const live = this.live.seats[seat];
    if (tool !== "submit_orders") live.toolCalls += 1;
    if (handled.ok && tool === "simulate") live.simulations += 1;
    if (handled.ok && tool === "scout") {
      // A scout spends one of the action points the seat shares with its orders,
      // and only for a hex that is really on the board.
      const hex = scoutHex(args);
      if (labelToKey(hex, this.config.radius) !== null) {
        live.apSpentOnScouts += 1;
        live.scouted.push(hex);
      }
    }
    live.transcript.push({
      tool,
      args,
      result: handled.ok ? handled.result : { error: handled.error },
      error: !handled.ok,
      ms,
    });
  }

  /**
   * Why a call is turned away before it reaches a tool: the seat has committed,
   * or the turn's calls, simulations or action points are spent. Every limit
   * brief §6.2 sets is checked here, in one place, so no tool has to remember to
   * check for itself and a call that is refused cannot spend anything. The seat's
   * submission outranks the rest: once it is in, the seat plays its turn out.
   *
   * The action points are the ones the seat shares with its orders, which is why
   * a scout is refused here while an order over budget is left to the engine to
   * waste: the scout would have bought information the seat has no point left to
   * pay for, and the order is played and wasted at resolution, point and all.
   */
  private refusal(seat: Seat, tool: string): string | null {
    const live = this.live.seats[seat];
    if (live.submission !== null) return "already_submitted";
    if (tool !== "submit_orders" && live.toolCalls >= TOOL_CALL_LIMIT) return "tool_call_limit";
    if (tool === "simulate" && live.simulations >= SIMULATE_LIMIT) return "simulate_limit";
    if (tool === "scout" && live.apSpentOnScouts >= this.config.actionPoints) {
      return "action_point_limit";
    }
    return null;
  }

  /**
   * `write_notes`: replace what the seat has written to itself. Notes outlive the
   * turn — they are the one thing a seat carries between turns — so they are held
   * outside the per-turn state. Text longer than brief §6.2 allows is refused and
   * what is stored stays exactly as it was.
   */
  private writeNotes(seat: Seat, args: unknown): HandlerResult {
    const notes = (args as { notes?: unknown } | null)?.notes;
    if (typeof notes !== "string") return { ok: false, error: "invalid_notes" };
    if (notes.length > NOTES_CHAR_LIMIT) return { ok: false, error: "notes_too_long" };
    this.notes[seat] = notes;
    return { ok: true, result: { stored: true } };
  }

  /**
   * `submit_orders`: what the seat wants played this turn.
   *
   * A call that is not shaped as brief §6.2 describes — an order the log cannot
   * hold, or a missing note or one outside 1 to 280 characters — is an error and
   * is not a submission, so it does not use up the seat's one rejected attempt.
   *
   * A first attempt is checked against the board with the action points the seat
   * has left after its scouts. Every order that gets checked spends one of them,
   * valid or not, which is what makes checking before storing anything worth
   * doing: the seat is told each invalid order and the engine's reason for it,
   * and nothing is committed, so it can try again having learned that.
   *
   * The second attempt stands whatever it carries. Its orders are stored as the
   * seat wrote them and the engine's `resolveTurn` wastes the invalid ones under
   * that same budget, so a wasted order still costs the point it would have cost
   * — which is why the seat is not simply asked again until it gets it right.
   */
  private submitOrders(seat: Seat, args: unknown): HandlerResult {
    const live = this.live.seats[seat];
    const submission = parseSubmission(args);
    if (submission === null) return { ok: false, error: "invalid_submission" };

    const checked = validateOrders(
      this.board,
      seat,
      ordersToEngine(submission.orders, this.config.radius),
      this.config.actionPoints - live.apSpentOnScouts,
    );
    if (checked.wasted.length === 0) {
      live.submission = submission;
      return { ok: true, result: { accepted: true } };
    }
    const wasted = wastedToLog(checked.wasted, this.config.radius);
    if (live.rejected === null) {
      // The seat's one rejected attempt: nothing is stored, and it may submit
      // once more. `status` still says it has no submission in.
      live.rejected = { orders: submission.orders, wasted };
      return { ok: true, result: { accepted: false, wasted } };
    }
    live.submission = submission;
    return { ok: true, result: { accepted: true, wasted } };
  }

  /**
   * `scout`: one action point for the hex the seat asked for and the hexes
   * touching it, as they stand on the board the turn opened on. A submission
   * commits nothing until `resolveTurn`, so what the other seat has handed in
   * has not moved these hexes yet. `count` is where the action point is spent —
   * and refuses to spend one on a hex that is not on the board — and where the
   * hex joins the ones the seat knows for the rest of the turn.
   */
  private scout(seat: Seat, args: unknown): HandlerResult {
    const key = labelToKey(scoutHex(args), this.config.radius);
    if (key === null) return { ok: false, error: "unknown_hex" };
    return { ok: true, result: scoutView(this.board, seat, this.config, key) };
  }

  /**
   * `simulate`: what the seat's orders would do, worked out on what the seat
   * knows and costing one of its three simulations. `simulate` builds the board
   * it runs on; nothing here commits anything.
   */
  private simulate(seat: Seat, args: unknown): HandlerResult {
    const called = args as { orders?: unknown; assumed_enemy_orders?: unknown } | null;
    const outcome = simulateTurn({
      state: this.board,
      seat,
      config: this.config,
      used: this.live.seats[seat],
      orders: called?.orders,
      assumed_enemy_orders: called?.assumed_enemy_orders,
    });
    return outcome.ok ? { ok: true, result: outcome.view } : { ok: false, error: outcome.error };
  }

  /** What `seat` is allowed to be told about the turn that is open. */
  private viewFor(seat: Seat): StateView {
    return stateView({
      state: this.board,
      seat,
      config: this.config,
      used: this.live.seats[seat],
      previous: this.previous,
    });
  }

  /** Both seats' records for the turn that is open, with the engine's verdict on them. */
  private recordsFor(wasted: Record<Seat, WastedLogOrder[]>): TurnPlayerRecords {
    const record = (seat: Seat): TurnPlayerRecord => {
      const live = this.live.seats[seat];
      const submission = live.submission;
      return {
        tool_calls: live.transcript.slice(),
        scouts: live.scouted.slice(),
        // The first attempt of a seat that was refused and allowed to try again.
        rejected_submission: live.rejected,
        orders: submission?.orders.slice() ?? [],
        wasted: wasted[seat],
        intent: submission?.intent ?? "",
        prediction: submission?.prediction ?? "",
        passed: submission === null ? "no_submission" : null,
        notes_after: this.notes[seat],
        usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        cost_usd: 0,
        context_tokens: 0,
        compacted: false,
        wall_ms: 0,
      };
    };
    return { A: record("A"), B: record("B") };
  }
}
