/**
 * The data the engine shares with everything above it. Everything here is
 * plain, JSON-friendly data with whole numbers only, so a match log can be
 * written, compared and replayed without any game logic.
 */

export type Seat = "A" | "B";

export type Terrain = "plain" | "node" | "base" | "blocked";

/** A hex addressed as `"q,r"`, the key used wherever hexes are looked up. */
export type HexKey = string;

/** Axial coordinates: `|q|`, `|r|` and `|q + r|` all stay within the radius. */
export interface HexCoord {
  q: number;
  r: number;
}

export interface Hex {
  /** Board label such as `F6`: letter for the diagonal column, number for the row. */
  id: string;
  q: number;
  r: number;
  terrain: Terrain;
  owner: Seat | null;
  troops: number;
  /** Neutral troops standing on a Node; 0 on every other terrain. */
  garrison: number;
}

export interface MatchResult {
  type: "time" | "knockout";
  winner: Seat | null;
  turn: number;
}

export interface MatchState {
  turn: number;
  seed: number;
  /** Every hex on the board, keyed by `"q,r"`. Never rely on key order. */
  hexes: Record<HexKey, Hex>;
  base: Record<Seat, HexKey>;
  over: boolean;
  result: MatchResult | null;
}
