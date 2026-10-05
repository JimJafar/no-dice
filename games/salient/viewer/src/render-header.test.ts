// @vitest-environment happy-dom
/**
 * What the DOM decides about the header: which seat is drawn on which side, how
 * wide each segment of the score bar is made, and what the two lines under it
 * say. The numbers behind them are pinned by `header.test.ts`, so this file
 * never recomputes a total — it asks whether the header the log describes is
 * the header that gets drawn, in the mock-up's shape
 * (`salient/docs/mockups/spectator-view.html`).
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";

import { headerView } from "./header.ts";
import { renderHeader } from "./render-header.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import golden04 from "../fixtures/golden-04-mirror-draw.json";

const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** The header as the log gives it at turn `turn`, drawn into a fresh element. */
function header(turn: number): HTMLElement {
  const el = document.createElement("div");
  renderHeader(el, headerView(log, turn));
  return el;
}

/** The bar's segments, left to right, as the frame draws them. */
function segments(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(".bar .seg")];
}

/** The points a segment holds, which is the flex the mock-up sizes it by. */
function pointsOf(segment: HTMLElement): string {
  return segment.style.flexGrow;
}

describe("renderHeader", () => {
  it("draws each seat on its own side, with its name and its score in big numerals", () => {
    const el = header(TURN_11);
    expect(el.querySelector(".seat-a .seat-name")?.textContent).toBe("raider");
    expect(el.querySelector(".seat-a .score")?.textContent).toBe("43");
    expect(el.querySelector(".seat-b .seat-name")?.textContent).toBe("striker");
    expect(el.querySelector(".seat-b .score")?.textContent).toBe("33");
  });

  it("labels each seat and marks it with its colour", () => {
    const el = header(TURN_11);
    expect(el.querySelector(".seat-a .seat-label")?.textContent).toBe("PLAYER A");
    expect(el.querySelector(".seat-b .seat-label")?.textContent).toBe("PLAYER B");
    // The colour itself is the CSS's, keyed off the seat; the element that carries
    // it is what the CSS needs to exist.
    expect(el.querySelector(".seat-a .swatch")).not.toBeNull();
    expect(el.querySelector(".seat-b .swatch")).not.toBeNull();
  });

  it("counts the frame against the match's length", () => {
    expect(header(TURN_11).querySelector(".counter")?.textContent).toBe("TURN 11 OF 25");
    expect(header(0).querySelector(".counter")?.textContent).toBe("TURN 0 OF 25");
  });

  it("makes the bar A's points from the left, the points nobody scores, then B's", () => {
    const made = segments(header(TURN_11));
    expect(made).toHaveLength(3);
    expect(made.map(pointsOf)).toEqual(["43", "17", "33"]);
    expect(made.map((seg) => seg.className)).toEqual(["seg seg-a", "seg seg-mid", "seg seg-b"]);
  });

  it("sizes the segments by the scores of the frame being shown", () => {
    // The bar is the frame's, not the match's: turn 1 is not turn 25.
    expect(segments(header(1)).map(pointsOf)).toEqual(["5", "84", "4"]);
  });

  it("names what each segment holds", () => {
    const made = segments(header(TURN_11));
    expect(made.map((seg) => seg.title)).toEqual(["A: 43 points", "Not scoring: 17 points", "B: 33 points"]);
  });

  it("puts the tick at half the bar and says half of what", () => {
    const tick = header(TURN_11).querySelector(".bar .tick");
    expect(tick).not.toBeNull();
    expect(tick?.getAttribute("title")).toBe("Half of the 93 points");
  });

  it("states the lead and the points that are not scoring under the bar", () => {
    expect(header(TURN_11).querySelector(".summary")?.textContent).toBe(
      "A leads by 10. 17 of the 93 points are not scoring.",
    );
  });

  it("says the scores are level when neither seat leads", () => {
    const el = document.createElement("div");
    renderHeader(el, headerView(matchLogSchema.parse(golden04), 25));
    expect(el.querySelector(".summary")?.textContent).toBe(
      "The scores are level. 9 of the 93 points are not scoring.",
    );
  });

  it("says why the mock-up's series line is not there, rather than leaving a gap", () => {
    const text = header(TURN_11).querySelector(".series")?.textContent ?? "";
    expect(text).toContain("No series in this log");
    expect(text).toContain("milestone 06");
  });

  it("replaces the frame it is given, so a stepped header holds no score from the last", () => {
    const el = document.createElement("div");
    renderHeader(el, headerView(log, TURN_11));
    renderHeader(el, headerView(log, 0));
    expect(el.querySelectorAll(".seat")).toHaveLength(2);
    expect(el.querySelectorAll(".bar .seg")).toHaveLength(3);
    expect(el.querySelector(".score")?.textContent).toBe("1");
    expect(el.querySelector(".counter")?.textContent).toBe("TURN 0 OF 25");
  });
});
