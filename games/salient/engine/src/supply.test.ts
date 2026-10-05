/**
 * Visibility and supply. The prototype in `salient/docs/reference/engine.js` is
 * the oracle: the same board has to reveal the same hexes, score the same
 * points, and call the same hexes supplied by the Base.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { generateMap } from "./board.ts";
import { DEFAULT_CONFIG, type Config } from "./config.ts";
import { boardCells, hexKey } from "./hex.ts";
import { score, visibleHexes } from "./supply.ts";
import type { Hex, HexKey, MatchState, Seat, Terrain } from "./types.ts";

const B6 = "-4,0"; // seat A's Base, 5 troops at the start of the turn
const C6 = "-3,0";
const D6 = "-2,0"; // the Node two hexes out from B6
const E5 = "-1,-1";
const E6 = "-1,0"; // blocked on this map
const F5 = "0,-1";
const F6 = "0,0"; // the centre Node
const H6 = "2,0"; // a Node on seat B's half
const J6 = "4,0"; // seat B's Base

const CELLS = boardCells(DEFAULT_CONFIG.radius);

/**
 * Seed 135 with A holding a wedge from its Base towards the centre, plus a blob
 * at F5 and F6 behind the blocked hex at E6: that blob is cut off from B6.
 */
function scenario(): MatchState {
  const state = generateMap(135, DEFAULT_CONFIG);
  const own = (key: HexKey, seat: Seat, troops: number): void => {
    state.hexes[key].owner = seat;
    state.hexes[key].troops = troops;
  };
  own(C6, "A", 3);
  own(D6, "A", 4);
  own(F5, "A", 2);
  own(F6, "A", 2);
  return state;
}

/** The board labels for a set of hex keys, in label order. */
function labelsOf(state: MatchState, keys: Iterable<HexKey>): string[] {
  return [...keys].map((key) => state.hexes[key].id).sort();
}

describe("visibility", () => {
  it("shows a seat exactly its own hexes and every hex next to them", () => {
    const state = scenario();
    // Blocked hexes are in the list: their terrain is always known, and the
    // hexes next to them are what a seat's own hexes look out on.
    expect(labelsOf(state, visibleHexes(state, "A"))).toEqual([
      "A6",
      "A7",
      "B5",
      "B6",
      "B7",
      "C5",
      "C6",
      "C7",
      "D5",
      "D6",
      "D7",
      "E5",
      "E6",
      "E7",
      "F4",
      "F5",
      "F6",
      "F7",
      "G4",
      "G5",
      "G6",
    ]);
  });

  it("shows a seat that owns only its Base the Base and its six neighbours", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    expect(labelsOf(state, visibleHexes(state, "A"))).toEqual(["A6", "A7", "B5", "B6", "B7", "C5", "C6"]);
    // Seat B's Base is nowhere near, so its troops stay hidden from seat A.
    expect(visibleHexes(state, "A").has(J6)).toBe(false);
  });

  it("includes a neutral Node next to its hexes, so its garrison is known", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    state.hexes[F5].owner = "A";
    state.hexes[F5].troops = 2;
    const visible = visibleHexes(state, "A");
    expect(state.hexes[F6]).toMatchObject({ terrain: "node", owner: null, garrison: 3 });
    expect(visible.has(F6)).toBe(true);
    // The Node on seat B's half is out of sight, garrison and all.
    expect(visible.has(H6)).toBe(false);
  });

  it("sees each seat from its own hexes only", () => {
    const state = scenario();
    // Seat B holds only J6, so it sees that Base and the six hexes around it.
    expect(labelsOf(state, visibleHexes(state, "B"))).toEqual(["I6", "I7", "J5", "J6", "J7", "K5", "K6"]);
    expect(visibleHexes(state, "B").has(C6)).toBe(false);
  });
});

describe("scoring", () => {
  it("counts a plain hex and a Base as 1 and a Node as 3", () => {
    const fresh = generateMap(135, DEFAULT_CONFIG);
    expect(score(fresh, "A", DEFAULT_CONFIG)).toEqual({ points: 1, supplied: new Set([B6]) });

    // B6 and C6 are plain, D6 is a Node: 1 + 1 + 3.
    const wedge = scenario();
    const supplied = score(wedge, "A", DEFAULT_CONFIG);
    expect(supplied.points).toBe(5);
    expect(labelsOf(wedge, supplied.supplied)).toEqual(["B6", "C6", "D6"]);
  });

  it("scores a region cut from the Base nothing, and scores it again once reconnected", () => {
    const state = scenario();
    const cut = score(state, "A", DEFAULT_CONFIG);
    expect(cut.points).toBe(5);
    expect(labelsOf(state, cut.supplied)).toEqual(["B6", "C6", "D6"]);
    // F5 and F6 belong to A but are walled off by the blocked hex at E6, so
    // they are the hexes the log and the viewer mark as cut off.
    expect([state.hexes[F5].owner, state.hexes[F6].owner]).toEqual(["A", "A"]);
    expect(cut.supplied.has(F5)).toBe(false);
    expect(cut.supplied.has(F6)).toBe(false);

    // One hex at E5 joins the blob to the wedge: 5 + E5 (1) + F5 (1) + F6 (3).
    state.hexes[E5].owner = "A";
    state.hexes[E5].troops = 1;
    const reconnected = score(state, "A", DEFAULT_CONFIG);
    expect(reconnected.points).toBe(10);
    expect(labelsOf(state, reconnected.supplied)).toEqual(["B6", "C6", "D6", "E5", "F5", "F6"]);
  });

  it("scores nothing for a seat that no longer owns its Base, and supplies nothing", () => {
    const state = scenario();
    state.hexes[B6].owner = "B";
    expect(score(state, "A", DEFAULT_CONFIG)).toEqual({ points: 0, supplied: new Set<HexKey>() });
    // Seat B scores the Base it still holds; the Base it captured at B6 is 8 hexes
    // from J6 and unowned on the way, so it scores nothing there either.
    const asB = score(state, "B", DEFAULT_CONFIG);
    expect(asB.points).toBe(1);
    expect(labelsOf(state, asB.supplied)).toEqual(["J6"]);
  });

  it("adds up to the 93 points on the board when one seat owns every passable hex", () => {
    const state = scenario();
    for (const cell of CELLS) {
      const hex = state.hexes[hexKey(cell.q, cell.r)];
      if (hex.terrain !== "blocked") {
        hex.owner = "A";
        hex.troops = 1;
      }
    }
    const full = score(state, "A", DEFAULT_CONFIG);
    expect(full.points).toBe(93);
    expect(full.supplied.size).toBe(79);
    // 91 hexes, 12 of them blocked: 70 plain, 2 Bases and 7 Nodes.
    expect(
      70 * DEFAULT_CONFIG.points.plain + 2 * DEFAULT_CONFIG.points.base + 7 * DEFAULT_CONFIG.points.node,
    ).toBe(93);
    // Seat B has lost its Base, so it scores nothing whatever it owns.
    expect(score(state, "B", DEFAULT_CONFIG)).toEqual({ points: 0, supplied: new Set<HexKey>() });
  });

  it("counts every owned hex when a match is played without the supply rule", () => {
    const state = scenario();
    const unsupplied: Config = { ...DEFAULT_CONFIG, supply: false };
    const result = score(state, "A", unsupplied);
    // All five owned hexes count, the cut-off blob included: 1 + 1 + 3 + 1 + 3.
    expect(result.points).toBe(9);
    expect(labelsOf(state, result.supplied)).toEqual(["B6", "C6", "D6", "F5", "F6"]);
  });

  it("gives the same answer whatever order the hexes are keyed in", () => {
    const state = scenario();
    const scrambled: Record<HexKey, Hex> = {};
    for (const cell of [...CELLS].reverse()) {
      const key = hexKey(cell.q, cell.r);
      scrambled[key] = state.hexes[key];
    }
    const reversed: MatchState = { ...state, hexes: scrambled };
    expect(score(reversed, "A", DEFAULT_CONFIG).points).toBe(5);
    expect(labelsOf(reversed, score(reversed, "A", DEFAULT_CONFIG).supplied)).toEqual(["B6", "C6", "D6"]);
    expect(labelsOf(reversed, visibleHexes(reversed, "A"))).toEqual(labelsOf(state, visibleHexes(state, "A")));
  });

  it("changes neither the state nor the config it is given", () => {
    const state = scenario();
    const before = JSON.stringify(state);
    const beforeConfig = JSON.stringify(DEFAULT_CONFIG);
    visibleHexes(state, "A");
    score(state, "A", DEFAULT_CONFIG);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(beforeConfig);
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
  DEFAULT_CFG: { PTS: Record<Terrain, number>; SUPPLY: boolean };
  score: (state: PrototypeState, seat: Seat, cfg: unknown) => { pts: number; supplied: Set<HexKey> };
  visible: (state: PrototypeState, seat: Seat) => Set<HexKey>;
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

/**
 * A board with owners scattered over it by a fixed rule, so most seeds end up
 * with regions of one seat walled off from its Base.
 */
function scattered(seed: number): MatchState {
  const state = generateMap(seed, DEFAULT_CONFIG);
  for (const cell of CELLS) {
    const hex = state.hexes[hexKey(cell.q, cell.r)];
    if (hex.terrain === "blocked") continue;
    const n = (cell.q * 7 + cell.r * 13 + seed * 5) % 11;
    hex.owner = n === 0 ? "A" : n === 1 ? "B" : null;
    hex.troops = hex.owner === null ? 0 : 1;
  }
  state.hexes[state.base.A].owner = "A";
  state.hexes[state.base.B].owner = "B";
  return state;
}

const sortedKeys = (keys: Iterable<HexKey>): string[] => [...keys].sort();

describe("visibility and scoring against the prototype engine", () => {
  it("reveals the same hexes on 50 scattered boards", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = scattered(seed);
      const theirs = toPrototype(state);
      for (const seat of ["A", "B"] as const) {
        expect(sortedKeys(visibleHexes(state, seat)), `seed ${seed} seat ${seat}`).toEqual(
          sortedKeys(reference.visible(theirs, seat)),
        );
      }
    }
  });

  it("scores the same points, with the same hexes supplied, on 50 scattered boards", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = scattered(seed);
      const theirs = toPrototype(state);
      for (const seat of ["A", "B"] as const) {
        const ours = score(state, seat, DEFAULT_CONFIG);
        const theirScore = reference.score(theirs, seat, reference.DEFAULT_CFG);
        expect(ours.points, `seed ${seed} seat ${seat}`).toBe(theirScore.pts);
        expect(sortedKeys(ours.supplied), `seed ${seed} seat ${seat}`).toEqual(sortedKeys(theirScore.supplied));
      }
    }
  });
});

/** The scenario board is what the tests above claim it is. */
describe("the scenario board", () => {
  it("is seed 135 with the hexes the tests name", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    const idOf = (key: HexKey): string => state.hexes[key].id;
    expect([idOf(B6), idOf(C6), idOf(D6), idOf(E5), idOf(E6), idOf(F5), idOf(F6), idOf(H6), idOf(J6)]).toEqual([
      "B6",
      "C6",
      "D6",
      "E5",
      "E6",
      "F5",
      "F6",
      "H6",
      "J6",
    ]);
    expect(state.hexes[D6].terrain).toBe("node");
    expect(state.hexes[F6].terrain).toBe("node");
    expect(state.hexes[E6].terrain).toBe("blocked");
    expect(state.hexes[H6].terrain).toBe("node");
    expect(hexKey(-1, -1)).toBe(E5);
  });
});
