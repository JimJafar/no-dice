/**
 * `BotPlayer`: a bot played through an ordinary MCP client, which is the whole
 * reason the harness exists.
 *
 * A bot driven in-process could be handed the server's board and would win on
 * information a model never gets. This one is dealt a seat's bearer token and
 * reaches the match over the same Streamable HTTP endpoint a Pi session uses,
 * so it is answered by the same tools, refused by the same limits, and recorded
 * in the same transcript. What it reports having called is checked against what
 * the server recorded it calling.
 *
 * The turn it plays is the turn brief §6.2 tells a player to play, and no more
 * than that: the rules once, on turn 1, then the position, a decision, and a
 * submission. It does not scout and it does not simulate — not because a bot
 * would cheat, but because the baselines are meant to be the floor a model has
 * to clear using only what it is shown. A submission the server refuses costs it
 * the orders the server turned away and one more attempt, which is exactly the
 * deal a model gets.
 *
 * Nothing in here is Salient. The tool names, the decision and the way a
 * submission's answer is read all come in as arguments, so the `PiPlayer` of
 * brief §6.4 can sit beside this one against the same interface.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type {
  Player,
  PlayerContext,
  RejectedSubmission,
  ToolCallRecord,
  TurnOutcome,
} from "./player.ts";
import { answerOf } from "./tool-answer.ts";

/** The three tools a bot plays a turn with, named for the game being played. */
export interface BotTools {
  /** The half of the match that never changes: called once, on turn 1. */
  rules: string;
  /** The turn as this seat can see it. */
  state: string;
  /** The orders to play, with the two notes the game requires with them. */
  submit: string;
}

/** What a decision function answers: the moves it wants played, and why. */
export interface Decision<Order> {
  orders: Order[];
  intent: string;
  prediction: string;
}

/** What a `submit` call answered, as the harness reads it. */
export interface SubmitVerdict<Order> {
  /** Whether the server now holds this submission. */
  accepted: boolean;
  /** The submission the server refused, for the log; `null` when it refused nothing. */
  rejected: RejectedSubmission | null;
  /** What to send on the one resubmission: the refused orders dropped, the rest standing. */
  retry: Order[];
}

/** How one game's tools read to the harness. */
export interface BotPlayerOptions<Rules = unknown, State = unknown, Order = unknown> {
  /** The tool names this game's server answers. */
  tools: BotTools;
  /** The decision, over what the two read-only tools answered. */
  decide: (rules: Rules, state: State) => Decision<Order>;
  /** How to read a submission's answer, given the orders that were sent. */
  verdict: (result: unknown, sent: Order[]) => SubmitVerdict<Order>;
  /**
   * How to reach the server. Streamable HTTP with the seat's bearer token by
   * default; `InMemoryTransport.createLinkedPair()` for a test that wants the
   * same code path without a socket.
   */
  transport?: (ctx: PlayerContext) => Transport;
}

/** A turn in which nothing was submitted: the calls it made, and nothing else. */
const noSubmission = (turn: number, toolCalls: ToolCallRecord[]): TurnOutcome => ({
  turn,
  toolCalls,
  submitted: false,
  orders: [],
  intent: "",
  prediction: "",
  rejected: null,
});

/** How a player reaches a real match: the endpoint, and the seat's bearer token. */
const httpTransport = (ctx: PlayerContext): Transport =>
  new StreamableHTTPClientTransport(new URL(ctx.serverUrl), {
    requestInit: { headers: { authorization: `Bearer ${ctx.token}` } },
  });

export class BotPlayer<Rules = unknown, State = unknown, Order = unknown> implements Player {
  private readonly options: BotPlayerOptions<Rules, State, Order>;
  private client: Client | null = null;
  /**
   * The map, from the one call to the rules tool brief §6.2 says a player makes,
   * on turn 1. It is kept for the rest of the match; the only turn that asks
   * again is one whose asking was refused, since a bot with no map cannot
   * decide at all.
   */
  private rules: Rules | null = null;

  constructor(options: BotPlayerOptions<Rules, State, Order>) {
    this.options = options;
  }

  async start(ctx: PlayerContext): Promise<void> {
    if (this.client !== null) throw new Error("this player is connected already");
    const client = new Client({ name: "no-dice-bot-player", version: "0.0.0" });
    this.client = client;
    await client.connect((this.options.transport ?? httpTransport)(ctx));
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.rules = null;
    if (client !== null) await client.close();
  }

  /**
   * One turn, end to end: the position read, the decision made, the submission
   * sent, and — if the server refused it — one resubmission with the refused
   * orders gone. Every call is recorded as it is made, so a turn that goes wrong
   * part way still reports what it did.
   */
  async playTurn(turn: number): Promise<TurnOutcome> {
    const { tools } = this.options;
    const toolCalls: ToolCallRecord[] = [];

    if (this.rules === null) {
      const rules = await this.call(tools.rules, {}, toolCalls);
      if (rules.error) return noSubmission(turn, toolCalls);
      this.rules = rules.result as Rules;
    }
    const state = await this.call(tools.state, {}, toolCalls);
    if (state.error) return noSubmission(turn, toolCalls);

    const decision = this.options.decide(this.rules, state.result as State);
    const first = await this.call(
      tools.submit,
      { orders: decision.orders, intent: decision.intent, prediction: decision.prediction },
      toolCalls,
    );
    const verdict = this.options.verdict(first.result, decision.orders);
    if (verdict.rejected === null) {
      return {
        turn,
        toolCalls,
        submitted: verdict.accepted,
        orders: decision.orders,
        intent: decision.intent,
        prediction: decision.prediction,
        rejected: null,
      };
    }

    // The seat's one resubmission, on the same terms a model gets: the orders
    // the server refused are dropped, the rest go back as they stood, and
    // whatever the server makes of that is final.
    const second = await this.call(
      tools.submit,
      { orders: verdict.retry, intent: decision.intent, prediction: decision.prediction },
      toolCalls,
    );
    return {
      turn,
      toolCalls,
      submitted: this.options.verdict(second.result, verdict.retry).accepted,
      orders: verdict.retry,
      intent: decision.intent,
      prediction: decision.prediction,
      rejected: verdict.rejected,
    };
  }

  /**
   * One tool call, timed at this end of the wire and recorded in the shape the
   * log wants. A call the server marks an error is recorded as an error, with
   * the refusal as its result, which is what the seat was told.
   */
  private async call(
    tool: string,
    args: Record<string, unknown>,
    toolCalls: ToolCallRecord[],
  ): Promise<{ result: unknown; error: boolean }> {
    const client = this.client;
    if (client === null) throw new Error("the player has not started");
    const started = performance.now();
    // The SDK's type also allows a task handle, which is how a server defers a
    // long-running tool. A game server answers its tools directly, so what
    // comes back is the result.
    const answered = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
    const ms = Math.max(0, Math.round(performance.now() - started));
    const error = answered.isError === true;
    const result = answerOf(answered);
    toolCalls.push({ tool, args, result, error, ms });
    return { result, error };
  }
}
