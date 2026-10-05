// @vitest-environment happy-dom
/**
 * What the DOM decides about the chart: which side of the line each turn's bar
 * is drawn on, how tall it is made, which slot carries the mark and what is
 * written over it, and how far the axis reaches. The numbers behind them are
 * pinned by `chart.test.ts`, so this file never recomputes a margin — it asks
 * whether the chart the log describes is the chart that gets drawn, in the
 * mock-up's shape (`salient/docs/mockups/spectator-view.html`).
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";

import { chartView } from "./chart.ts";
import { renderChart } from "./render-chart.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import golden03 from "../fixtures/golden-03-knockout-by-B.json";
import golden04 from "../fixtures/golden-04-mirror-draw.json";

const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** The chart as the log gives it at `frame`, drawn into a fresh element. */
function chart(logJson: unknown, frame: number): HTMLElement {
  const el = document.createElement("div");
  renderChart(el, chartView(matchLogSchema.parse(logJson), frame));
  return el;
}

/** The axis's slots, left to right, as the frame draws them. */
function slots(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(".chart-axis .slot")];
}

/** The bars of one slot, which is none for a level turn and for an unplayed one. */
function barsOf(slot: HTMLElement): HTMLElement[] {
  return [...slot.querySelectorAll<HTMLElement>(".lead")];
}

/** The turn a slot stands for, as the frame labels it. */
function turnOf(slot: HTMLElement): string {
  return slot.dataset.turn ?? "";
}

describe("renderChart", () => {
  it("draws one bar for each played turn, on the side its margin says", () => {
    const el = chart(golden01, TURN_11);
    const played = slots(el).filter((slot) => barsOf(slot).length > 0);
    expect(played.map(turnOf)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    // A above the line, B below it: turn 10 is the one B was ahead at.
    expect(played.map((slot) => barsOf(slot)[0]?.className)).toEqual([
      "lead lead-a", "lead lead-a", "lead lead-a", "lead lead-a", "lead lead-a",
      "lead lead-a", "lead lead-a", "lead lead-a", "lead lead-a", "lead lead-b", "lead lead-a",
    ]);
  });

  it("makes each bar the mock-up's height for its margin", () => {
    const el = chart(golden01, TURN_11);
    const made = slots(el)
      .filter((slot) => barsOf(slot).length > 0)
      .map((slot) => barsOf(slot)[0]?.style.height);
    expect(made).toEqual(["4px", "8px", "8px", "4px", "12px", "4px", "4px", "12px", "16px", "8px", "40px"]);
  });

  it("names each bar with its turn and who was ahead by how much", () => {
    const el = chart(golden01, TURN_11);
    const titles = slots(el)
      .flatMap(barsOf)
      .map((bar) => bar.title);
    expect(titles[0]).toBe("Turn 1: A ahead by 1");
    expect(titles[9]).toBe("Turn 10: B ahead by 2");
    expect(titles[10]).toBe("Turn 11: A ahead by 10");
  });

  it("marks the frame's turn and writes its margin over it", () => {
    const el = chart(golden01, TURN_11);
    const marked = slots(el).filter((slot) => slot.classList.contains("marked"));
    expect(marked.map(turnOf)).toEqual(["11"]);
    expect(marked[0]?.querySelector(".mark")?.textContent).toBe("+10");
  });

  it("writes the mark with the sign the margin has", () => {
    // B's lead reads as a negative margin, and a level turn as a bare 0.
    expect(chart(golden03, 19).querySelector(".slot.marked .mark")?.textContent).toBe("-69");
    expect(chart(golden04, 25).querySelector(".slot.marked .mark")?.textContent).toBe("0");
  });

  it("marks a turn the match never reached without writing a margin over it", () => {
    // golden-03 was knocked out at turn 19: a `0` at turn 22 would claim the
    // scores were level at a turn that was never played.
    const el = chart(golden03, 22);
    const marked = el.querySelector(".slot.marked");
    expect(turnOf(marked as HTMLElement)).toBe("22");
    expect(marked?.querySelector(".mark")).toBeNull();
    expect(barsOf(marked as HTMLElement)).toHaveLength(0);
  });

  it("draws the axis to config.turns, leaving the unplayed turns as empty slots", () => {
    // The mock-up's 25 slots, and golden-03's 19 played turns of them.
    const el = chart(golden03, 19);
    expect(slots(el)).toHaveLength(25);
    expect(slots(el).map(turnOf)).toEqual(
      Array.from({ length: 25 }, (_, i) => String(i + 1)),
    );
    expect(slots(el).filter((slot) => barsOf(slot).length > 0)).toHaveLength(19);
    for (const slot of slots(el).slice(19)) expect(barsOf(slot)).toHaveLength(0);
  });

  it("leaves turns after the frame blank, even turns the log holds", () => {
    const el = chart(golden01, 4);
    expect(slots(el)).toHaveLength(25);
    expect(slots(el).filter((slot) => barsOf(slot).length > 0).map(turnOf)).toEqual(["1", "2", "3", "4"]);
  });

  it("moves the mark and its number with the frame", () => {
    const el = document.createElement("div");
    renderChart(el, chartView(log, TURN_11));
    renderChart(el, chartView(log, 4));
    const marked = el.querySelector(".slot.marked");
    expect(turnOf(marked as HTMLElement)).toBe("4");
    expect(marked?.querySelector(".mark")?.textContent).toBe("+1");
  });

  it("draws no bar at all for a match that never left level", () => {
    const el = chart(golden04, 25);
    expect(slots(el)).toHaveLength(25);
    expect(el.querySelectorAll(".lead")).toHaveLength(0);
    expect(el.querySelector(".slot.marked .mark")?.textContent).toBe("0");
  });

  it("shows the key the mock-up draws beside the axis", () => {
    const el = chart(golden01, TURN_11);
    expect(el.querySelector(".chart-title")?.textContent).toBe("LEAD BY TURN");
    expect([...el.querySelectorAll(".chart-legend")].map((line) => line.textContent)).toEqual([
      "A ahead, above",
      "B ahead, below",
    ]);
    // The colour itself is the CSS's, keyed off the seat; the element that
    // carries it is what the CSS needs to exist.
    expect(el.querySelector(".chart-legend.leg-a .swatch")).not.toBeNull();
    expect(el.querySelector(".chart-legend.leg-b .swatch")).not.toBeNull();
  });

  it("makes the axis as wide as the match's turns, and draws the zero line once", () => {
    const el = chart(golden01, TURN_11);
    const axis = el.querySelector(".chart-axis") as HTMLElement;
    expect(axis.style.width).toBe(`${25 * 44}px`);
    expect(el.querySelectorAll(".chart-axis .zero")).toHaveLength(1);
  });

  it("replaces the chart it is given, so a stepped frame holds no bar from the last", () => {
    const el = document.createElement("div");
    renderChart(el, chartView(matchLogSchema.parse(golden03), 19));
    renderChart(el, chartView(log, TURN_11));
    expect(el.querySelectorAll(".chart-axis")).toHaveLength(1);
    expect(slots(el)).toHaveLength(25);
    expect(el.querySelectorAll(".slot.marked")).toHaveLength(1);
    expect(turnOf(el.querySelector(".slot.marked") as HTMLElement)).toBe("11");
  });
});
