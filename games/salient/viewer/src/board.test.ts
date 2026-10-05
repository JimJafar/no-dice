/**
 * The board's view-model: one entry per hex of the log's `map`, holding what
 * `cells[i]` says about `map[i]` and the pixel centre the mock-ups' geometry
 * gives it. Nothing here is generated or recomputed — the labels, coordinates
 * and terrain come from `map`, the owner, troops, garrison and cut-off from the
 * board the frame shows — so the test reads the same fixture the browser would
 * load and asks whether each hex carries the fact the log states.
 *
 * The DOM is not here: which class a hex gets and which mark it draws is
 * `render-board.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";

import { boardView, hexCentre } from "./board.ts";
import type { HexView } from "./board.ts";
import golden01 from "../fixtures/golden-01-time-win.json";

/** The first golden match, validated the way the viewer validates every log. */
const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** The hexes of a board view, keyed by label, so a case can name one. */
function byLabel(turn: number): Map<string, HexView> {
  return new Map(boardView(log, turn).hexes.map((hex) => [hex.label, hex]));
}

describe("boardView", () => {
  it("gives one view per hex of the map, in the map's order", () => {
    const view = boardView(log, TURN_11);
    expect(view.hexes).toHaveLength(91);
    expect(view.hexes.map((hex) => hex.label)).toEqual(log.map.map((hex) => hex.id));
    expect(view.hexes.map((hex) => hex.terrain)).toEqual(log.map.map((hex) => hex.terrain));
  });

  it("reads turn 11's cells for turn 11", () => {
    const hexes = byLabel(TURN_11);
    // B holds F1 with 1 troop and is out of supply on it.
    expect(hexes.get("F1")).toMatchObject({ terrain: "plain", owner: "B", troops: 1, garrison: 0, cutOff: true });
    // A cut-off hex with nothing on it is still cut off.
    expect(hexes.get("G1")).toMatchObject({ owner: "B", troops: 0, cutOff: true });
    // A's Base holds 3 troops and is never out of supply, being where supply starts.
    expect(hexes.get("B6")).toMatchObject({ terrain: "base", owner: "A", troops: 3, cutOff: false });
    // A Node A has taken shows its troops, not the garrison it had when neutral.
    expect(hexes.get("D6")).toMatchObject({ terrain: "node", owner: "A", troops: 3, garrison: 0 });
    // A Node nobody holds keeps its garrison.
    expect(hexes.get("G2")).toMatchObject({ terrain: "node", owner: null, troops: 0, garrison: 3 });
    // A blocked hex is nobody's and holds nothing.
    expect(hexes.get("I1")).toMatchObject({ terrain: "blocked", owner: null, troops: 0, garrison: 0, cutOff: false });
  });

  it("names exactly five cut-off hexes at turn 11, all of them B's", () => {
    const cutOff = boardView(log, TURN_11).hexes.filter((hex) => hex.cutOff);
    expect(cutOff.map((hex) => hex.label)).toEqual(["F1", "G1", "H1", "H2", "G3"]);
    expect(cutOff.map((hex) => hex.owner)).toEqual(["B", "B", "B", "B", "B"]);
  });

  it("reads the start board for turn 0", () => {
    const hexes = byLabel(0);
    // Both seats open on their Base with 5 troops, and nothing is cut off yet.
    expect(hexes.get("B6")).toMatchObject({ owner: "A", troops: 5, cutOff: false });
    expect(hexes.get("J6")).toMatchObject({ owner: "B", troops: 5, cutOff: false });
    expect(hexes.get("F1")).toMatchObject({ owner: null, troops: 0, cutOff: false });
    expect(boardView(log, 0).hexes.filter((hex) => hex.cutOff)).toEqual([]);
  });

  it("refuses a turn the log does not hold", () => {
    // The last turn golden-01 played is 25, so 26 has no board to show.
    expect(() => boardView(log, 26)).toThrow(/turn 26/);
    expect(() => boardView(log, -1)).toThrow(/turn -1/);
  });

  it("sizes the board to the box the hexes fit in, as the mock-ups draw it", () => {
    // The mock-up's board area is 705 × 629 px: the span of the hex centres
    // plus one hex's own size and the gap between hexes.
    const view = boardView(log, TURN_11);
    expect(Math.round(view.width)).toBe(705);
    expect(Math.round(view.height)).toBe(629);
  });

  it("centres the hexes on the board, so the map's own centre hex is at the middle", () => {
    const view = boardView(log, TURN_11);
    const centre = view.hexes.find((hex) => hex.label === "F6");
    expect(centre).toEqual(expect.objectContaining({ x: 0, y: 0 }));
    // The board is symmetric about that centre: F6 sits half a width and half a
    // height from the left and top edges of the box.
    expect(centre!.x + view.width / 2).toBeCloseTo(352.5, 1);
    expect(centre!.y + view.height / 2).toBeCloseTo(314.5, 1);
  });
});

describe("hexCentre", () => {
  it("puts the centre of (q, r) where the mock-ups' formula puts it", () => {
    // x = 64.09 × (q + r / 2), y = 55.5 × r, from the board's centre.
    expect(hexCentre(0, 0)).toEqual({ x: 0, y: 0 });
    for (const [q, r, x, y] of [
      [0, -5, -160.225, -277.5],
      [5, 0, 320.45, 0],
      [-5, 5, -160.225, 277.5],
      [-4, 0, -256.36, 0],
    ] as const) {
      const centre = hexCentre(q, r);
      expect(centre.x, `(${q}, ${r}) across`).toBeCloseTo(x, 4);
      expect(centre.y, `(${q}, ${r}) down`).toBeCloseTo(y, 4);
    }
  });

  it("steps hexes far enough apart to leave the mock-ups' gap between 60 × 69 px", () => {
    // Neighbours in a row are one column step apart, which is 4.09 px more than
    // the 60 px a hex is drawn at.
    expect(hexCentre(1, 0).x - hexCentre(0, 0).x).toBeCloseTo(64.09, 2);
    // Each row sits 55.5 px below the one before it.
    expect(hexCentre(0, 1).y).toBeCloseTo(55.5, 2);
  });
});
