/**
 * The Greedy bot, on the situations its rules of thumb are meant to tell apart.
 *
 * Each one is set on the real map of a real match — the hexes, their terrain and
 * their neighbours come from `get_rules` — with only what the seat can see
 * written by hand. That keeps the geometry honest while letting a test ask about
 * one thing: whether it pays for a Node, whether it attacks a hex it can beat,
 * what it keeps at home while it expands, and what it does with a stack that has
 * nothing next to it to take.
 */
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { MatchServer } from "@no-dice/salient-server";
import type { RulesView, StateView } from "@no-dice/salient-server";
import { describe, expect, it } from "vitest";

import { greedyBot } from "./greedy.ts";
import type { BotState } from "./types.ts";

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
  return { rules: answer("get_rules") as RulesView, state: answer("get_state") as StateView };
}

/** The map seat A plays on seed 135: `B6` its Base, `D6` and `F6` Nodes, `E6` blocked. */
function rulesForSeatA(): RulesView {
  const { server, matchId } = openedMatch(135);
  return viewFor(server, matchId, "A").rules;
}

/** A `get_state` answer in which the seat knows exactly these hexes. */
function seatSees(hexes: BotState["hexes"], actionPoints = 6): BotState {
  return { action_points_left: actionPoints, hexes };
}

describe("greedyBot", () => {
  it("takes a neutral Node it can afford, with one more troop than its garrison", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "C6", owner: "you", troops: 4 },
        { id: "D6", owner: null, troops: 0, garrison: 3 },
      ]),
    );

    expect(turn.orders).toEqual([{ from: "C6", to: "D6", troops: 4 }]);
    expect(turn.intent).toBe("Take the node at D6 with 4.");
  });

  it("leaves a Node it cannot afford and claims cheaper hexes instead", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "C6", owner: "you", troops: 3 },
        { id: "D6", owner: null, troops: 0, garrison: 3 },
      ]),
    );

    expect(turn.orders.map((order) => order.to)).not.toContain("D6");
    expect(turn.orders).toHaveLength(3);
  });

  it("attacks an enemy hex with enough troops to beat the stack and its home bonus", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "C6", owner: "you", troops: 4 },
        { id: "D5", owner: "enemy", troops: 2 },
        { id: "D6", owner: "you", troops: 0 },
        { id: "C5", owner: "you", troops: 0 },
        { id: "B6", owner: "you", troops: 0 },
        { id: "B7", owner: "you", troops: 0 },
        { id: "C7", owner: "you", troops: 0 },
      ]),
    );

    // Two on it, one to beat them, and one for the home bonus it defends with.
    expect(turn.orders).toEqual([{ from: "C6", to: "D5", troops: 4 }]);
    // The stack next door is two hexes from the Base, so it holds there too.
    expect(turn.intent).toContain("Attack D5 from C6 with 4.");
  });

  it("does not attack a hex it cannot beat", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "C6", owner: "you", troops: 3 },
        { id: "D5", owner: "enemy", troops: 2 },
        { id: "D6", owner: "you", troops: 0 },
        { id: "C5", owner: "you", troops: 0 },
        { id: "B6", owner: "you", troops: 0 },
        { id: "B7", owner: "you", troops: 0 },
        { id: "C7", owner: "you", troops: 0 },
      ]),
    );

    expect(turn.orders).toEqual([]);
    expect(turn.intent).not.toContain("Attack");
    expect(turn.intent).toContain("Hold 3 at base against the stack nearby.");
  });

  it("keeps enough on a Node of its own to hold it against the stack next to it", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "D6", owner: "you", troops: 7 },
        { id: "C6", owner: "enemy", troops: 2 },
        { id: "E5", owner: "you", troops: 0 },
        { id: "D5", owner: "you", troops: 0 },
        { id: "C7", owner: "you", troops: 0 },
        { id: "D7", owner: "you", troops: 0 },
      ]),
    );

    // Seven on the Node, and only four may leave: the three it needs to hold it.
    expect(turn.orders).toEqual([{ from: "D6", to: "C6", troops: 4 }]);
  });

  it("keeps a guard on its Base against an enemy stack it can see nearby", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "B6", owner: "you", troops: 5 },
        { id: "C6", owner: "enemy", troops: 1 },
        { id: "C5", owner: "you", troops: 0 },
        { id: "B5", owner: "you", troops: 0 },
        { id: "A6", owner: "you", troops: 0 },
        { id: "A7", owner: "you", troops: 0 },
        { id: "B7", owner: "you", troops: 0 },
      ]),
    );

    // One enemy troop next door, so two stay, and only three go.
    expect(turn.orders).toEqual([{ from: "B6", to: "C6", troops: 3 }]);
    expect(turn.intent).toContain("Hold 2 at base against the stack nearby.");
  });

  it("marches an interior stack toward the front when nothing next to it can be taken", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "B6", owner: "you", troops: 5 },
        { id: "C6", owner: "you", troops: 0 },
        { id: "C5", owner: "you", troops: 0 },
        { id: "B5", owner: "you", troops: 0 },
        { id: "A6", owner: "you", troops: 0 },
        { id: "A7", owner: "you", troops: 0 },
        { id: "B7", owner: "you", troops: 0 },
      ]),
    );

    expect(turn.orders).toEqual([{ from: "B6", to: "C6", troops: 5 }]);
    expect(turn.intent).toBe("Bring 5 troops up to the front.");
  });

  it("claims the open hexes next to its Base on the first turn, one troop each", () => {
    const { server, matchId } = openedMatch(135);
    const { rules, state } = viewFor(server, matchId, "A");

    const turn = greedyBot()(rules, state);

    // Five troops on the Base and six action points: the troops run out first.
    expect(turn.orders).toHaveLength(5);
    for (const order of turn.orders) {
      expect([order.from, order.troops]).toEqual(["B6", 1]);
      expect(state.hexes.find((hex) => hex.id === order.to)?.owner).toBeNull();
    }
  });

  it("spends no more moves than the action points the turn has left", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([{ id: "B6", owner: "you", troops: 5 }], 2),
    );

    expect(turn.orders).toHaveLength(2);
  });

  it("names the biggest enemy stack it can see, and the hex it looks pointed at", () => {
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "B6", owner: "you", troops: 5 },
        { id: "C6", owner: "enemy", troops: 3 },
        { id: "C5", owner: "enemy", troops: 1 },
      ]),
    );

    expect(turn.prediction).toBe("Their 3 at C6 will hit B6.");
  });

  it("throws a stack at their Base only once it is big enough to be worth the risk", () => {
    // The `expander` weights ask for 99 troops before a stack is thrown at their
    // Base, and rate that move at nothing, so it takes a position this lopsided
    // to see it: a huge stack with nothing next to it worth attacking, and its
    // own territory leading toward the enemy Base.
    const turn = greedyBot()(
      rulesForSeatA(),
      seatSees([
        { id: "F5", owner: "you", troops: 120 },
        { id: "G5", owner: "you", troops: 0 },
        { id: "G4", owner: "enemy", troops: 30 },
        { id: "F4", owner: "enemy", troops: 30 },
        { id: "E4", owner: "enemy", troops: 30 },
        { id: "E5", owner: "enemy", troops: 30 },
        { id: "F6", owner: "enemy", troops: 30 },
      ]),
    );

    expect(turn.orders).toHaveLength(1);
    expect(turn.orders[0]).toEqual({ from: "F5", to: "G5", troops: 120 });
    expect(turn.intent).toBe("Push 120 from F5 toward their base.");
  });

  it("plays a whole match without an order dropped or a note running past the limit", () => {
    const { server, matchId } = openedMatch(135);
    const greedy = greedyBot();

    for (let turn = 1; turn <= 12; turn++) {
      for (const seat of ["A", "B"] as const) {
        const { rules, state } = viewFor(server, matchId, seat);
        const decided = greedy(rules, state);
        for (const note of [decided.intent, decided.prediction]) {
          expect(note.length).toBeGreaterThanOrEqual(1);
          expect(note.length).toBeLessThanOrEqual(280);
        }
        const outcome = server.call(matchId, seat, "submit_orders", decided);
        if (!outcome.ok) throw new Error(`submit_orders answered ${outcome.error}`);
      }
      server.resolveTurn(matchId);
      const record = server.turnRecord(matchId, turn);
      expect(record.A.wasted).toEqual([]);
      expect(record.B.wasted).toEqual([]);
      server.openTurn(matchId);
    }
  });
});
