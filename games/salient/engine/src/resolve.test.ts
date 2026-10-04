/**
 * Turn resolution. The sequence the rules fix is checked step by step — the
 * five combat rows, the edge clash, garrison wear, ownership, supply cuts,
 * production and the knockout — and the prototype in
 * `salient/docs/reference/engine.js` is then used as an oracle, over whole
 * scripted matches and over the awkward cases, so nothing here drifts from the
 * numbers the golden logs were played with.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { generateMap } from "./board";
import { DEFAULT_CONFIG, type Config } from "./config";
import { boardCells, hexDistance, hexKey, neighbourKeys, parseHexKey } from "./hex";
import { mulberry32 } from "./rng";
import { resolveTurn, type TurnOutcome } from "./resolve";
import { score } from "./supply";
import type { Hex, HexKey, MatchState, Order, Seat, Terrain, WastedOrder } from "./types";

const B6 = "-4,0"; // seat A's Base, 5 troops at the start of the turn
const C6 = "-3,0"; // plain, next to B6
const C5 = "-3,-1"; // plain, next to C6
const C7 = "-3,1"; // plain, on the far side of C6 from C5
const B5 = "-4,-1";
const B7 = "-4,1";
const D6 = "-2,0"; // the Node two hexes out from B6, garrison 3 while neutral
const E5 = "-1,-1"; // plain, the gap that reconnects the cut-off blob
const E6 = "-1,0"; // blocked on this map
const F5 = "0,-1"; // plain, next to F6 on A's side
const F6 = "0,0"; // the centre Node
const G5 = "1,-1"; // plain, next to F6 on B's side
const I6 = "3,0";
const J6 = "4,0"; // seat B's Base

const CELLS = boardCells(DEFAULT_CONFIG.radius);

/**
 * The rules' constants with production switched off, so a test about a fight
 * reads as the fight alone. Production has its own tests below.
 */
const NO_PRODUCTION: Config = { ...DEFAULT_CONFIG, baseProduction: 0, nodeProduction: 0 };

const order = (from: HexKey, to: HexKey, troops: number): Order => ({ from, to, troops });

/** Resolve one turn with both seats' orders and no scouting. */
function resolve(
  state: MatchState,
  a: readonly Order[],
  b: readonly Order[],
  scouts: Partial<Record<Seat, number>> = { A: 0, B: 0 },
  config: Config = DEFAULT_CONFIG,
) {
  return resolveTurn(state, { A: a, B: b }, scouts, config);
}

const held = (state: MatchState, key: HexKey): [Seat | null, number] => [
  state.hexes[key].owner,
  state.hexes[key].troops,
];

const garrisonOf = (state: MatchState, key: HexKey): number => state.hexes[key].garrison;

/** Seat A's wedge on seed 135, plus a blob at F5 and F6 walled off by E6. */
function wedge(): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  const own = (key: HexKey, seat: Seat, troops: number): void => {
    state.hexes[key].owner = seat;
    state.hexes[key].troops = troops;
    state.hexes[key].garrison = 0; // an owned Node has no garrison left
  };
  own(C6, "A", 3);
  own(D6, "A", 4);
  own(F5, "A", 2);
  own(F6, "A", 2);
  return state;
}

/** C6 belongs to seat B with `defenders` on it; A attacks it from C5. */
function battlefield(attackers: number, defenders: number): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  state.hexes[C5].owner = "A";
  state.hexes[C5].troops = attackers + 3; // 3 of them stay where they are
  state.hexes[C6].owner = "B";
  state.hexes[C6].troops = defenders;
  return state;
}

/** A holds C5 with 5 and B holds C6 with `defenders`, facing each other. */
function facing(defenders: number): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  state.hexes[C5].owner = "A";
  state.hexes[C5].troops = 5;
  state.hexes[C6].owner = "B";
  state.hexes[C6].troops = defenders;
  return state;
}

/** A holds C6 with `attackers` ready to storm the neutral Node at D6. */
function atTheGate(attackers: number, staying = 0): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  state.hexes[C6].owner = "A";
  state.hexes[C6].troops = attackers + staying;
  return state;
}

/** A holds I6 with 5, one step from seat B's Base at J6. */
function atTheBase(): MatchState {
  const state = wedge();
  state.hexes[I6].owner = "A";
  state.hexes[I6].troops = 5;
  state.hexes[J6].troops = 2;
  return state;
}

/** A and B each hold one plain hex on either side of the centre Node. */
function eitherSideOfTheNode(a: number, b: number): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  state.hexes[F5].owner = "A";
  state.hexes[F5].troops = a;
  state.hexes[G5].owner = "B";
  state.hexes[G5].troops = b;
  return state;
}

/** The board as one string per hex, in board order, so key order cannot matter. */
function boardOf(hexes: Record<HexKey, { owner: Seat | null; troops: number; garrison: number }>): string[] {
  return CELLS.map((cell) => {
    const key = hexKey(cell.q, cell.r);
    const hex = hexes[key];
    return `${key} ${hex.owner ?? "-"} ${hex.troops} ${hex.garrison}`;
  });
}

describe("the combat table", () => {
  function attack(attackers: number, defenders: number) {
    const result = resolve(
      battlefield(attackers, defenders),
      [order(C5, C6, attackers)],
      [],
      { A: 0, B: 0 },
      NO_PRODUCTION,
    );
    return { state: result.state, events: result.events };
  }

  it("holds a hex its owner stands on with no troops, against one attacker", () => {
    const { state, events } = attack(1, 0);
    // The home bonus is the whole defence, so the tie destroys the attacker.
    expect(held(state, C6)).toEqual(["B", 0]);
    expect(events).toEqual([{ type: "repelled", at: C6, by: "A", n: 1 }]);
  });

  it("is captured with one attacker left, two attackers against an empty hex", () => {
    const { state, events } = attack(2, 0);
    // The bonus absorbs the owner's first loss, so only the attacker pays.
    expect(held(state, C6)).toEqual(["A", 1]);
    expect(events).toEqual([{ type: "capture", at: C6, by: "A", from: "B", terrain: "plain" }]);
  });

  it("fails with no defenders left when the attack matches the defence, 4 against 3", () => {
    const { state, events } = attack(4, 3);
    // 4 attackers against 3 defenders plus the bonus: a tie, so the hex holds.
    expect(held(state, C6)).toEqual(["B", 0]);
    expect(events).toEqual([{ type: "battle", at: C6, A: 4, B: 3, owner: "B" }]);
  });

  it("is captured with one attacker left, 5 attackers against 3 defenders", () => {
    const { state, events } = attack(5, 3);
    expect(held(state, C6)).toEqual(["A", 1]);
    expect(events).toEqual([
      { type: "battle", at: C6, A: 5, B: 3, owner: "B" },
      { type: "capture", at: C6, by: "A", from: "B", terrain: "plain" },
    ]);
  });

  it("fails against a bigger force and leaves the defenders with 3, attacking with 3 against 5", () => {
    const { state, events } = attack(3, 5);
    // The bonus absorbs one of the losses the 3 attackers would have inflicted.
    expect(held(state, C6)).toEqual(["B", 3]);
    expect(events).toEqual([{ type: "battle", at: C6, A: 3, B: 5, owner: "B" }]);
  });

  it("takes only the troops an order named off the hex they started on", () => {
    const { state } = attack(2, 0);
    expect(held(state, C5)).toEqual(["A", 3]);
  });
});

describe("the edge clash", () => {
  const crossTheEdge = (state: MatchState, a: number, b: number) =>
    resolve(state, [order(C5, C6, a)], [order(C6, C5, b)], { A: 0, B: 0 }, NO_PRODUCTION);

  it("destroys the smaller force and costs the larger the same number", () => {
    const result = crossTheEdge(facing(1), 5, 1);
    expect(result.events).toEqual([
      { type: "clash", between: [C5, C6], A: 5, B: 1 },
      { type: "capture", at: C6, by: "A", from: "B", terrain: "plain" },
    ]);
    // 4 of A's troops survive the edge, and the empty hex B left behind still
    // defends with its home bonus, so 3 of them arrive.
    expect(held(result.state, C5)).toEqual(["A", 0]);
    expect(held(result.state, C6)).toEqual(["A", 3]);
  });

  it("takes both forces off the edge when they are the same size", () => {
    const result = crossTheEdge(facing(5), 5, 5);
    expect(result.events).toEqual([{ type: "clash", between: [C5, C6], A: 5, B: 5 }]);
    // Both hexes are empty now, and neither lost its owner.
    expect(held(result.state, C5)).toEqual(["A", 0]);
    expect(held(result.state, C6)).toEqual(["B", 0]);
  });

  it("fights one clash per edge, named in the direction A crossed it, even for split orders", () => {
    const state = facing(3);
    // A splits its move over the same edge; the two orders travel as one force.
    const result = resolve(
      state,
      [order(C5, C6, 3), order(C5, C6, 2)],
      [order(C6, C5, 2)],
      { A: 0, B: 0 },
      NO_PRODUCTION,
    );
    expect(result.events[0]).toEqual({ type: "clash", between: [C5, C6], A: 5, B: 2 });
    expect(result.events.filter((event) => event.type === "clash")).toHaveLength(1);
  });

  it("does not happen when the two moves cross different edges", () => {
    const state = facing(1);
    const result = resolve(state, [order(C5, C6, 5)], [order(C6, C7, 1)], { A: 0, B: 0 }, NO_PRODUCTION);
    expect(result.events).toEqual([
      { type: "capture", at: C6, by: "A", from: "B", terrain: "plain" },
      { type: "capture", at: C7, by: "B", from: null, terrain: "plain" },
    ]);
    expect(held(result.state, C6)).toEqual(["A", 4]); // 5 less the bonus of the empty hex
    expect(held(result.state, C7)).toEqual(["B", 1]);
  });
});

describe("neutral Nodes and their garrisons", () => {
  const storm = (state: MatchState, attackers: number) =>
    resolve(state, [order(C6, D6, attackers)], [], { A: 0, B: 0 }, NO_PRODUCTION);

  it("takes a Node with a force that exceeds the garrison, and loses that many", () => {
    const result = storm(atTheGate(4), 4);
    expect([held(result.state, D6)[0], held(result.state, D6)[1], garrisonOf(result.state, D6)]).toEqual(["A", 1, 0]);
    expect(result.events).toEqual([{ type: "capture", at: D6, by: "A", from: null, terrain: "node" }]);
  });

  it("destroys a force that only matches the garrison and wears it down by its own size", () => {
    const result = storm(atTheGate(3), 3);
    expect([held(result.state, D6)[0], held(result.state, D6)[1], garrisonOf(result.state, D6)]).toEqual([null, 0, 0]);
    expect(result.events).toEqual([{ type: "repelled", at: D6, by: "A", n: 3 }]);
  });

  it("wears a garrison down over turns, so a later attack has less to overcome", () => {
    const state = atTheGate(2, 2); // 2 to send this turn and 2 more next turn
    const first = storm(state, 2);
    expect(garrisonOf(first.state, D6)).toBe(1); // 3 worn down to 1
    expect(first.events).toEqual([{ type: "repelled", at: D6, by: "A", n: 2 }]);

    const second = storm(first.state, 2);
    expect([held(second.state, D6)[0], held(second.state, D6)[1], garrisonOf(second.state, D6)]).toEqual(["A", 1, 0]);
    expect(second.events).toEqual([{ type: "capture", at: D6, by: "A", from: null, terrain: "node" }]);
  });

  it("makes the two invaders of a neutral hex fight with no bonus, then face the garrison", () => {
    const state = eitherSideOfTheNode(4, 2);
    const result = resolve(state, [order(F5, F6, 4)], [order(G5, F6, 2)], { A: 0, B: 0 }, NO_PRODUCTION);
    // A's 4 beat B's 2 with no bonus for either, and the 2 left over are beaten
    // back by the garrison of 3, which they wear down to 1.
    expect(result.events).toEqual([
      { type: "battle", at: F6, A: 4, B: 2, owner: null },
      { type: "repelled", at: F6, by: "A", n: 2 },
    ]);
    expect([held(result.state, F6)[0], held(result.state, F6)[1], garrisonOf(result.state, F6)]).toEqual([null, 0, 1]);
  });

  it("gives the survivor of that fight the hex once the garrison is spent", () => {
    const state = eitherSideOfTheNode(5, 1);
    const result = resolve(state, [order(F5, F6, 5)], [order(G5, F6, 1)], { A: 0, B: 0 }, NO_PRODUCTION);
    expect(result.events).toEqual([
      { type: "battle", at: F6, A: 5, B: 1, owner: null },
      { type: "capture", at: F6, by: "A", from: null, terrain: "node" },
    ]);
    expect([held(result.state, F6)[0], held(result.state, F6)[1], garrisonOf(result.state, F6)]).toEqual(["A", 1, 0]);
  });

  it("leaves a garrison alone once the Node has an owner", () => {
    const state = atTheGate(1);
    state.hexes[D6].owner = "A";
    state.hexes[D6].troops = 4;
    state.hexes[D6].garrison = 0;
    const result = storm(state, 1);
    expect(held(result.state, D6)).toEqual(["A", 5]); // 4 held + 1 arrived
    expect(result.events).toEqual([]);
  });
});

describe("movement and ownership", () => {
  it("moves only the troops that stood on the hex when the turn started", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    state.hexes[B6].troops = 2;
    state.hexes[C6].owner = "A";
    state.hexes[C6].troops = 3;
    const result = resolve(state, [order(B6, C6, 2), order(C6, C5, 3)], [], { A: 0, B: 0 }, NO_PRODUCTION);
    // The 3 that left C6 were the 3 standing there; the 2 that arrive this turn
    // cannot move again until the next one.
    expect(held(result.state, C6)).toEqual(["A", 2]);
    expect(held(result.state, C5)).toEqual(["A", 3]);
  });

  it("keeps a hex whose last troop walks out of it", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    state.hexes[C6].owner = "A";
    state.hexes[C6].troops = 3;
    const result = resolve(state, [order(C6, B6, 3)], [], { A: 0, B: 0 }, NO_PRODUCTION);
    expect(held(result.state, C6)).toEqual(["A", 0]);
    expect(held(result.state, B6)).toEqual(["A", 8]); // 5 that were there + 3 that arrived
    expect(result.events).toEqual([]); // A never lost the hex, so nothing was captured
  });

  it("hands a hex to whichever side has troops standing on it afterwards", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    state.hexes[C6].owner = "B";
    state.hexes[C6].troops = 1;
    const result = resolve(state, [order(B6, C6, 3)], [], { A: 0, B: 0 }, NO_PRODUCTION);
    expect(held(result.state, C6)).toEqual(["A", 1]); // 3 attackers, 1 defender, 1 bonus
  });

  it("wastes the orders over the action points left after scouting, and spends nothing on them", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    const orders = [order(B6, C6, 1), order(B6, C5, 1), order(B6, B5, 1), order(B6, B7, 1)];
    const result = resolve(state, orders, [], { A: 4, B: 0 }, NO_PRODUCTION);
    expect(result.wasted.A.map((wasted) => wasted.reason)).toEqual(["no action points left", "no action points left"]);
    expect(result.wasted.A.map((wasted) => wasted.order)).toEqual(orders.slice(2));
    expect([held(result.state, C6)[0], held(result.state, C5)[0], held(result.state, B5)[0]]).toEqual(["A", "A", null]);

    // A seat that spent all 6 points on scouts has no orders at all.
    const spent = resolve(state, orders, [], { A: 6, B: 0 }, NO_PRODUCTION);
    expect(spent.wasted.A.map((wasted) => wasted.reason)).toEqual(orders.map(() => "no action points left"));
    expect(spent.events).toEqual([]);
  });

  it("wastes an invalid order with its reason, and still spends its action point on it", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    const blocked = order(B6, E6, 1);
    const result = resolve(state, [blocked, order(B6, C6, 2)], [], { A: 0, B: 0 }, NO_PRODUCTION);
    expect(result.wasted.A.map((wasted) => wasted.reason)).toEqual(["destination is blocked"]);
    expect(result.wasted.A[0].order).toBe(blocked); // the order comes back as submitted
    expect(held(result.state, C6)).toEqual(["A", 2]); // the legal order behind it still ran
  });
});

describe("supply and production", () => {
  it("scores a cut-off region nothing, and scores it again once it is reconnected", () => {
    const state = wedge();
    expect(score(state, "A", DEFAULT_CONFIG).points).toBe(5); // B6, C6 and the Node at D6

    // One move to E5 joins the blob at F5 and F6 back to the wedge.
    const result = resolve(state, [order(F5, E5, 2)], []);
    expect(result.events).toEqual([{ type: "capture", at: E5, by: "A", from: null, terrain: "plain" }]);
    expect(score(result.state, "A", DEFAULT_CONFIG).points).toBe(10);
    expect(score(result.state, "B", DEFAULT_CONFIG).points).toBe(1);
  });

  it("produces 2 at each Base and 1 at each owned Node, and nothing on plain hexes", () => {
    const result = resolve(wedge(), [], []);
    expect(result.state.hexes[B6].troops).toBe(7); // Base
    expect(result.state.hexes[J6].troops).toBe(7); // Base
    expect(result.state.hexes[D6].troops).toBe(5); // Node A owns
    expect(result.state.hexes[C6].troops).toBe(3); // plain: no troops added
    expect(result.state.hexes[C5].troops).toBe(0); // unowned plain
  });

  it("still produces on a Node that is cut off from its Base", () => {
    const result = resolve(wedge(), [], []);
    expect(score(result.state, "A", DEFAULT_CONFIG).supplied.has(F6)).toBe(false);
    expect(result.state.hexes[F6].troops).toBe(3); // 2 held + 1 produced
  });

  it("produces at a Base with an enemy hex next to it", () => {
    const state = wedge();
    state.hexes[C6].owner = "B"; // B sits between A's Base and its own Node
    const result = resolve(state, [], []);
    expect(held(result.state, B6)).toEqual(["A", 7]);
    expect(score(result.state, "A", DEFAULT_CONFIG).points).toBe(1); // only B6 is supplied
  });
});

describe("the knockout", () => {
  it("ends the match when a Base is captured, recorded as 93 to 0", () => {
    const result = resolve(atTheBase(), [order(I6, J6, 5)], []);
    expect(result.events).toEqual([
      { type: "battle", at: J6, A: 5, B: 2, owner: "B" },
      { type: "capture", at: J6, by: "A", from: "B", terrain: "base" },
    ]);
    expect(result.state.over).toBe(true);
    expect(result.state.result).toEqual({ type: "knockout", winner: "A", turn: 1, score: { A: 93, B: 0 } });
  });

  it("keeps the true position on the board of the turn that ended the match", () => {
    const result = resolve(atTheBase(), [order(I6, J6, 5)], []);
    expect(held(result.state, J6)).toEqual(["A", 2]);
    expect(score(result.state, "A", DEFAULT_CONFIG).points).toBe(5); // the real score, not 93
  });

  it("produces nothing once the match is over", () => {
    const result = resolve(atTheBase(), [order(I6, J6, 5)], []);
    expect(held(result.state, B6)).toEqual(["A", 5]); // no +2 at A's own Base
    expect(held(result.state, J6)).toEqual(["A", 2]); // no +2 at the Base just taken
  });

  it("records the 93 as every point on the board, whatever the points are worth", () => {
    const roomier: Config = { ...DEFAULT_CONFIG, points: { plain: 2, node: 3, base: 1 } };
    const result = resolve(atTheBase(), [order(I6, J6, 5)], [], { A: 0, B: 0 }, roomier);
    // 70 plain hexes at 2, 7 Nodes at 3, 2 Bases at 1.
    expect(result.state.result?.score).toEqual({ A: 163, B: 0 });
  });

  it("is a draw when both Bases fall on the same turn", () => {
    const state = atTheBase();
    state.hexes[C6].owner = "B";
    state.hexes[C6].troops = 5;
    state.hexes[B6].troops = 2;
    const result = resolve(state, [order(I6, J6, 5)], [order(C6, B6, 5)]);
    expect(result.state.over).toBe(true);
    expect(result.state.result?.type).toBe("knockout");
    expect(result.state.result?.winner).toBe(null);
    expect(result.state.result?.turn).toBe(1);
    // Neither seat took the other's Base alone, so neither is given the board.
    expect(result.state.result?.score).toEqual({ A: 0, B: 0 });
    expect(held(result.state, B6)).toEqual(["B", 2]);
    expect(held(result.state, J6)).toEqual(["A", 2]);
  });

  it("carries on when a Base is attacked but held", () => {
    const state = atTheBase();
    state.hexes[I6].troops = 1; // far too few to take it
    const result = resolve(state, [order(I6, J6, 1)], []);
    expect(result.state.over).toBe(false);
    expect(result.state.result).toBe(null);
    expect(result.events).toEqual([{ type: "battle", at: J6, A: 1, B: 2, owner: "B" }]);
    expect(held(result.state, J6)).toEqual(["B", 4]); // 2 held + 2 produced, the match went on
  });

  it("ends the match as a knockout even on the last turn of the match", () => {
    const state = { ...atTheBase(), turn: DEFAULT_CONFIG.turns };
    const result = resolve(state, [order(I6, J6, 5)], []);
    expect(result.state.result?.type).toBe("knockout");
    expect(result.state.result?.score).toEqual({ A: 93, B: 0 });
  });

  it("resolves a match that is already over to itself", () => {
    const ended = resolve(atTheBase(), [order(I6, J6, 5)], []).state;
    const again = resolve(ended, [order(I6, J6, 5), order(I6, I6, 1)], []);
    // Simulating past the end of a match must not re-stamp the turn it was
    // decided on, move the board or produce troops.
    expect(again.events).toEqual([]);
    expect(again.wasted).toEqual({ A: [], B: [] });
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(ended));
  });
});

describe("the match ending on time", () => {
  it("ends after the last turn with the true score and the winner by points", () => {
    const state = { ...wedge(), turn: DEFAULT_CONFIG.turns };
    const result = resolve(state, [], []);
    expect(result.state.over).toBe(true);
    // A holds B6, C6 and the Node at D6; the blob at F5 and F6 stays cut off.
    expect(result.state.result).toEqual({
      type: "time",
      winner: "A",
      turn: DEFAULT_CONFIG.turns,
      score: { A: 5, B: 1 },
    });
    expect(result.state.turn).toBe(DEFAULT_CONFIG.turns + 1);
  });

  it("does not end the match before the last turn", () => {
    const state = { ...wedge(), turn: DEFAULT_CONFIG.turns - 1 };
    const result = resolve(state, [], []);
    expect(result.state.over).toBe(false);
    expect(result.state.result).toBe(null);
    expect(result.state.turn).toBe(DEFAULT_CONFIG.turns);
  });

  it("calls an even score on the last turn a draw", () => {
    const state = { ...generateMap(135, DEFAULT_CONFIG), turn: DEFAULT_CONFIG.turns };
    const result = resolve(state, [], []);
    expect(result.state.result).toEqual({
      type: "time",
      winner: null,
      turn: DEFAULT_CONFIG.turns,
      score: { A: 1, B: 1 },
    });
  });
});

describe("purity and determinism", () => {
  it("changes neither the state, the orders nor the config it is given", () => {
    const state = wedge();
    const before = JSON.stringify(state);
    const submitted = [order(F5, E5, 2), order(B6, E6, 1)];
    const beforeOrders = JSON.stringify(submitted);
    const beforeConfig = JSON.stringify(DEFAULT_CONFIG);

    const result = resolveTurn(state, { A: submitted, B: [] }, { A: 0, B: 0 }, DEFAULT_CONFIG);

    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(submitted)).toBe(beforeOrders);
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(beforeConfig);
    expect(state.turn).toBe(1);
    expect(result.state.turn).toBe(2);
    // Every hex on the new board is a new object, so neither board can be
    // changed through the other.
    for (const cell of CELLS) {
      const key = hexKey(cell.q, cell.r);
      expect(result.state.hexes[key]).not.toBe(state.hexes[key]);
    }
  });

  it("gives the same board and the same events whatever order the hexes are keyed in", () => {
    const state = wedge();
    const scrambled: Record<HexKey, Hex> = {};
    for (const cell of [...CELLS].reverse()) {
      const key = hexKey(cell.q, cell.r);
      scrambled[key] = state.hexes[key];
    }
    const orders = [order(F5, E5, 2), order(B6, E6, 1)];
    const straight = resolve(state, orders, [order(J6, I6, 1)]);
    const mixed = resolve({ ...state, hexes: scrambled }, orders, [order(J6, I6, 1)]);
    expect(boardOf(mixed.state.hexes)).toEqual(boardOf(straight.state.hexes));
    expect(mixed.events).toEqual(straight.events);
    expect(mixed.wasted).toEqual(straight.wasted);
    expect(mixed.state.result).toEqual(straight.state.result);
  });

  it("resolves the same turn the same way every time it is asked", () => {
    const state = atTheGate(4, 2);
    const first = resolve(state, [order(C6, D6, 4), order(B6, C6, 2)], [order(J6, I6, 1)]);
    const second = resolve(state, [order(C6, D6, 4), order(B6, C6, 2)], [order(J6, I6, 1)]);
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
    expect(first.events).toEqual(second.events);
  });
});

interface PrototypeHex {
  q: number;
  r: number;
  id: string;
  t: Terrain;
  owner: Seat | null;
  troops: number;
  garrison: number;
}

interface PrototypeOrder {
  from: string;
  to: string;
  n: number;
}

interface PrototypeState {
  turn: number;
  seed: number;
  hexes: Record<HexKey, PrototypeHex>;
  base: Record<Seat, HexKey>;
  over: boolean;
  result: { type: string; winner: Seat | null; turn: number } | null;
}

interface PrototypeTurn {
  events: Record<string, unknown>[];
  wasted: Record<Seat, { o: PrototypeOrder; why: string }[]>;
  score: Record<Seat, number>;
}

const requireModule = createRequire(import.meta.url);
const reference = requireModule("../../../../salient/docs/reference/engine.js") as {
  DEFAULT_CFG: unknown;
  resolve: (
    state: PrototypeState,
    orders: Record<Seat, PrototypeOrder[]>,
    scouts: Record<Seat, number>,
    cfg: unknown,
  ) => PrototypeTurn;
};

function toPrototype(state: MatchState): PrototypeState {
  const hexes: Record<HexKey, PrototypeHex> = {};
  for (const [key, hex] of Object.entries<Hex>(state.hexes)) {
    hexes[key] = {
      q: hex.q,
      r: hex.r,
      id: hex.id,
      t: hex.terrain,
      owner: hex.owner,
      troops: hex.troops,
      garrison: hex.garrison,
    };
  }
  return { turn: state.turn, seed: state.seed, hexes, base: state.base, over: state.over, result: state.result };
}

const toPrototypeOrders = (orders: readonly Order[]): PrototypeOrder[] =>
  orders.map((o) => ({ from: o.from, to: o.to, n: o.troops }));

/** An event as one string, whatever order its fields were written in. */
function shapeEvent(event: Record<string, unknown>): string {
  const entries = Object.entries(event).sort((left, right) => (left[0] < right[0] ? -1 : 1));
  return JSON.stringify(entries);
}

const shapeOurWasted = (wasted: WastedOrder): string =>
  `${wasted.order.from}>${wasted.order.to} ${wasted.order.troops} ${wasted.reason}`;

const shapeTheirWasted = (wasted: { o: PrototypeOrder; why: string }): string =>
  `${wasted.o.from}>${wasted.o.to} ${wasted.o.n} ${wasted.why}`;

const outcomeOf = (
  result: { type: string; winner: Seat | null; turn: number } | null,
): [string, Seat | null, number] | null => (result === null ? null : [result.type, result.winner, result.turn]);

/**
 * Resolve one turn through this engine and through the prototype, and insist
 * they agree on the board, the events, the wasted orders, the scores and the
 * outcome. The prototype changes the state it is handed, so it gets a copy.
 */
function bothEngines(
  state: MatchState,
  orders: Record<Seat, readonly Order[]>,
  scouts: Record<Seat, number> = { A: 0, B: 0 },
  label = "turn",
): TurnOutcome {
  const ours = resolveTurn(state, { A: [...orders.A], B: [...orders.B] }, scouts, DEFAULT_CONFIG);
  const theirs = toPrototype(state);
  const theirTurn = reference.resolve(
    theirs,
    { A: toPrototypeOrders(orders.A), B: toPrototypeOrders(orders.B) },
    scouts,
    reference.DEFAULT_CFG,
  );

  expect(boardOf(ours.state.hexes), `${label} board`).toEqual(boardOf(theirs.hexes));
  const shaped = ours.events.map((event) => shapeEvent(event as unknown as Record<string, unknown>));
  expect(shaped, `${label} events`).toEqual(theirTurn.events.map(shapeEvent));
  for (const seat of ["A", "B"] as const) {
    expect(ours.wasted[seat].map(shapeOurWasted), `${label} seat ${seat} wasted`).toEqual(
      theirTurn.wasted[seat].map(shapeTheirWasted),
    );
    expect(score(ours.state, seat, DEFAULT_CONFIG).points, `${label} seat ${seat} score`).toBe(theirTurn.score[seat]);
  }
  expect(ours.state.over, `${label} over`).toBe(theirs.over);
  expect(outcomeOf(ours.state.result), `${label} outcome`).toEqual(outcomeOf(theirs.result));
  return ours;
}

/**
 * Up to two orders more than the action points allow, so the cut-off is
 * exercised too: every troop on a hex to one neighbour, either the one nearest
 * the enemy Base or a random one. `mulberry32` hands out unsigned 32-bit
 * integers, so every draw here stays in that currency. Drawn from a seed, so
 * the match is the same on every run.
 */
function marchOrders(state: MatchState, seat: Seat, seed: number, pushToBase: boolean): Order[] {
  const rnd = mulberry32(seed);
  const board = new Set<HexKey>(Object.keys(state.hexes));
  const goal = parseHexKey(state.base[seat === "A" ? "B" : "A"]);
  const orders: Order[] = [];
  for (const cell of CELLS) {
    if (orders.length >= DEFAULT_CONFIG.actionPoints + 2) break;
    const key = hexKey(cell.q, cell.r);
    const hex = state.hexes[key];
    if (hex.owner !== seat || hex.troops === 0) continue;
    const targets = neighbourKeys(key, board).filter((n) => state.hexes[n].terrain !== "blocked");
    if (targets.length === 0) continue;
    if (!pushToBase) {
      orders.push({ from: key, to: targets[rnd() % targets.length], troops: hex.troops });
      continue;
    }
    const ranked = targets
      .map((target) => ({ target, steps: hexDistance(parseHexKey(target), goal), draw: rnd() }))
      .sort((left, right) => left.steps - right.steps || left.draw - right.draw);
    orders.push({ from: key, to: ranked[0].target, troops: hex.troops });
  }
  return orders;
}

describe("turn resolution against the prototype engine", () => {
  it("reproduces the prototype's boards, events, wasted orders and scores over whole scripted matches", () => {
    const seen = { clash: 0, battle: 0, repelled: 0, capture: 0, knockout: 0, wasted: 0 };

    for (const seed of [7, 92, 108, 135, 189, 1, 2, 3, 4, 5, 6, 8, 9, 10]) {
      // In each match one seat heads for the enemy Base while the other wanders,
      // and which seat does which alternates with the seed, so the front line
      // gets crossed in both directions.
      const pushA = seed % 2 === 0;
      const played = { orders: 0, events: 0 };
      let state = generateMap(seed, DEFAULT_CONFIG);
      for (let turn = 1; turn <= DEFAULT_CONFIG.turns && !state.over; turn++) {
        const orders: Record<Seat, Order[]> = {
          A: marchOrders(state, "A", seed * 100 + 1, pushA),
          B: marchOrders(state, "B", seed * 100 + 2, !pushA),
        };
        const label = `seed ${seed} turn ${turn}`;
        const result = bothEngines(state, orders, { A: 0, B: 0 }, label);
        for (const event of result.events) seen[event.type] += 1;
        seen.wasted += result.wasted.A.length + result.wasted.B.length;
        if (result.state.result?.type === "knockout") seen.knockout += 1;

        played.orders += orders.A.length + orders.B.length - result.wasted.A.length - result.wasted.B.length;
        played.events += result.events.length;
        state = result.state;
      }

      // A seed whose orders were all dropped would compare nothing at all, so
      // each match has to have played, and to have changed the board.
      expect(played.orders, `seed ${seed} had no order accepted`).toBeGreaterThan(0);
      expect(played.events, `seed ${seed} resolved without an event`).toBeGreaterThan(0);
    }

    // These matches have to have reached the interesting parts of the rules, or
    // the comparison above would prove very little.
    expect(seen.clash).toBeGreaterThan(0);
    expect(seen.battle).toBeGreaterThan(0);
    expect(seen.repelled).toBeGreaterThan(0);
    expect(seen.capture).toBeGreaterThan(0);
    expect(seen.wasted).toBeGreaterThan(0);
    expect(seen.knockout).toBeGreaterThan(0);
  });

  it("reproduces the prototype on the cases the rules spell out", () => {
    const scenarios: [string, MatchState, Record<Seat, Order[]>][] = [
      ["clash, one side larger", facing(1), { A: [order(C5, C6, 5)], B: [order(C6, C5, 1)] }],
      ["clash, both the same size", facing(5), { A: [order(C5, C6, 5)], B: [order(C6, C5, 5)] }],
      ["clash and a move aside", facing(1), { A: [order(C5, C6, 5)], B: [order(C6, C7, 1)] }],
      ["a Node stormed by 4", atTheGate(4), { A: [order(C6, D6, 4)], B: [] }],
      ["a Node stormed by 3", atTheGate(3), { A: [order(C6, D6, 3)], B: [] }],
      ["a Node both seats enter", eitherSideOfTheNode(4, 2), { A: [order(F5, F6, 4)], B: [order(G5, F6, 2)] }],
      ["a Base taken", atTheBase(), { A: [order(I6, J6, 5)], B: [] }],
    ];
    for (const [name, state, orders] of scenarios) bothEngines(state, orders, { A: 0, B: 0 }, name);

    // Both Bases fall on one turn, which the prototype calls a draw too.
    const both = atTheBase();
    both.hexes[C6].owner = "B";
    both.hexes[C6].troops = 5;
    both.hexes[B6].troops = 2;
    bothEngines(both, { A: [order(I6, J6, 5)], B: [order(C6, B6, 5)] }, { A: 0, B: 0 }, "both Bases fall");
  });

  it("keeps every troop count and garrison a whole number through a match", () => {
    for (const seed of [135, 92, 189]) {
      let state = generateMap(seed, DEFAULT_CONFIG);
      for (let turn = 1; turn <= DEFAULT_CONFIG.turns && !state.over; turn++) {
        state = resolveTurn(
          state,
          { A: marchOrders(state, "A", seed * 7 + 1, true), B: marchOrders(state, "B", seed * 7 + 2, false) },
          { A: 0, B: 0 },
          DEFAULT_CONFIG,
        ).state;
        for (const cell of CELLS) {
          const hex = state.hexes[hexKey(cell.q, cell.r)];
          expect(Number.isInteger(hex.troops), `seed ${seed} turn ${turn}`).toBe(true);
          expect(Number.isInteger(hex.garrison), `seed ${seed} turn ${turn}`).toBe(true);
        }
      }
    }
  });
});

/** The keys the tests above name are the hexes they claim on seed 135. */
describe("the scenario board", () => {
  it("is seed 135 with the hexes the tests name", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    const idOf = (key: HexKey): string => state.hexes[key].id;
    const keys = [B6, C6, C5, C7, B5, B7, D6, E5, E6, F5, F6, G5, I6, J6];
    expect(keys.map(idOf)).toEqual([
      "B6",
      "C6",
      "C5",
      "C7",
      "B5",
      "B7",
      "D6",
      "E5",
      "E6",
      "F5",
      "F6",
      "G5",
      "I6",
      "J6",
    ]);
    expect(state.hexes[B6].terrain).toBe("base");
    expect(state.hexes[J6].terrain).toBe("base");
    expect(state.hexes[D6].terrain).toBe("node");
    expect(state.hexes[F6].terrain).toBe("node");
    expect(state.hexes[E6].terrain).toBe("blocked");
    for (const key of [C5, C6, C7, G5, E5, F5]) expect(state.hexes[key].terrain).toBe("plain");
    expect([state.hexes[D6].owner, state.hexes[D6].garrison]).toEqual([null, 3]);
    expect([state.hexes[F6].owner, state.hexes[F6].garrison]).toEqual([null, 3]);

    const board = new Set(Object.keys(state.hexes));
    expect(neighbourKeys(F6, board)).toContain(F5);
    expect(neighbourKeys(F6, board)).toContain(G5);
    expect(neighbourKeys(E5, board)).toContain(D6);
    expect(neighbourKeys(C6, board)).toContain(C5);
    expect(neighbourKeys(C6, board)).toContain(C7);
  });
});
