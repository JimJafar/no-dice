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
 * submission tool, in order to say whether the seat submitted.
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
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { RpcClient } from "@earendil-works/pi-coding-agent";
import type { SessionStats } from "@earendil-works/pi-coding-agent";

import { piCli } from "./pi-cli.ts";
import { createSeatHome, MCP_SERVER_NAME, type SeatHome, type SeatId } from "./pi-home.ts";
import type {
  Player,
  PlayerContext,
  ProviderTurn,
  RejectedSubmission,
  ToolCallRecord,
  TurnOutcome,
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

/** The tool as the log names it: Pi's name, without the MCP server's prefix. */
const stripPrefix = (tool: string): string =>
  tool.startsWith(TOOL_PREFIX) ? tool.slice(TOOL_PREFIX.length) : tool;

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
 * events the turn produced.
 */
const providerTurn = (
  previous: SessionStats | null,
  stats: SessionStats,
  compacted: boolean,
): ProviderTurn => ({
  usage: {
    input: delta(previous?.tokens.input ?? 0, stats.tokens.input),
    output: delta(previous?.tokens.output ?? 0, stats.tokens.output),
    cache_read: delta(previous?.tokens.cacheRead ?? 0, stats.tokens.cacheRead),
    cache_write: delta(previous?.tokens.cacheWrite ?? 0, stats.tokens.cacheWrite),
  },
  costUsd: delta(previous?.cost ?? 0, stats.cost),
  // `null` when Pi cannot say, which is what a compaction leaves behind until
  // the next assistant answer. Not folded into zero.
  contextTokens: stats.contextUsage?.tokens ?? null,
  compacted,
});

/**
 * A seat played by one Pi session that lasts the match.
 *
 * `start` writes the seat's home and spawns the pinned CLI; `playTurn` prompts
 * once and reads that turn's events; `stop` lets the process go. A turn that
 * runs out of its time, a provider that fails and a tool outside the seven are
 * the turn rules, and are not this class's business yet.
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
  }

  /**
   * Play one turn: prompt, read events until Pi settles, and turn what was seen
   * into the seat's half of a log turn.
   *
   * The listener is installed before the prompt is sent, because a stub answers
   * at once and an event that arrives between the two would be missing from the
   * turn. The prompt text is brief §6.3's, exactly: `Turn <n> of 25. Play your
   * turn.`, with nothing else, so both seats are asked identically.
   */
  async playTurn(turn: number): Promise<TurnOutcome> {
    const client = this.client;
    if (client === null) throw new Error("the player has not started");

    const toolCalls: ToolCallRecord[] = [];
    /** The calls Pi has started but not finished, keyed by its own call id. */
    const open = new Map<string, { tool: string; args: unknown; at: number }>();
    let compacted = false;
    let settle!: () => void;
    const settled = new Promise<void>((resolveSettled) => {
      settle = resolveSettled;
    });

    const unsubscribe = client.onEvent((event) => {
      switch (event.type) {
        case "tool_execution_start":
          open.set(event.toolCallId, {
            tool: event.toolName,
            args: event.args,
            at: performance.now(),
          });
          break;
        case "tool_execution_end": {
          // Pi reports the call id on both halves, so the pair is matched on it
          // and the wall time is measured at this end of the wire.
          const started = open.get(event.toolCallId);
          open.delete(event.toolCallId);
          const at = performance.now();
          toolCalls.push({
            tool: stripPrefix(started?.tool ?? event.toolName),
            args: started?.args ?? {},
            result: answerOf(event.result),
            error: event.isError,
            ms: Math.max(0, Math.round(at - (started?.at ?? at))),
          });
          break;
        }
        case "compaction_start":
        case "compaction_end":
          compacted = true;
          break;
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
      const disposition = await client.prompt(prompt);
      // A prompt that Pi handled without starting a run — an extension command,
      // say — never settles, so waiting on it would hang the turn.
      if (disposition === "started") await settled;
    } finally {
      unsubscribe();
    }

    const stats = await client.getSessionStats();
    const previous = this.totals;
    this.totals = stats;

    const submissions = toolCalls.filter((call) => call.tool === SUBMIT_TOOL);
    const last = submissions.at(-1) ?? null;
    const refused = submissions.find((call) => submissionOf(call.result)?.accepted === false) ?? null;
    const verdict = last === null ? null : submissionOf(last.result);

    return {
      turn,
      toolCalls,
      submitted: verdict?.accepted === true,
      orders: ordersOf(last?.args),
      intent: noteOf(last?.args, "intent"),
      prediction: noteOf(last?.args, "prediction"),
      rejected:
        refused === null
          ? null
          : { orders: ordersOf(refused.args), wasted: submissionOf(refused.result)?.wasted ?? [] },
      provider: providerTurn(previous, stats, compacted),
    };
  }

  /** Let the seat go. The saved session stays on disk: it is the match's transcript. */
  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client !== null) await client.stop();
  }
}
