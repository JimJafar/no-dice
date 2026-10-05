/**
 * The `Player` interface brief §6.4 gives the match runner: one interface over
 * a model driven through Pi and a bot driven through the same MCP tools, so the
 * runner's loop does not know which kind of seat it is playing.
 *
 * A player is started once per match, asked for one turn at a time, and stopped
 * at the end. What it hands back for a turn is the seat's half of a log turn:
 * the tool calls it made, what they were answered with, what it finally
 * submitted, and whether it submitted at all. The runner adds what only it knows
 * — the turn number, the engine's verdict, the other seat — and what only a
 * model's harness knows, which is usage, cost and context size.
 *
 * Nothing here names a game. The tool calls and the orders are values the
 * runner passes through to the log, which is where they are checked.
 */

/** What a player is told about the server it has to reach, and who it is there. */
export interface PlayerContext {
  /** The MCP endpoint, e.g. `http://127.0.0.1:8787/mcp`. */
  serverUrl: string;
  /** The seat's bearer token: the whole of its identity, and good for one seat. */
  token: string;
}

/**
 * One tool call the player made, in the shape the log records it
 * (`toolCallSchema` in `@no-dice/runner/log`), so the runner can put these
 * straight into a turn without translating them.
 */
export interface ToolCallRecord {
  /** The tool as the player called it, without any `mcp__salient__` prefix. */
  tool: string;
  args: unknown;
  /** The answer the player got; `{ error: <code> }` for a call that was refused. */
  result: unknown;
  /** Whether the call was refused. */
  error: boolean;
  /** What the call took, measured at the player's end of the wire. */
  ms: number;
}

/**
 * A first submission the server refused: what it carried, and the reason it
 * gave for each order it turned away. Nothing of it stands.
 */
export interface RejectedSubmission {
  orders: unknown[];
  wasted: { order: unknown; reason: string }[];
}

/**
 * Why a seat played no orders this turn, in the words brief §6.3's turn-outcome
 * table gives and `passReasonSchema` in `@no-dice/runner/log` accepts. The last
 * two are not turns at all: they end the match, and a player reports them by
 * throwing `MatchVoided` rather than by handing back an outcome.
 *
 * The names are repeated here rather than imported, for the same reason
 * `ToolCallRecord` repeats `toolCallSchema`: the harness does not depend on the
 * runner, and the runner checks what a seat reports against its own schema.
 */
export type PassReason =
  | "no_submission"
  | "timeout"
  | "token_budget"
  | "provider_error"
  | "harness_crash"
  | "tool_surface";

/** Why a match is voided rather than played: the two match-level reasons above. */
export type VoidReason = Extract<PassReason, "harness_crash" | "tool_surface">;

/**
 * A match-level failure: the seat's Pi process died, or the seat reached a tool
 * outside the seven. Brief §6.3 voids the match for either, so a log of it must
 * never be written as a match that was played; a voided match is replayed from
 * turn 1 on the same seed.
 *
 * A player throws this instead of reporting a turn, because a turn that was
 * never played has no pass reason.
 */
export class MatchVoided extends Error {
  /** Which of the two match-level rules the seat broke. */
  readonly reason: VoidReason;

  constructor(reason: VoidReason, message: string) {
    super(message);
    this.name = "MatchVoided";
    this.reason = reason;
  }
}

/**
 * What one seat's provider run added to that seat's conversation over one turn.
 *
 * A model seat knows these and a bot seat does not, which is why they travel
 * together and apart: the runner copies them into the log's turn record, where
 * `usageSchema` and `turnPlayerSchema` in `@no-dice/runner/log` hold the same
 * fields under the same names.
 */
export interface ProviderTurn {
  /** Provider tokens the turn used, named as the log names them. */
  usage: { input: number; output: number; cache_read: number; cache_write: number };
  /** What the turn cost, in US dollars, at the rates the seat's model entry gives. */
  costUsd: number;
  /**
   * The size of the seat's conversation at the end of the turn, or `null` when
   * the seat cannot say. Pi reports `contextUsage.tokens` as `null` immediately
   * after a compaction, until a fresh assistant answer arrives, and that is
   * unknown rather than zero: a compaction makes the conversation smaller, so a
   * zero would read as an empty one.
   */
  contextTokens: number | null;
  /** Whether the seat's conversation was compacted during the turn. */
  compacted: boolean;
}

/** What one seat did in one turn, as the seat itself saw it. */
export interface TurnOutcome {
  /** The turn this outcome is for, echoed back so a report stands on its own. */
  turn: number;
  /** Every tool call the player made, in the order it made them. */
  toolCalls: ToolCallRecord[];
  /** Whether the server holds a submission from this seat for this turn. */
  submitted: boolean;
  /** The orders the final submission carried, valid or not. */
  orders: unknown[];
  /** The two notes that went with the final submission; empty when there was none. */
  intent: string;
  prediction: string;
  /** The submission the server refused before the final one, if it refused one. */
  rejected: RejectedSubmission | null;
  /**
   * Why the seat played no orders, as the seat itself can say: `null` when it
   * submitted. A seat that ran out of its turn is aborted by the runner, which
   * is the one who knows the turn ran out, so a player leaves `no_submission`
   * here and the runner replaces it with `timeout`.
   */
  passed: PassReason | null;
  /**
   * What the seat's provider run cost it over this turn, when it runs a
   * provider at all: absent for a bot, present for a seat driven through Pi.
   */
  provider?: ProviderTurn;
}

/** One seat of a match, however it is driven. */
export interface Player {
  /** Connect to the match. Called once, before the first turn. */
  start(ctx: PlayerContext): Promise<void>;
  /** Play one turn: read the position, decide, submit. */
  playTurn(turn: number): Promise<TurnOutcome>;
  /**
   * Stop what the seat is doing right now, and leave it in the match.
   *
   * Brief §6.3 aborts a turn that ran out of its time, spent its output-token
   * budget or is still running after it submitted, and the seat is prompted
   * again next turn with the aborted turn still in its history. So this ends a
   * turn, not a seat: it must not throw away the conversation, and the runner
   * never restarts a player to get out of a turn. The turn in flight answers
   * with the outcome it has, passed.
   *
   * `ctx` is the context the seat goes on playing with. A runner that replaces
   * the connection a seat reaches the match over gives it a new token with it,
   * and a player that reconnects uses this one; a player whose connection is
   * fixed for the match is given the context it started with.
   */
  abort(ctx: PlayerContext): Promise<void>;
  /** Let the player go. Called once, when the match is over. */
  stop(): Promise<void>;
}
