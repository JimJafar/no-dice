/**
 * Hex geometry: the axial coordinate system, labels, distances and
 * neighbours. Whole-number arithmetic only.
 */
import type { HexCoord, HexKey } from "./types";

/** The six neighbour directions, in the order the rules list them. */
export const HEX_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function hexKey(q: number, r: number): HexKey {
  return `${q},${r}`;
}

export function parseHexKey(key: HexKey): HexCoord {
  const parts = key.split(",");
  return { q: Number(parts[0]), r: Number(parts[1]) };
}

/** Distance in hex steps: `(|dq| + |dr| + |dq + dr|) / 2`. */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  // The sum of the three absolute values is always even, so halving it by
  // bit-shift stays in whole numbers.
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) >> 1;
}

/** Letter for the diagonal column, number for the row: F6 is the centre. */
export function hexLabel(q: number, r: number, radius: number): string {
  return String.fromCharCode(65 + q + radius) + (r + radius + 1);
}

export function isOnBoard(q: number, r: number, radius: number): boolean {
  return Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius;
}

/** Every hex on the board in one fixed order: row, then column. */
export function boardCells(radius: number): HexCoord[] {
  const cells: HexCoord[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (isOnBoard(q, r, radius)) cells.push({ q, r });
    }
  }
  return cells;
}

/** The half-turn rotation that makes a map fair: `(q, r) -> (-q, -r)`. */
export function rotateHalfTurn(coord: HexCoord): HexCoord {
  return { q: -coord.q, r: -coord.r };
}

/** Neighbours of `key` that are present in `board` (the board, or its passable hexes). */
export function neighbourKeys(key: HexKey, board: ReadonlySet<HexKey>): HexKey[] {
  const at = parseHexKey(key);
  const out: HexKey[] = [];
  for (const [dq, dr] of HEX_DIRECTIONS) {
    const neighbour = hexKey(at.q + dq, at.r + dr);
    if (board.has(neighbour)) out.push(neighbour);
  }
  return out;
}
