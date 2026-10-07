/**
 * `PiPlayer`: a seat played by a headless Pi session, which is the seat brief
 * §6.3 measures.
 *
 * The runner's loop is the same for a model and a bot, so everything that is
 * specific to a model lives here: the seat's isolated Pi home, the pinned CLI
 * spawned in RPC mode with the lock-down flags, one prompt per turn, the events
 * of that turn read back into tool calls, and the session stats turned into
 * what the turn cost. Nothing here knows the game: the tools are whatever the
 * seat's `mcp.json` connects it to, and the only name spelled out is the
 * submission tool, in order to say whether the seat submitted. Before the child
 * is spawned, the model's credential is checked with `pi auth check`: a run that
 * cannot pay for its model stops in one line, rather than playing 25 turns of
 * provider errors and writing a log that says so 25 times.
 *
 * `RpcClient`, exported from the pinned package's root, is what runs the child.
 * Hand-rolling the JSONL is the wrong shortcut: `docs/rpc.md` warns that Node's
 * `readline` also splits on U+2028 and U+2029, which are legal inside JSON
 * strings, so a tool result containing one would break the framing; and closing
 * the child's stdin — which is what a piped sequence of commands does when the
 * pipe ends — shuts Pi down, so a scripted turn would never run. `RpcClient`
 * keeps stdin open, frames records on LF alone, correlates each command with
 * its response by id, and hands the events over as parsed objects.
 *
 * One session plays the whole match. Brief §6.3 keeps a seat's conversation
 * alive across turns because the match is one continuous game, and Pi's stats
 * are cumulative over that session, so a turn's tokens and cost are the
 * difference from the totals the last turn left behind.
 *
 * Brief §6.3's turn outcomes are this class's business, except for the one the
 * runner causes: a turn that settles with an accepted submission is a normal
 * turn, one that settles without one passes with `no_submission`, a provider
 * that fails after Pi's own retries passes with `provider_error`, and output
 * tokens over the per-turn budget abort the seat and pass with `token_budget`.
 * A turn that runs out of its time is aborted by the runner, which is the one
 * that knows, and the runner says `timeout` on the way to the log. The two
 * match-level failures — a tool outside the seven, and the Pi process dying —
 * are not turns, and are thrown as `MatchVoided`.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { RpcClient } from "@earendil-works/pi-coding-agent";
import type { JsonAgentSessionEvent, SessionStats } from "@earendil-works/pi-coding-agent";

import { piCli } from "./pi-cli.ts";
import { checkPiAuth } from "./pi-auth.ts";
import { createSeatHome, MCP_SERVER_NAME, type SeatHome, type SeatId } from "./pi-home.ts";
import {
  MatchVoided,
  type PassReason,
  type Player,
  type PlayerContext,
  type ProviderTurn,
  type RejectedSubmission,
  type ToolCallRecord,
  type TurnOutcome,
  type VoidReason,
} from "./player.ts";
import { answerOf } from "./tool-answer.ts";

/** The reasoning level a seat plays at, as brief §6.3's `--thinking` names it. */
export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * The turns of the match, which the per-turn prompt names: brief §6.3's message
 * is `Turn <n> of 25. Play your turn.` and both seats get it byte for byte.
 */
const DEFAULT_TURNS = 25;

/** The file a seat's provider is named in, beside the `mcp.json` it is written into. */
const MODELS_FILE = "models.json";

/**
 * The prefix Pi puts on every tool of an MCP server, `mcp__<server>__`. The log
 * records the tools without it — `get_state`, not `mcp__salient__get_state` —
 * because the server a seat was connected to is already in the log's header.
 */
const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/**
 * The tool a submission goes through, once the prefix is off. It is named here
 * so the harness can say whether the seat submitted at all; what the orders
 * mean stays the game's business, and the server's answer is what the log
 * records.
 */
const SUBMIT_TOOL = "submit_orders";

/**
 * The seven tools brief §6.3 locks a seat to, named as the log names them. The
 * seat is offered exactly these — `createSeatHome` turns off every built-in tool
 * and connects one MCP server — so a call to anything else is a seat that
 * reached outside the game, which voids the match however the call was answered.
 * One exception: one of the seven by its bare name (`submit_orders` for
 * `mcp__salient__submit_orders`). Pi has no such tool and answers "not found",
 * so nothing outside the game was reached; the call is a refused one, recorded
 * like any other, and the turn goes on.
 */
const SALIENT_TOOLS = new Set([
  "get_rules",
  "get_state",
  "scout",
  "simulate",
  "submit_orders",
  "read_notes",
  "write_notes",
]);

/** How a seat is driven. */
export interface PiPlayerOptions {
  /** Which seat this player plays. */
  seat: SeatId;
  /** The match's directory; the seat's three directories are made inside it. */
  matchDir: string;
  /** The model under test, as `--model` takes it: `<provider>/<id>`. */
  model: string;
  /** The reasoning level to play at. A measured variable, so there is no default. */
  thinking: PiThinkingLevel;
  /**
   * The player system prompt: a path to a file, or the prompt itself. A path is
   * made absolute before it is handed to the child, which runs in the seat's
   * empty working directory and would otherwise read the path as the prompt
   * text without complaint.
   */
  systemPrompt: string;
  /** Turns in the match, for the prompt's `of <n>`. Defaults to 25. */
  turns?: number;
  /**
   * The seat's `models.json`, written into its Pi home before the child starts.
   * This is how a seat reaches the model under test: a provider entry with its
   * `baseUrl`, its `apiKey` if the endpoint takes one, and the model's metadata
   * spelled out, because a compatible endpoint does not advertise it.
   */
  modelsJson?: unknown;
  /**
   * Extra variables for the child, merged over the seat home's own. A test
   * points a seat at a local endpoint with `PI_OFFLINE`; an operator gives it a
   * provider's key.
   */
  env?: Record<string, string>;
  /**
   * The output tokens one turn may cost before the seat is aborted and the turn
   * passes with `token_budget`. Brief §6.3 leaves the number to the experiment,
   * so there is no default: `null`, and a turn is bounded by its time alone.
   */
  outputTokenBudget?: number | null;
  /**
   * A tap on the seat's RPC event stream, called with every event Pi puts on
   * stdout while a turn is being played, before this class acts on it.
   *
   * Nothing in a match reads it. Brief §6.3's first-run checklist asks what the
   * stream itself carries — whether `agent_settled` arrives exactly once per
   * prompt, which event announces a compaction and what it says — and those are
   * questions about the wire, which the turn record cannot answer.
   */
  onEvent?: (event: JsonAgentSessionEvent) => void;
}

/** A submission tool's answer, as the harness reads it. */
interface SubmissionVerdict {
  accepted: boolean;
  /** The orders the server turned away, with the reason it gave for each. */
  wasted: RejectedSubmission["wasted"];
}

/**
 * The orders a refused submission carried, read from the server's answer. The
 * reason is what the log records, so it is required here; the order itself is
 * passed through as a value, because the log is where an order is checked.
 */
const wastedOf = (wasted: unknown): RejectedSubmission["wasted"] =>
  (Array.isArray(wasted) ? wasted : []).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { order, reason } = entry as { order?: unknown; reason?: unknown };
    return typeof reason === "string" ? [{ order, reason }] : [];
  });

/** Read a submission answer out of a tool result, or `null` when it is not one. */
const submissionOf = (result: unknown): SubmissionVerdict | null => {
  if (typeof result !== "object" || result === null) return null;
  const answer = result as { accepted?: unknown; wasted?: unknown };
  if (typeof answer.accepted !== "boolean") return null;
  return { accepted: answer.accepted, wasted: wastedOf(answer.wasted) };
};

/** The orders a submission carried, as values; the log is where they are checked. */
const ordersOf = (args: unknown): unknown[] => {
  const orders = (args as { orders?: unknown } | null)?.orders;
  return Array.isArray(orders) ? orders : [];
};

/** A note that went with a submission, or the empty string when it carried none. */
const noteOf = (args: unknown, key: "intent" | "prediction"): string => {
  const value = (args as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : "";
};

/** A tool as the log names it: Pi's name, without the MCP server's prefix. */
const stripPrefix = (tool: string): string =>
  tool.startsWith(TOOL_PREFIX) ? tool.slice(TOOL_PREFIX.length) : tool;

/**
 * Whether a failed command means the seat's Pi process is gone.
 *
 * `RpcClient` exposes no exit event: when the child dies it remembers an error
 * and rejects every command that is outstanding or comes later with it, so a
 * rejected command is how a death is noticed. Matching on the text is what there
 * is to match on; the phrases are the client's own.
 */
const seatIsGone = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /process exited|process error|Client not started/i.test(message);
};

/** A turn's tokens, from the cumulative totals either side of it. */
const delta = (from: number, to: number): number =>
  // Clamped rather than trusted: a session that was replaced mid-match would
  // otherwise report a negative turn, which the log's schema refuses and a
  // report would carry as a mystery.
  Math.max(0, to - from);

/**
 * What one turn added to the seat's session.
 *
 * `get_session_stats` answers the whole session, so the turn is the difference
 * between the totals it reports now and the ones the turn before it left
 * behind. `compacted` is the one figure that is not a number: it comes from the
 * events the turn produced, or from the conversation being smaller than the
 * turn before it left it, which is what a compaction is.
 */
const providerTurn = (
  previous: SessionStats | null,
  stats: SessionStats,
  compacted: boolean,
): ProviderTurn => {
  // `null` when Pi cannot say, which is what a compaction leaves behind until
  // the next assistant answer. Not folded into zero.
  const contextTokens = stats.contextUsage?.tokens ?? null;
  const before = previous?.contextUsage?.tokens ?? null;
  return {
    usage: {
      input: delta(previous?.tokens.input ?? 0, stats.tokens.input),
      output: delta(previous?.tokens.output ?? 0, stats.tokens.output),
      cache_read: delta(previous?.tokens.cacheRead ?? 0, stats.tokens.cacheRead),
      cache_write: delta(previous?.tokens.cacheWrite ?? 0, stats.tokens.cacheWrite),
    },
    costUsd: delta(previous?.cost ?? 0, stats.cost),
    contextTokens,
    // Either signal is enough. The events are the direct one; a drop is the
    // trace it leaves in the totals, and catches a compaction whose events the
    // turn never reported because the seat was aborted over it.
    compacted: compacted || (before !== null && contextTokens !== null && contextTokens < before),
    // The window itself, not the usage against it: the log's header records it
    // for a Pi seat, and Pi's `contextUsage` is the only place it is kept.
    contextWindow: stats.contextUsage?.contextWindow ?? null,
  };
};

/**
 * A seat played by one Pi session that lasts the match.
 *
 * `start` writes the seat's home, spawns the pinned CLI and reads the context
 * window Pi resolved its model against; `playTurn` prompts once and reads that
 * turn's events; `abort` ends the turn in flight and leaves the session alone;
 * `stop` lets the process go.
 */
export class PiPlayer implements Player {
  private readonly options: PiPlayerOptions;
  /** The turn count the per-turn prompt names. */
  private readonly turns: number;
  private client: RpcClient | null = null;
  private home: SeatHome | null = null;
  /**
   * The session totals as of the end of the last turn. Pi's `get_session_stats`
   * is cumulative over the session, so a turn's figures are the difference from
   * these, and these are replaced with the new totals at the end of every turn.
   */
  private totals: SessionStats | null = null;
  /** The bearer token the seat's connection was made with, for the whole match. */
  private token: string | null = null;
  /**
   * The context window Pi reported for the seat's model, read from the
   * session stats while the seat was starting. `null` when the seat has not
   * started, and when Pi gives its model no window at all.
   */
  private window: number | null = null;
  /**
   * Ends the turn in flight because the seat's process was found gone. Set while
   * a turn is being played, and called by `abort` when the command it sent was
   * refused by a dead child: without it, a turn whose `agent_settled` can never
   * arrive would hang the match.
   */
  private seatGone: (() => void) | null = null;

  // Assigned in the body rather than as constructor parameters: the `no-dice`
  // bin runs this file through Node's type stripping, which erases annotations
  // but does not support parameter properties.
  constructor(options: PiPlayerOptions) {
    this.options = options;
    this.turns = options.turns ?? DEFAULT_TURNS;
  }

  /**
   * The seat's home, as `start` wrote it. The runner reads it to point a
   * provider at an endpoint and to say where the match's transcripts are; a
   * test reads the session directory to show one session played the match.
   */
  get seatHome(): SeatHome {
    const home = this.home;
    if (home === null) throw new Error("the player has not started");
    return home;
  }

  /**
   * Write the seat's isolated home and start its Pi session.
   *
   * The flags are brief §6.3's lock-down, and they are passed here rather than
   * left to the seat's settings so a match cannot be run with a flag missing.
   * `--no-extensions` is deliberately absent: it would take away the built-in
   * MCP extension, and with it the game tools. `--mode rpc` is prepended by
   * `RpcClient`, which also spawns `node <cliPath>` — the pinned build from
   * `piCli()`, never the `pi` on `PATH`.
   */
  async start(ctx: PlayerContext): Promise<void> {
    if (this.client !== null) throw new Error("this player is connected already");

    const home = createSeatHome({
      matchDir: this.options.matchDir,
      seat: this.options.seat,
      serverUrl: ctx.serverUrl,
      token: ctx.token,
    });
    if (this.options.modelsJson !== undefined) {
      writeFileSync(
        join(home.piHomeDir, MODELS_FILE),
        `${JSON.stringify(this.options.modelsJson, null, 2)}\n`,
        "utf-8",
      );
    }
    this.home = home;
    this.token = ctx.token;

    // brief §6.3 resolves a credential before a turn is spent finding out there is
    // none, and it asks Pi rather than reading a key file: the seat's home is empty
    // by design, so a login stored in `~/.pi/agent` is not there to find. The check
    // is given the environment the child is about to get, which is what makes a
    // provider named in the seat's own `models.json` resolve.
    const auth = await checkPiAuth({
      model: this.options.model,
      env: { ...home.env, ...(this.options.env ?? {}) },
    });
    if (!auth.ok) {
      throw new Error(`seat ${this.options.seat}: ${auth.message}`);
    }

    const client = new RpcClient({
      cliPath: piCli().path,
      cwd: home.cwd,
      // `RpcClient` merges these over its own `process.env`, so the seat's
      // relocated config directory and its bearer token are what the child ends
      // up with for those names.
      env: { ...home.env, ...(this.options.env ?? {}) },
      model: this.options.model,
      args: [
        "--no-builtin-tools",
        "--no-context-files",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--system-prompt",
        existsSync(this.options.systemPrompt)
          ? resolve(this.options.systemPrompt)
          : this.options.systemPrompt,
        "--thinking",
        this.options.thinking,
        "--session-dir",
        home.sessionDir,
      ],
    });
    this.client = client;
    await client.start();

    // Pi knows the window of the model it resolved as soon as the session is up:
    // `contextUsage` is in its stats before a turn has been played, and the
    // window is a property of the model entry rather than of the conversation.
    // Read it here, while the seat is idle, so the match's header has
    // a window even when no seat ever settled a turn, and so nothing has to ask
    // a seat that may be mid-turn — or starved and slow to answer — for one.
    const stats = await this.command("the session stats", () => client.getSessionStats());
    this.window = stats.contextUsage?.contextWindow ?? null;
  }

  /**
   * The context window this seat's model is played with, as Pi reported it when
   * the session started: what the log's header records for a model seat. `null`
   * before the seat has started, and for a model Pi reports no window for.
   */
  contextWindow(): number | null {
    return this.window;
  }

  /**
   * Play one turn: prompt, read events until Pi settles, and turn what was seen
   * into the seat's half of a log turn.
   *
   * The listener is installed before the prompt is sent, because a stub answers
   * at once and an event that arrives between the two would be missing from the
   * turn. The prompt text is brief §6.3's, exactly: `Turn <n> of 25. Play your
   * turn.`, with nothing else, so both seats are asked identically.
   *
   * Nothing here retries a turn: brief §6.3 forbids it, and Pi's own provider
   * retries are the only ones a turn gets.
   */
  async playTurn(turn: number): Promise<TurnOutcome> {
    const client = this.client;
    if (client === null) throw new Error("the player has not started");

    const toolCalls: ToolCallRecord[] = [];
    /** The calls Pi has started but not finished, keyed by its own call id. */
    const open = new Map<string, { tool: string; args: unknown; at: number; misnamed: boolean }>();
    /** Calls to one of the seven by its bare name, which never reached the game. */
    const misnamed = new Set<ToolCallRecord>();
    let compacted = false;
    /** Why the turn is ending without orders, as far as this end can tell. */
    let passed: PassReason = "no_submission";
    /** A tool the seat was not given, which voids the match. */
    let outside: string | null = null;
    /** Output tokens the turn's answers have reported, against the budget. */
    let outputTokens = 0;
    let died = false;

    let settle!: () => void;
    const settled = new Promise<void>((resolveSettled) => {
      settle = resolveSettled;
    });
    let gone!: () => void;
    const seatGone = new Promise<void>((resolveGone) => {
      gone = resolveGone;
    });
    this.seatGone = gone;

    const unsubscribe = client.onEvent((event) => {
      this.options.onEvent?.(event);
      switch (event.type) {
        case "tool_execution_start": {
          const tool = stripPrefix(event.toolName);
          const bare = !event.toolName.startsWith(TOOL_PREFIX) && SALIENT_TOOLS.has(event.toolName);
          if (!bare && (!event.toolName.startsWith(TOOL_PREFIX) || !SALIENT_TOOLS.has(tool))) {
            // Brief §6.3 voids the match over this, so there is no point letting
            // the seat go on playing the turn.
            outside ??= event.toolName;
            this.stopTheSeat(client);
          }
          open.set(event.toolCallId, {
            tool: event.toolName,
            args: event.args,
            at: performance.now(),
            misnamed: bare,
          });
          break;
        }
        case "tool_execution_end": {
          // Pi reports the call id on both halves, so the pair is matched on it
          // and the wall time is measured at this end of the wire.
          const started = open.get(event.toolCallId);
          open.delete(event.toolCallId);
          const at = performance.now();
          const record: ToolCallRecord = {
            tool: stripPrefix(started?.tool ?? event.toolName),
            args: started?.args ?? {},
            result: answerOf(event.result),
            error: event.isError || started?.misnamed === true,
            ms: Math.max(0, Math.round(at - (started?.at ?? at))),
          };
          toolCalls.push(record);
          if (started?.misnamed === true) misnamed.add(record);
          break;
        }
        case "compaction_start":
        case "compaction_end":
          compacted = true;
          break;
        case "auto_retry_end":
          // Pi's own retries are over and the provider still said no. The turn
          // is not retried from here: brief §6.3 passes it, with the reason.
          if (event.success === false) passed = "provider_error";
          break;
        case "message_end": {
          const message = event.message;
          if (message.role !== "assistant") break;
          outputTokens += message.usage?.output ?? 0;
          const budget = this.options.outputTokenBudget ?? null;
          if (budget !== null && outputTokens > budget && outside === null) {
            passed = "token_budget";
            this.stopTheSeat(client);
          }
          break;
        }
        case "agent_settled":
          // The only signal that Pi will do nothing more for this prompt.
          // `agent_end` is not enough: a retry, a compaction or a queued
          // steering message can still follow it.
          settle();
          break;
      }
    });

    try {
      const prompt = `Turn ${String(turn)} of ${String(this.turns)}. Play your turn.`;
      const disposition = await this.command("the prompt", () => client.prompt(prompt));
      // A prompt that Pi handled without starting a run — an extension command,
      // say — never settles, so waiting on it would hang the turn.
      if (disposition === "started") {
        const ended = await Promise.race([settled.then(() => false), seatGone.then(() => true)]);
        died = ended;
      }
    } finally {
      unsubscribe();
      this.seatGone = null;
    }

    if (died) throw this.voided("harness_crash", "the seat's Pi process exited during the match");
    if (outside !== null) {
      throw this.voided(
        "tool_surface",
        `the seat called ${outside}, which is not one of the seven tools it was given`,
      );
    }

    const stats = await this.command("the session stats", () => client.getSessionStats());
    const previous = this.totals;
    this.totals = stats;

    const submissions = toolCalls.filter((call) => call.tool === SUBMIT_TOOL && !misnamed.has(call));
    const last = submissions.at(-1) ?? null;
    const refused = submissions.find((call) => submissionOf(call.result)?.accepted === false) ?? null;
    const verdict = last === null ? null : submissionOf(last.result);
    const submitted = verdict?.accepted === true;

    return {
      turn,
      toolCalls,
      submitted,
      orders: ordersOf(last?.args),
      intent: noteOf(last?.args, "intent"),
      prediction: noteOf(last?.args, "prediction"),
      rejected:
        refused === null
          ? null
          : { orders: ordersOf(refused.args), wasted: submissionOf(refused.result)?.wasted ?? [] },
      // A turn the runner aborted is a turn that ran out of its time, but the
      // runner is the one that knows that; the seat only knows it has no orders.
      passed: submitted ? null : passed,
      provider: providerTurn(previous, stats, compacted),
    };
  }

  /**
   * End the turn this seat is in the middle of, and leave the seat in the match:
   * brief §6.3 aborts a turn and never a session, so the conversation, the tool
   * calls already made and the aborted turn itself all stay in the history the
   * next turn is prompted on.
   *
   * A seat whose process has died cannot be aborted, and saying so here would
   * hide the reason the match is over: the death is reported by the turn in
   * flight, which is unblocked by this.
   */
  async abort(ctx: PlayerContext): Promise<void> {
    const client = this.client;
    if (client === null) throw new Error("the player has not started");
    // A Pi session holds one connection, and the bearer token written into it,
    // for the whole match: brief §6.3 keeps the conversation, and the calls it
    // has already made were made as this seat. A runner that hands an aborted
    // Pi seat another token has taken the seat out of the match by the back
    // door — every call it makes from here would be refused — so it is said to
    // out loud rather than left to show up as a seat that stops submitting.
    if (this.token !== null && ctx.token !== this.token) {
      throw new Error("a Pi seat cannot be given a new token in the middle of a match");
    }
    try {
      await client.abort();
    } catch (error) {
      if (!seatIsGone(error)) throw error;
      // There is nothing to abort. The death is reported by the turn in flight,
      // which this unblocks.
      this.markGone();
    }
  }

  /** Send the seat a command, and turn a dead process into a voided match. */
  private async command<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!seatIsGone(error)) throw error;
      this.markGone();
      throw this.voided(
        "harness_crash",
        `the seat's Pi process exited during the match; ${what} was refused`,
      );
    }
  }

  /** The match-level failure this seat caused, as brief §6.3 names it. */
  private voided(reason: VoidReason, message: string): MatchVoided {
    return new MatchVoided(reason, message);
  }

  /** Tell the seat to stop what it is doing, for a rule the harness enforces. */
  private stopTheSeat(client: RpcClient): void {
    void client.abort().catch((error: unknown) => {
      if (seatIsGone(error)) this.markGone();
    });
  }

  /** End the turn in flight, because the seat's process is gone. */
  private markGone(): void {
    const endTurn = this.seatGone;
    this.seatGone = null;
    endTurn?.();
  }

  /** Let the seat go. The saved session stays on disk: it is the match's transcript. */
  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.token = null;
    if (client !== null) await client.stop();
  }
}
