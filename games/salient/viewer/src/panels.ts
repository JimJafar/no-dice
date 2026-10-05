/**
 * The two side panels: what each seat did this turn, and what it cost.
 *
 * One panel per seat, read from `turns[n].players.A` / `.B` and from the board
 * that turn leaves. Nothing here is scripted or inferred: the intent and the
 * prediction are the sentences the seat wrote, the tool-call trace is the log's
 * own list in the log's own order, and the three boxes are counted off the log —
 * troops from `after.troops`, Nodes held by counting the `map` hexes whose
 * terrain is `node` and whose cell owner is the seat, and actions used as
 * `orders.length + scouts.length` against `config.action_points`, which is what
 * the rules spend an action point on: an order, or a scout.
 *
 * The context meter is the addition brief §6.8 suggests: `context_tokens`
 * against the seat's own `players.<seat>.context_window`. A seat driven by a bot
 * has no window — it keeps no conversation between turns — and is shown no meter
 * at all rather than a meter reading zero, which would look like a context that
 * had emptied rather than one that never existed.
 *
 * Frame 0 is the start position, which no seat has played yet: the panel shows
 * the board as it opens — troops counted off `start.cells`, the Nodes it holds,
 * no orders spent — and no intent, prediction or tool calls, because the log
 * holds none for a turn that has not happened.
 *
 * The marks a turn carries — a refused submission, a pass, a compaction — come
 * from `marks.ts`, which is also what the turn strip marks with. The mock-ups'
 * "Called it" / "Missed" verdict tag is not here: how predictions are scored is
 * undecided, so the panel shows the prediction and no judgement of it.
 */
import type { Cells, MatchLog, PlayerHeader, Seat, ToolCallRecord, TurnPlayerRecord, TurnRecord } from "@no-dice/log";

import { seatName } from "./header.ts";
import { markText, marksFor, type SeatMarks } from "./marks.ts";

/**
 * The most of one call's arguments a trace line shows. A `simulate` call can
 * carry twenty orders, and a panel line that runs four screens is not a trace;
 * what is left off is marked with an ellipsis rather than hidden.
 */
export const ARGS_LIMIT = 120;

/**
 * A call's arguments on one line: keys and values as JSON spells them, with a
 * space after each separator, and cut to `ARGS_LIMIT` characters when they run
 * past it. The walk rather than a rewrite of JSON's own text is what keeps a
 * string value intact — an intent sentence full of colons and commas is exactly
 * the kind of argument a `submit_orders` call carries. The log types `args` as
 * `unknown`, so this reads whatever is there rather than assuming the seven
 * tools of the current server.
 */
export function compactArgs(args: unknown): string {
  const text = compactValue(args);
  return text.length > ARGS_LIMIT ? `${text.slice(0, ARGS_LIMIT - 1)}…` : text;
}

/** One value of a call's arguments, written onto one line. */
function compactValue(value: unknown): string {
  if (value === undefined) return "no arguments";
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(compactValue).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, child]) => `${JSON.stringify(key)}: ${compactValue(child)}`,
  );
  return `{${entries.join(", ")}}`;
}

/** One line of the tool-call trace. */
export interface ToolCallView {
  /** The tool as the player called it, which the log already holds unprefixed. */
  readonly tool: string;
  /** The arguments, compacted onto the line. */
  readonly args: string;
  /** Whether the call came back an error. */
  readonly error: boolean;
  /** How long the server took, in milliseconds. */
  readonly ms: number;
}

/** A seat's conversation, measured against the window it is played in. */
export interface ContextView {
  readonly tokens: number;
  readonly window: number;
  /** `tokens` as a whole percentage of `window`, which may pass 100. */
  readonly percent: number;
}

/** One seat's panel for one frame. */
export interface PanelView {
  readonly seat: Seat;
  /** What the seat is called: its model for a `pi` seat, its bot for a `bot` seat. */
  readonly name: string;
  /** The frame the panel describes: 0 for the start position, else the turn's number. */
  readonly frame: number;
  readonly intent: string;
  readonly prediction: string;
  /** The seat's tool calls for the turn, in the log's order. */
  readonly toolCalls: readonly ToolCallView[];
  /** The hexes the seat scouted this turn, in the order it scouted them. */
  readonly scouted: readonly string[];
  readonly troops: number;
  /** The Nodes of the map this seat holds at the frame. */
  readonly nodesHeld: number;
  /** Orders plus scouts: the action points the turn spent. */
  readonly actionsUsed: number;
  /** The action points the match was played with. */
  readonly actionPoints: number;
  /** The context meter, or `null` for a seat with no window to measure against. */
  readonly context: ContextView | null;
  readonly marks: SeatMarks;
  /** The marks as sentences, one per mark the turn carries. */
  readonly markLines: readonly string[];
}

/** The troops of `seat` on a board that logs no `troops` of its own. */
function troopsIn(cells: Cells, seat: Seat): number {
  const owner = seat === "A" ? 1 : 2;
  return cells.reduce((sum, cell) => (cell[0] === owner ? sum + cell[1] : sum), 0);
}

/**
 * The Nodes `seat` holds at a board: the hexes the map says are Nodes, counted
 * where the cell that describes them is owned by the seat. A Node cut off from
 * its Base is still held — it scores nothing, but the seat has it.
 */
function nodesHeld(log: MatchLog, cells: Cells, seat: Seat): number {
  const owner = seat === "A" ? 1 : 2;
  return log.map.reduce((sum, hex, i) => (hex.terrain === "node" && cells[i][0] === owner ? sum + 1 : sum), 0);
}

/**
 * The context meter for one seat, or `null` when it has no window. A `bot` seat
 * carries no `context_window` in its header at all, and a `pi` seat configured
 * with a window of 0 has nothing to measure against either; either way an empty
 * meter would claim a context of zero tokens, which is not what happened.
 */
function contextFor(player: PlayerHeader, record: TurnPlayerRecord): ContextView | null {
  const window = player.kind === "pi" ? player.context_window : 0;
  if (window === 0) return null;
  return {
    tokens: record.context_tokens,
    window,
    percent: Math.round((record.context_tokens / window) * 100),
  };
}

/** The trace line for one call the player made. */
function toolCallView(call: ToolCallRecord): ToolCallView {
  return { tool: call.tool, args: compactArgs(call.args), error: call.error, ms: call.ms };
}

/**
 * One seat's panel for one frame of a log: the sentences the seat wrote, the
 * calls it made, and the three boxes the mock-up draws under them.
 */
export function panelView(log: MatchLog, frame: number, seat: Seat): PanelView {
  // Frame 0 is the start position, which no seat has played; any other frame has
  // to be a turn the log holds, or there is nothing to show for it.
  let record: TurnRecord | null = null;
  if (frame !== 0) {
    const found = log.turns.find((turn) => turn.n === frame);
    if (found === undefined) throw new Error(`the log holds no turn ${frame}`);
    record = found;
  }

  const player = record === null ? null : record.players[seat];
  const cells = record === null ? log.start.cells : record.after.cells;
  const marks: SeatMarks =
    player === null
      ? { seat, rejected: [], passed: null, compacted: false }
      : marksFor(player, seat);

  return {
    seat,
    name: seatName(log.players[seat]),
    frame,
    intent: player?.intent ?? "",
    prediction: player?.prediction ?? "",
    toolCalls: player?.tool_calls.map(toolCallView) ?? [],
    scouted: player?.scouts ?? [],
    troops: record === null ? troopsIn(cells, seat) : record.after.troops[seat],
    nodesHeld: nodesHeld(log, cells, seat),
    actionsUsed: player === null ? 0 : player.orders.length + player.scouts.length,
    actionPoints: log.config.action_points,
    context: player === null ? null : contextFor(log.players[seat], player),
    marks,
    markLines: markText(marks),
  };
}

/** Both panels for one frame, keyed by seat. */
export function panelsView(log: MatchLog, frame: number): Record<Seat, PanelView> {
  return { A: panelView(log, frame, "A"), B: panelView(log, frame, "B") };
}
