/**
 * The board as one view-model per hex, for one frame of the replay.
 *
 * Nothing here is generated or recomputed. The label, the axial coordinates and
 * the terrain of every hex come from the log's `map`, and `cells[i]` describes
 * `map[i]` — an alignment `matchLogSchema` already enforces, so a board is read
 * by index and never looked up by coordinate. The frame's board is `start.cells`
 * at turn 0 and `turns[n].after.cells` at turn `n`.
 *
 * The only numbers invented here are the pixel centres, which are the mock-ups'
 * geometry (`salient/docs/salient-mockups.md`, "Build notes"): pointy-top hexes
 * of size 37 px, the centre of `(q, r)` at `x = 64.09 × (q + r / 2)` and
 * `y = 55.5 × r` from the centre of the board, each hex drawn 60 × 69 px, which
 * is what leaves the 4 px gap between them.
 *
 * What a hex means — which class it gets, which mark it draws — is the
 * renderer's decision, and lives in `render-board.ts`.
 */
import type { Cells, MapHex, MatchLog, Seat } from "@no-dice/log";

/** The mock-ups' hex size: a pointy-top hex of 37 px. */
export const HEX_SIZE = 37;

/** What a hex is drawn at, which leaves the mock-ups' gap between neighbours. */
export const HEX_WIDTH = 60;
export const HEX_HEIGHT = 69;

/** How far apart hex centres are: across a row, and down one step in `r`. */
export const COLUMN_STEP = 64.09;
export const ROW_STEP = 55.5;

/** One hex of one board: what the log says about it, and where it is drawn. */
export interface HexView {
  /** The board label, which is how a log names a hex. */
  readonly label: string;
  readonly terrain: MapHex["terrain"];
  /** `null` for a hex nobody owns. */
  readonly owner: Seat | null;
  readonly troops: number;
  /** What a neutral Node is defended by; 0 once anyone owns the hex. */
  readonly garrison: number;
  /** An owned hex its owner is out of supply on, so it scores nothing. */
  readonly cutOff: boolean;
  /** The pixel centre, measured from the centre of the board. */
  readonly x: number;
  readonly y: number;
}

/** One whole board, and the box its hexes fit in. */
export interface BoardView {
  /** One entry per hex of the map, in the map's order. */
  readonly hexes: readonly HexView[];
  readonly width: number;
  readonly height: number;
}

/** The mock-ups' centre of hex `(q, r)`, from the centre of the board. */
export function hexCentre(q: number, r: number): { x: number; y: number } {
  return { x: COLUMN_STEP * (q + r / 2), y: ROW_STEP * r };
}

/**
 * The board a frame shows: `start.cells` at turn 0, `turns[n].after.cells` at
 * turn `n`. Fog is computed over the same board the frame draws, so this is the
 * one place that decides which board a turn means.
 */
export function cellsAt(log: MatchLog, turn: number): Cells {
  if (turn === 0) return log.start.cells;
  const record = log.turns.find((t) => t.n === turn);
  if (record === undefined) throw new Error(`the log holds no turn ${turn}`);
  return record.after.cells;
}

/** The owner half of a cell, as the seat it names rather than as 0, 1 or 2. */
function ownerOf(cell: Cells[number]): Seat | null {
  return cell[0] === 1 ? "A" : cell[0] === 2 ? "B" : null;
}

/** The distance between the furthest apart of `values`, and 0 when there are none. */
function span(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/**
 * The board one frame of a log shows. The box is the hexes' own bounding box
 * plus the gap around them, which for golden-01's map is the 705 × 629 px the
 * mock-ups give the board area.
 */
export function boardView(log: MatchLog, turn: number): BoardView {
  const cells = cellsAt(log, turn);
  const hexes = log.map.map((hex, i): HexView => {
    const cell = cells[i];
    const { x, y } = hexCentre(hex.q, hex.r);
    return {
      label: hex.id,
      terrain: hex.terrain,
      owner: ownerOf(cell),
      troops: cell[1],
      garrison: cell[2],
      cutOff: cell[3] === 1,
      x,
      y,
    };
  });

  return {
    hexes,
    // One column step across, and one hex's full height down, of padding: the
    // gap between neighbours, half on each side.
    width: span(hexes.map((hex) => hex.x)) + COLUMN_STEP,
    height: span(hexes.map((hex) => hex.y)) + 2 * HEX_SIZE,
  };
}
