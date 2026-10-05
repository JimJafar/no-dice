/**
 * The Random bot, read the way any player is read: through the two read-only
 * tools, with the engine judging the orders afterwards.
 *
 * A bot that decides nothing still has to be a legal, repeatable player, so that
 * is what these tests hold: the same seed plays the same match again, a turn
 * never carries more moves than it has action points, every order survives the
 * engine, and each move leaves a hex the seat owns for a hex next to it.
 */
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { MatchServer, type RulesView, type StateView, type TurnPlayerRecords } from "@no-dice/salient-server";
import { describe, expect, it } from "vitest";

import { randomBot } from "./random.ts";
import type { Bot, BotOrder } from "./types.ts";

/** A match with its first turn open, so both seats can call the read-only tools. */
function openedMatch(seed: number): { server: MatchServer; matchId: string } {
  const server = new MatchServer();
  const { matchId } = server.createMatch(seed, DEFAULT_CONFIG);
  server.openTurn(matchId);
  return { server, matchId };
}

/** What `seat`'s two read-only tools answer right now. */
function viewFor(
  server: MatchServer,
  matchId: string,
  seat: Seat,
): { rules: RulesView; state: StateView } {
  const answer = (tool: string): unknown => {
    const outcome = server.call(matchId, seat, tool, {});
    if (!outcome.ok) throw new Error(`${tool} answered ${outcome.error}`);
    return outcome.result;
  };
  return {
    rules: answer("get_rules") as RulesView,
    state: answer("get_state") as StateView,
  };
}

/**
 * Play `turns` turns of a random-versus-random match, keeping what each seat
 * submitted and what the engine dropped from it.
 */
function playRandom(seed: number, botSeed: number, turns: number): {
  played: Record<Seat, BotOrder[][]>;
  wasted: Record<Seat, TurnPlayerRecords[Seat]["wasted"]>;
} {
  const { server, matchId } = openedMatch(seed);
  const bots: Record<Seat, Bot> = { A: randomBot(botSeed), B: randomBot(botSeed) };
  const played: Record<Seat, BotOrder[][]> = { A: [], B: [] };
  const wasted: Record<Seat, TurnPlayerRecords[Seat]["wasted"]> = { A: [], B: [] };

  for (let turn = 1; turn <= turns; turn++) {
    for (const seat of ["A", "B"] as const) {
      const { rules, state } = viewFor(server, matchId, seat);
      const decided = bots[seat](rules, state);
      played[seat].push(decided.orders);
      const outcome = server.call(matchId, seat, "submit_orders", decided);
      if (!outcome.ok) throw new Error(`submit_orders answered ${outcome.error}`);
    }
    server.resolveTurn(matchId);
    const record = server.turnRecord(matchId, turn);
    for (const seat of ["A", "B"] as const) wasted[seat].push(...record[seat].wasted);
    server.openTurn(matchId);
  }
  return { played, wasted };
}

describe("randomBot", () => {
  it("plays the same match again from the same seed and the same views", () => {
    const first = playRandom(189, 7, 6);
    const second = playRandom(189, 7, 6);

    expect(first.played).toEqual(second.played);
    // A different seed is a different player, or the seed would be doing nothing.
    expect(playRandom(189, 11, 6).played.A[0]).not.toEqual(first.played.A[0]);
  });

  it("submits nothing the engine drops, in either seat", () => {
    const { wasted } = playRandom(189, 7, 10);

    expect(wasted).toEqual({ A: [], B: [] });
  });

  it("never makes more moves than the turn has action points", () => {
    const { server, matchId } = openedMatch(135);
    const { rules, state } = viewFor(server, matchId, "A");

    const orders = randomBot(7)(rules, state).orders;

    expect(orders.length).toBeLessThanOrEqual(6);
    expect(orders.length).toBeLessThanOrEqual(state.action_points_left);
  });

  it("moves troops it has, from a hex it owns, to a hex it can walk to", () => {
    const { server, matchId } = openedMatch(189);
    const { rules, state } = viewFor(server, matchId, "A");
    const passable = new Map(rules.map.map((hex) => [hex.id, new Set(hex.neighbours ?? [])]));

    const orders = randomBot(3)(rules, state).orders;

    expect(orders.length).toBeGreaterThan(0);
    const leaving = new Map<string, number>();
    for (const order of orders) {
      const source = state.hexes.find((hex) => hex.id === order.from);
      expect(source?.owner).toBe("you");
      expect(passable.get(order.from)?.has(order.to)).toBe(true);
      expect(Number.isInteger(order.troops)).toBe(true);
      expect(order.troops).toBeGreaterThan(0);
      // Several moves may leave one hex, but not more than it was standing on.
      leaving.set(order.from, (leaving.get(order.from) ?? 0) + order.troops);
    }
    for (const [id, troops] of leaving) {
      expect(troops).toBeLessThanOrEqual(state.hexes.find((hex) => hex.id === id)?.troops ?? 0);
    }
  });

  it("answers with the two notes submit_orders takes", () => {
    const { server, matchId } = openedMatch(135);
    const { rules, state } = viewFor(server, matchId, "A");

    const turn = randomBot(7)(rules, state);

    for (const note of [turn.intent, turn.prediction]) {
      expect(note.length).toBeGreaterThanOrEqual(1);
      expect(note.length).toBeLessThanOrEqual(280);
    }
  });
});
