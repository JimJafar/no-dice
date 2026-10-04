/**
 * Entry point for the Salient rules engine.
 *
 * The board lands here first: coordinates, distances, the rules' constants,
 * seeded map generation and order validation. Visibility, turn resolution and
 * scoring follow in the later engine tasks.
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
export type { Hex, HexCoord, HexKey, MatchResult, MatchState, Order, Seat, Terrain, WasteReason, WastedOrder } from "./types";
export { validateOrders, type ValidationResult } from "./validate-orders";
