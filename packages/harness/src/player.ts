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
  /** Let the player go. Called once, when the match is over. */
  stop(): Promise<void>;
}
