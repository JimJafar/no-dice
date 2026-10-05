/**
 * Order validation. The prototype in `salient/docs/reference/engine.js` is the
 * oracle: the same board and the same orders have to accept, and waste with the
 * same reasons, what the prototype did in the games the golden logs came from.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { generateMap } from "./board.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { hexKey } from "./hex.ts";
import type { Hex, HexKey, MatchState, Order, Seat, Terrain, WasteReason } from "./types.ts";
import { validateOrders, type ValidationResult } from "./validate-orders.ts";

const B6 = "-4,0"; // seat A's Base, 5 troops at the start of the turn
const C6 = "-3,0";
const C5 = "-3,-1";
const A6 = "-5,0";
const D6 = "-2,0"; // the Node two hexes out from B6
const D5 = "-2,-1";
const E6 = "-1,0"; // blocked on this map
const C7 = "-3,1"; // neutral
const J6 = "4,0"; // seat B's Base
const I6 = "3,0";

const order = (from: HexKey, to: HexKey, troops: number): Order => ({ from, to, troops });

/** Seed 135 with a fixed position: A holds a wedge from its Base towards F6. */
function scenario(): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  const own = (key: HexKey, seat: Seat, troops: number): void => {
    state.hexes[key].owner = seat;
    state.hexes[key].troops = troops;
  };
  own(C6, "A", 3);
  own(D6, "A", 4);
  own(D5, "A", 2);
  return state;
}

function reasons(result: ValidationResult): WasteReason[] {
  return result.wasted.map((wasted) => wasted.reason);
}

function wastedOrders(result: ValidationResult): Order[] {
  return result.wasted.map((wasted) => wasted.order);
}

describe("order validation", () => {
  it("accepts legal moves and wastes nothing", () => {
    const state = scenario();
    const orders = [order(B6, C6, 2), order(C6, D6, 3), order(D6, D5, 1)];
    const result = validateOrders(state, "A", orders, DEFAULT_CONFIG.actionPoints);
    expect(result.accepted).toEqual(orders);
    expect(result.wasted).toEqual([]);
  });

  it("refuses a source hex the seat does not own", () => {
    const state = scenario();
    const result = validateOrders(state, "A", [order(C7, C6, 1), order(J6, I6, 1)], 6);
    expect(result.accepted).toEqual([]);
    expect(reasons(result)).toEqual(["source hex not owned", "source hex not owned"]);
  });

  it("refuses a hex that is not on the board, at either end of the order", () => {
    const state = scenario();
    const result = validateOrders(
      state,
      "A",
      [order("9,9", C6, 1), order(C6, "9,9", 1), order(C6, "constructor", 1), order("toString", C6, 1)],
      6,
    );
    expect(result.accepted).toEqual([]);
    expect(reasons(result)).toEqual(["unknown hex", "unknown hex", "unknown hex", "unknown hex"]);
  });

  it("refuses a destination that is blocked", () => {
    const state = scenario();
    expect(state.hexes[E6].terrain).toBe("blocked");
    const result = validateOrders(state, "A", [order(D6, E6, 1)], 6);
    expect(result.accepted).toEqual([]);
    expect(reasons(result)).toEqual(["destination is blocked"]);
  });

  it("refuses a destination that is not adjacent, including the source itself", () => {
    const state = scenario();
    const result = validateOrders(state, "A", [order(B6, D6, 1), order(B6, B6, 1)], 6);
    expect(result.accepted).toEqual([]);
    expect(reasons(result)).toEqual(["hexes are not adjacent", "hexes are not adjacent"]);
  });

  it("refuses a troop count that is not a positive integer", () => {
    const state = scenario();
    const counts = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];
    const result = validateOrders(state, "A", counts.map((n) => order(B6, C6, n)), 6);
    expect(result.accepted).toEqual([]);
    expect(reasons(result)).toEqual(counts.map(() => "troop count must be a positive integer"));
  });

  it("shares the troops standing at a hex between its orders, up to what is there", () => {
    const state = scenario();
    expect(state.hexes[B6].troops).toBe(5);
    const exact = validateOrders(state, "A", [order(B6, C6, 2), order(B6, C5, 3)], 6);
    expect(exact.accepted).toEqual([order(B6, C6, 2), order(B6, C5, 3)]);
    expect(exact.wasted).toEqual([]);

    // The third order is the one over the 5 troops there, whichever it is.
    const over = validateOrders(state, "A", [order(B6, C6, 2), order(B6, C5, 2), order(B6, A6, 2)], 6);
    expect(over.accepted).toEqual([order(B6, C6, 2), order(B6, C5, 2)]);
    expect(reasons(over)).toEqual(["not enough troops in source hex"]);
  });

  it("wastes an order that is beyond the action points left, and spends no point on it", () => {
    const state = scenario();
    const orders = [order(B6, C6, 1), order(C6, D6, 1), order(D6, D5, 1), order(D5, C6, 1), order(B6, A6, 1)];
    const three = validateOrders(state, "A", orders, 3);
    expect(three.accepted).toEqual(orders.slice(0, 3));
    expect(reasons(three)).toEqual(["no action points left", "no action points left"]);

    const none = validateOrders(state, "A", orders, 0);
    expect(none.accepted).toEqual([]);
    expect(reasons(none)).toEqual(orders.map(() => "no action points left"));
  });

  it("spends an action point on an invalid order, because a final submission wastes it", () => {
    const state = scenario();
    const result = validateOrders(state, "A", [order(B6, D6, 1), order(B6, C6, 1)], 1);
    expect(result.accepted).toEqual([]);
    expect(reasons(result)).toEqual(["hexes are not adjacent", "no action points left"]);
  });

  it("spends a point on an invalid order but not the troops it names", () => {
    const state = scenario();
    const result = validateOrders(state, "A", [order(B6, C6, 1.5), order(B6, C6, 5)], 6);
    expect(result.accepted).toEqual([order(B6, C6, 5)]);
    expect(reasons(result)).toEqual(["troop count must be a positive integer"]);
  });

  it("wastes every kind of invalid order and spends its action point on it", () => {
    const invalid: [Order, WasteReason][] = [
      [order("9,9", C6, 1), "unknown hex"],
      [order(C7, C6, 1), "source hex not owned"],
      [order(D6, E6, 1), "destination is blocked"],
      [order(B6, D6, 1), "hexes are not adjacent"],
      [order(B6, C6, 0), "troop count must be a positive integer"],
      [order(B6, C6, 6), "not enough troops in source hex"],
    ];
    for (const [bad, reason] of invalid) {
      // One point left: the invalid order takes it, and the legal one behind it
      // is wasted for running out.
      const spent = validateOrders(scenario(), "A", [bad, order(B6, C6, 1)], 1);
      expect(reasons(spent), `${bad.from}>${bad.to}`).toEqual([reason, "no action points left"]);
      expect(spent.accepted, `${bad.from}>${bad.to}`).toEqual([]);
    }
  });

  it("judges each seat only by its own hexes", () => {
    const state = scenario();
    // Seat B cannot use A's wedge, and can use its own Base.
    const asB = validateOrders(state, "B", [order(B6, C6, 1), order(J6, I6, 2)], 6);
    expect(asB.accepted).toEqual([order(J6, I6, 2)]);
    expect(reasons(asB)).toEqual(["source hex not owned"]);

    // Validating one seat leaves the other's orders untouched.
    const asA = validateOrders(state, "A", [order(B6, C6, 1)], 6);
    expect(asA.accepted).toEqual([order(B6, C6, 1)]);
    expect(asA.wasted).toEqual([]);
  });

  it("changes neither the state nor the orders it was given", () => {
    const state = scenario();
    const before = JSON.stringify(state);
    const orders = [order(B6, C6, 2), order(B6, D6, 99), order("9,9", C6, 1), order(D6, E6, 1)];
    const beforeOrders = JSON.stringify(orders);
    const result = validateOrders(state, "A", orders, 6);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(orders)).toBe(beforeOrders);
    // The orders come back as they were submitted, so the log can quote them.
    expect(result.wasted[0].order).toBe(orders[1]);
    expect(result.wasted[1].order).toBe(orders[2]);
    expect(result.accepted[0]).toBe(orders[0]);
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
  result: unknown;
}

const requireModule = createRequire(import.meta.url);
const reference = requireModule("../../../../salient/docs/reference/engine.js") as {
  DEFAULT_CFG: { AP: number };
  resolve: (
    state: PrototypeState,
    orders: Record<Seat, PrototypeOrder[]>,
    scouts: Record<Seat, number>,
    cfg: unknown,
  ) => { wasted: Record<Seat, { o: PrototypeOrder; why: WasteReason }[]> };
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

const shapeOurs = (orders: Order[]): string[] => orders.map((o) => `${o.from}>${o.to} ${o.troops}`);
const shapeTheirs = (orders: PrototypeOrder[]): string[] => orders.map((o) => `${o.from}>${o.to} ${o.n}`);

describe("order validation against the prototype engine", () => {
  it("wastes the same orders, for the same reasons, in the same order", () => {
    const state = scenario();
    const orders = [
      order(B6, C6, 2), // legal
      order(C6, D6, 3), // legal
      order("9,9", C6, 1), // unknown source
      order(C7, C6, 1), // neutral source
      order(J6, I6, 1), // seat B's Base
      order(D6, E6, 1), // blocked destination
      order(B6, D6, 1), // two hexes away
      order(D5, D6, 0), // no troops
      order(D5, C5, 1.5), // fractional troops
      order(B6, C5, 4), // 2 already sent from B6, so 6 > 5
      order(B6, A6, 3), // exactly fills B6
      order(D6, C6, 9), // more than the 4 standing at D6
    ];
    const theirs = orders.map((o) => ({ from: o.from, to: o.to, n: o.troops }));

    // Enough action points to examine every order, so each reason is compared.
    const resolved = reference.resolve(toPrototype(state), { A: theirs, B: [] }, { A: 0, B: 0 }, {
      ...reference.DEFAULT_CFG,
      AP: orders.length,
    });
    const ours = validateOrders(state, "A", orders, orders.length);

    expect(shapeOurs(wastedOrders(ours))).toEqual(shapeTheirs(resolved.wasted.A.map((w) => w.o)));
    expect(reasons(ours)).toEqual(resolved.wasted.A.map((w) => w.why));
    expect(ours.accepted.length).toBe(orders.length - resolved.wasted.A.length);
    expect(shapeOurs(ours.accepted).join(" ")).toBe(
      [`${B6}>${C6} 2`, `${C6}>${D6} 3`, `${B6}>${A6} 3`].join(" "),
    );
  });

  it("spends action points the way the prototype does, at the rules' limit of 6", () => {
    const state = scenario();
    const orders = [
      order(B6, C6, 1),
      order(B6, D6, 99), // invalid, but still costs a point
      order(C6, D6, 1),
      order(D6, E6, 1),
      order(D5, C6, 1),
      order(B6, A6, 1),
      order(C6, C7, 1),
      order(D5, D6, 1),
    ];
    const theirs = orders.map((o) => ({ from: o.from, to: o.to, n: o.troops }));
    const resolved = reference.resolve(toPrototype(state), { A: theirs, B: [] }, { A: 0, B: 0 }, reference.DEFAULT_CFG);
    const ours = validateOrders(state, "A", orders, DEFAULT_CONFIG.actionPoints);
    expect(reasons(ours)).toEqual(resolved.wasted.A.map((w) => w.why));
    expect(ours.accepted.length).toBe(orders.length - resolved.wasted.A.length);
  });
});

/** The board order is used by other engine code; keep the keys here honest. */
describe("the scenario board", () => {
  it("is seed 135 with the hexes the tests name", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    const idOf = (key: HexKey): string => state.hexes[key].id;
    expect([idOf(B6), idOf(C6), idOf(C5), idOf(A6), idOf(D6), idOf(D5), idOf(E6), idOf(C7), idOf(J6), idOf(I6)]).toEqual([
      "B6",
      "C6",
      "C5",
      "A6",
      "D6",
      "D5",
      "E6",
      "C7",
      "J6",
      "I6",
    ]);
    expect(state.hexes[D6].terrain).toBe("node");
    expect(state.hexes[E6].terrain).toBe("blocked");
    expect(state.hexes[C7].owner).toBe(null);
    expect(hexKey(-4, 0)).toBe(B6);
  });
});
