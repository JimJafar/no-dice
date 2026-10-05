/**
 * The two read-only tools, and what they leave out.
 *
 * `get_rules` answers the match's static half, so its tests are about the map:
 * every hex present, once, in one fixed order, with neighbours only where a
 * counter can actually walk. `get_state` answers the half that moves, so its
 * tests are mostly about absence — the hexes the seat cannot see, the other
 * seat's name, and the neighbours of a hex it cannot move from.
 */
import { readFileSync } from "node:fs";

import { DEFAULT_CONFIG, boardCells, hexLabel } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { matchConfigSchema } from "@no-dice/log";
import type { HexLabel } from "@no-dice/log";
import { describe, expect, it } from "vitest";

import { MatchServer } from "./server.ts";
import { PLAYER_SYSTEM_PROMPT, playerRulesText, stateView, type RulesView, type StateView } from "./view.ts";

/** A match with its first turn open, and both seats able to call. */
function openedMatch(seed = 135): { server: MatchServer; matchId: string } {
  const server = new MatchServer();
  const { matchId } = server.createMatch(seed, DEFAULT_CONFIG);
  server.openTurn(matchId);
  return { server, matchId };
}

/** A call that worked, answered in the shape the tool documents. */
function call<T>(server: MatchServer, matchId: string, seat: Seat, tool: string): T {
  const outcome = server.call(matchId, seat, tool, {});
  if (!outcome.ok) throw new Error(`${tool} answered ${outcome.error}`);
  return outcome.result as T;
}

const rulesOf = (server: MatchServer, matchId: string, seat: Seat): RulesView =>
  call<RulesView>(server, matchId, seat, "get_rules");

const stateOf = (server: MatchServer, matchId: string, seat: Seat): StateView =>
  call<StateView>(server, matchId, seat, "get_state");

/** Every hex label in the order the board is walked: row, then column. */
const boardOrder = (): HexLabel[] =>
  boardCells(DEFAULT_CONFIG.radius).map((cell) => hexLabel(cell.q, cell.r, DEFAULT_CONFIG.radius));

/**
 * Everywhere a payload names a seat outright — a field called `A`, or a value
 * that is just `"A"`. A seat-relative answer never does: the other player is
 * `enemy`, and the caller is `you`.
 */
function seatNames(value: unknown, key?: string): string[] {
  const found: string[] = [];
  if (typeof value === "string") return value === "A" || value === "B" ? [`${key}=${value}`] : [];
  if (Array.isArray(value)) return value.flatMap((item) => seatNames(item, key));
  if (value !== null && typeof value === "object") {
    for (const [name, child] of Object.entries(value)) {
      if (name === "A" || name === "B") found.push(name);
      found.push(...seatNames(child, name));
    }
  }
  return found;
}

/** Both seats step one hex forward, and the turn resolves with each on a new hex. */
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

describe("get_rules", () => {
  it("lists every hex of the map once, in the board's own order", () => {
    const { server, matchId } = openedMatch();

    const rules = rulesOf(server, matchId, "A");

    expect(rules.map).toHaveLength(91);
    expect(rules.map.map((hex) => hex.id)).toEqual(boardOrder());
    expect(new Set(rules.map.map((hex) => hex.id)).size).toBe(91);
  });

  it("gives neighbours to passable hexes only, and never to a blocked one", () => {
    const { server, matchId } = openedMatch();

    const rules = rulesOf(server, matchId, "A");
    const terrain = new Map(rules.map.map((hex) => [hex.id, hex.terrain]));

    expect(rules.map.filter((hex) => hex.terrain === "blocked")).toHaveLength(12);
    for (const hex of rules.map) {
      if (hex.terrain === "blocked") {
        expect(hex.neighbours).toBeUndefined();
        continue;
      }
      const neighbours = hex.neighbours ?? [];
      expect(neighbours.length).toBeGreaterThan(0);
      // A blocked hex cannot be walked into, so it is not in anyone's list, and
      // the map is undirected: a neighbour names its hex back.
      for (const neighbour of neighbours) {
        expect(terrain.get(neighbour)).not.toBe("blocked");
        expect(rules.map.find((other) => other.id === neighbour)?.neighbours).toContain(hex.id);
      }
    }
  });

  it("answers the constants the match is played under, in the log's spelling", () => {
    const { server, matchId } = openedMatch();

    const { constants } = rulesOf(server, matchId, "A");

    const parsed = matchConfigSchema.safeParse(constants);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    expect(parsed.data).toEqual(constants);
    expect(constants).toEqual({
      turns: 25,
      action_points: 6,
      start_troops: 5,
      base_production: 2,
      node_production: 1,
      node_garrison: 3,
      home_bonus: 1,
      points: { plain: 1, base: 1, node: 3 },
    });
  });

  it("gives both seats the same bytes, and only swaps which Base is `you`", () => {
    const { server, matchId } = openedMatch();

    const a = rulesOf(server, matchId, "A");
    const b = rulesOf(server, matchId, "B");

    expect(a.rules).toBe(b.rules);
    expect(a.map).toEqual(b.map);
    expect(a.constants).toEqual(b.constants);
    expect(a.bases).toEqual({ you: "B6", enemy: "J6" });
    expect(b.bases).toEqual({ you: "J6", enemy: "B6" });
    expect(seatNames(a)).toEqual([]);
    expect(seatNames(b)).toEqual([]);
  });

  it("holds the rules document's sections and the brief's instructions, byte for byte", () => {
    const rulesDoc = readFileSync(
      new URL("../../../../salient/docs/salient-rules-v0.md", import.meta.url),
      "utf8",
    );
    const brief = readFileSync(
      new URL("../../../../salient/docs/salient-build-brief.md", import.meta.url),
      "utf8",
    );
    const sections = rulesDoc
      .slice(rulesDoc.indexOf("## Board and map"), rulesDoc.indexOf("## MCP tool surface"))
      .replace(/\s+$/, "");
    const at = brief.indexOf("You are one of the two players in a game of Salient.");
    const instructions = brief
      .slice(brief.lastIndexOf("```", at) + 3, brief.indexOf("```", at))
      .replace(/^\n/, "")
      .replace(/\s+$/, "");

    // The same file is what brief §6.3 hands Pi as the player's system prompt.
    expect(PLAYER_SYSTEM_PROMPT.pathname).toMatch(/games\/salient\/prompts\/player-system\.md$/);
    expect(playerRulesText()).toBe(`${sections}\n\n${instructions}\n`);
  });
});

describe("get_state", () => {
  it("lists only the hexes the seat can see, in the board's one order", () => {
    const { server, matchId } = openedMatch();

    const a = stateOf(server, matchId, "A");

    // Seat A owns only B6, so it sees B6 and the six hexes around it — and the
    // order is the board's, not the order the hexes were discovered in.
    expect(a.hexes.map((hex) => hex.id)).toEqual(["B5", "C5", "A6", "B6", "C6", "A7", "B7"]);
    expect(a.hexes.map((hex) => hex.owner)).toEqual([null, null, null, "you", null, null, null]);
    expect(a.turn).toBe(1);
    expect(a.turns_total).toBe(25);
    expect(a.scores).toEqual({ you: 1, enemy: 1 });
    expect(a.last_turn).toBeNull();
    expect(seatNames(a)).toEqual([]);
  });

  it("lists the same hexes in the same order from both ends of the board", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);

    const order = boardOrder();
    const a = stateOf(server, matchId, "A").hexes.map((hex) => hex.id);
    const b = stateOf(server, matchId, "B").hexes.map((hex) => hex.id);

    // Each list is the board's order with the unknown hexes taken out, so the
    // two seats never see a different sequence.
    expect(a).toEqual(order.filter((id) => a.includes(id)));
    expect(b).toEqual(order.filter((id) => b.includes(id)));
    expect(a).toEqual(["B5", "C5", "D5", "A6", "B6", "C6", "D6", "A7", "B7", "C7"]);
  });

  it("repeats neighbours only where the seat can move from, and garrisons only on unowned Nodes", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);

    const terrain = new Map(rulesOf(server, matchId, "A").map.map((hex) => [hex.id, hex.terrain]));
    for (const seat of ["A", "B"] as const) {
      for (const hex of stateOf(server, matchId, seat).hexes) {
        expect([hex.id, "neighbours" in hex]).toEqual([hex.id, hex.owner === "you" && hex.troops > 0]);
        expect([hex.id, "garrison" in hex]).toEqual([
          hex.id,
          terrain.get(hex.id) === "node" && hex.owner === null,
        ]);
      }
    }

    const c6 = stateOf(server, matchId, "A").hexes.find((hex) => hex.id === "C6");
    expect(c6).toEqual({
      id: "C6",
      owner: "you",
      troops: 2,
      neighbours: ["D6", "D5", "C5", "B6", "B7", "C7"],
    });
  });

  it("lists a hex the seat holds with nothing on it without neighbours", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "A", "submit_orders", {
      orders: [{ from: "B6", to: "C6", troops: 2 }],
      intent: "take C6",
      prediction: "uncontested",
    });
    server.resolveTurn(matchId);
    server.openTurn(matchId);
    // Two troops against a Node garrisoned to three: the attack fails, the
    // troops are gone, and C6 stays seat A's with nothing standing on it.
    server.call(matchId, "A", "submit_orders", {
      orders: [{ from: "C6", to: "D6", troops: 2 }],
      intent: "take the Node",
      prediction: "the garrison holds",
    });
    server.resolveTurn(matchId);
    server.openTurn(matchId);

    const hexes = stateOf(server, matchId, "A").hexes;

    expect(hexes.find((hex) => hex.id === "C6")).toEqual({ id: "C6", owner: "you", troops: 0 });
    // The garrison the attack wore down is still what an attacker has to beat.
    expect(hexes.find((hex) => hex.id === "D6")).toEqual({
      id: "D6",
      owner: null,
      troops: 0,
      garrison: 1,
    });
  });

  it("keeps an enemy stack outside the visible ring out of both seats' answers", () => {
    const { server, matchId } = openedMatch();
    // Seat B's pair steps onto I6, seven hexes from anything seat A can see.
    bothSeatsAdvanced(server, matchId);

    const a = stateOf(server, matchId, "A");
    const b = stateOf(server, matchId, "B");

    expect(a.hexes.map((hex) => hex.id)).not.toContain("I6");
    expect(a.hexes.some((hex) => hex.owner === "enemy")).toBe(false);
    // The same holds the other way: B never hears about the stack on C6.
    expect(b.hexes.map((hex) => hex.id)).not.toContain("C6");
    expect(b.hexes.some((hex) => hex.owner === "enemy")).toBe(false);
    // And no field of either answer names the other seat.
    expect(seatNames(a)).toEqual([]);
    expect(seatNames(b)).toEqual([]);
  });

  it("treats a hex scouted this turn as known, and spends its action point", () => {
    const { server, matchId } = openedMatch();
    bothSeatsAdvanced(server, matchId);
    const session = server.match(matchId);
    const view = (scouted: HexLabel[]) =>
      stateView({
        state: session.state,
        seat: "A",
        config: DEFAULT_CONFIG,
        used: { toolCalls: 1, simulations: 0, apSpentOnScouts: scouted.length, scouted },
        previous: null,
      });

    expect(view([]).hexes.map((hex) => hex.id)).not.toContain("I6");
    expect(view(["I6"]).hexes.find((hex) => hex.id === "I6")).toEqual({
      id: "I6",
      owner: "enemy",
      troops: 2,
    });
    expect(view(["I6"]).action_points_left).toBe(5);
  });

  it("counts down the calls, simulations and action points the seat has left", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "A", "get_rules", {});
    server.call(matchId, "A", "get_state", {});

    expect(stateOf(server, matchId, "A").limits).toEqual({ tool_calls_left: 10, simulations_left: 3 });
    expect(stateOf(server, matchId, "B").limits).toEqual({ tool_calls_left: 12, simulations_left: 3 });
    expect(stateOf(server, matchId, "A").action_points_left).toBe(6);
  });

  it("reports last turn in the seat's own words, and only on hexes it could see", () => {
    const { server, matchId } = openedMatch();
    // Seat A's second order is illegal, so the first attempt is refused and
    // commits nothing; the seat hands the same orders in again, and that second
    // submission is final whatever it carries. The wasted order it hears about
    // next turn is one it was told about and played anyway.
    const attempt = {
      orders: [
        { from: "B6", to: "C6", troops: 2 },
        { from: "B6", to: "D6", troops: 2 },
      ],
      intent: "edge forward",
      prediction: "B holds",
    };
    expect(server.call(matchId, "A", "submit_orders", attempt).result).toEqual({
      accepted: false,
      wasted: [{ order: { from: "B6", to: "D6", troops: 2 }, reason: "hexes are not adjacent" }],
    });
    server.call(matchId, "A", "submit_orders", attempt);
    server.call(matchId, "B", "submit_orders", {
      orders: [{ from: "J6", to: "I6", troops: 2 }],
      intent: "edge forward",
      prediction: "A holds",
    });
    server.resolveTurn(matchId);
    server.openTurn(matchId);

    // Each seat hears the capture it could see, and not the one on the far side.
    expect(stateOf(server, matchId, "A").last_turn).toEqual({
      your_orders: [
        { from: "B6", to: "C6", troops: 2 },
        { from: "B6", to: "D6", troops: 2 },
      ],
      wasted: [{ order: { from: "B6", to: "D6", troops: 2 }, reason: "hexes are not adjacent" }],
      events: [{ type: "capture", at: "C6", by: "you", from: null, terrain: "plain" }],
    });
    expect(stateOf(server, matchId, "B").last_turn).toEqual({
      your_orders: [{ from: "J6", to: "I6", troops: 2 }],
      wasted: [],
      events: [{ type: "capture", at: "I6", by: "you", from: null, terrain: "plain" }],
    });
  });
});
