/**
 * The two tools that spend something without committing anything: `scout`, which
 * buys a look at the turn as it opened, and `simulate`, which projects a turn on
 * nothing but what the caller knows.
 *
 * Both are tested by what they answer and, just as much, by what they leave out.
 * A scout is answered from the board the turn opened on, so a submission by the
 * other seat — which commits nothing until `resolveTurn` — has not moved the
 * hexes it reports. A simulation runs the real engine over a board with the
 * caller's unknown hexes emptied, so a stack the caller has not seen neither
 * fights in the projection nor shows up in it: the enemy Base and the pair on
 * I6 are beyond the reach of every hex the caller can see, and produce nothing
 * the caller is told about.
 *
 * Seed 135 is the map `view.test.ts` uses: seat A's Base at B6 sees seven hexes,
 * and seat B's Base at J6 and the hexes around it are nowhere in that.
 */
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import type { HexLabel, LogOrder } from "@no-dice/log";
import { describe, expect, it } from "vitest";

import { MatchServer } from "./server.ts";
import type { SimulateView } from "./simulate.ts";
import type { ScoutView, StateHexView, StateView } from "./view.ts";

/** A match with its first turn open. */
function openedMatch(seed = 135): { server: MatchServer; matchId: string } {
  const server = new MatchServer();
  const { matchId } = server.createMatch(seed, DEFAULT_CONFIG);
  server.openTurn(matchId);
  return { server, matchId };
}

/** A tool call that worked, answered in the shape the tool documents. */
function call<T>(server: MatchServer, matchId: string, seat: Seat, tool: string, args: unknown): T {
  const outcome = server.call(matchId, seat, tool, args);
  if (!outcome.ok) throw new Error(`${tool} answered ${outcome.error}`);
  return outcome.result as T;
}

const scout = (server: MatchServer, matchId: string, seat: Seat, hex: string): ScoutView =>
  call<ScoutView>(server, matchId, seat, "scout", { hex });

const simulate = (
  server: MatchServer,
  matchId: string,
  seat: Seat,
  args: { orders: unknown; assumed_enemy_orders?: unknown },
): SimulateView => call<SimulateView>(server, matchId, seat, "simulate", args);

const stateOf = (server: MatchServer, matchId: string, seat: Seat): StateView =>
  call<StateView>(server, matchId, seat, "get_state", {});

const hexIds = (hexes: StateHexView[]): string[] => hexes.map((hex) => hex.id);

/** Both seats step one hex forward, which puts B's pair on I6, out of A's sight. */
function bothSeatsAdvanced(server: MatchServer, matchId: string): void {
  server.call(matchId, "A", "submit_orders", {
    orders: [{ from: "B6", to: "C6", troops: 2 }],
    intent: "edge forward",
    prediction: "B holds",
  });
  server.call(matchId, "B", "submit_orders", {
    orders: [{ from: "J6", to: "I6", troops: 2 }],
    intent: "edge forward",
    prediction: "A holds",
  });
  server.resolveTurn(matchId);
  server.openTurn(matchId);
}

/**
 * Both seats walk the corridor seed 135 leaves walkable end to end —
 * `B6 C6 D6 E5 F5 G5 H5 I5 J5 J6` — one move a turn, except seat A resting on
 * turn 4. D6 is a Node garrisoned to three, so a stack taking it arrives with
 * four. Four turns leave seat A holding B6, D6 and E5, and seat B's pair split
 * between I5 (3) and G5 (1) — G5 one hex past the ring seat A can see, and next
 * to F5, which seat A can see.
 */
function bothSeatsMarched(server: MatchServer, matchId: string): void {
  const march: { a: LogOrder[]; b: LogOrder[] }[] = [
    { a: [{ from: "B6", to: "C6", troops: 4 }], b: [{ from: "J6", to: "J5", troops: 4 }] },
    { a: [{ from: "C6", to: "D6", troops: 4 }], b: [{ from: "J5", to: "I5", troops: 4 }] },
    { a: [{ from: "D6", to: "E5", troops: 1 }], b: [{ from: "I5", to: "H5", troops: 1 }] },
    { a: [], b: [{ from: "H5", to: "G5", troops: 1 }] },
  ];
  for (const step of march) {
    server.call(matchId, "A", "submit_orders", {
      orders: step.a,
      intent: "along the corridor",
      prediction: "the corridor holds",
    });
    server.call(matchId, "B", "submit_orders", {
      orders: step.b,
      intent: "along the corridor",
      prediction: "the corridor holds",
    });
    server.resolveTurn(matchId);
    server.openTurn(matchId);
  }
}

/**
 * The ring seat A can see once the march is over, in the board's one
 * order — the geometry both edge cases stand on. E6, which E5 also touches,
 * is blocked and so is never answered. F5 is the last hex in, and G5 sits one
 * hex beyond it.
 */
const aRingAfterMarch: HexLabel[] = [
  "E4",
  "F4",
  "B5",
  "C5",
  "D5",
  "E5",
  "F5",
  "A6",
  "B6",
  "C6",
  "D6",
  "A7",
  "B7",
  "C7",
  "D7",
];

/** Seat B's own answer for the hex seat A must not see: the stack, standing there. */
const g5AsItsOwnerSeesIt = {
  id: "G5",
  owner: "you",
  troops: 1,
  neighbours: ["H5", "H4", "G4", "F5", "F6"],
};

describe("scout", () => {
  it("spends one action point on the hex asked for and the hexes it touches", () => {
    const { server, matchId } = openedMatch();

    const revealed = scout(server, matchId, "A", "D6");

    // The Node and its neighbours, in the board's one order. E6, which D6 also
    // touches, is blocked: it has no owner and no troops to report, and its
    // terrain is already in `get_rules`.
    expect(revealed.hexes).toEqual([
      { id: "D5", owner: null, troops: 0 },
      { id: "E5", owner: null, troops: 0 },
      { id: "C6", owner: null, troops: 0 },
      { id: "D6", owner: null, troops: 0, garrison: 3 },
      { id: "C7", owner: null, troops: 0 },
      { id: "D7", owner: null, troops: 0 },
    ]);
    // One of the six action points the seat shares with its orders, and the
    // call itself counted against the twelve.
    expect(server.match(matchId).counters("A")).toEqual({
      toolCalls: 1,
      simulations: 0,
      apSpentOnScouts: 1,
      scouted: ["D6"],
    });
    // The hex is logged as one of the seat's scouts, in the order it asked.
    expect(server.turnRecord(matchId, 1).A.scouts).toEqual(["D6"]);
  });

  it("reports the turn as it opened, whatever the other seat has submitted", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "B", "submit_orders", {
      orders: [{ from: "J6", to: "I6", troops: 2 }],
      intent: "edge forward",
      prediction: "A holds",
    });

    const revealed = scout(server, matchId, "A", "I6");

    // Nothing is committed until the turn resolves, so I6 is still empty and
    // seat B's Base still has the five it started the turn with.
    const at = (id: string): StateHexView | undefined => revealed.hexes.find((hex) => hex.id === id);
    expect(at("I6")).toEqual({ id: "I6", owner: null, troops: 0 });
    expect(at("J6")).toEqual({ id: "J6", owner: "enemy", troops: 5 });
    expect(at("H6")).toEqual({ id: "H6", owner: null, troops: 0, garrison: 3 });
    expect(hexIds(revealed.hexes)).toEqual(["I5", "J5", "H6", "I6", "J6", "H7", "I7"]);
  });

  it("leaves a hidden enemy stack out of a scout of the hexes next to it", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);

    const revealed = scout(server, matchId, "A", "D6");

    // D6 and the six hexes it touches are nowhere near the pair seat B moved
    // onto I6.
    expect(hexIds(revealed.hexes)).toEqual(["D5", "E5", "C6", "D6", "C7", "D7"]);
    expect(revealed.hexes.some((hex) => hex.owner === "enemy")).toBe(false);
  });

  it("leaves a stack one hex past the ring it scouted out of the answer", () => {
    const { server, matchId } = openedMatch();
    // Seat B's lone troop stands on G5, one hex outside seat A's ring.
    bothSeatsMarched(server, matchId);
    expect(hexIds(stateOf(server, matchId, "A").hexes)).toEqual(aRingAfterMarch);

    // F4 is the hex at the very edge of what seat A can see. Its ring is
    // `E4 E5 F3 F4 F5 G3 G4`: G5 touches two hexes in that ring — F5 and G4 —
    // and is in none of it, so the scout still has to leave it out.
    const revealed = scout(server, matchId, "A", "F4");

    expect(hexIds(revealed.hexes)).toEqual(["F3", "G3", "E4", "F4", "G4", "E5", "F5"]);
    // Nothing else in the answer carries it either: not the neighbours of the hex
    // seat A owns inside the ring, not a 0-troop placeholder for the hex itself.
    expect(JSON.stringify(revealed)).not.toContain("G5");

    // What the scout made known stops at its ring: the three hexes of it seat A
    // had not seen are in its answer from here on, and G5 still is not.
    const known = hexIds(stateOf(server, matchId, "A").hexes);
    expect(known).toContain("F3");
    expect(known).toContain("G4");
    expect(known).not.toContain("G5");

    // The control: the stack is where the march put it, and its own seat is told.
    expect(stateOf(server, matchId, "B").hexes.find((hex) => hex.id === "G5")).toEqual(
      g5AsItsOwnerSeesIt,
    );
  });

  it("makes the hexes it revealed known for the rest of the turn", () => {
    const { server, matchId } = openedMatch();

    expect(hexIds(stateOf(server, matchId, "A").hexes)).not.toContain("D6");
    scout(server, matchId, "A", "D6");

    const state = stateOf(server, matchId, "A");
    expect(hexIds(state.hexes)).toEqual([
      "B5",
      "C5",
      "D5",
      "E5",
      "A6",
      "B6",
      "C6",
      "D6",
      "A7",
      "B7",
      "C7",
      "D7",
    ]);
    expect(state.hexes.find((hex) => hex.id === "D6")).toEqual({
      id: "D6",
      owner: null,
      troops: 0,
      garrison: 3,
    });
    expect(state.action_points_left).toBe(5);
  });

  it("refuses a hex that is not on the board and spends no action point", () => {
    const { server, matchId } = openedMatch();

    // A label that names a hex outside the radius, and a string that is no hex.
    expect(server.call(matchId, "A", "scout", { hex: "A1" }).error).toBe("unknown_hex");
    expect(server.call(matchId, "A", "scout", { hex: "somewhere" }).error).toBe("unknown_hex");
    expect(server.call(matchId, "A", "scout", {}).error).toBe("unknown_hex");

    // The calls counted against the twelve; the hexes counted as nothing.
    expect(server.match(matchId).counters("A")).toEqual({
      toolCalls: 3,
      simulations: 0,
      apSpentOnScouts: 0,
      scouted: [],
    });
    expect(stateOf(server, matchId, "A").action_points_left).toBe(6);
  });
});

describe("simulate", () => {
  it("answers which orders would run and which would be wasted, and spends no action point", () => {
    const { server, matchId } = openedMatch();

    const view = simulate(server, matchId, "A", {
      orders: [
        { from: "B6", to: "C6", troops: 2 },
        { from: "B6", to: "D6", troops: 2 },
      ],
    });

    expect(view.accepted).toEqual([{ from: "B6", to: "C6", troops: 2 }]);
    expect(view.wasted).toEqual([
      { order: { from: "B6", to: "D6", troops: 2 }, reason: "hexes are not adjacent" },
    ]);
    // C6 is taken; B6 sent two and produced two, so it stands where it was.
    expect(view.changed_hexes).toEqual([{ id: "C6", owner: "you", troops: 2 }]);
    expect(view.your_score_after).toBe(2);

    // A simulation costs one of the three, and no action point — and the board
    // it projected is not the board the match plays.
    expect(server.match(matchId).counters("A")).toEqual({
      toolCalls: 1,
      simulations: 1,
      apSpentOnScouts: 0,
      scouted: [],
    });
    expect(stateOf(server, matchId, "A").hexes.find((hex) => hex.id === "C6")).toEqual({
      id: "C6",
      owner: null,
      troops: 0,
    });
  });

  it("projects only what the caller knows, so a hidden stack never appears", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);
    // Seat B has a pair on I6 and five more at J6, and neither hex is one seat A
    // can see.
    expect(hexIds(stateOf(server, matchId, "A").hexes)).not.toContain("I6");

    const view = simulate(server, matchId, "A", { orders: [] });

    // The only hex the projection moved is seat A's own Base, which produced.
    // Seat B's Base produced too, and is not in the answer: a hex A cannot see
    // has no state for the answer to report.
    expect(view.changed_hexes).toEqual([{ id: "B6", owner: "you", troops: 7 }]);
    // Only the caller's own score is answered: the enemy's would say what is on
    // the hexes it has not seen.
    expect(view.your_score_after).toBe(2);
  });

  it("keeps a stack one hex past the caller's ring out of the projection, and refuses an order from it", () => {
    const { server, matchId } = openedMatch();
    bothSeatsMarched(server, matchId);
    // The ring the case stands on: F5 is the hex seat A can see, G5 the one next
    // to it that it cannot.
    expect(hexIds(stateOf(server, matchId, "A").hexes)).toEqual(aRingAfterMarch);

    // Seat A marches its lone troop onto the last hex it can see. The projection
    // runs on a board where G5 is empty, so nothing there fights back.
    const view = simulate(server, matchId, "A", { orders: [{ from: "E5", to: "F5", troops: 1 }] });

    expect(view.accepted).toEqual([{ from: "E5", to: "F5", troops: 1 }]);
    expect(view.wasted).toEqual([]);
    expect(view.changed_hexes).toEqual([
      { id: "E5", owner: "you", troops: 0 },
      { id: "F5", owner: "you", troops: 1 },
      { id: "B6", owner: "you", troops: 11 },
      { id: "D6", owner: "you", troops: 4 },
    ]);
    expect(view.your_score_after).toBe(7);
    // No field of the projection names the hex: not a changed one, not an
    // accepted order into it.
    expect(JSON.stringify(view)).not.toContain("G5");

    // An order out of G5 is refused the same way an order out of far-off I6 is:
    // the caller may only assume orders from a hex it has seen the enemy
    // hold, and nearly seeing it is not seeing it.
    const refused = server.call(matchId, "A", "simulate", {
      orders: [],
      assumed_enemy_orders: [{ from: "G5", to: "F5", troops: 1 }],
    });
    expect(refused.error).toBe("unknown_enemy_hex");
    expect(refused.result).toEqual({ error: "unknown_enemy_hex" });

    // The control: the stack is where the march put it, and its own seat is told.
    expect(stateOf(server, matchId, "B").hexes.find((hex) => hex.id === "G5")).toEqual(
      g5AsItsOwnerSeesIt,
    );
  });

  it("refuses an assumed enemy order from a hex the caller has not seen the enemy hold", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);

    const refused = server.call(matchId, "A", "simulate", {
      orders: [],
      assumed_enemy_orders: [{ from: "I6", to: "H6", troops: 2 }],
    });

    // Seat A has never seen I6, so an order from it is a question about who is
    // standing there.
    expect(refused.error).toBe("unknown_enemy_hex");
    expect(refused.result).toEqual({ error: "unknown_enemy_hex" });
    // J6 is the enemy Base. Its position is in `get_rules`, and the board the
    // projection runs on leaves the enemy owning it so the turn is not read as a
    // knockout — an order out of a Base no one has looked at is still refused.
    const fromBase = server.call(matchId, "A", "simulate", {
      orders: [],
      assumed_enemy_orders: [{ from: "J6", to: "I6", troops: 2 }],
    });
    expect(fromBase.error).toBe("unknown_enemy_hex");
    // A call that answered an error counted against the twelve, not the three.
    expect(server.match(matchId).counters("A")).toMatchObject({ toolCalls: 2, simulations: 0 });
  });

  it("takes an assumed enemy order once a scout has revealed the hex it starts from", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);
    scout(server, matchId, "A", "I6");

    const view = simulate(server, matchId, "A", {
      orders: [],
      assumed_enemy_orders: [{ from: "I6", to: "H6", troops: 2 }],
    });

    expect(view.accepted).toEqual([]);
    expect(view.wasted).toEqual([]);
    // The pair leaves I6 and is turned back at the Node: I6 stays seat B's with
    // nothing on it, and H6 keeps its garrison, which the answer does not track.
    // Both Bases produced, and now that A has seen J6 it may hear about that.
    expect(view.changed_hexes).toEqual([
      { id: "B6", owner: "you", troops: 7 },
      { id: "I6", owner: "enemy", troops: 0 },
      { id: "J6", owner: "enemy", troops: 7 },
    ]);
    expect(view.your_score_after).toBe(2);
  });

  it("validates an assumed enemy order like a real one, and drops it if it is not a move", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);
    scout(server, matchId, "A", "I6");

    const view = simulate(server, matchId, "A", {
      orders: [],
      // I6 and G6 are two hexes apart: the pair does not move, and the
      // projection says so rather than carrying the order out.
      assumed_enemy_orders: [{ from: "I6", to: "G6", troops: 2 }],
    });

    expect(view.changed_hexes).toEqual([
      { id: "B6", owner: "you", troops: 7 },
      { id: "J6", owner: "enemy", troops: 7 },
    ]);
    expect(view.your_score_after).toBe(2);
  });

  it("counts against the three simulations a seat gets in a turn", () => {
    const { server, matchId } = openedMatch();

    for (let i = 0; i < 3; i++) simulate(server, matchId, "A", { orders: [] });

    expect(server.match(matchId).counters("A")).toMatchObject({ simulations: 3 });
    expect(stateOf(server, matchId, "A").limits).toEqual({ tool_calls_left: 9, simulations_left: 0 });
    expect(stateOf(server, matchId, "B").limits).toEqual({ tool_calls_left: 12, simulations_left: 3 });
  });

  it("refuses a call whose orders are not orders", () => {
    const { server, matchId } = openedMatch();

    // A hex named by the engine's key, and an assumed move with no destination.
    expect(
      server.call(matchId, "A", "simulate", { orders: [{ from: "-4,0", to: "-3,0", troops: 2 }] }).error,
    ).toBe("invalid_orders");
    expect(
      server.call(matchId, "A", "simulate", {
        orders: [{ from: "B6", to: "C6", troops: 2 }],
        assumed_enemy_orders: [{ from: "J6", troops: 2 }],
      }).error,
    ).toBe("invalid_orders");
    expect(server.match(matchId).counters("A")).toMatchObject({ simulations: 0 });
  });
});
