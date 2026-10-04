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

export { DEFAULT_CONFIG, type Config } from "./config";
export { generateMap } from "./board";
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
} from "./hex";
export { mulberry32 } from "./rng";
export { resolveTurn, type TurnOutcome } from "./resolve";
export { score, visibleHexes, type ScoreResult } from "./supply";
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
} from "./types";
export { validateOrders, type ValidationResult } from "./validate-orders";
