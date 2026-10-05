/**
 * The board: geometry, the rules' constants, and seeded map generation.
 * The prototype in `salient/docs/reference/engine.js` is the oracle for the
 * last two — the same seed has to give the same map it gave there.
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { generateMap } from "./board.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import {
  HEX_DIRECTIONS,
  boardCells,
  hexDistance,
  hexKey,
  hexLabel,
  isOnBoard,
  neighbourKeys,
  parseHexKey,
  rotateHalfTurn,
} from "./hex.ts";
import { mulberry32 } from "./rng.ts";
import type { Hex, HexKey, MatchState, Seat, Terrain } from "./types.ts";

const CELLS = boardCells(DEFAULT_CONFIG.radius);

interface PrototypeHex {
  q: number;
  r: number;
  id: string;
  t: Terrain;
  owner: Seat | null;
  troops: number;
  garrison: number;
}

interface PrototypeMap {
  hexes: Record<HexKey, PrototypeHex>;
  base: { A: HexKey; B: HexKey };
}

const requireModule = createRequire(import.meta.url);
const reference = requireModule("../../../../salient/docs/reference/engine.js") as {
  DEFAULT_CFG: { R: number; NODE_GARRISON: number; BLOCKED_PAIRS: number };
  genMap: (seed: number, cfg: unknown) => PrototypeMap;
  mulberry32: (seed: number) => () => number;
};

/** Every passable hex, in board order. */
function passableKeys(state: MatchState): HexKey[] {
  return CELLS.map((cell) => hexKey(cell.q, cell.r)).filter((key) => state.hexes[key].terrain !== "blocked");
}

/** Flood fill over passable hexes. */
function reachableFrom(state: MatchState, start: HexKey): Set<HexKey> {
  const board = new Set(passableKeys(state));
  const seen = new Set<HexKey>([start]);
  const queue: HexKey[] = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const neighbour of neighbourKeys(queue[i], board)) {
      if (!seen.has(neighbour)) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return seen;
}

function terrainCounts(state: MatchState): Record<Terrain, number> {
  const counts: Record<Terrain, number> = { plain: 0, node: 0, base: 0, blocked: 0 };
  for (const cell of CELLS) counts[state.hexes[hexKey(cell.q, cell.r)].terrain] += 1;
  return counts;
}

/** The Nodes on one seat's half: the three nearer its Base than the other's. */
function nodesOnHalf(state: MatchState, seat: Seat): Hex[] {
  const own = state.hexes[state.base[seat]];
  const other = state.hexes[state.base[seat === "A" ? "B" : "A"]];
  return CELLS.map((cell) => state.hexes[hexKey(cell.q, cell.r)]).filter(
    (hex) => hex.terrain === "node" && hexDistance(hex, own) < hexDistance(hex, other),
  );
}

const swapSeat = (owner: Seat | null): Seat | null => (owner === null ? null : owner === "A" ? "B" : "A");

function boardSignature(state: MatchState): string {
  return CELLS.map((cell) => {
    const hex = state.hexes[hexKey(cell.q, cell.r)];
    return `${hex.id} ${hex.terrain} ${hex.owner ?? "-"} ${hex.troops} ${hex.garrison}`;
  }).join("\n");
}

/**
 * Terrain, owner and troops at every hex in board order. The label is left out
 * because it is fixed by the position, so it cannot break a symmetry.
 */
function contents(state: MatchState, seenFromOtherSeat: boolean): string {
  return CELLS.map((cell) => {
    const at = seenFromOtherSeat ? rotateHalfTurn(cell) : cell;
    const hex = state.hexes[hexKey(at.q, at.r)];
    const owner = seenFromOtherSeat ? swapSeat(hex.owner) : hex.owner;
    return `${hex.terrain} ${owner ?? "-"} ${hex.troops} ${hex.garrison}`;
  }).join("\n");
}

function prototypeSignature(map: PrototypeMap): string {
  return CELLS.map((cell) => {
    const hex = map.hexes[hexKey(cell.q, cell.r)];
    return `${hex.id} ${hex.t} ${hex.owner ?? "-"} ${hex.troops} ${hex.garrison}`;
  }).join("\n");
}

describe("board geometry", () => {
  it("holds 91 hexes with |q|, |r| and |q + r| all within 5", () => {
    expect(CELLS.length).toBe(91);
    for (const cell of CELLS) {
      expect(isOnBoard(cell.q, cell.r, DEFAULT_CONFIG.radius)).toBe(true);
    }
    expect(isOnBoard(5, 5, DEFAULT_CONFIG.radius)).toBe(false);
    expect(isOnBoard(0, -6, DEFAULT_CONFIG.radius)).toBe(false);
  });

  it("labels A6, F6 and the Bases as the rules do", () => {
    expect(hexLabel(-5, 0, 5)).toBe("A6");
    expect(hexLabel(0, 0, 5)).toBe("F6");
    expect(hexLabel(-4, 0, 5)).toBe("B6");
    expect(hexLabel(4, 0, 5)).toBe("J6");
    expect(hexLabel(0, -5, 5)).toBe("F1");
    expect(hexLabel(5, 5, 5)).toBe("K11");
    const labels = new Set(CELLS.map((cell) => hexLabel(cell.q, cell.r, 5)));
    expect(labels.size).toBe(91);
  });

  it("reads a hex key back into its coordinates", () => {
    expect(parseHexKey("-4,0")).toEqual({ q: -4, r: 0 });
    expect(parseHexKey("3,-5")).toEqual({ q: 3, r: -5 });
  });

  it("gives F6 its six neighbours in the order the rules list them", () => {
    const board = new Set(CELLS.map((cell) => hexKey(cell.q, cell.r)));
    expect(neighbourKeys(hexKey(0, 0), board)).toEqual([
      hexKey(1, 0),
      hexKey(1, -1),
      hexKey(0, -1),
      hexKey(-1, 0),
      hexKey(-1, 1),
      hexKey(0, 1),
    ]);
    expect(HEX_DIRECTIONS.length).toBe(6);
    // A corner hex has only the neighbours still on the board.
    expect(neighbourKeys(hexKey(-5, 0), board).length).toBe(3);
  });

  it("measures distance in whole hex steps", () => {
    expect(hexDistance({ q: -5, r: 0 }, { q: 4, r: 0 })).toBe(9);
    expect(hexDistance({ q: -4, r: 0 }, { q: 4, r: 0 })).toBe(8);
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    const board = new Set(CELLS.map((cell) => hexKey(cell.q, cell.r)));
    for (const neighbour of neighbourKeys(hexKey(0, 0), board)) {
      expect(hexDistance({ q: 0, r: 0 }, parseHexKey(neighbour))).toBe(1);
    }
  });
});

describe("rules constants", () => {
  it("are the values the rules table gives", () => {
    expect(DEFAULT_CONFIG).toEqual({
      radius: 5,
      turns: 25,
      actionPoints: 6,
      startingTroops: 5,
      baseProduction: 2,
      nodeProduction: 1,
      nodeGarrison: 3,
      blockedPairs: 6,
      homeBonus: 1,
      points: { plain: 1, node: 3, base: 1 },
      supply: true,
    });
  });
});

describe("map generation", () => {
  it("lays out 91 hexes as 70 plain, 12 blocked, 7 Nodes and 2 Bases", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    expect(Object.keys(state.hexes).length).toBe(91);
    expect(terrainCounts(state)).toEqual({ plain: 70, node: 7, base: 2, blocked: 12 });
    for (const cell of CELLS) {
      const hex = state.hexes[hexKey(cell.q, cell.r)];
      expect(hex).toMatchObject({ q: cell.q, r: cell.r, id: hexLabel(cell.q, cell.r, DEFAULT_CONFIG.radius) });
    }
    expect(state.turn).toBe(1);
    expect(state.seed).toBe(135);
    expect(state.over).toBe(false);
    expect(state.result).toBe(null);
  });

  it("gives each Base its seat and 5 troops, and every Node a garrison of 3", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    expect(state.base).toEqual({ A: "-4,0", B: "4,0" });
    const baseA = state.hexes[state.base.A];
    const baseB = state.hexes[state.base.B];
    expect([baseA.id, baseB.id]).toEqual(["B6", "J6"]);
    expect(baseA).toEqual({ id: "B6", q: -4, r: 0, terrain: "base", owner: "A", troops: 5, garrison: 0 });
    expect(baseB).toEqual({ id: "J6", q: 4, r: 0, terrain: "base", owner: "B", troops: 5, garrison: 0 });
    const nodes = CELLS.map((cell) => state.hexes[hexKey(cell.q, cell.r)]).filter((hex) => hex.terrain === "node");
    for (const node of nodes) {
      expect(node.owner).toBe(null);
      expect(node.troops).toBe(0);
      expect(node.garrison).toBe(3);
    }
    expect(state.hexes["0,0"].terrain).toBe("node");
  });

  it("places three Nodes per half: one 2 from the Base, two more 3 to 5 out and well apart", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    for (const seat of ["A", "B"] as const) {
      const base = state.hexes[state.base[seat]];
      const nodes = nodesOnHalf(state, seat);
      expect(nodes.length).toBe(3);
      const distances = nodes.map((node) => hexDistance(node, base)).sort((x, y) => x - y);
      expect(distances[0]).toBe(2);
      for (const distance of distances.slice(1)) {
        expect(distance).toBeGreaterThanOrEqual(3);
        expect(distance).toBeLessThanOrEqual(5);
      }
      for (const node of nodes) expect(hexDistance(node, { q: 0, r: 0 })).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          expect(hexDistance(nodes[i], nodes[j])).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("gives the same seed the same map", () => {
    const first = generateMap(135, DEFAULT_CONFIG);
    const second = generateMap(135, DEFAULT_CONFIG);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(generateMap(136, DEFAULT_CONFIG).hexes).not.toEqual(first.hexes);
  });

  it("leaves every passable hex reachable from B6", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = generateMap(seed, DEFAULT_CONFIG);
      expect(reachableFrom(state, state.base.A).size, `seed ${seed}`).toBe(passableKeys(state).length);
    }
  });

  it("generates the same map as the prototype engine for the same seed", () => {
    // The five golden seeds come first: they are the maps real matches ran on.
    const seeds = [7, 92, 108, 135, 189, ...Array.from({ length: 50 }, (_, i) => i + 1)];
    for (const seed of seeds) {
      const state = generateMap(seed, DEFAULT_CONFIG);
      const prototype = reference.genMap(seed, reference.DEFAULT_CFG);
      expect(boardSignature(state), `seed ${seed}`).toBe(prototypeSignature(prototype));
      expect(state.base, `seed ${seed}`).toEqual(prototype.base);
    }
  });

  it("draws the same numbers as the prototype's generator, and restarts from the same seed", () => {
    const ours = mulberry32(12345);
    const theirs = reference.mulberry32(12345);
    for (let i = 0; i < 200; i++) expect(ours()).toBe(theirs());
    expect(mulberry32(12345)()).toBe(mulberry32(12345)());
    expect(mulberry32(12345)()).not.toBe(mulberry32(99991)());
  });
});

describe("map symmetry", () => {
  it("is unchanged by the half-turn rotation with seats swapped, on 300 consecutive seeds", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = generateMap(seed, DEFAULT_CONFIG);
      expect(contents(state, true), `seed ${seed}`).toBe(contents(state, false));
      expect(terrainCounts(state), `seed ${seed}`).toEqual({ plain: 70, node: 7, base: 2, blocked: 12 });
      expect(reachableFrom(state, state.base.A).size, `seed ${seed}`).toBe(passableKeys(state).length);
    }
  });
});
