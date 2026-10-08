/**
 * The Node ping-pong: a Node taken and retaken on consecutive turns.
 *
 * `salient/docs/salient-rules-v0.md`'s open question "Centre Node ping-pong"
 * says the bots change the centre Node's owner on alternate turns "because they
 * attack with the exact minimum", and asks whether that recapture is meant to be
 * rewarded. This file states what the resolution rules actually do about it —
 * steps 5 to 7 of `resolveTurn`: the owner's +1 home bonus, and the neutral
 * Node's garrison of 3 that a force entering has to exceed and then pays for.
 *
 * The arithmetic those steps give, and what these tests pin down, is that
 * **the defence of a Node is the same number before and after it is taken**. A
 * neutral Node stands at its garrison, 3. A Node taken with the minimum — 4
 * troops, which is garrison + 1 — is left with 1 survivor, and step 9 produces
 * 1 more on the turn it was taken, so it stands at 2 troops plus the +1 home
 * bonus: 3 again. The recapture is therefore no dearer than the capture, and
 * the same 4 troops that took the Node from the garrison take it back from the
 * seat that took it a turn ago. Nothing in the engine breaks that chain: there
 * is no defence term for a hex taken this turn, and the garrison is never raised
 * again once a Node has been cleared.
 *
 * What the chain is not is free, and the last suite counts it. A
 * seat that wins the Node four times running pays 4 troops each time and keeps
 * the Node's 1 a turn, so the churn trades troops for the 3 points a Node is
 * worth at scoring time. That is the decision Jim made on 8 October 2026, and
 * what these tests state: the recapture is intended, the garrison and the combat
 * table stand as they are, and no series is replayed. The measurement behind it
 * is the Greedy-vs-Greedy series kept at `reports/series/greedy-vs-greedy-evidence.md`
 * — 0 of 20 matches ping-ponged — beside the model rerun's 1 of 10, both counted
 * by `isPingPong` in `packages/stats/src/rules-evidence.ts`.
 */
import { describe, expect, it } from "vitest";

import { generateMap } from "./board.ts";
import { DEFAULT_CONFIG, type Config } from "./config.ts";
import { resolveTurn } from "./resolve.ts";
import type { HexKey, MatchState, Order, Seat } from "./types.ts";

const F5 = "0,-1"; // plain, A's side of the centre Node
const G5 = "1,-1"; // plain, B's side of it
const F6 = "0,0"; // the centre Node the rules name, garrison 3 while neutral

/** The rules' constants with production off, so a test about a fight is the fight. */
const NO_PRODUCTION: Config = { ...DEFAULT_CONFIG, baseProduction: 0, nodeProduction: 0 };

const order = (from: HexKey, to: HexKey, troops: number): Order => ({ from, to, troops });

/** Resolve one turn with both seats' orders and no scouting. */
function resolve(
  state: MatchState,
  a: readonly Order[],
  b: readonly Order[],
  config: Config = DEFAULT_CONFIG,
) {
  return resolveTurn(state, { A: a, B: b }, { A: 0, B: 0 }, config);
}

const held = (state: MatchState, key: HexKey): [Seat | null, number] => [
  state.hexes[key].owner,
  state.hexes[key].troops,
];

/**
 * A holds F5 with `a` and B holds G5 with `b`, one step from the centre Node on
 * either side. Seed 135's map has E6 and G6 blocked next to F6, so F5 and G5 are
 * the only two ways onto it, which is what makes the fight here one hex wide.
 */
function eitherSideOfTheNode(a: number, b: number): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  state.hexes[F5].owner = "A";
  state.hexes[F5].troops = a;
  state.hexes[G5].owner = "B";
  state.hexes[G5].troops = b;
  return state;
}

/** A has just taken the centre Node with the minimum; B is next to it with `b`. */
function justTaken(b: number): MatchState {
  const taken = resolve(eitherSideOfTheNode(12, b), [order(F5, F6, 4)], []);
  return taken.state;
}

/** Seat `seat` sends `troops` onto the Node, and the other seat does nothing. */
function sendToTheNode(state: MatchState, seat: Seat, troops: number, config: Config = DEFAULT_CONFIG) {
  const from = seat === "A" ? F5 : G5;
  return resolve(state, seat === "A" ? [order(from, F6, troops)] : [], seat === "B" ? [order(from, F6, troops)] : [], config);
}

describe("the minimum-force attack on a Node", () => {
  it("takes a neutral Node with the garrison plus one, and keeps one troop", () => {
    const { state, events } = resolve(eitherSideOfTheNode(12, 12), [order(F5, F6, 4)], [], NO_PRODUCTION);
    expect(held(state, F6)).toEqual(["A", 1]);
    expect(state.hexes[F6].garrison).toBe(0);
    expect(events).toEqual([{ type: "capture", at: F6, by: "A", from: null, terrain: "node" }]);
  });

  it("is turned back at the garrison, and wears the garrison down by its own size", () => {
    const { state, events } = resolve(eitherSideOfTheNode(12, 12), [order(F5, F6, 3)], [], NO_PRODUCTION);
    expect(held(state, F6)).toEqual([null, 0]);
    expect(state.hexes[F6].garrison).toBe(DEFAULT_CONFIG.nodeGarrison - 3);
    expect(events).toEqual([{ type: "repelled", at: F6, by: "A", n: 3 }]);
  });

  it("leaves the Node standing at the garrison's own strength, bonus included", () => {
    const { state } = resolve(eitherSideOfTheNode(12, 12), [order(F5, F6, 4)], []);
    // 1 survivor of the 4, plus the Node's 1 of step 9 production, on the turn it
    // was taken. With the +1 home bonus that is the garrison it replaced.
    expect(held(state, F6)).toEqual(["A", 2]);
    expect(state.hexes[F6].troops + DEFAULT_CONFIG.homeBonus).toBe(DEFAULT_CONFIG.nodeGarrison);
  });
});

describe("a Node taken and retaken on consecutive turns", () => {
  it("is retaken on the very next turn by the same 4 troops that took it neutral", () => {
    const { state, events } = resolve(justTaken(12), [], [order(G5, F6, 4)]);
    expect(held(state, F6)).toEqual(["B", 2]);
    expect(events).toEqual([
      { type: "battle", at: F6, A: 2, B: 4, owner: "A" },
      { type: "capture", at: F6, by: "B", from: "A", terrain: "node" },
    ]);
  });

  it("changes owner every turn while each seat keeps bringing the minimum", () => {
    let state = eitherSideOfTheNode(12, 12);
    const owners: (Seat | null)[] = [];
    for (const seat of ["A", "B", "A", "B"] as const) {
      state = sendToTheNode(state, seat, 4).state;
      owners.push(state.hexes[F6].owner);
      // The taker always ends the turn holding it with 2: the 1 that survived the
      // fight, plus the Node's production. So the next seat faces 3 again.
      expect(held(state, F6)).toEqual([seat, 2]);
    }
    expect(owners).toEqual(["A", "B", "A", "B"]);
  });

  it("costs the attacker one troop short of the minimum both its stack and the defenders", () => {
    const { state, events } = resolve(justTaken(12), [], [order(G5, F6, 3)], NO_PRODUCTION);
    // 3 against 2 plus the bonus is a tie, and a tie destroys both sides. The hex
    // keeps its owner — a hex left with none is not lost — but stands empty.
    expect(held(state, F6)).toEqual(["A", 0]);
    expect(events).toEqual([{ type: "battle", at: F6, A: 2, B: 3, owner: "A" }]);
  });

  it("never raises the garrison again once the Node has been cleared", () => {
    let state = justTaken(12);
    for (const seat of ["B", "A", "B"] as const) {
      state = sendToTheNode(state, seat, 4).state;
      expect(state.hexes[F6].garrison).toBe(0);
    }
    // So every one of those fights is against the holder and its bonus, and the
    // number to beat is 3 every time, exactly as it was against the garrison.
    expect(held(state, F6)).toEqual(["B", 2]);
  });

  it("gives a hex taken this turn no defence it would not have after five turns", () => {
    const atOnce = resolve(justTaken(12), [], [order(G5, F6, 3)], NO_PRODUCTION);

    let heldFor = justTaken(12);
    for (let turn = 1; turn <= 4; turn++) heldFor = resolve(heldFor, [], [], NO_PRODUCTION).state;
    const later = resolve(heldFor, [], [order(G5, F6, 3)], NO_PRODUCTION);

    expect(held(later.state, F6)).toEqual(held(atOnce.state, F6));
    expect(later.events).toEqual(atOnce.events);
  });
});

describe("what the ping-pong is priced at", () => {
  it("trades 4 troops a hand change for a Node that produces 1 a turn", () => {
    let state = eitherSideOfTheNode(12, 12);
    for (const seat of ["A", "B", "A", "B"] as const) state = sendToTheNode(state, seat, 4).state;
    // Four hand changes, 4 troops each: each seat has sent 8 out of its 12 and
    // still holds nothing at the end of the fourth turn but 2 troops on the Node.
    expect(held(state, F5)).toEqual(["A", 4]);
    expect(held(state, G5)).toEqual(["B", 4]);
    expect(held(state, F6)).toEqual(["B", 2]);
    // The Node has produced 4 troops over those four turns, to whoever held it
    // when they came in, against the 8 each seat paid. The churn is a stalemate
    // that burns troops; what it buys is the 3 points a Node is worth at scoring.
    const produced = DEFAULT_CONFIG.nodeProduction * 4;
    const paid = 2 * 4 * 4;
    expect(produced).toBeLessThan(paid);
    expect(DEFAULT_CONFIG.points.node).toBe(3);
  });
});
