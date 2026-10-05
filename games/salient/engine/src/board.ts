/**
 * Map generation, ported from `genMap` in `salient/docs/reference/engine.js`
 * so a seed gives the same map as the prototype. One half of the board is
 * chosen by the seeded generator and rotated onto the other half by
 * `(q, r) -> (-q, -r)`, which is what makes every map fair for both seats.
 */
import { DEFAULT_CONFIG, type Config } from "./config.ts";
import { boardCells, hexDistance, hexKey, hexLabel, neighbourKeys, rotateHalfTurn } from "./hex.ts";
import { mulberry32 } from "./rng.ts";
import type { Hex, HexCoord, HexKey, MatchState, Terrain } from "./types.ts";

/** The centre hex, which always holds the seventh Node. */
const CENTRE: HexCoord = { q: 0, r: 0 };

/** How far the home Node sits from its Base, and the range for the other two. */
const HOME_NODE_DISTANCE = 2;
const OUTPOST_MIN_DISTANCE = 3;
const OUTPOST_MAX_DISTANCE = 5;

/** Nodes stay at least this far apart, and at least this far from the centre. */
const NODE_SEPARATION = 3;
const CENTRE_CLEARANCE = 2;

/** A map is rejected and redrawn if it fails the checks; then we give up. */
const MAX_ATTEMPTS = 500;

const keyOf = (coord: HexCoord): HexKey => hexKey(coord.q, coord.r);

/** Fisher-Yates on a copy, drawing in the same order as the prototype. */
function shuffle<T>(items: readonly T[], randomBelow: (n: number) => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    const held = out[i];
    out[i] = out[j];
    out[j] = held;
  }
  return out;
}

/** True when every passable hex is reachable from `start` through passable hexes. */
function allConnected(passable: ReadonlySet<HexKey>, start: HexKey): boolean {
  const seen = new Set<HexKey>([start]);
  const queue: HexKey[] = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const neighbour of neighbourKeys(queue[i], passable)) {
      if (!seen.has(neighbour)) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return seen.size === passable.size;
}

function buildHexes(
  cells: readonly HexCoord[],
  terrain: Readonly<Record<HexKey, Terrain>>,
  config: Config,
  bases: readonly [HexKey, HexKey],
): Record<HexKey, Hex> {
  const hexes: Record<HexKey, Hex> = {};
  for (const cell of cells) {
    const key = keyOf(cell);
    const kind = terrain[key];
    hexes[key] = {
      id: hexLabel(cell.q, cell.r, config.radius),
      q: cell.q,
      r: cell.r,
      terrain: kind,
      owner: null,
      troops: 0,
      garrison: kind === "node" ? config.nodeGarrison : 0,
    };
  }
  const [seatA, seatB] = bases;
  hexes[seatA].owner = "A";
  hexes[seatA].troops = config.startingTroops;
  hexes[seatB].owner = "B";
  hexes[seatB].troops = config.startingTroops;
  return hexes;
}

/** Generate the map for `seed`: blocked hexes and Nodes, mirrored and connected. */
export function generateMap(seed: number, config: Config = DEFAULT_CONFIG): MatchState {
  const rnd = mulberry32(seed);
  const randomBelow = (n: number) => rnd() % n;

  const cells = boardCells(config.radius);
  const baseA: HexCoord = { q: -(config.radius - 1), r: 0 };
  const baseB: HexCoord = { q: config.radius - 1, r: 0 };
  const baseKeys: [HexKey, HexKey] = [keyOf(baseA), keyOf(baseB)];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const terrain: Record<HexKey, Terrain> = {};
    for (const cell of cells) terrain[keyOf(cell)] = "plain";
    terrain[baseKeys[0]] = "base";
    terrain[baseKeys[1]] = "base";

    // Blocked hexes: the half nearer seat A, rotated onto the other half.
    const blockedCandidates = cells.filter(
      (cell) =>
        (cell.q < 0 || (cell.q === 0 && cell.r < 0)) &&
        hexDistance(cell, baseA) > 1 &&
        hexDistance(cell, baseB) > 1,
    );
    for (const cell of shuffle(blockedCandidates, randomBelow).slice(0, config.blockedPairs)) {
      terrain[keyOf(cell)] = "blocked";
      terrain[keyOf(rotateHalfTurn(cell))] = "blocked";
    }

    terrain[keyOf(CENTRE)] = "node";

    // Nodes: the home Node two hexes out, then two more 3 to 5 hexes out that
    // are well clear of each other and of the centre Node.
    const half = cells.filter(
      (cell) => terrain[keyOf(cell)] === "plain" && hexDistance(cell, baseA) < hexDistance(cell, baseB),
    );
    const home = shuffle(
      half.filter((cell) => hexDistance(cell, baseA) === HOME_NODE_DISTANCE),
      randomBelow,
    )[0];
    if (!home) continue;

    const outposts = half.filter((cell) => {
      const distance = hexDistance(cell, baseA);
      return distance >= OUTPOST_MIN_DISTANCE && distance <= OUTPOST_MAX_DISTANCE;
    });
    const nodes: HexCoord[] = [home];
    for (const cell of shuffle(outposts, randomBelow)) {
      if (nodes.length >= 3) break;
      if (nodes.every((node) => hexDistance(node, cell) >= NODE_SEPARATION) && hexDistance(cell, CENTRE) >= CENTRE_CLEARANCE) {
        nodes.push(cell);
      }
    }
    if (nodes.length < 3) continue;
    for (const cell of nodes) {
      terrain[keyOf(cell)] = "node";
      terrain[keyOf(rotateHalfTurn(cell))] = "node";
    }

    const passable = new Set<HexKey>(cells.filter((cell) => terrain[keyOf(cell)] !== "blocked").map(keyOf));
    if (!allConnected(passable, baseKeys[0])) continue;

    return {
      turn: 1,
      seed,
      hexes: buildHexes(cells, terrain, config, baseKeys),
      base: { A: baseKeys[0], B: baseKeys[1] },
      over: false,
      result: null,
    };
  }

  throw new Error(`map generation failed for seed ${seed}`);
}
