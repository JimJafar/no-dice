/**
 * The viewer's frame still has room for its board.
 *
 * The replay viewer's frame is the mock-up's fixed 1920 × 1080 box
 * (`salient/docs/mockups/spectator-view.html`), and everything in it is fixed
 * except one row: the stage takes whatever the others leave, and the board box
 * inside it is 705 × 629 px of the mock-up's hex geometry. So the rows are a
 * budget — spend 20 px more on the header and the stage is 20 px shorter, and
 * when the stage is shorter than 629 px the board is pushed out of the frame.
 * `docs/viewer-notes.md` §4 counts that budget in prose, and the header row is
 * the row that has to grow: the series line under the score bar is a sentence
 * about a series, and two `provider/model` names wrap it to three lines in the
 * mock-up's 760 px centre column.
 *
 * Prose is not a gate, and no test can measure the layout: happy-dom has no
 * box model, so every `offsetHeight` on that page is 0. What can be pinned is the
 * arithmetic, so this reads the row heights out of `viewer.css` and the row list
 * out of `index.html` and adds them up the way the frame does. A row added to the
 * page without being paid for, a gap widened, a header pinned back to a fixed
 * height — each fails here rather than on a screen three tasks later.
 *
 * The board box is not taken on trust here either: it is derived from a fixture
 * through the viewer's own `board.ts`, so a board that stops being the mock-up's
 * 705 × 629 px fails this budget as well as `golden-frame.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";

import { boardView } from "../games/salient/viewer/src/board.ts";
import golden01 from "../games/salient/viewer/fixtures/golden-01-time-win.json";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CSS = readFileSync(join(ROOT, "games/salient/viewer/src/viewer.css"), "utf8");
const HTML = readFileSync(join(ROOT, "games/salient/viewer/index.html"), "utf8");

/** The mock-up's board box, which is the frame's one immovable block. */
const MOCKUP_BOARD = { width: 705, height: 629 };

/** The board the frame holds: the viewer's own geometry over a real fixture, and
 * the block every row of the frame has to leave room for. */
const board = boardView(matchLogSchema.parse(golden01), 0);

/** One rule's declarations, as text — `viewer.css` puts every rule at a line start. */
function rule(selector) {
  const at = CSS.indexOf(`\n${selector}{`);
  if (at === -1) throw new Error(`viewer.css has no ${selector} rule`);
  return CSS.slice(at + 1, CSS.indexOf("}", at));
}

/** One declaration of a rule, or null when the rule does not make it. */
function declaration(block, property) {
  // Anchored to the start of a declaration, so `min-height` is not read as a `height`.
  const match = block.match(new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+)`));
  return match === null ? null : match[1].trim();
}

/** A length a rule gives in px. */
function px(selector, property) {
  const length = Number.parseFloat(declaration(rule(selector), property) ?? "");
  if (!Number.isFinite(length)) throw new Error(`viewer.css gives no ${property} on ${selector}`);
  return length;
}

/** The height of one line of a rule's text: its font size times its line height. */
function lineBox(selector) {
  const block = rule(selector);
  // `font:600 15px/1.2 …`, which is how the mock-up writes its type, or
  // the two declarations apart, which is how the page's own sentences are written.
  const shorthand = declaration(block, "font")?.match(/(\d+(?:\.\d+)?)px\s*\/\s*([\d.]+)/);
  if (shorthand) return Number(shorthand[1]) * Number(shorthand[2]);
  const size = Number.parseFloat(declaration(block, "font-size") ?? "");
  const ratio = declaration(block, "line-height");
  if (!Number.isFinite(size)) throw new Error(`viewer.css gives no font size on ${selector}`);
  return size * (ratio === null ? 1 : Number.parseFloat(ratio));
}

/** One of the page's control buttons: its padding over its line of text. */
function buttonHeight(selector) {
  const [vertical] = (declaration(rule(selector), "padding") ?? "").split(/\s+/);
  const pads = Number.parseFloat(vertical ?? "");
  if (!Number.isFinite(pads)) throw new Error(`viewer.css gives no padding on ${selector}`);
  return 2 * pads + lineBox(selector);
}

/** The header's centre column, with `lines` of series under the score bar. */
function centreColumn(lines) {
  return (
    lineBox(".counter") +
    px(".bar", "height") +
    lineBox(".summary") +
    lines * lineBox(".series") +
    3 * px(".centre", "gap")
  );
}

/** The ids of the elements `#frame` holds directly, in document order. */
function frameRows() {
  const start = HTML.indexOf('<div id="frame"');
  if (start === -1) throw new Error("index.html has no #frame");
  const rows = [];
  let depth = 0;
  for (const tag of HTML.matchAll(/<\/?div\b[^>]*>/g)) {
    if (tag.index < start) continue;
    if (tag[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) break; // that closed #frame itself
      continue;
    }
    if (depth === 1) {
      const id = /\bid="([^"]+)"/.exec(tag[0]);
      if (id !== null) rows.push(id[1]);
    }
    depth += 1;
  }
  return rows;
}

/** What each row of a loaded frame costs, by its id. `stage` is absent because it
 * is the row that takes whatever the others leave; `load` is absent because the
 * loading screen gives its height up as soon as a log arrives. */
const ROW_HEIGHTS = {
  header: () => px(".header", "min-height"),
  headline: () => lineBox(".headline"),
  // The tallest thing in the page's control row is one of its buttons.
  controls: () => Math.max(buttonHeight(".toggle button"), buttonHeight(".turns button")),
  chart: () => px(".chart-axis", "height"),
};

const FRAME_HEIGHT = px(".frame", "height");
const PADDING = px(".frame", "padding");
const GAP = px(".frame", "gap");
const INNER = FRAME_HEIGHT - 2 * PADDING;

/** The rows a loaded frame shows. */
const ROWS = frameRows().filter((id) => id !== "load");

/** What the stage is left with, once the header row has taken `headerHeight`. */
function stageFor(headerHeight) {
  const costs = ROWS.filter((id) => id !== "stage").map((id) => {
    const cost = ROW_HEIGHTS[id];
    if (cost === undefined) throw new Error(`the frame's ${id} row is not in the budget`);
    return id === "header" ? headerHeight : cost();
  });
  return INNER - (ROWS.length - 1) * GAP - costs.reduce((sum, cost) => sum + cost, 0);
}

describe("the viewer's frame budget", () => {
  it("is the mock-up's 1920 × 1080 box around a 705 × 629 px board", () => {
    expect(FRAME_HEIGHT).toBe(1080);
    expect([Math.round(board.width), Math.round(board.height)]).toEqual([MOCKUP_BOARD.width, MOCKUP_BOARD.height]);
  });

  it("names a cost for every row the frame holds", () => {
    // A row added to `index.html` is a row the frame has to pay for; this is
    // the check that says so before the arithmetic below quietly absorbs it.
    for (const id of ROWS.filter((row) => row !== "stage")) {
      expect(Object.keys(ROW_HEIGHTS), `${id} has no cost in the frame budget`).toContain(id);
    }
  });

  it("lets the header row grow past the mock-up's 104 px rather than clip to it", () => {
    // The mock-up fixes the row at 104 px. The page keeps that as a floor, so a
    // series line that wraps takes the row taller instead of hanging over the
    // headline and the control rows below it.
    expect(declaration(rule(".header"), "height"), ".header fixes its height").toBeNull();
    expect(px(".header", "min-height")).toBe(104);
  });

  it("keeps the board box inside the frame at the mock-up's header height", () => {
    expect(stageFor(104)).toBeGreaterThanOrEqual(board.height);
  });

  it("pays for a three-line series line and keeps the board box inside the frame", () => {
    // The sentence `series.ts` builds for a pairing of two `provider/model` names
    // — the pairing, its win rate and interval, its pairs, its stop reason and the
    // seed clause — is three lines at the mock-up's 15 px in its 760 px centre
    // column, which is the tallest the header is expected to get.
    const threeLines = centreColumn(3);
    expect(threeLines).toBeGreaterThan(104);
    expect(stageFor(threeLines)).toBeGreaterThanOrEqual(board.height);
  });

  it("absorbs a fourth and a fifth line into the gaps around the stage, and no further", () => {
    // The stage can give up to one gap on either side before the board box
    // touches the rows next to it. That is what the frame has left over: room for
    // two more lines of series than it pays for, and none beyond them.
    const slack = board.height - 2 * GAP;
    expect(stageFor(centreColumn(5))).toBeGreaterThanOrEqual(slack);
    expect(stageFor(centreColumn(6))).toBeLessThan(slack);
  });

  it("holds five rows, the page's two control groups sharing one of them", () => {
    // The mock-up's three, plus the headline and the page's own controls. The view
    // toggle and the replay controls share that last row: they are the only height
    // in the frame that is not the mock-up's, and the row they used to take
    // separately is what the header row spends on the series line.
    expect(ROWS).toEqual(["header", "headline", "stage", "controls", "chart"]);
    expect(ROWS).not.toContain("view-toggle");
    expect(ROWS).not.toContain("turns");
  });
});
