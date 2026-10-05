// @vitest-environment happy-dom
/**
 * What the DOM decides: which class a hex gets, which mark it draws, and where
 * it lands. The numbers behind them are pinned by `board.test.ts`, so this file
 * never recomputes a coordinate — it asks whether the frame the log describes
 * is the frame that gets drawn, and it reads the same fixture the browser does.
 *
 * The classes and the marks are the mock-ups' (`salient/docs/mockups/
 * spectator-view.html`), including the positions its markup gives each hex at
 * turn 11, which is the frame this viewer has to reproduce.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";

import { boardView } from "./board.ts";
import { renderBoard } from "./render-board.ts";
import golden01 from "../fixtures/golden-01-time-win.json";

const log = matchLogSchema.parse(golden01);

/** The board as the log gives it at turn `turn`, drawn into a fresh element. */
function frame(turn: number): HTMLElement {
  const board = document.createElement("div");
  renderBoard(board, boardView(log, turn));
  return board;
}

/** The drawn hexes, keyed by the label each one carries. */
function hexes(board: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const hex of board.querySelectorAll<HTMLElement>(".hx")) {
    const label = hex.dataset.hex;
    expect(label, "a hex carries no label to find it by").toBeTruthy();
    found.set(label!, hex);
  }
  return found;
}

/** The one background class a hex carries: a team colour, a hatch, or blocked. */
function background(hex: HTMLElement): string {
  const found = ["x", "ac", "bc", "a", "b", "n"].filter((cls) => hex.classList.contains(cls));
  const label = hex.dataset.hex;
  expect(found, `${label} carries the backgrounds ${found.join(", ")}`).toHaveLength(1);
  return found[0];
}

/** What a hex shows besides its label: the numbers and symbols drawn on it. */
function marks(hex: HTMLElement): { text: string; symbols: string[] } {
  const copy = hex.cloneNode(true) as HTMLElement;
  copy.querySelector("i")?.remove();
  return {
    text: (copy.textContent ?? "").trim(),
    symbols: ["bs", "nd", "ct"].filter((cls) => copy.querySelector(`.${cls}`) !== null),
  };
}

/** The background the log implies for one hex of one board. */
function expectedBackground(terrain: string, cell: readonly number[]): string {
  if (terrain === "blocked") return "x";
  if (cell[3] === 1) return cell[0] === 1 ? "ac" : "bc";
  return cell[0] === 1 ? "a" : cell[0] === 2 ? "b" : "n";
}

/** The number the log implies for one hex of one board, and "" for none. */
function expectedMark(terrain: string, cell: readonly number[]): string {
  if (terrain === "blocked") return "";
  const troops = cell[1];
  if (terrain === "base") return troops === 0 ? "" : String(troops);
  if (terrain === "node") {
    const shown = cell[0] === 0 ? cell[2] : troops;
    return shown === 0 ? "" : String(shown);
  }
  return troops === 0 ? "" : String(troops);
}

describe("renderBoard", () => {
  it("draws one hex per hex of the map, each carrying its label twice", () => {
    const board = frame(11);
    const drawn = hexes(board);
    expect(drawn.size).toBe(91);
    for (const hex of log.map) {
      const el = drawn.get(hex.id);
      expect(el, `${hex.id} is not drawn`).toBeTruthy();
      expect(el!.querySelector("i")?.textContent).toBe(hex.id);
    }
  });

  it("gives every hex the background and the number its cell gives it at turn 11", () => {
    const drawn = hexes(frame(11));
    const cells = log.turns.find((turn) => turn.n === 11)!.after.cells;

    for (const [i, hex] of log.map.entries()) {
      const el = drawn.get(hex.id)!;
      expect(background(el), `${hex.id} background`).toBe(expectedBackground(hex.terrain, cells[i]));
      expect(marks(el).text, `${hex.id} number`).toBe(expectedMark(hex.terrain, cells[i]));
    }
  });

  it("hatches exactly five hexes at turn 11, and they are F1, G1, H1, H2 and G3", () => {
    const board = frame(11);
    const cutOff = [...board.querySelectorAll(".bc, .ac")].map((hex) => (hex as HTMLElement).dataset.hex);
    expect(cutOff.sort()).toEqual(["F1", "G1", "G3", "H1", "H2"]);
    // All five are B's, so they all get B's hatch, and none keeps a flat colour.
    expect(board.querySelectorAll(".bc")).toHaveLength(5);
    expect(board.querySelectorAll(".ac")).toHaveLength(0);
  });

  it("puts a cut-off hex's troops in a dark disc so they read over the hatch", () => {
    const drawn = hexes(frame(11));
    // F1 holds 1 troop; the other four cut-off hexes hold nothing at all.
    expect(drawn.get("F1")!.querySelector(".ct")?.textContent).toBe("1");
    for (const label of ["G1", "H1", "H2", "G3"]) {
      expect(marks(drawn.get(label)!)).toEqual({ text: "", symbols: [] });
    }
  });

  it("draws the two Bases as a number in a circle and the seven Nodes in a diamond", () => {
    const drawn = hexes(frame(11));
    const bases = [...frame(11).querySelectorAll(".bs")];
    expect(bases).toHaveLength(2);
    expect(bases.map((base) => base.textContent)).toEqual(["3", "4"]);

    const nodes = [...frame(11).querySelectorAll(".nd")];
    expect(nodes).toHaveLength(7);
    // A held Node shows its troops; a neutral one shows its garrison.
    expect(drawn.get("D6")!.querySelector(".nd b")?.textContent).toBe("3");
    expect(drawn.get("F6")!.querySelector(".nd b")?.textContent).toBe("2");
    expect(drawn.get("H6")!.querySelector(".nd b")?.textContent).toBe("3");
    for (const label of ["G2", "H3", "D9", "E10"]) {
      expect(drawn.get(label)!.querySelector(".nd b")?.textContent).toBe("3");
      expect(drawn.get(label)!.classList.contains("n"), `${label} is neutral`).toBe(true);
    }
  });

  it("hatches a blocked hex and never gives it an owner colour or a number, in any frame", () => {
    const blocked = log.map.filter((hex) => hex.terrain === "blocked").map((hex) => hex.id);
    expect(blocked).toHaveLength(12);

    // Frame 0 is the start position, then one frame per logged turn.
    for (let turn = 0; turn <= log.turns.length; turn++) {
      const drawn = hexes(frame(turn));
      for (const label of blocked) {
        const hex = drawn.get(label)!;
        expect(background(hex), `${label} at turn ${turn}`).toBe("x");
        expect(marks(hex), `${label} at turn ${turn}`).toEqual({ text: "", symbols: [] });
      }
    }
  });

  it("places each hex where the mock-up's markup puts it", () => {
    const drawn = hexes(frame(11));
    // The left/top of each hex in salient/docs/mockups/spectator-view.html.
    const mockup: Record<string, [number, number]> = {
      F1: [162, 3],
      G2: [258, 58],
      A6: [2, 280],
      K6: [643, 280],
      A11: [162, 558],
      F11: [483, 558],
    };
    for (const [label, [left, top]] of Object.entries(mockup)) {
      const hex = drawn.get(label)!;
      expect(parseFloat(hex.style.left), `${label} left`).toBeCloseTo(left, 0);
      expect(parseFloat(hex.style.top), `${label} top`).toBeCloseTo(top, 0);
    }
  });

  it("sizes the board to the mock-ups' 705 × 629 px and clears the frame it redraws", () => {
    const board = frame(11);
    expect(board.style.width).toBe("705px");
    expect(board.style.height).toBe("629px");

    // Stepping to another turn replaces the frame rather than adding to it.
    renderBoard(board, boardView(log, 0));
    expect(board.querySelectorAll(".hx")).toHaveLength(91);
    expect(board.querySelector('[data-hex="F1"]')!.classList.contains("bc"), "turn 0 has no cut-offs").toBe(false);
  });
});
