/**
 * A bot played the way a model is played: through ordinary MCP calls.
 *
 * The point of the harness is that a bot is not privileged. It reaches the
 * server over the same transport, is answered by the same tools, is counted by
 * the same limits and reports the same transcript, so a bot-versus-bot match
 * exercises the surface a model will meet. These tests pin that down from both
 * sides: what the player reports calling, and what the server recorded being
 * called.
 *
 * The first suite drives the real Salient server over Streamable HTTP, which is
 * how a real match runs. The second drives a three-tool game over an in-memory
 * transport, which is the same code path without a socket, and is where the
 * resubmission is put under test — a scripted game can refuse a submission on
 * cue, and can refuse the resubmission too.
 */
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { greedyBot } from "@no-dice/salient-bots";
import type { Bot, BotOrder } from "@no-dice/salient-bots";
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import {
  MatchServer,
  startServer,
  type RulesView,
  type RunningServer,
  type StateView,
} from "@no-dice/salient-server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { BotPlayer } from "./bot-player";
import type { BotPlayerOptions, SubmitVerdict } from "./bot-player";

/**
 * How a game that answers `{ accepted, wasted }` reads to the harness: the
 * submission stands when the server says it does, and the one resubmission
 * carries the same orders with the refused ones taken out.
 *
 * Both games here answer that shape, which is what the Salient server answers
 * (brief §6.2), so one reading serves both.
 */
const acceptedOrRetry = <Order extends { from: string; to: string; troops: number }>(
  result: unknown,
  sent: Order[],
): SubmitVerdict<Order> => {
  const key = (order: Order): string => `${order.from}>${order.to}:${String(order.troops)}`;
  const answer = (result ?? {}) as { accepted?: boolean; wasted?: { order: Order; reason: string }[] };
  if (answer.accepted === true) return { accepted: true, rejected: null, retry: [] };
  if (answer.wasted === undefined) return { accepted: false, rejected: null, retry: [] };
  const refused = new Set(answer.wasted.map((each) => key(each.order)));
  return {
    accepted: false,
    rejected: { orders: sent, wasted: answer.wasted },
    retry: sent.filter((order) => !refused.has(key(order))),
  };
};

/** The Salient surface: the three tools a bot plays a turn with, and the bot itself. */
const salient = (bot: Bot): BotPlayerOptions<RulesView, StateView, BotOrder> => ({
  tools: { rules: "get_rules", state: "get_state", submit: "submit_orders" },
  decide: (rules, state) => bot(rules, state),
  verdict: acceptedOrRetry,
});

describe("a bot over Streamable HTTP against the Salient server", () => {
  /** Every match these tests play, and the endpoint they reach it on. */
  let matches: MatchServer;
  let running: RunningServer;
  /** Every player a test connected, so they are all shut before the run ends. */
  const players: BotPlayer<RulesView, StateView, BotOrder>[] = [];

  beforeAll(async () => {
    matches = new MatchServer();
    running = await startServer({ matches, port: 0 });
  });

  afterEach(async () => {
    await Promise.all(players.splice(0).map((player) => player.stop()));
  });

  afterAll(async () => {
    await running.close();
  });

  /** Seat A of a fresh match on `seed`, with its first turn open and its player connected. */
  const seatA = async (seed: number): Promise<{ matchId: string; player: BotPlayer<RulesView, StateView, BotOrder> }> => {
    const { matchId, tokens } = matches.createMatch(seed, DEFAULT_CONFIG);
    matches.openTurn(matchId);
    const player = new BotPlayer(salient(greedyBot()));
    players.push(player);
    await player.start({ serverUrl: running.url, token: tokens.A });
    return { matchId, player };
  };

  it("plays a turn end to end, and reports the calls the server recorded", async () => {
    const { matchId, player } = await seatA(135);

    const outcome = await player.playTurn(1);
    const recorded = matches.turnRecord(matchId, 1).A;

    expect(outcome.turn).toBe(1);
    expect(outcome.submitted).toBe(true);
    expect(outcome.rejected).toBeNull();
    expect(outcome.toolCalls.map((call) => call.tool)).toEqual([
      "get_rules",
      "get_state",
      "submit_orders",
    ]);
    // The server saw exactly what the player says it saw: same tools, same
    // arguments, same answers, in the same order.
    expect(recorded.tool_calls.map((call) => call.tool)).toEqual(
      outcome.toolCalls.map((call) => call.tool),
    );
    for (const [i, call] of outcome.toolCalls.entries()) {
      expect(recorded.tool_calls[i]).toEqual({
        tool: call.tool,
        args: call.args,
        result: call.result,
        error: call.error,
        ms: expect.any(Number),
      });
      expect(Number.isInteger(call.ms)).toBe(true);
      expect(call.ms).toBeGreaterThanOrEqual(0);
    }
    // And what it played is what the server holds for the log.
    expect(outcome.orders).toEqual(recorded.orders);
    expect(outcome.intent).toBe(recorded.intent);
    expect(outcome.prediction).toBe(recorded.prediction);
    expect(outcome.orders.length).toBeGreaterThan(0);
  });

  it("calls the rules tool once for the match and keeps the map", async () => {
    const { matchId, player } = await seatA(135);

    const first = await player.playTurn(1);
    matches.resolveTurn(matchId);
    matches.openTurn(matchId);
    const second = await player.playTurn(2);

    expect(first.toolCalls.map((call) => call.tool)).toEqual([
      "get_rules",
      "get_state",
      "submit_orders",
    ]);
    expect(second.turn).toBe(2);
    expect(second.toolCalls.map((call) => call.tool)).toEqual(["get_state", "submit_orders"]);
    expect(matches.turnRecord(matchId, 2).A.tool_calls.map((call) => call.tool)).toEqual(
      second.toolCalls.map((call) => call.tool),
    );
  });

  it("never calls scout or simulate, in either turn of a match", async () => {
    const { matchId, player } = await seatA(135);

    const turns = [await player.playTurn(1)];
    matches.resolveTurn(matchId);
    matches.openTurn(matchId);
    turns.push(await player.playTurn(2));

    for (const [n, outcome] of turns.entries()) {
      const tools = outcome.toolCalls.map((call) => call.tool);
      expect(tools).not.toContain("scout");
      expect(tools).not.toContain("simulate");
      expect(matches.turnRecord(matchId, n + 1).A.scouts).toEqual([]);
    }
  });

  it("passes the turn when the server refuses to answer it", async () => {
    const { matchId, player } = await seatA(135);

    // The turn is not open, so every call comes back `turn_not_open`.
    matches.resolveTurn(matchId);
    const outcome = await player.playTurn(1);

    expect(outcome.submitted).toBe(false);
    expect(outcome.orders).toEqual([]);
    expect(outcome.toolCalls.map((call) => call.tool)).toEqual(["get_rules"]);
    expect(outcome.toolCalls[0].error).toBe(true);
  });
});

/** One hex of the scripted game, and one move of it. */
interface FakeOrder {
  from: string;
  to: string;
  troops: number;
}

/** The scripted game's three tools, under names that are not Salient's. */
const FAKE_TOOLS = { rules: "rules", state: "state", submit: "send" } as const;

/** Every scripted player a test connected, so they are all shut before the run ends. */
const players: BotPlayer<
  { map: string[] },
  { turn: number; action_points_left: number },
  FakeOrder
>[] = [];

/**
 * A game small enough to hold in a test: three tools over an in-memory
 * transport pair, and a `send` that refuses what `refusals` says it refuses,
 * submission by submission. An empty entry means that submission is taken.
 * With `stateRefused`, the state tool turns every call away, which is how a
 * turn the seat cannot read plays out.
 *
 * `sent` collects what each submission carried, which is how the tests see what
 * the resubmission held.
 */
const scriptedGame = async (
  refusals: { order: FakeOrder; reason: string }[][],
  stateRefused = false,
): Promise<{ transport: InMemoryTransport; sent: FakeOrder[][] }> => {
  const sent: FakeOrder[][] = [];
  const answer = (result: unknown): { content: { type: "text"; text: string }[] } => ({
    content: [{ type: "text", text: JSON.stringify(result) }],
  });
  const refuse = (error: string): { content: { type: "text"; text: string }[]; isError: boolean } => ({
    content: [{ type: "text", text: JSON.stringify({ error }) }],
    isError: true,
  });
  const orderSchema = z.strictObject({ from: z.string(), to: z.string(), troops: z.number() });

  const mcp = new McpServer({ name: "scripted-game", version: "0.0.0" });
  mcp.registerTool(
    FAKE_TOOLS.rules,
    { description: "The map.", inputSchema: z.strictObject({}) },
    async () => answer({ map: ["a1", "a2", "a3"] }),
  );
  mcp.registerTool(
    FAKE_TOOLS.state,
    { description: "The turn.", inputSchema: z.strictObject({}) },
    async () => (stateRefused ? refuse("turn_not_open") : answer({ turn: 1, action_points_left: 2 })),
  );
  mcp.registerTool(
    FAKE_TOOLS.submit,
    {
      description: "The orders to play.",
      inputSchema: z.strictObject({
        orders: z.array(orderSchema),
        intent: z.string(),
        prediction: z.string(),
      }),
    },
    async (args) => {
      const orders = args.orders as FakeOrder[];
      const wasted = refusals[sent.length] ?? [];
      sent.push(orders);
      return wasted.length === 0
        ? answer({ accepted: true })
        : answer({ accepted: false, wasted });
    },
  );

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  return { transport: clientSide, sent };
};

/** The scripted game, in the harness's words. */
const scripted = (
  transport: InMemoryTransport,
): BotPlayerOptions<{ map: string[] }, { turn: number; action_points_left: number }, FakeOrder> => ({
  tools: FAKE_TOOLS,
  decide: () => ({
    orders: [
      { from: "a1", to: "a2", troops: 2 },
      { from: "a2", to: "a3", troops: 1 },
    ],
    intent: "Take a2, then a3.",
    prediction: "They hold a3.",
  }),
  verdict: acceptedOrRetry,
  transport: () => transport,
});

/** A scripted game and a player connected to it, with no socket between them. */
const atTheScriptedGame = async (
  refusals: { order: FakeOrder; reason: string }[][],
  stateRefused = false,
): Promise<{
  sent: FakeOrder[][];
  player: BotPlayer<{ map: string[] }, { turn: number; action_points_left: number }, FakeOrder>;
}> => {
  const game = await scriptedGame(refusals, stateRefused);
  const player = new BotPlayer(scripted(game.transport));
  players.push(player);
  await player.start({ serverUrl: "in-memory", token: "seat-1" });
  return { sent: game.sent, player };
};

describe("a bot over an in-memory transport", () => {
  const refused = { order: { from: "a2", to: "a3", troops: 1 }, reason: "source hex not owned" };

  afterEach(async () => {
    await Promise.all(players.splice(0).map((player) => player.stop()));
  });

  it("resubmits once with the refused orders dropped", async () => {
    const { sent, player } = await atTheScriptedGame([[refused], []]);

    const outcome = await player.playTurn(1);

    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual([{ from: "a1", to: "a2", troops: 2 }]);
    expect(outcome.submitted).toBe(true);
    expect(outcome.orders).toEqual([{ from: "a1", to: "a2", troops: 2 }]);
    expect(outcome.rejected).toEqual({
      orders: [
        { from: "a1", to: "a2", troops: 2 },
        { from: "a2", to: "a3", troops: 1 },
      ],
      wasted: [refused],
    });
    expect(outcome.toolCalls.map((call) => call.tool)).toEqual([
      "rules",
      "state",
      "send",
      "send",
    ]);
    expect(outcome.intent).toBe("Take a2, then a3.");
    expect(outcome.prediction).toBe("They hold a3.");
  });

  it("resubmits exactly once, even when the resubmission is refused too", async () => {
    const kept = { order: { from: "a1", to: "a2", troops: 2 }, reason: "destination is blocked" };
    const { sent, player } = await atTheScriptedGame([[refused], [kept]]);

    const outcome = await player.playTurn(1);

    expect(sent.length).toBe(2);
    expect(outcome.toolCalls.filter((call) => call.tool === "send").length).toBe(2);
    expect(outcome.submitted).toBe(false);
    // The log holds the first refusal, which is the one the player was given a
    // chance to answer.
    expect(outcome.rejected).toEqual({
      orders: [
        { from: "a1", to: "a2", troops: 2 },
        { from: "a2", to: "a3", troops: 1 },
      ],
      wasted: [refused],
    });
  });

  it("passes the turn when the state tool will not answer it", async () => {
    const { sent, player } = await atTheScriptedGame([[]], true);

    const outcome = await player.playTurn(1);

    expect(sent.length).toBe(0);
    expect(outcome.submitted).toBe(false);
    expect(outcome.orders).toEqual([]);
    expect(outcome.toolCalls.map((call) => call.tool)).toEqual(["rules", "state"]);
    expect(outcome.toolCalls[1].error).toBe(true);
  });
});
