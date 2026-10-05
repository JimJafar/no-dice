/**
 * Entry point for the Salient rules engine.
 *
 * The board lands here first: coordinates, distances, the rules' constants,
 * seeded map generation, order validation, visibility and scoring, and the
 * resolution of a whole turn.
 */
export const enginePackage = {
  name: "@no-dice/salient-engine",
} as const;

export { DEFAULT_CONFIG, type Config } from "./config.ts";
export { generateMap } from "./board.ts";
export {
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
export { mulberry32 } from "./rng.ts";
export { resolveTurn, type TurnOutcome } from "./resolve.ts";
export { score, visibleHexes, type ScoreResult } from "./supply.ts";
export type {
  BattleEvent,
  CaptureEvent,
  ClashEvent,
  Hex,
  HexCoord,
  HexKey,
  MatchResult,
  MatchState,
  Order,
  RepelledEvent,
  Seat,
  Terrain,
  TurnEvent,
  WasteReason,
  WastedOrder,
} from "./types.ts";
export { validateOrders, type ValidationResult } from "./validate-orders.ts";
