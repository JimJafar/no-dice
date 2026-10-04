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

/** A move: `troops` soldiers from one hex to another, one step in one turn. */
export interface Order {
  from: HexKey;
  to: HexKey;
  troops: number;
}

/**
 * Why an order was dropped, in the wording the log and the players see. The
 * reasons are checked in this order, so an order that breaks several rules is
 * reported under the first one.
 */
export type WasteReason =
  | "no action points left"
  | "unknown hex"
  | "source hex not owned"
  | "destination is blocked"
  | "hexes are not adjacent"
  | "troop count must be a positive integer"
  | "not enough troops in source hex";

export interface WastedOrder {
  order: Order;
  reason: WasteReason;
}

export interface MatchResult {
  type: "time" | "knockout";
  winner: Seat | null;
  turn: number;
  /**
   * The score the match is recorded as, which is not always the score the board
   * shows. A `time` result records the position's true score. A knockout records
   * every point on the board to the seat that took the other's Base and none to
   * the seat that lost its own; when both Bases fall on one turn neither side
   * takes the board, which is what makes it a draw.
   */
  score: Record<Seat, number>;
}

/**
 * What happened during one turn, in the order the engine saw it. Hexes are
 * named by their `"q,r"` key, the same currency as orders and the board; the
 * log and the tools translate the keys into board labels.
 */

/** Both players crossed the same edge in opposite directions and met on it. */
export interface ClashEvent {
  type: "clash";
  /** The two hexes of the edge, in the direction seat A moved across it. */
  between: [HexKey, HexKey];
  /** Troops each seat had on the edge before it was fought. */
  A: number;
  B: number;
}

/** Both players had troops in the hex, so they fought there. */
export interface BattleEvent {
  type: "battle";
  at: HexKey;
  /** Troops each seat had in the hex, before the home bonus. */
  A: number;
  B: number;
  owner: Seat | null;
}

/** An attack that was turned back: the hex keeps what it had, and the attackers are gone. */
export interface RepelledEvent {
  type: "repelled";
  at: HexKey;
  /** The seat whose attack failed — the one that was repelled. */
  by: Seat;
  /** The size of the force that was turned back. */
  n: number;
}

/** The hex changed hands. */
export interface CaptureEvent {
  type: "capture";
  at: HexKey;
  by: Seat;
  from: Seat | null;
  terrain: Terrain;
}

export type TurnEvent = ClashEvent | BattleEvent | RepelledEvent | CaptureEvent;

export interface MatchState {
  turn: number;
  seed: number;
  /** Every hex on the board, keyed by `"q,r"`. Never rely on key order. */
  hexes: Record<HexKey, Hex>;
  base: Record<Seat, HexKey>;
  over: boolean;
  result: MatchResult | null;
}
