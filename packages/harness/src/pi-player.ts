/**
 * `PiPlayer`: a seat played by a headless Pi session, which is the seat brief
 * §6.3 measures.
 *
 * The runner's loop is the same for a model and a bot, so everything that is
 * specific to a model lives here: the seat's isolated Pi home, the pinned CLI
 * spawned in RPC mode with the lock-down flags, one prompt per turn, the events
 * of that turn read back into tool calls, and the session stats turned into
 * what the turn cost. Nothing here knows the game: the tools are whatever the
 * match's server lists, given to the seat by the `seat-tools.ts` extension under
 * the server's own names, and the only name spelled out is the
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
 * A `prompt` command the seat never answers — its client waits 30 s, drops the
 * request and rejects, with the child alive — passes with `prompt_timeout`, the
 * seat is stopped before the turn is handed back, and the match goes on; the
 * next turn first puts the seat back in order (`recoverSeat`), and if it still
 * will not take a prompt, that turn passes the same way. A turn that runs out of
 * its time is aborted by the runner,
 * which is the one that knows, and the runner says `timeout` on the way to the
 * log. The match-level failure — the Pi process dying — is not a turn, and is
 * thrown as `MatchVoided`. A call to a tool the seat was not given is not a
 * failure at all: Pi's lock-down refuses it, and the turn goes on.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { RpcClient } from "@earendil-works/pi-coding-agent";
import type { JsonAgentSessionEvent, SessionStats } from "@earendil-works/pi-coding-agent";

import { piCli } from "./pi-cli.ts";
import { checkPiAuth } from "./pi-auth.ts";
import { createSeatHome, type SeatHome, type SeatId } from "./pi-home.ts";
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
import { SEAT_TOOLS_EXTENSION } from "./seat-tools.ts";
import { answerOf } from "./tool-answer.ts";

/** The reasoning level a seat plays at, as brief §6.3's `--thinking` names it. */
export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * The turns of the match, which the per-turn prompt names: brief §6.3's message
 * is `Turn <n> of 25. Play your turn.` and both seats get it byte for byte.
 */
const DEFAULT_TURNS = 25;

/** The file a seat's provider is named in, in the seat's config directory. */
const MODELS_FILE = "models.json";


/**
 * The tool a submission goes through. It is named here
 * so the harness can say whether the seat submitted at all; what the orders
 * mean stays the game's business, and the server's answer is what the log
 * records.
 */
const SUBMIT_TOOL = "submit_orders";


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

/**
 * What `RpcClient` says when its own wait for a command's response runs out:
 * `Timeout waiting for response to prompt. Stderr: …` (`rpc-client.js:465`). A
 * prompt Pi *refused* is not that: an error response's text becomes the
 * rejection through `getData` (`rpc-client.js:488-492`), and a seat that refused
 * a command is not a seat that never answered one.
 */
const commandTimedOut = (error: unknown): boolean =>
  /Timeout waiting for response to /.test(error instanceof Error ? error.message : String(error));

/** How often a run that is going to start is looked for, and for how long. */
const RUN_APPEARS_MS = 1_000;
const RUN_APPEARS_SAMPLES = 8;

/** How long a run that has started is waited on before the seat is stopped again. */
const RUN_SETTLES_MS = 30_000;

/** How many times a run that will not settle is stopped before the turn is handed back. */
const RUN_STOPS = 2;

/**
 * How long one between-turns recovery command is waited on, and how many times
 * the seat is asked before the next turn is asked anyway.
 *
 * The client's own wait is 30 s and has no knob, and the recovery sends three
 * commands, so a recovery that used it would be longer than the turn it is
 * preparing. These commands are answered by `rpc-mode.js` without a provider
 * round trip, so a seat that is merely busy answers them in milliseconds; five
 * seconds is room for a loaded box, and three passes is room for a stop that
 * needs a second look.
 */
const RECOVERY_COMMAND_MS = 5_000;
const RECOVERY_PASSES = 3;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

/**
 * Whether the seat settles within `ms`. `waitForIdle` waits for the *next*
 * `agent_settled` event (`rpc-client.js:366-380`), so a settle from a run that
 * ended before this one cannot answer for the run in flight. A seat whose process
 * is gone emits nothing and so reads as "did not settle"; the command that comes
 * after it is the one that notices the death.
 */
const settlesWithin = (client: RpcClient, ms: number): Promise<boolean> =>
  client
    .waitForIdle(ms)
    .then(() => true)
    .catch(() => false);

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

/**
 * The commands the between-turns recovery sends, as the part of `RpcClient` it
 * uses.
 *
 * Named as a subset because every one of them is answered by `rpc-mode.js`'s
 * `handleCommand` without a provider round trip — which is the whole reason the
 * recovery can ask a seat that has just failed to answer a `prompt`.
 */
export interface SeatRecoveryClient {
  getState(): Promise<{
    isStreaming: boolean;
    isCompacting: boolean;
    pendingMessageCount: number;
  }>;
  abort(): Promise<void>;
  clearQueue(): Promise<unknown>;
}

/** What a recovery found and did, so the cost of it is readable from outside. */
export interface SeatRecovery {
  /** Whether the seat was quiet at the end. `null` when it would not say. */
  quiet: boolean | null;
  /** Times the seat was asked, times it was stopped, times its queue was taken away. */
  asks: number;
  stops: number;
  clears: number;
}

/**
 * Wait for one command on this end's clock, and read not being told as an
 * answer rather than as a failure.
 *
 * The command is not cancelled — `RpcClient` gives no way to cancel one — it is
 * simply no longer waited on, and its late response is dispatched as an event
 * and dropped. A recovery that threw on its first unanswered command would be a
 * recovery that turns a survivable state into a lost turn.
 */
const withinBudget = async <T>(run: () => Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolveBudget) => {
    timer = setTimeout(() => resolveBudget(null), ms);
  });
  try {
    return await Promise.race([run(), budget]);
  } catch {
    // A seat whose process is gone rejects every command, and that is not the
    // recovery's to report: the next `prompt` is a command whose failure
    // means something, and it turns the death into a voided match.
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Put a seat that missed a prompt back in order before the next turn asks it
 * again — brief §6.3's "prompted again next turn" is only worth having if the
 * seat can take the prompt.
 *
 * The seat may still be working. The command the harness gave up on is still
 * inside Pi: `AgentSession.prompt()` parks a prompt arriving during
 * `_emitAgentSettled` in `_deferredSettledActions` and runs it afterwards
 * (`agent-session.js:1482-1485`), and the stop the passed turn sent can have
 * been answered while a run was still starting. A streaming seat refuses the
 * next prompt outright — `prompt()` throws "Agent is already processing…" and
 * `rpc-mode.js` answers the command with it — so the turn would be passed for a
 * reason that is not the truth, and a queued message would be answered inside a
 * run nobody asked for.
 *
 * So ask, and act on the answer: `get_state` says whether the seat is streaming
 * or compacting and how much is queued, `abort` stops what is running, and
 * `clear_queue` takes away what is queued. Nothing here re-sends a prompt:
 * brief §6.3 forbids retrying a turn, and the passed turn's prompt is already in
 * the seat's history, late or not. A seat that is still busy after being asked
 * and stopped as many times as the budget allows is asked anyway; if it will
 * not take the prompt, that turn passes too, and the match goes on.
 */
export const recoverSeat = async (
  client: SeatRecoveryClient,
  budgetMs: number = RECOVERY_COMMAND_MS,
  passes: number = RECOVERY_PASSES,
): Promise<SeatRecovery> => {
  const recovery: SeatRecovery = { quiet: null, asks: 0, stops: 0, clears: 0 };
  for (let pass = 0; pass < passes; pass += 1) {
    const state = await withinBudget(() => client.getState(), budgetMs);
    recovery.asks += 1;
    // It will not say, and there is nothing further to take away: ask the turn.
    if (state === null) return recovery;
    if (state.isStreaming || state.isCompacting) {
      await withinBudget(() => client.abort(), budgetMs);
      recovery.stops += 1;
      continue;
    }
    if (state.pendingMessageCount > 0) {
      await withinBudget(() => client.clearQueue(), budgetMs);
      recovery.clears += 1;
      continue;
    }
    recovery.quiet = true;
    return recovery;
  }
  // Asked and stopped until the budget ran out, and still busy. The turn is
  // asked anyway: a refused prompt is a pass, and a pass is a turn the
  // match survives. Only a process that is gone ends the match, and the prompt
  // is the command that says so.
  recovery.quiet = false;
  return recovery;
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
   * Whether the last turn's prompt failed to reach a run — the seat never
   * answered the command, or answered it to refuse it. The next turn is put
   * through `recoverSeat` before it asks, because a seat in that state may still
   * be working on the turn that was passed.
   */
  private missedPrompt = false;
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
   * `-e` loads `seat-tools.ts`, which gives the seat the match's tools under
   * their own names. `--mode rpc` is prepended by
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
        "-e",
        SEAT_TOOLS_EXTENSION,
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
   * retries are the only ones a turn gets. A `prompt` command that comes back
   * wrong while the seat's process is alive ends the turn as a pass with
   * `prompt_timeout` rather than throwing, because the match has a turn to
   * record and the seat is prompted again next turn; only a seat whose process is
   * gone ends the match. The turn after such a pass starts by putting the seat
   * back in order, which is what makes "prompted again next turn" mean a turn
   * that is played rather than a turn that is refused.
   */
  async playTurn(turn: number): Promise<TurnOutcome> {
    const client = this.client;
    if (client === null) throw new Error("the player has not started");

    // A seat that missed the last turn's prompt is put back in order
    // before this one asks it again. This runs before the turn's listener is
    // installed, so a run that is still finishing the passed turn cannot have
    // its tool calls, or any orders it makes, read as this turn's.
    if (this.missedPrompt) await recoverSeat(client);

    const toolCalls: ToolCallRecord[] = [];
    /** The calls Pi has started but not finished, keyed by its own call id. */
    const open = new Map<string, { tool: string; args: unknown; at: number }>();
    let compacted = false;
    /** Why the turn is ending without orders, as far as this end can tell. */
    let passed: PassReason = "no_submission";
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
          // Pi's lock-down decides what a seat can reach: a name it was not
          // given (`mcp__salient__write_notes`, `bash`) is answered "not
          // found", recorded as a refused call, and the turn goes on.
          open.set(event.toolCallId, { tool: event.toolName, args: event.args, at: performance.now() });
          break;
        }
        case "tool_execution_end": {
          // Pi reports the call id on both halves, so the pair is matched on it
          // and the wall time is measured at this end of the wire.
          const started = open.get(event.toolCallId);
          open.delete(event.toolCallId);
          const at = performance.now();
          const record: ToolCallRecord = {
            tool: started?.tool ?? event.toolName,
            args: started?.args ?? {},
            result: answerOf(event.result),
            error: event.isError,
            ms: Math.max(0, Math.round(at - (started?.at ?? at))),
          };
          toolCalls.push(record);
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
          if (budget !== null && outputTokens > budget) {
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
      try {
        const disposition = await this.command("the prompt", () => client.prompt(prompt));
        this.missedPrompt = false;
        // A prompt that Pi handled without starting a run — an extension command,
        // say — never settles, so waiting on it would hang the turn.
        if (disposition === "started") {
          const ended = await Promise.race([settled.then(() => false), seatGone.then(() => true)]);
          died = ended;
        }
      } catch (error) {
        // A seat whose process is gone is the match-level failure it has always
        // been, and `command` has already said so in the words brief §6.3 gives.
        if (error instanceof MatchVoided) throw error;
        // Anything else is a seat that is alive and did not take the question:
        // `RpcClient` waits a fixed 30 s for a response, then drops the pending
        // request and rejects, with the child running and still working. That is
        // not a death, and it is not the runner's turn cap either, so the turn is
        // passed under a reason of its own and the match goes on with the calls
        // the seat had already made. Only the client's own wait is that reason: a
        // rejection carrying Pi's error text — "Agent is already processing…" is
        // the likeliest — is a seat that answered the command to refuse it, which
        // is brief §6.3's plain pass and not a turn nobody answered.
        passed = commandTimedOut(error) ? "prompt_timeout" : "no_submission";
        // The turn is not retried, and this prompt is never sent again; the
        // seat is put back in order before the *next* turn asks it.
        this.missedPrompt = true;
        // Stop the seat, and wait for it to say it stopped, before the turn is
        // handed back. The prompt is queued inside Pi: `session.prompt()` is stuck
        // in `_checkCompaction` ahead of the `preflightResult` callback that
        // answers the command, and when that check ends — cancelled or not — the
        // run starts anyway. Left running, its tool calls and orders would be
        // counted by the listener the *next* turn installs and accepted by the
        // server as that turn's, so the log would call a turn unplayed that the
        // transcript calls played. So the seat is stopped here, and `quietTheSeat`
        // waits for the run that the stop lets go: the late run finishes inside
        // the turn that asked for it, and its calls stay in that turn's record.
        try {
          await this.command("the abort", () => client.abort());
          await this.quietTheSeat(client);
        } catch (abortError) {
          // The abort can wait the same 30 s on a late run longer than that, and
          // there is nothing further to do about it: the seat has been told to
          // stop, and `waitOutRun` has stopped it again since.
          if (abortError instanceof MatchVoided) throw abortError;
        }
      }
    } finally {
      unsubscribe();
      this.seatGone = null;
    }

    if (died) throw this.voided("harness_crash", "the seat's Pi process exited during the match");

    // The turn's figures come from the same client that just failed to answer, so
    // the same 30 s and the same non-death rejection can land here. A turn that
    // is already a pass must not be lost to a usage figure: when the seat cannot
    // say what the turn cost it, the turn is kept and its figures are missing.
    let stats: SessionStats | null = null;
    try {
      stats = await this.command("the session stats", () => client.getSessionStats());
    } catch (error) {
      if (error instanceof MatchVoided) throw error;
    }
    const previous = this.totals;
    // Only a seat that answered moves the totals the next turn is measured
    // against; a seat that could not say leaves them where they were, and the
    // turn after it carries what this one spent.
    if (stats !== null) this.totals = stats;

    // Only a call the game answered is a submission: a refused one never reached it.
    const submissions = toolCalls.filter((call) => call.tool === SUBMIT_TOOL && submissionOf(call.result) !== null);
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
      // `undefined` rather than a row of noughts, because the seat could not say
      // what the turn cost it. Note what the absence costs: `withHarness`
      // (packages/runner/src/match.ts:532-546) writes noughts for usage, cost and
      // context whenever this is absent, which is what a bot's record carries — so
      // in the log a wedged Pi seat is told from a bot only by its reason.
      provider: stats === null ? undefined : providerTurn(previous, stats, compacted),
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

  /**
   * Wait for a seat to be quiet again, after its abort has been answered.
   *
   * `session.abort()` answers as soon as the session *looks* quiet: `isIdle` is
   * "no run and no compaction" (`agent-session.js:1038-1040`), and a prompt
   * deferred behind a cancelled compaction is idle for a tick before its run
   * starts (`agent-session.js:1873-1884`). The abort alone therefore leaves a
   * window — the run appears afterwards, and its events reach whichever listener
   * is installed then, which is the next turn's. So look for the run here, while
   * this turn's listener is still installed, and wait it out: its calls land on
   * the turn that asked for them.
   *
   * Looking is sampling, not one sample: on a loaded box the run can appear
   * seconds after the abort was answered, and `vitest.config.ts` records that box
   * for this suite. Waiting it out is bounded, and a run that outlasts the bound
   * is stopped and waited on again — the second `session.abort()` finds
   * `_isAgentRunActive` true and answers only once the session has gone quiet, so
   * that stop is what usually ends it. The runner does *not* cover what is
   * left: it aborts a seat only when the turn is still pending at its own
   * deadline (`packages/runner/src/match.ts:453-457`), and this turn is
   * handed back long before that. What survives is a run that ignores an abort
   * for the whole of the second wait, and docs/pi-harness-notes.md §8 says what
   * such a turn's record is then.
   */
  private async quietTheSeat(client: RpcClient): Promise<void> {
    for (let sample = 0; sample < RUN_APPEARS_SAMPLES; sample += 1) {
      await sleep(RUN_APPEARS_MS);
      const state = await this.command("the seat's state", () => client.getState());
      if (state.isStreaming || state.isCompacting) {
        await this.waitOutRun(client);
        return;
      }
    }
  }

  /**
   * Wait for the run in flight to settle, stopping the seat when it will not.
   *
   * A stop that is answered has itself waited for the session to go quiet, so the
   * wait after it is the belt: the run may have been told to stop and still be
   * winding down. Every command is answered or timed out by the client inside
   * 30 s (`rpc-client.js:463-466`), so the whole of this is bounded — at
   * `RUN_STOPS` stops, well inside the runner's own turn cap, which matters
   * because a turn that outlasts that cap is recorded as the runner's `timeout`
   * rather than this seat's `prompt_timeout`.
   */
  private async waitOutRun(client: RpcClient): Promise<void> {
    for (let stop = 0; stop < RUN_STOPS; stop += 1) {
      if (await settlesWithin(client, RUN_SETTLES_MS)) return;
      await this.command("the abort", () => client.abort());
    }
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
