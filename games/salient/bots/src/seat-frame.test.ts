/**
 * The seat frame both bots decide in.
 *
 * The tools answer in the board's own names, and the two seats sit on opposite
 * sides of it. A bot that ranked hexes by those names would play one seat better
 * than the other, so both bots turn the board to face their own Base before they
 * rank anything. These tests check that by rotating a view half a turn —
 * `(q, r) -> (-q, -r)`, which is where the other seat sees the same hex — and
 * asking for the decision again: the orders come back rotated by the same turn.
 */
import { DEFAULT_CONFIG, hexLabel, rotateHalfTurn } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { MatchServer } from "@no-dice/salient-server";
import type { RulesView, StateView } from "@no-dice/salient-server";
import { describe, expect, it } from "vitest";

import { greedyBot } from "./greedy.ts";
import { randomBot } from "./random.ts";
import type { Bot, BotOrder, BotRules, BotState } from "./types.ts";

const RADIUS = DEFAULT_CONFIG.radius;

/** A hex's name from the other side of the board. */
function opposite(name: string): string {
  const q = name.charCodeAt(0) - "A".charCodeAt(0) - RADIUS;
  const r = Number(name.slice(1)) - RADIUS - 1;
  const turned = rotateHalfTurn({ q, r });
  return hexLabel(turned.q, turned.r, RADIUS);
}

/** The same orders, read from the other side of the board. */
function oppositeOrders(orders: readonly BotOrder[]): BotOrder[] {
  return orders.map((order) => ({ from: opposite(order.from), to: opposite(order.to), troops: order.troops }));
}

/**
 * The same note, read from the other side of the board. The bots write the hex
 * names a spectator uses, not the names they ranked internally, so a mirror
 * match's notes differ by exactly this rotation.
 */
function oppositeText(note: string): string {
  return note.replace(/[A-K][0-9]{1,2}/g, (name) => opposite(name));
}

/** The same two answers, read from the other side of the board. */
function oppositeView(rules: RulesView, state: StateView): { rules: BotRules; state: BotState } {
  return {
    rules: {
      ...rules,
      bases: { you: opposite(rules.bases.you), enemy: opposite(rules.bases.enemy) },
      map: rules.map.map((hex) => ({
        ...hex,
        id: opposite(hex.id),
        neighbours: hex.neighbours?.map(opposite),
      })),
    },
    state: {
      action_points_left: state.action_points_left,
      hexes: state.hexes.map((hex) => ({
        ...hex,
        id: opposite(hex.id),
        neighbours: hex.neighbours?.map(opposite),
      })),
    },
  };
}

/** A match with its first turn open, and both seats' answers to the read-only tools. */
function openedMatch(seed: number): { server: MatchServer; matchId: string } {
  const server = new MatchServer();
  const { matchId } = server.createMatch(seed, DEFAULT_CONFIG);
  server.openTurn(matchId);
  return { server, matchId };
}

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
  return { rules: answer("get_rules") as RulesView, state: answer("get_state") as StateView };
}

/**
 * Play `turns` turns with one bot per seat, and keep what each seat submitted.
 * A seat whose orders are not the other seat's mirror fails here, turn by turn.
 */
function playMirrored(seed: number, bot: () => Bot, turns: number): void {
  const { server, matchId } = openedMatch(seed);
  const bots: Record<Seat, Bot> = { A: bot(), B: bot() };

  for (let turn = 1; turn <= turns; turn++) {
    const submitted: Record<Seat, { orders: BotOrder[]; intent: string; prediction: string }> = {
      A: { orders: [], intent: "", prediction: "" },
      B: { orders: [], intent: "", prediction: "" },
    };
    for (const seat of ["A", "B"] as const) {
      const { rules, state } = viewFor(server, matchId, seat);
      const decided = bots[seat](rules, state);
      submitted[seat] = decided;
      const outcome = server.call(matchId, seat, "submit_orders", decided);
      if (!outcome.ok) throw new Error(`submit_orders answered ${outcome.error}`);
    }
    expect(submitted.B.orders).toEqual(oppositeOrders(submitted.A.orders));
    expect(submitted.B.intent).toBe(oppositeText(submitted.A.intent));
    expect(submitted.B.prediction).toBe(oppositeText(submitted.A.prediction));
    server.resolveTurn(matchId);
    server.openTurn(matchId);
  }
}

describe("the seat frame", () => {
  it("plays Greedy's whole match as the mirror image in the other seat", () => {
    playMirrored(135, greedyBot, 8);
  });

  it("plays Random's whole match as the mirror image in the other seat", () => {
    playMirrored(189, () => randomBot(7), 8);
  });

  it("decides a rotated view as the rotated version of the same decision", () => {
    // A position only one side of the board has been busy in, so the two seats
    // are not handed the same view by the match: the rotation has to be.
    const { server, matchId } = openedMatch(135);
    const greedy = greedyBot();
    for (let turn = 1; turn <= 4; turn++) {
      const { rules, state } = viewFor(server, matchId, "A");
      const here = greedy(rules, state);
      const there = oppositeView(rules, state);
      const turned = greedy(there.rules, there.state);

      expect(turned.orders).toEqual(oppositeOrders(here.orders));
      expect(turned.intent).toBe(oppositeText(here.intent));
      expect(turned.prediction).toBe(oppositeText(here.prediction));

      server.call(matchId, "A", "submit_orders", here);
      server.call(matchId, "B", "submit_orders", { orders: [], intent: "holding", prediction: "holding" });
      server.resolveTurn(matchId);
      server.openTurn(matchId);
    }
  });

  it("draws Random's same turn from either seat", () => {
    const { server, matchId } = openedMatch(135);
    const { rules, state } = viewFor(server, matchId, "A");

    const turned = oppositeView(rules, state);

    expect(randomBot(7)(turned.rules, turned.state).orders).toEqual(
      oppositeOrders(randomBot(7)(rules, state).orders),
    );
  });
});
