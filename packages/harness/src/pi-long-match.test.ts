/**
 * brief §6.3's "Verify on first run" list, answered by one scripted match.
 *
 * Every earlier task in this milestone proved its piece of the Pi harness over
 * a turn or two. The checklist items left over are the ones that only go wrong
 * across a whole match: an MCP connection that is fine on turn 3 and gone by
 * turn 20, a `get_rules` result the model is still being shown on turn 25 or is
 * no longer, session stats that stop answering, a compaction that happens in
 * the middle of a match and nobody notices. So this file plays one 25-turn
 * match — a stub-model seat against Greedy, on one Pi process — and reads the
 * answers off it. `docs/pi-harness-notes.md` carries what they were, in the
 * words milestones 04 and 06 can quote.
 *
 * Three of the answers are read off the wire rather than off the turn record,
 * because the turn record cannot give them:
 *
 * - **The MCP connection.** `PiPlayer` never reconnects and the runner never
 *   re-tokens a Pi seat, but neither of those says what the seat's own MCP
 *   client did. A loopback proxy in front of the match server counts the
 *   `initialize` requests the seat sends and the session ids it uses: one of
 *   each is a connection that lasted the match, and the seat's bearer token
 *   still resolving at the end is the other half — a rotated token would have
 *   cut the seat off mid-match.
 * - **`agent_settled` once per prompt.** `PiPlayer` stops reading at the first
 *   one, so a second per prompt is invisible from a turn. `onEvent` taps the
 *   stream and the count is taken from the tap.
 * - **Compaction.** Pi's own events say it happened, and brief §6.3 asks which
 *   event RPC mode emits. The tap is what answers that; the second suite forces
 *   a compaction with a small `contextWindow` so the answer is observed rather
 *   than read out of Pi's documentation.
 *
 * The turn-25 check is a substring check on a request the stub recorded: the
 * whole `get_rules` answer of turn 1, byte for byte, has to be inside the body
 * of the last request of turn 25. The rules text is also the seat's system
 * prompt, so a phrase from it would prove nothing; the answer's `constants`,
 * `bases` and `map` are match-specific and appear nowhere else in the request.
 *
 * A Pi process is seconds to start and seconds to prompt, so 25 turns of one
 * are minutes, and every test here carries a timeout of its own.
 */
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { greedyBot } from "@no-dice/salient-bots";
import type { BotOrder } from "@no-dice/salient-bots";
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import {
  MatchServer,
  TOOL_NAMES,
  startServer,
  type RulesView,
  type RunningServer,
  type StateView,
  type TurnPlayerRecords,
} from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BotPlayer } from "./bot-player.ts";
import type { SubmitVerdict } from "./bot-player.ts";
import { PiPlayer } from "./pi-player.ts";
import type { TurnOutcome } from "./player.ts";
import { StubModel, outgrowsTheWindow, stubModelsJson } from "./stub-model.ts";
import type { StubReply, StubRequest } from "./stub-model.ts";

/** The prompt a seat is played with, which is the one the match gives it. */
const PLAYER_SYSTEM = join(import.meta.dirname, "../../../games/salient/prompts/player-system.md");

/** Turns in the match, which the per-turn prompt names. */
const TURNS = DEFAULT_CONFIG.turns;

/** The seed these matches are played on, and the map they are played on. */
const SEED = 135;

/** A 25-turn match on one Pi process: minutes, not seconds. */
const MATCH_TIMEOUT_MS = 420_000;

/**
 * The window the long match's model entry declares. Compaction stays on — it is
 * off only by being far away: the stub reports a conversation that grows by a
 * hundred tokens a request, which is nowhere near 200,000 minus Pi's 16,384
 * token reserve.
 */
const CONTEXT_WINDOW = 200_000;

/**
 * The window the compaction suite declares. Pi compacts when the conversation
 * passes the window less its reserve, so 40,000 against replies that report
 * 30,000 prompt tokens puts the line inside the first turn.
 */
const SMALL_WINDOW = 40_000;

/** Pi's own compaction reserve, which it keeps back from the window. */
const RESERVE_TOKENS = 16_384;

/** What the stub's model entry charges, so a turn has a price to read. */
const COST = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

/** A submission the server accepts: no orders, and the two notes with them. */
const SUBMISSION = {
  orders: [],
  intent: "The stub is holding still.",
  prediction: "The other seat moves east.",
};

/** The seven tools, in the order the server registers them, as the model sees them. */
const SEVEN = [...TOOL_NAMES];

/** What resolving a turn reports: the match's result, or `null` while it runs. */
type TurnResult = ReturnType<MatchServer["resolveTurn"]>["result"];

/** The text of one message of a model request, however it is shaped. */
const textOf = (message: Record<string, unknown>): string => {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .flatMap((part) => {
        const text = (part as { text?: unknown } | null)?.text;
        return typeof text === "string" ? [text] : [];
      })
      .join("");
  }
  return "";
};

/** The prompt the seat is answering: the last user message of the request. */
const lastPromptOf = (request: StubRequest): string => {
  const users = request.messages.filter((message) => message.role === "user");
  const last = users.at(-1);
  return last === undefined ? "" : textOf(last);
};

/** The tools the seat called after the prompt it is now answering. */
const toolsSincePrompt = (request: StubRequest): string[] => {
  const roles = request.messages.map((message) => message.role);
  const since = request.messages.slice(roles.lastIndexOf("user") + 1);
  return since.flatMap((message) => {
    const calls = message.tool_calls;
    if (!Array.isArray(calls)) return [];
    return calls.flatMap((call) => {
      const name = (call as { function?: { name?: unknown } } | null)?.function?.name;
      return typeof name === "string" ? [name] : [];
    });
  });
};

/** Every tool result the seat was shown, as the text it was shown them in. */
const toolResultsOf = (request: StubRequest): string =>
  request.messages
    .filter((message) => message.role === "tool")
    .map((message) => textOf(message))
    .join("\n");

/**
 * The scripted model of the long match: the rules once, on turn 1, then the
 * board, a submission, and a sentence to settle on.
 *
 * The phase is read from the request rather than counted from the first, because
 * a match is a hundred requests long and a count that slips by one scripts every
 * later turn wrong.
 */
const playsEveryTurn = (request: StubRequest): StubReply => {
  const called = toolsSincePrompt(request);
  if (called.includes("submit_orders")) {
    return { text: "I have submitted. I will hold this line." };
  }
  if (
    lastPromptOf(request) === `Turn 1 of ${String(TURNS)}. Play your turn.` &&
    !called.includes("get_rules")
  ) {
    return { toolCalls: [{ name: "get_rules", args: {} }] };
  }
  if (!called.includes("get_state")) {
    return { toolCalls: [{ name: "get_state", args: {} }] };
  }
  return { toolCalls: [{ name: "submit_orders", args: SUBMISSION }] };
};

/**
 * How a Salient submission's answer reads to the harness: the orders stand when
 * the server says they do, and the one resubmission carries them with the
 * refused ones taken out. Same reading the runner uses; the harness cannot
 * import the runner's, because the runner depends on the harness.
 */
const acceptedOrRetry = (result: unknown, sent: BotOrder[]): SubmitVerdict<BotOrder> => {
  const key = (order: BotOrder): string => `${order.from}>${order.to}:${String(order.troops)}`;
  const answer = (result ?? {}) as { accepted?: boolean; wasted?: { order: BotOrder; reason: string }[] };
  if (answer.accepted === true) return { accepted: true, rejected: null, retry: [] };
  if (answer.wasted === undefined) return { accepted: false, rejected: null, retry: [] };
  const refused = new Set(answer.wasted.map((each) => key(each.order)));
  return {
    accepted: false,
    rejected: { orders: sent, wasted: answer.wasted },
    retry: sent.filter((order) => !refused.has(key(order))),
  };
};

/**
 * A loopback proxy in front of the match server that counts the MCP traffic on
 * one seat's connection: how many MCP sessions it opened — a request with no
 * `mcp-session-id` is an `initialize`, which is what opens one — and how many
 * distinct session ids it went on using.
 *
 * The server keeps its sessions to itself and `PiPlayer` has no reason to look,
 * so nothing on the inside can say whether the seat's MCP client reconnected
 * halfway through the match. Brief §6.3's checklist asks, and the wire is the
 * only place the answer is.
 */
interface McpWatcher {
  /** The URL to point a seat at instead of the server's own. */
  url: string;
  /** How many MCP sessions were opened through here: one per connection. */
  sessionsOpened(): number;
  /** The distinct `mcp-session-id` values that came through here. */
  sessionIds(): string[];
  /** How many requests came through here, so a zero means nothing was wired up. */
  requests(): number;
  close(): Promise<void>;
}

const watchMcp = async (upstream: string): Promise<McpWatcher> => {
  const target = new URL(upstream);
  const ids = new Set<string>();
  let opened = 0;
  let requests = 0;

  const listener = createServer((req, res) => {
    requests += 1;
    const id = req.headers["mcp-session-id"];
    if (typeof id === "string") ids.add(id);
    else opened += 1;
    const onward = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    onward.on("error", () => {
      // The seat is told the endpoint went away rather than left hanging.
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      if (!res.writableEnded) res.end();
    });
    req.pipe(onward);
  });

  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });
  const bound = listener.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(bound.port)}${target.pathname}`,
    sessionsOpened: () => opened,
    sessionIds: () => [...ids].sort(),
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve) => {
        // The seat's SSE stream is a connection that never ends on its own.
        listener.closeAllConnections();
        listener.close(() => resolve());
      }),
  };
};

/** The session files Pi has saved in a seat's session directory. */
const sessionsIn = (sessionDir: string): string[] =>
  readdirSync(sessionDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort();

describe("one Pi session plays a whole 25-turn match against Greedy", () => {
  let matchDir: string;
  let matches: MatchServer;
  let running: RunningServer;
  let watcher: McpWatcher;
  let stub: StubModel;
  let pi: PiPlayer;
  let bot: BotPlayer<RulesView, StateView, BotOrder>;
  let matchId: string;
  let tokens: Record<Seat, string>;
  /** What the seat reported for each turn, in turn order. */
  const outcomes: TurnOutcome[] = [];
  /** What the server recorded for each turn, in turn order. */
  const records: TurnPlayerRecords[] = [];
  /** What resolving each turn reported: `null` while the match is still running. */
  const results: TurnResult[] = [];
  /** Every RPC event the seat's session put on stdout, in order. */
  const events: unknown[] = [];

  beforeAll(async () => {
    matchDir = mkdtempSync(join(tmpdir(), "no-dice-pi-long-"));
    matches = new MatchServer();
    running = await startServer({ matches, port: 0 });
    watcher = await watchMcp(running.url);

    const created = matches.createMatch(SEED, DEFAULT_CONFIG);
    matchId = created.matchId;
    tokens = created.tokens;

    stub = await StubModel.start(playsEveryTurn, { contextWindow: CONTEXT_WINDOW, cost: COST });
    pi = new PiPlayer({
      seat: "A",
      matchDir,
      model: stub.modelRef,
      thinking: "off",
      systemPrompt: PLAYER_SYSTEM,
      turns: TURNS,
      modelsJson: stubModelsJson(stub.baseUrl, { contextWindow: CONTEXT_WINDOW, cost: COST }),
      // The seat reaches the stub over loopback and nothing else.
      env: { PI_OFFLINE: "1" },
      onEvent: (event) => {
        events.push(event);
      },
    });
    bot = new BotPlayer<RulesView, StateView, BotOrder>({
      tools: { rules: "get_rules", state: "get_state", submit: "submit_orders" },
      decide: greedyBot(),
      verdict: acceptedOrRetry,
    });

    // The seat's MCP connection is watched, so it is the one that goes through
    // the proxy; Greedy reaches the server directly.
    await pi.start({ serverUrl: watcher.url, token: tokens.A });
    await bot.start({ serverUrl: running.url, token: tokens.B });

    for (let turn = 1; turn <= TURNS; turn++) {
      matches.openTurn(matchId);
      const [seatA, seatB] = await Promise.all([pi.playTurn(turn), bot.playTurn(turn)]);
      outcomes.push(seatA);
      expect(seatB.submitted).toBe(true);
      results.push(matches.resolveTurn(matchId).result);
      records.push(matches.turnRecord(matchId, turn));
    }

    await pi.stop();
    await bot.stop();
    await stub.stop();
    await watcher.close();
    await running.close();
  }, MATCH_TIMEOUT_MS);

  afterAll(async () => {
    rmSync(matchDir, { recursive: true, force: true });
  });

  it("plays every turn, and the server holds a record of each one", () => {
    expect(outcomes).toHaveLength(TURNS);
    expect(records).toHaveLength(TURNS);

    for (const [index, record] of records.entries()) {
      const turn = index + 1;
      // The seat played the turn the way the rules ask: the rules once, on the
      // turn it was asked for them, then the board and a submission every turn.
      const called = record.A.tool_calls.map((call) => call.tool);
      expect(called).toEqual(
        turn === 1 ? ["get_rules", "get_state", "submit_orders"] : ["get_state", "submit_orders"],
      );
      // A turn the server holds a submission for is a turn that was played, not
      // a pass, and the seat agrees.
      expect(record.A.passed).toBeNull();
      expect(outcomes[index].submitted).toBe(true);
      expect(outcomes[index].passed).toBeNull();
      expect(outcomes[index].toolCalls.map((call) => call.tool)).toEqual(called);
      // Greedy played its half of every turn too, so the match was a match.
      expect(record.B.tool_calls.length).toBeGreaterThan(0);
      expect(record.B.passed).toBeNull();
    }

    // One Pi process played all of it: one transcript in the seat's session
    // directory, and one session file grown over the match rather than 25.
    expect(sessionsIn(pi.seatHome.sessionDir)).toHaveLength(1);

    // And the fixture is the match it claims to be: Greedy took the score 89 to
    // 1 against a stub that never moved, but nothing ended it early, so all 25
    // turns were played.
    expect(results.slice(0, TURNS - 1)).toEqual(new Array<TurnResult>(TURNS - 1).fill(null));
    expect(results.at(-1)).toMatchObject({ type: "time", winner: "B", turn: TURNS });
  });

  it("kept one MCP connection and one seat token for all 25 turns", () => {
    // Every tool call of the match went through the watched connection, and the
    // connection was opened once: one `initialize`, one session id, for a seat
    // that called the tools 51 times over 25 turns. A reconnect — a session the
    // MCP client quietly replaced — would show up here as a second id, and no
    // part of the match would notice on its own.
    const calls = records.reduce((total, record) => total + record.A.tool_calls.length, 0);
    expect(calls).toBe(3 + 2 * (TURNS - 1));
    expect(watcher.requests()).toBeGreaterThanOrEqual(calls);
    expect(watcher.sessionsOpened()).toBe(1);
    expect(watcher.sessionIds()).toHaveLength(1);

    // And the identity that connection was made with is still the seat's: a
    // runner that re-tokens a Pi seat cuts it off from its own match, which is
    // why `PiPlayer` refuses one and this never happens.
    expect(matches.resolveToken(tokens.A)).toEqual({ matchId, seat: "A" });
  });

  it("settles exactly once per prompt, and never offered a tool outside the seven", () => {
    const settled = events.filter((event) => (event as { type?: string }).type === "agent_settled");
    // One per prompt, no more: `PiPlayer` stops reading at the first, so a
    // second one for the same prompt would be a turn that ended and Pi going on.
    expect(settled).toHaveLength(TURNS);

    // The lock-down held for the whole match, not just for the first request:
    // every request the seat's model was sent carried exactly the seven tools.
    // Three requests a turn — the board, the submission, the sentence that
    // settles it — and a fourth on turn 1 for the rules.
    expect(stub.recorded.length).toBe(TURNS * 3 + 1);
    for (const request of stub.recorded) {
      expect(request.toolNames).toEqual(SEVEN);
    }
    for (const record of records) {
      // What the server logged is spelled without the MCP prefix it was called
      // through, and is still one of the seven.
      for (const call of record.A.tool_calls) expect(TOOL_NAMES).toContain(call.tool);
    }
  });

  it("answers get_session_stats with contextUsage on every turn", () => {
    for (const [index, outcome] of outcomes.entries()) {
      const provider = outcome.provider;
      expect(provider).toBeDefined();
      // `contextUsage.tokens` is `null` when Pi cannot say, which is what a
      // compaction leaves behind. On a match that never compacted it answers
      // every turn.
      expect(provider?.contextTokens).not.toBeNull();
      expect(provider?.contextWindow).toBe(CONTEXT_WINDOW);
      expect(provider?.usage.input).toBeGreaterThan(0);
      expect(provider?.usage.output).toBeGreaterThan(0);
      expect(provider?.compacted).toBe(false);
      // The conversation is kept, so the context the seat reports grows rather
      // than starting again each turn.
      if (index > 0) {
        expect(provider?.contextTokens ?? 0).toBeGreaterThan(
          outcomes[index - 1].provider?.contextTokens ?? 0,
        );
      }
    }
  });

  it("still shows turn 1's get_rules result in turn 25's request, with no compaction", () => {
    // The whole answer, as the server wrote it: `rules`, `constants`, `bases`
    // and `map`. The rules text is also the seat's system prompt, so it proves
    // nothing on its own; the map and the bases are this match's and appear
    // nowhere else in the request.
    const rulesAnswer = records[0].A.tool_calls[0].result;
    const fingerprint = JSON.stringify(rulesAnswer);
    expect(fingerprint).toContain('"bases"');
    expect(fingerprint).toContain('"map"');

    const lastRequest = stub.recorded.at(-1);
    expect(lastRequest).toBeDefined();
    // The last request of the last turn is still answering that turn — it is the
    // reply that settles the seat — and it is turn 25's.
    expect(lastPromptOf(lastRequest!)).toContain(`Turn ${String(TURNS)} of ${String(TURNS)}.`);
    expect(toolResultsOf(lastRequest!)).toContain(fingerprint);

    // And it is still there because nothing threw the older turns away: no
    // compaction event crossed the tap, and no turn reported one.
    const compactions = events.filter(
      (event) =>
        (event as { type?: string }).type === "compaction_start" ||
        (event as { type?: string }).type === "compaction_end",
    );
    expect(compactions).toEqual([]);
    for (const outcome of outcomes) expect(outcome.provider?.compacted).toBe(false);

    // Every turn's prompt is still in the conversation turn 25 was sent with:
    // the match is one continuous game, and a pass or a compaction is the only
    // thing that would take an earlier turn out of it.
    for (let turn = 1; turn <= TURNS; turn++) {
      expect(JSON.stringify(lastRequest!.body)).toContain(
        `Turn ${String(turn)} of ${String(TURNS)}. Play your turn.`,
      );
    }
  });
});

describe("a seat whose conversation outgrows its window", () => {
  let matchDir: string;
  let matches: MatchServer;
  let running: RunningServer;
  let stub: StubModel;
  let pi: PiPlayer;
  let matchId: string;
  let tokens: Record<Seat, string>;
  /** Every RPC event the seat's session put on stdout, in order. */
  const events: Record<string, unknown>[] = [];
  let first: TurnOutcome;
  let second: TurnOutcome;

  beforeAll(async () => {
    matchDir = mkdtempSync(join(tmpdir(), "no-dice-pi-compact-"));
    matches = new MatchServer();
    running = await startServer({ matches, port: 0 });
    const created = matches.createMatch(SEED, { ...DEFAULT_CONFIG, turns: 2 });
    matchId = created.matchId;
    tokens = created.tokens;

    // `outgrowsTheWindow` is the script that crosses the line: Pi's threshold is
    // `contextWindow - 16384`, but the cut point also has to fall somewhere, so
    // the bulk is in the reply's text as well as in the tokens it reports. Its
    // fourth entry answers the summarisation call, which is why the script is
    // re-armed before the second turn.
    stub = await StubModel.start(outgrowsTheWindow(), { contextWindow: SMALL_WINDOW, cost: COST });
    pi = new PiPlayer({
      seat: "A",
      matchDir,
      model: stub.modelRef,
      thinking: "off",
      systemPrompt: PLAYER_SYSTEM,
      turns: 2,
      modelsJson: stubModelsJson(stub.baseUrl, { contextWindow: SMALL_WINDOW, cost: COST }),
      env: { PI_OFFLINE: "1" },
      onEvent: (event) => {
        events.push(event as Record<string, unknown>);
      },
    });
    await pi.start({ serverUrl: running.url, token: tokens.A });

    matches.openTurn(matchId);
    first = await pi.playTurn(1);
    matches.resolveTurn(matchId);
    matches.openTurn(matchId);
    stub.setScript(outgrowsTheWindow());
    second = await pi.playTurn(2);
    matches.resolveTurn(matchId);

    await pi.stop();
    await stub.stop();
    await running.close();
  }, MATCH_TIMEOUT_MS);

  afterAll(async () => {
    rmSync(matchDir, { recursive: true, force: true });
  });

  it("announces the compaction on the RPC stream, and marks the turn it happened in", () => {
    // What brief §6.3 asks — which event, if any, RPC mode emits — answered from
    // the stream: both halves arrive, and `reason` says which of Pi's triggers
    // fired. A window smaller than the conversation is a threshold, not an
    // overflow the provider had to report.
    const compactions = events.filter(
      (event) => event.type === "compaction_start" || event.type === "compaction_end",
    );
    // Twice, because the seat is still overflowing on turn 2: compaction is not
    // a one-off that a session gets credit for, and a seat that keeps spending
    // its window keeps paying for it.
    expect(compactions.map((event) => event.type)).toEqual([
      "compaction_start",
      "compaction_end",
      "compaction_start",
      "compaction_end",
    ]);
    for (const event of compactions) expect(event.reason).toBe("threshold");
    // `compaction_end` carries the summary it wrote and what it cost, and says
    // the compaction was neither aborted nor followed by a retry of the turn.
    const result = compactions[1].result as { summary: string; tokensBefore: number };
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.tokensBefore).toBeGreaterThan(SMALL_WINDOW - RESERVE_TOKENS);
    expect(compactions[1].aborted).toBe(false);
    expect(compactions[1].willRetry).toBe(false);

    // The turns the harness hands the runner say so too, which is what milestone
    // 04 counts compaction turns with — and Pi can no longer say how big the
    // conversation is, so the seat reports no context size for them.
    expect(first.provider?.compacted).toBe(true);
    expect(first.provider?.contextTokens).toBeNull();
    expect(second.provider?.compacted).toBe(true);
  });

  it("keeps the seat in the match through it", () => {
    // Compaction is neither a pass nor a void: the seat is prompted again next
    // turn on the session the summary replaced the older turns with, and plays
    // that turn like any other.
    expect(second.submitted).toBe(true);
    expect(second.passed).toBeNull();
    expect(matches.turnRecord(matchId, 2).A.passed).toBeNull();
    expect(sessionsIn(pi.seatHome.sessionDir)).toHaveLength(1);
    // The older turns are gone from the conversation now — that is what the
    // summary is for — which is why the turn-25 check above is a check that
    // compaction had *not* run.
    const last = stub.recorded.at(-1);
    expect(last).toBeDefined();
    expect(JSON.stringify(last!.body)).not.toContain("Turn 1 of 2. Play your turn.");
  });
});
