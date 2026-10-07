/**
 * A seat played by a headless Pi session in RPC mode.
 *
 * Brief §6.4 puts `Player` between the runner and a seat so the loop cannot
 * tell a model seat from a bot seat, so these tests hold `PiPlayer` to what
 * `BotPlayer` already reports — the same tool names, the same answers parsed
 * back to values — and then check what only a provider run can report: the
 * tokens, cost and context size of the turn, worked out from a session that
 * runs the whole match.
 *
 * A real Pi process is spawned for each seat here, which is why every test
 * carries a timeout of its own: starting one takes seconds, not milliseconds.
 * The model is still `StubModel` on loopback, so no credential is needed and no
 * provider is called. One test asks no turn at all: a seat names the context
 * window its model is played with as soon as its session is up.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { MatchServer, startServer, type RunningServer } from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PiPlayer } from "./pi-player.ts";
import type { PiPlayerOptions } from "./pi-player.ts";
import type { ProviderTurn, TurnOutcome } from "./player.ts";
import {
  STUB_MODEL_ID,
  STUB_PROVIDER,
  StubModel,
  callsToolThenSubmits,
  salientToolName,
  stubModelsJson,
} from "./stub-model.ts";
import type { StubReply, StubRequest, StubScript } from "./stub-model.ts";

/** The prompt a seat is played with, which is the one the match gives it. */
const PLAYER_SYSTEM = join(import.meta.dirname, "../../../games/salient/prompts/player-system.md");

/** A seat's turn means a Pi process: seconds to start, seconds to answer. */
const SEAT_TIMEOUT_MS = 120_000;

/** A reply's four token counts, all of them named, so the sums below are exact. */
type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** What every reply of these tests reports, so a turn's figures are exact. */
const USAGE: Tokens = { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 };

/** What the turn after it reports: a conversation that has grown since. */
const GROWN_USAGE: Tokens = { input: 400, output: 20, cacheRead: 5, cacheWrite: 1 };

/** What the seat's model entry charges, in US dollars per million tokens. */
const COST = { input: 1, output: 2, cacheRead: 4, cacheWrite: 8 };

/** What one reply costs at those rates, which is how Pi works it out. */
const costOf = (usage: Tokens): number =>
  (usage.input * COST.input +
    usage.output * COST.output +
    usage.cacheRead * COST.cacheRead +
    usage.cacheWrite * COST.cacheWrite) /
  1_000_000;

/** The same scripted turn, with every reply reporting the same tokens. */
const withUsage = (replies: StubReply[], usage: Tokens): StubReply[] =>
  replies.map((reply) => ({ ...reply, usage }));

/** What a request's user messages said, whether they came as text or as parts. */
const userTexts = (request: StubRequest): string[] =>
  request.messages
    .filter((message) => message.role === "user")
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return content
        .flatMap((part) => {
          if (typeof part !== "object" || part === null) return [];
          const block = part as { type?: unknown; text?: unknown };
          return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
        })
        .join("");
    });

/** A Pi seat always reports its provider run, so the tests read it as a fact. */
const providerOf = (outcome: TurnOutcome): ProviderTurn => {
  const provider = outcome.provider;
  if (provider === undefined) throw new Error(`turn ${String(outcome.turn)} reported no provider run`);
  return provider;
};

describe("a seat played by a headless Pi session", () => {
  const matches = new MatchServer();
  let running: RunningServer;
  let matchId: string;
  let tokens: Record<Seat, string>;
  /** The turn the match is on, so a test can ask for the next one. */
  let turn = 0;
  const stubs: StubModel[] = [];
  const players: PiPlayer[] = [];
  const matchDirs: string[] = [];

  beforeAll(async () => {
    running = await startServer({ matches, port: 0 });
    const created = matches.createMatch(135, DEFAULT_CONFIG);
    matchId = created.matchId;
    tokens = created.tokens;
    matches.openTurn(matchId);
    turn = 1;
  }, SEAT_TIMEOUT_MS);

  afterAll(async () => {
    // A Pi child left running keeps the test process alive, and a match server
    // left listening keeps its port.
    for (const player of players) await player.stop();
    for (const stub of stubs) await stub.stop();
    await running.close();
    for (const dir of matchDirs) rmSync(dir, { recursive: true, force: true });
  }, SEAT_TIMEOUT_MS);

  /** Resolve the turn in play and open the one after it, and say which that is. */
  const nextTurn = (): number => {
    matches.resolveTurn(matchId);
    matches.openTurn(matchId);
    turn += 1;
    return turn;
  };

  /** The scripted model one seat plays, stopped when the test is over. */
  const startStub = async (script: StubScript): Promise<StubModel> => {
    const stub = await StubModel.start(script, { cost: COST });
    stubs.push(stub);
    return stub;
  };

  /**
   * Seat `seat` at the table: its own directories, its own endpoint, and the
   * pinned Pi started against them.
   */
  const startSeat = async (
    seat: Seat,
    stub: StubModel,
    options: Partial<PiPlayerOptions> = {},
  ): Promise<PiPlayer> => {
    const matchDir = mkdtempSync(join(tmpdir(), "no-dice-pi-player-"));
    matchDirs.push(matchDir);
    const player = new PiPlayer({
      seat,
      matchDir,
      model: stub.modelRef,
      thinking: "off",
      systemPrompt: PLAYER_SYSTEM,
      modelsJson: stubModelsJson(stub.baseUrl, { cost: COST }),
      // The seat reaches `StubModel` over loopback and nothing else.
      env: { PI_OFFLINE: "1" },
      ...options,
    });
    players.push(player);
    await player.start({ serverUrl: running.url, token: tokens[seat] });
    return player;
  };

  it(
    "plays a turn whose tool calls are the ones the match server recorded, in the same order",
    async () => {
      const stub = await startStub(callsToolThenSubmits("scout", { hex: "F6" }));
      const player = await startSeat("A", stub);

      const outcome = await player.playTurn(turn);

      expect(outcome.turn).toBe(turn);
      // Pi names an MCP tool `mcp__salient__scout`; the log names it `scout`.
      expect(outcome.toolCalls.map((call) => call.tool)).toEqual(["scout", "submit_orders"]);
      expect(matches.turnRecord(matchId, turn).A.tool_calls.map((call) => call.tool)).toEqual([
        "scout",
        "submit_orders",
      ]);

      const [scout, submit] = outcome.toolCalls;
      expect(scout.args).toEqual({ hex: "F6" });
      // The JSON text the server answered with, read back as a value.
      expect((scout.result as { hexes: unknown[] }).hexes).toHaveLength(5);
      expect(scout.error).toBe(false);
      expect(scout.ms).toBeGreaterThanOrEqual(0);
      expect(submit.result).toEqual({ accepted: true });

      expect(outcome.submitted).toBe(true);
      expect(outcome.orders).toEqual([]);
      expect(outcome.intent).toBe("The stub is holding still.");
      expect(outcome.prediction).toBe("The other seat moves east.");
      expect(outcome.rejected).toBeNull();
      expect(matches.status(matchId).submitted).toEqual({ A: true, B: false });

      // Brief §6.3's per-turn message, and nothing else in front of it.
      const first = stub.recorded[0];
      expect(userTexts(first)).toEqual(["Turn 1 of 25. Play your turn."]);
      expect(first.systemPrompts).toHaveLength(1);
      expect(first.systemPrompts[0]).toContain("You act only through the salient tools.");

      // And its lock-down reaches the child: the model is offered the match's
      // seven tools and nothing else — no `read`, no `bash`, no `edit` — and it
      // is offered the model under test, from the seat's own `models.json`.
      expect(first.toolNames).toHaveLength(7);
      expect(first.toolNames.every((name) => name.startsWith("mcp__salient__"))).toBe(true);
      expect(first.body.model).toBe(STUB_MODEL_ID);

      const provider = providerOf(outcome);
      expect(provider.usage.input).toBeGreaterThan(0);
      expect(provider.usage.output).toBeGreaterThan(0);
      expect(provider.costUsd).toBeGreaterThan(0);
      expect(provider.contextTokens).toBeGreaterThan(0);
      expect(provider.compacted).toBe(false);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "names the context window its model is played with before a turn has been played",
    async () => {
      // The window is a property of the model entry, and Pi resolves the model
      // when the session starts, so a seat can say what window it is played with
      // before any turn has settled. That is what lets a match in which no seat
      // ever finished a turn — every turn aborted on its deadline — still carry
      // the window in its header.
      const stub = await startStub(callsToolThenSubmits("get_state"));
      const player = await startSeat("A", stub, {
        // The window the seat's own `models.json` declares, which is the one Pi
        // resolves its model against and the one the seat has to name.
        modelsJson: stubModelsJson(stub.baseUrl, { cost: COST, contextWindow: 40_000 }),
      });

      expect(player.contextWindow()).toBe(40_000);

      // And it says the same after a turn as the turn's own stats report, so the
      // two sources of the number cannot disagree.
      const played = await player.playTurn(turn);
      expect(providerOf(played).contextWindow).toBe(40_000);
      expect(player.contextWindow()).toBe(40_000);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it("names no window for a seat whose session has not started", () => {
    // Nothing is guessed here. A seat that has not started its Pi session has
    // never been told a window, and says so; the log's header turns that into a
    // refusal rather than a number no seat ran with.
    const player = new PiPlayer({
      seat: "A",
      // Never used: this seat never starts, so it writes no home.
      matchDir: join(tmpdir(), "no-dice-pi-player-unstarted"),
      model: `${STUB_PROVIDER}/${STUB_MODEL_ID}`,
      thinking: "off",
      systemPrompt: PLAYER_SYSTEM,
    });

    expect(player.contextWindow()).toBeNull();
  });

  it(
    "reports a turn's usage, cost and context as that turn's, not the session's running total",
    async () => {
      const script = withUsage(callsToolThenSubmits("get_state"), USAGE);
      const stub = await startStub(script);
      const player = await startSeat("B", stub);

      const beforeFirst = stub.requestCount;
      const first = await player.playTurn(turn);
      const firstRequests = stub.requestCount - beforeFirst;

      nextTurn();
      stub.setScript(withUsage(callsToolThenSubmits("get_state"), GROWN_USAGE));
      const beforeSecond = stub.requestCount;
      const second = await player.playTurn(turn);
      const secondRequests = stub.requestCount - beforeSecond;

      // One Pi session plays both turns, so its stats are cumulative and a turn
      // is the difference. `firstRequests + secondRequests` is what the session
      // had spent by the end of the second turn.
      expect(firstRequests).toBeGreaterThan(0);
      expect(secondRequests).toBeGreaterThan(0);
      expect(providerOf(first).usage).toEqual({
        input: USAGE.input * firstRequests,
        output: USAGE.output * firstRequests,
        cache_read: USAGE.cacheRead * firstRequests,
        cache_write: USAGE.cacheWrite * firstRequests,
      });
      expect(providerOf(second).usage).toEqual({
        input: GROWN_USAGE.input * secondRequests,
        output: GROWN_USAGE.output * secondRequests,
        cache_read: GROWN_USAGE.cacheRead * secondRequests,
        cache_write: GROWN_USAGE.cacheWrite * secondRequests,
      });
      expect(providerOf(second).usage.input).toBeLessThan(
        GROWN_USAGE.input * (firstRequests + secondRequests),
      );

      expect(providerOf(first).costUsd).toBeCloseTo(costOf(USAGE) * firstRequests, 9);
      expect(providerOf(second).costUsd).toBeCloseTo(costOf(GROWN_USAGE) * secondRequests, 9);

      // The conversation the second turn was played with is the first turn plus
      // more of it, and the seat can say how big it is.
      const firstContext = providerOf(first).contextTokens;
      const secondContext = providerOf(second).contextTokens;
      expect(firstContext).not.toBeNull();
      expect(secondContext).not.toBeNull();
      expect(secondContext).toBeGreaterThan(firstContext ?? 0);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "plays both turns in one Pi session, whose saved session grows between them",
    async () => {
      const stub = await startStub(withUsage(callsToolThenSubmits("get_state"), USAGE));
      const player = await startSeat("A", stub);
      const sessionDir = player.seatHome.sessionDir;

      const firstTurn = turn;
      const first = await player.playTurn(firstTurn);
      const sessionsAfterFirst = sessionsIn(sessionDir);
      const bytesAfterFirst = totalBytes(sessionDir);

      nextTurn();
      stub.setScript(withUsage(callsToolThenSubmits("get_state"), USAGE));
      const second = await player.playTurn(turn);

      // One session, not one per turn: the same single transcript file, grown.
      expect(sessionsAfterFirst).toHaveLength(1);
      expect(sessionsIn(sessionDir)).toEqual(sessionsAfterFirst);
      expect(totalBytes(sessionDir)).toBeGreaterThan(bytesAfterFirst);

      // And the second turn was asked with the first turn still in front of it.
      expect(JSON.stringify(stub.lastRequest?.body)).toContain(
        `Turn ${String(firstTurn)} of 25. Play your turn.`,
      );
      expect(first.toolCalls.map((call) => call.tool)).toEqual(["get_state", "submit_orders"]);
      expect(second.toolCalls.map((call) => call.tool)).toEqual(["get_state", "submit_orders"]);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "records a submission the server refused, and the one the seat sent after it",
    async () => {
      const badOrder = { from: "A1", to: "Z9", troops: 1 };
      const stub = await startStub([
        {
          toolCalls: [
            {
              name: salientToolName("submit_orders"),
              args: { orders: [badOrder], intent: "Trying an impossible move.", prediction: "Refused." },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: salientToolName("submit_orders"),
              args: { orders: [], intent: "Holding still instead.", prediction: "Nothing moves." },
            },
          ],
        },
        { text: "I am holding still." },
      ]);
      const player = await startSeat("B", stub);

      const outcome = await player.playTurn(turn);

      expect(outcome.toolCalls.map((call) => call.tool)).toEqual(["submit_orders", "submit_orders"]);
      // A refusal is an answer, not a failed call: the server says so in the result.
      expect(outcome.toolCalls[0].error).toBe(false);
      const refusal = { order: badOrder, reason: "unknown hex" };
      expect(outcome.toolCalls[0].result).toEqual({ accepted: false, wasted: [refusal] });
      expect(outcome.rejected).toEqual({ orders: [badOrder], wasted: [refusal] });
      expect(outcome.submitted).toBe(true);
      expect(outcome.intent).toBe("Holding still instead.");
      expect(matches.turnRecord(matchId, turn).B.tool_calls.map((call) => call.tool)).toEqual([
        "submit_orders",
        "submit_orders",
      ]);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );
});

/** The session files Pi has saved, which is one per session the seat has had. */
const sessionsIn = (sessionDir: string): string[] =>
  readdirSync(sessionDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort();

/** What those files weigh between them, which is how much of the match is written down. */
const totalBytes = (sessionDir: string): number =>
  sessionsIn(sessionDir).reduce((total, entry) => total + statSync(join(sessionDir, entry)).size, 0);
