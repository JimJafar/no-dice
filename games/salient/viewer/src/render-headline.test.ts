// @vitest-environment happy-dom
/**
 * The one line above the board: what the page does with a turn's sentence.
 * `headline.test.ts` pins the sentences themselves against the fixtures, so this
 * file never recomputes one from events — it asks that the frame shows the
 * sentence of the turn it is on, that moving the frame replaces the line rather
 * than adding to it, and that no frame of a match is left with an empty line,
 * which would read as a broken viewer rather than a quiet turn.
 *
 * The last test reads `index.html` itself, because the element the line is drawn
 * into is the page's, not this module's: an element missing from the frame, or
 * put below the board instead of above it, is a headline the viewer never shows.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

import { headline } from "./headline.ts";
import { renderHeadline } from "./render-headline.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import golden04 from "../fixtures/golden-04-mirror-draw.json";
import golden05 from "../fixtures/golden-05-random-chaos.json";
import indexHtml from "../index.html?raw";

/** The match the mock-ups were drawn from. */
const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** The line one turn of `source` shows: its sentence, drawn into a fresh element. */
function line(source: MatchLog, turn: number): HTMLElement {
  const el = document.createElement("div");
  renderHeadline(el, headline(source, turn));
  return el;
}

describe("renderHeadline", () => {
  it("draws the turn's sentence as the line above the board", () => {
    // The mock-up's turn 11: the Node capture, the 5 against 3 fight that took
    // it, and the five of B's hexes the turn leaves out of supply.
    expect(line(log, TURN_11).textContent).toBe(
      "B takes K2, A takes G4, A takes the Node, 5 against 3, and cuts off five of B's hexes",
    );
  });

  it("opens the replay on the start position's line rather than an empty one", () => {
    expect(line(log, 0).textContent).toBe(
      "The match opens with A holding its Base at B6 and B holding its Base at J6",
    );
  });

  it("gives a turn that logged no events a line of its own", () => {
    // golden-04's turn 16 is orders that moved troops between hexes their owner
    // already held, so the line says what that means instead of saying nothing.
    expect(line(matchLogSchema.parse(golden04), 16).textContent).toBe("No hex changed hands");
  });

  it("replaces the line when the frame moves, leaving no clause of the turn before", () => {
    const el = document.createElement("div");
    renderHeadline(el, headline(log, TURN_11));
    renderHeadline(el, headline(log, 12));
    expect(el.textContent).toBe("B takes G5, 1 against 4, A takes E7, 3 against 1, and cuts off five of B's hexes");
    // Turn 11's captures are gone, and nothing was appended to hold them.
    expect(el.textContent).not.toContain("K2");
    expect(el.childNodes).toHaveLength(1);
  });

  it("leaves no frame of a match without a line", () => {
    // Every frame of three of the fixtures: golden-01 for the fights and the
    // supply, golden-04 for the turns that logged nothing, golden-05 for a match
    // no scripted bot steered.
    for (const source of [log, matchLogSchema.parse(golden04), matchLogSchema.parse(golden05)]) {
      for (let turn = 0; turn <= source.turns.length; turn += 1) {
        const shown = line(source, turn).textContent?.trim() ?? "";
        expect(shown, `${source.seed} turn ${turn} shows no line`).not.toBe("");
      }
    }
  });
});

describe("the frame holds a place for the line", () => {
  it("has a headline element, and has it above the board", () => {
    // `main.ts` asks the page for this element by id and throws without it, and
    // the mock-up draws the line directly above the board box.
    const at = indexHtml.indexOf('id="headline"');
    expect(at, "index.html holds no #headline").toBeGreaterThan(-1);
    expect(indexHtml.indexOf('id="board"')).toBeGreaterThan(at);
    // The class `viewer.css` styles the line by, and hidden until a log arrives,
    // like every other row of an empty frame.
    const tag = indexHtml.slice(indexHtml.lastIndexOf("<", at), indexHtml.indexOf(">", at));
    expect(tag).toContain('class="headline"');
    expect(tag).toContain("hidden");
  });
});
