/**
 * What one seat can see of one board, worked out from the log.
 *
 * The viewer never imports the engine, so the rules' "Visibility and scouting"
 * is restated here: a seat sees the hexes it owns and every hex next to them,
 * and the rest of the board is hidden. Terrain is never hidden — the log's
 * `map` is the whole board and says what every hex is — so a hidden hex is a
 * hex whose owner, troop count and garrison are unknown, not a hex that stops
 * being drawn. A Base and a Node therefore keep their positions under fog, and
 * only the number inside them goes missing.
 *
 * Adjacency comes from the `q`/`r` the log's `map` carries: the six axial
 * deltas looked up in the map's own list of hexes, which is what lets a log
 * replay without generating a board.
 *
 * The frame at turn `n` is what the seat knew when the board was
 * `turns[n].after` — the same board the frame draws, so the fog toggle compares
 * one frame's knowledge against another rather than two frames from different
 * moments.
 */
import type { MatchLog, Seat } from "@no-dice/log";

import { cellsAt } from "./board.ts";

/**
 * The six axial deltas: the neighbours of `(q, r)` on the pointy-top grid the
 * log's coordinates measure. The engine has the same list; the viewer holds its
 * own, because it reads the log and not the engine.
 */
export const AXIAL_DELTAS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** One seat's knowledge of one board. */
export interface FogView {
  /** The seat whose eyes this is. */
  readonly seat: Seat;
  /** The turn whose board is being seen. */
  readonly turn: number;
  /** The labels of the hexes whose owner, troops and garrison the seat can see. */
  readonly visible: ReadonlySet<string>;
  /** The labels of every other hex of the map: its terrain known, the rest not. */
  readonly hidden: ReadonlySet<string>;
}

/** A hex's coordinate as the log's `map` gives it, keyed for neighbour lookups. */
const coordKey = (q: number, r: number): string => `${q},${r}`;

/**
 * What `seat` can see of the board at turn `turn`: the hexes it owns and every
 * hex next to them. Everything else the map holds is hidden from it — including
 * blocked hexes, which the renderer draws the same either way, having nothing
 * to hide.
 */
export function fogView(log: MatchLog, turn: number, seat: Seat): FogView {
  const cells = cellsAt(log, turn);
  const owner = seat === "A" ? 1 : 2;

  // The map is the whole board, so a neighbour is whatever the map has at that
  // coordinate — and a coordinate off the map, or one the map leaves out, is
  // simply not a hex.
  const at = new Map<string, string>();
  for (const hex of log.map) at.set(coordKey(hex.q, hex.r), hex.id);

  const visible = new Set<string>();
  for (const [i, hex] of log.map.entries()) {
    if (cells[i][0] !== owner) continue;
    visible.add(hex.id);
    for (const [dq, dr] of AXIAL_DELTAS) {
      const neighbour = at.get(coordKey(hex.q + dq, hex.r + dr));
      if (neighbour !== undefined) visible.add(neighbour);
    }
  }

  const hidden = new Set<string>();
  for (const hex of log.map) {
    if (!visible.has(hex.id)) hidden.add(hex.id);
  }

  return { seat, turn, visible, hidden };
}
