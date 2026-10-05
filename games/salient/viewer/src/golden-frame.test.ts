// @vitest-environment happy-dom
/**
 * The milestone's done-means, and brief §8's viewer test: golden log 01 at turn
 * 11 renders the frame the spectator mock-up draws.
 *
 * Every other file here checks one view-model or one renderer. This one
 * assembles the frame the way `main.ts` does — the fixture read as the bytes
 * Vite serves at `?log=/golden-01-time-win.json`, put through the same
 * `parseLog` the page puts a log through, the frame index asked for turn 11 the
 * way the scrubber asks for it, and the four renderers drawing into elements of
 * the kinds `index.html` owns — and then reads the mock-up's numbers off the
 * result. A view-model that quietly moves a number fails here even if every
 * unit test still passes on its own reading of it, which is the point.
 *
 * The numbers, the classes and the sentences are the mock-up's, read out of
 * `salient/docs/mockups/spectator-view.html` and `fog-of-war-view.html`.
 * `docs/viewer-notes.md` records that comparison in full, including the panel
 * sentences that cannot match the mock-up's because the fixture's are generated
 * from the orders — the scripted prototype bots wrote nothing. The one line of
 * the mock-up the page does not draw yet is the headline above the board, so it
 * is not asserted here; `headline.test.ts` covers the sentence itself.
 */
import { describe, expect, it } from "vitest";

import { parseLog, pickLogSource } from "./load.ts";
import { turnFrames } from "./turns.ts";
import type { TurnFrame } from "./turns.ts";
import { boardView } from "./board.ts";
import { headerView } from "./header.ts";
import { panelsView } from "./panels.ts";
import { chartView } from "./chart.ts";
import { fogView } from "./fog.ts";
import { renderHeader } from "./render-header.ts";
import { renderBoard } from "./render-board.ts";
import { renderPanel } from "./render-panels.ts";
import { renderChart } from "./render-chart.ts";
import type { BoardMode } from "./view-mode.ts";

/** The fixture as text: the same bytes the dev server serves, not a parsed copy. */
import fixtureText from "../fixtures/golden-01-time-win.json?raw";

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** The log the page holds once that file has been loaded. */
const log = parseLog(fixtureText);

/** The elements `index.html` holds for one frame, and the frame drawn into them. */
interface Page {
  readonly header: HTMLElement;
  readonly board: HTMLElement;
  readonly panelA: HTMLElement;
  readonly panelB: HTMLElement;
  readonly chart: HTMLElement;
  /** What the frame index answered, which is what the renderers were handed. */
  readonly frame: TurnFrame;
}

/**
 * The frame one turn and one view mode shows, built as `main.ts`'s `redraw`
 * builds it: the frame index settled on the turn, then the same four renderers
 * over the same view-models, in the same order. Stepping to a frame by hand
 * lands on its settled step, which is the step the mock-up is.
 */
function draw(turn: number, mode: BoardMode = "spectator"): Page {
  const frames = turnFrames(log);
  frames.scrub(turn);
  const frame = frames.view();
  const fog = mode === "spectator" ? null : fogView(log, frame.board, mode);

  const page: Page = {
    header: document.createElement("div"),
    board: document.createElement("div"),
    panelA: document.createElement("div"),
    panelB: document.createElement("div"),
    chart: document.createElement("div"),
    frame,
  };

  renderHeader(page.header, headerView(log, frame.frame));
  renderBoard(page.board, boardView(log, frame.board), fog, frame);
  const panels = panelsView(log, frame.frame);
  renderPanel(page.panelA, panels.A);
  renderPanel(page.panelB, panels.B);
  renderChart(page.chart, chartView(log, frame.frame));
  return page;
}

/** The text under one selector, failing if the frame holds more or fewer than one. */
function text(root: HTMLElement, selector: string): string {
  const found = root.querySelectorAll(selector);
  expect(found, `${selector} matches ${found.length} elements`).toHaveLength(1);
  return found[0]?.textContent ?? "";
}

/** The labels of the elements a selector names, in the order they are drawn. */
function labels(root: HTMLElement, selector: string): string[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].map((el) => el.dataset.hex ?? "");
}

/** A panel's three small boxes, as "LABEL value". */
function boxes(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll<HTMLElement>(".boxes .box")].map(
    (box) => `${text(box, ".label")} ${text(box, ".value")}`,
  );
}

/** The height of a chart slot's bar, or `""` for a slot with no bar. */
function barHeight(slot: HTMLElement): string {
  return slot.querySelector<HTMLElement>(".lead")?.style.height ?? "";
}

describe("the fixture reaches the page as a log", () => {
  it("is the file ?log= names in dev, and a log the viewer accepts", () => {
    // Vite serves `fixtures/` at the root of the dev server, so this is the URL
    // the page fetches; the test hands the same bytes to the same `parseLog`.
    expect(pickLogSource("?log=/golden-01-time-win.json", [])).toEqual({
      kind: "url",
      url: "/golden-01-time-win.json",
    });
    expect(log.format).toBe("salient-log/1");
    expect(log.turns).toHaveLength(25);
    // The board the mock-up's 93-point bar is drawn against.
    expect(log.map).toHaveLength(91);
    expect(log.map.filter((hex) => hex.terrain !== "blocked")).toHaveLength(79);
  });

  it("steps to turn 11 as a settled frame, which is the step the mock-up is", () => {
    const page = draw(TURN_11);
    expect(page.frame.frame).toBe(TURN_11);
    expect(page.frame.phase).toBe("settled");
    expect(text(page.header, ".counter")).toBe("TURN 11 OF 25");
  });
});

describe("the turn-11 frame of golden-01", () => {
  it("reads 43 and 33 across a 43 / 17 / 33 bar and a lead of 10", () => {
    const { header } = draw(TURN_11);
    expect(text(header, ".seat-a .score")).toBe("43");
    expect(text(header, ".seat-b .score")).toBe("33");

    const segments = [...header.querySelectorAll<HTMLElement>(".bar .seg")];
    expect(segments.map((segment) => segment.className)).toEqual(["seg seg-a", "seg seg-mid", "seg seg-b"]);
    // The mock-up sizes the bar by flex, so the three widths are the points.
    expect(segments.map((segment) => segment.style.flexGrow)).toEqual(["43", "17", "33"]);
    expect(segments.map((segment) => segment.title)).toEqual([
      "A: 43 points",
      "Not scoring: 17 points",
      "B: 33 points",
    ]);
    expect(text(header, ".summary")).toBe("A leads by 10. 17 of the 93 points are not scoring.");
  });

  it("hatches the five cut-off hexes, all B's, that the mock-up hatches", () => {
    const { board } = draw(TURN_11);
    // In the map's own order, which is the order the mock-up's markup has them.
    expect(labels(board, ".hx.bc")).toEqual(["F1", "G1", "H1", "H2", "G3"]);
    // F1 is the only one of the five still holding troops, and its count sits on
    // the dark disc that keeps it readable over a hatch.
    expect(text(board, '.hx[data-hex="F1"] .ct')).toBe("1");
    expect(board.querySelectorAll(".hx.ac")).toHaveLength(0);
    // The mock-up's board box, which every hex, arrow and outline is placed from.
    expect(board.style.width).toBe("705px");
    expect(board.style.height).toBe("629px");
  });

  it("outlines the fight at F6 and draws the mock-up's twelve order arrows", () => {
    const { board } = draw(TURN_11);
    // One outline, on the hex the turn's `battle` was fought on: F6, which A
    // then took. The captures and the outline are the same fight, told twice.
    expect(labels(board, ".hl")).toEqual(["F6"]);

    const arrows = [...board.querySelectorAll<HTMLElement>(".ar")];
    expect(arrows).toHaveLength(12);
    // A's six orders then B's six, each as the mock-up's tooltip names it, which
    // is the log's own record of what each seat submitted.
    expect(arrows.map((arrow) => arrow.title)).toEqual([
      "A: 5 from F5 to F6",
      "A: 2 from F5 to G4",
      "A: 2 from D6 to D7",
      "A: 2 from C6 to D6",
      "A: 2 from C7 to D7",
      "A: 2 from B6 to C6",
      "B: 4 from H6 to H5",
      "B: 1 from K1 to K2",
      "B: 2 from I6 to H6",
      "B: 2 from I5 to H5",
      "B: 2 from J6 to I6",
      "B: 2 from J4 to J3",
    ]);
  });

  it("reads 22 troops and 2 Nodes in A's panel, and 24 and 1 in B's", () => {
    const { panelA, panelB } = draw(TURN_11);
    expect(boxes(panelA)).toEqual(["TROOPS 22", "NODES HELD 2", "ACTIONS 6 of 6"]);
    expect(boxes(panelB)).toEqual(["TROOPS 24", "NODES HELD 1", "ACTIONS 6 of 6"]);
    // The sentences are the fixture's, generated from the orders: the mock-up's
    // hand-written intent cannot appear here, and no "Called it" tag either.
    expect(text(panelA, ".block.intent .text")).toContain("5 from F5 to F6");
    expect(text(panelA, ".block.prediction .text")).toBe(
      "The largest move, 5 troops, heads for F6: expect B to answer there.",
    );
    // No "Called it" / "Missed" tag: the prediction block holds its label and
    // the sentence, and nothing else.
    expect([...panelA.querySelectorAll<HTMLElement>(".block.prediction > *")].map((el) => el.className)).toEqual([
      "label",
      "text",
    ]);
    // The scripted bots made no tool calls, so the trace says so rather than
    // inventing the mock-up's placeholder trace.
    expect(text(panelA, ".block.trace")).toContain("no tool calls");
  });

  it("marks turn 11 of the lead chart at +10", () => {
    const { chart } = draw(TURN_11);
    const slots = [...chart.querySelectorAll<HTMLElement>(".slot")];
    // The axis is the match's length, not the turns played: 25 slots, 11 of them
    // with a bar.
    expect(slots).toHaveLength(25);
    const marked = slots.filter((slot) => slot.classList.contains("marked"));
    expect(marked.map((slot) => slot.dataset.turn)).toEqual(["11"]);
    expect(text(marked[0]!, ".mark")).toBe("+10");
    // The mock-up's 4 px per point, which is the scale the whole match is drawn
    // at because its widest lead is this one.
    expect(slots.slice(0, 11).map(barHeight)).toEqual([
      "4px", "8px", "8px", "4px", "12px", "4px", "4px", "12px", "16px", "8px", "40px",
    ]);
  });
});

describe("the same turn under B's fog", () => {
  it("hides 27 playable hexes, and draws them as fog rather than not at all", () => {
    const { board } = draw(TURN_11, "B");
    const playable = new Set(log.map.filter((hex) => hex.terrain !== "blocked").map((hex) => hex.id));
    const hidden = labels(board, ".hx.f");
    expect(hidden).toHaveLength(27);
    for (const label of hidden) expect(playable.has(label), `${label} is not playable`).toBe(true);
    // A blocked hex has no owner and no troops whoever looks at it, so the
    // mock-up's 12 dark hatches are unchanged by the toggle.
    expect(board.querySelectorAll(".hx.x")).toHaveLength(12);
    // The board is the same board, in the same box.
    expect(board.style.width).toBe("705px");
    expect(board.style.height).toBe("629px");
  });

  it("keeps both Bases and all 7 Nodes on the board, with their numbers missing", () => {
    const { board } = draw(TURN_11, "B");
    const special = log.map.filter((hex) => hex.terrain === "base" || hex.terrain === "node");
    expect(special).toHaveLength(9);
    for (const hex of special) {
      const el = board.querySelector<HTMLElement>(`.hx[data-hex="${hex.id}"]`);
      expect(el, `${hex.id} is missing from the fog frame`).not.toBeNull();
      // The symbol the terrain gives it, whether or not B can see who holds it.
      expect(el!.querySelector(hex.terrain === "base" ? ".bs" : ".nd"), `${hex.id} lost its mark`).not.toBeNull();
    }
    // What goes missing is the number inside: A's Base and A's two Nodes on the
    // far side of the board are out of B's sight at turn 11.
    expect(text(board, '.hx[data-hex="B6"] .bs')).toBe("?");
    expect(text(board, '.hx[data-hex="D6"] .nd')).toBe("?");
    expect(text(board, '.hx[data-hex="D9"] .nd')).toBe("?");
    // And what B stands on keeps its count.
    expect(text(board, '.hx[data-hex="J6"] .bs')).toBe("4");
    expect(text(board, '.hx[data-hex="H6"] .nd')).toBe("3");
  });

  it("changes the board only: header, panels and chart stay the log's", () => {
    const spectator = draw(TURN_11);
    const fogged = draw(TURN_11, "B");
    expect(fogged.header.textContent).toBe(spectator.header.textContent);
    expect(fogged.panelA.textContent).toBe(spectator.panelA.textContent);
    expect(fogged.panelB.textContent).toBe(spectator.panelB.textContent);
    expect(fogged.chart.textContent).toBe(spectator.chart.textContent);
    // The board is the part fog is a lens over, so it is the part that differs.
    expect(fogged.board.innerHTML).not.toBe(spectator.board.innerHTML);
  });
});
