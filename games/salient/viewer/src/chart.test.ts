/**
 * The chart's numbers: one margin per turn of the match's axis, which side of
 * the line it belongs to, which slot carries the mark, and how tall each bar is
 * drawn. The margins come from `turns[n].after.score` and from nowhere else —
 * the result's own `margin` says how the match ended, which is one number
 * rather than the shape of it.
 *
 * What gets drawn — the classes, the titles, the key — is `render-chart.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

import { chartView, ZERO_LINE, type ChartView, type LeadSlot } from "./chart.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import golden02 from "../fixtures/golden-02-knockout-by-A.json";
import golden03 from "../fixtures/golden-03-knockout-by-B.json";
import golden04 from "../fixtures/golden-04-mirror-draw.json";

/** The first golden match, validated the way the viewer validates every log. */
const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** The slot for turn `turn` of `view`, failing if the axis does not reach it. */
function slot(view: ChartView, turn: number): LeadSlot {
  const found = view.slots.find((s) => s.turn === turn);
  if (found === undefined) throw new Error(`the axis holds no slot for turn ${turn}`);
  return found;
}

/** The side each played turn of `view` is drawn on, in turn order. */
function sides(view: ChartView): (string | null)[] {
  return view.slots.filter((s) => s.played).map((s) => s.leader);
}

/** The heights each played turn of `view` is drawn at, in turn order. */
function heights(view: ChartView): number[] {
  return view.slots.filter((s) => s.played).map((s) => s.height);
}

describe("chartView", () => {
  it("takes the margin from the logged scores and never from the result's margin", () => {
    // golden-03 ends with B having won by 93, but the match's shape is a lead
    // that grew turn by turn: turn 19 is 0 against 69, not 93.
    const knockedOut = matchLogSchema.parse(golden03);
    expect(knockedOut.result.margin).toBe(93);
    expect(slot(chartView(knockedOut, 19), 19).margin).toBe(-69);
    expect(slot(chartView(knockedOut, 19), 19).leader).toBe("B");
  });

  it("puts every turn on the side its own margin says", () => {
    // The mock-up's eleven turns: A ahead through turn 9, B ahead at turn 10,
    // and A back in front by 10 at turn 11.
    expect(sides(chartView(log, TURN_11))).toEqual([
      "A", "A", "A", "A", "A", "A", "A", "A", "A", "B", "A",
    ]);
  });

  it("marks the frame's own turn and holds its margin for the mark", () => {
    const view = chartView(log, TURN_11);
    expect(view.slots.filter((s) => s.marked).map((s) => s.turn)).toEqual([TURN_11]);
    expect(slot(view, TURN_11).margin).toBe(10);
  });

  it("draws the whole axis to config.turns, leaving the unplayed turns blank", () => {
    // golden-03 was knocked out at turn 19 of 25, and the mock-up's axis is the
    // match's length rather than the turns it reached.
    const knockedOut = matchLogSchema.parse(golden03);
    const view = chartView(knockedOut, 19);
    expect(view.axis).toBe(25);
    expect(view.slots).toHaveLength(25);
    expect(view.slots.map((s) => s.played)).toEqual([
      ...Array(19).fill(true),
      ...Array(6).fill(false),
    ]);
    for (const s of view.slots.slice(19)) {
      expect([s.margin, s.leader, s.height]).toEqual([0, null, 0]);
    }
  });

  it("leaves turns after the frame blank even when the log holds them", () => {
    // The chart replays with the frame: turn 11 is not known at turn 4.
    const view = chartView(log, 4);
    expect(view.slots.filter((s) => s.played).map((s) => s.turn)).toEqual([1, 2, 3, 4]);
    expect(view.slots.filter((s) => !s.played).map((s) => s.turn)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    ]);
  });

  it("shows no played turn at frame 0, and marks nothing", () => {
    const view = chartView(log, 0);
    expect(view.slots).toHaveLength(25);
    expect(view.slots.some((s) => s.played)).toBe(false);
    expect(view.slots.some((s) => s.marked)).toBe(false);
  });

  it("marks a turn the match never reached without claiming a margin for it", () => {
    // Scrubbing past a knockout still says where the frame is; writing `0` over
    // a turn that was never played would claim the scores were level at it.
    const knockedOut = matchLogSchema.parse(golden03);
    const view = chartView(knockedOut, 22);
    expect(slot(view, 22).marked).toBe(true);
    expect(slot(view, 22).played).toBe(false);
    expect(slot(view, 22).margin).toBe(0);
  });

  it("keeps a level turn off both sides of the line", () => {
    // golden-04 is a mirror match: every turn leaves the scores equal, so the
    // axis is full of played turns and holds no bar at all.
    const mirror = matchLogSchema.parse(golden04);
    const view = chartView(mirror, 25);
    expect(view.slots.every((s) => s.played)).toBe(true);
    expect(view.slots.every((s) => s.margin === 0 && s.leader === null && s.height === 0)).toBe(true);
  });

  it("sizes the bars at the mock-up's four pixels per point while they fit", () => {
    // The mock-up's heights: 4, 8, 8, 4, 12, 4, 4, 12, 16 for A's turns 1 to 9,
    // 8 below the line for turn 10, and 40 for the marked turn 11.
    const view = chartView(log, TURN_11);
    expect(view.scale).toBe(4);
    expect(heights(view)).toEqual([4, 8, 8, 4, 12, 4, 4, 12, 16, 8, 40]);
  });

  it("shrinks the scale when the match's widest lead does not fit half the box", () => {
    // golden-02 ends 93 to 0: at four pixels a point its 74-point lead would be
    // 296 px in a box whose half is 56, so the whole match is drawn smaller.
    const landslide = matchLogSchema.parse(golden02);
    const view = chartView(landslide, 23);
    expect(view.scale).toBeLessThan(4);
    expect(Math.max(...heights(view))).toBeLessThanOrEqual(ZERO_LINE);
    // A one-point lead still shows, or the first turn of the match would vanish.
    expect(slot(view, 1).height).toBeGreaterThanOrEqual(1);
  });

  it("sizes the bars over the whole match, so scrubbing does not resize them", () => {
    // The scale is the match's shape, not the frame's: the same five turns are
    // as tall at turn 5 as they are at turn 23.
    const landslide = matchLogSchema.parse(golden02);
    expect(heights(chartView(landslide, 5))).toEqual(heights(chartView(landslide, 23)).slice(0, 5));
    expect(heights(chartView(landslide, 5))).toHaveLength(5);
  });

  it("draws an axis of its own length for a match of any length", () => {
    // The axis is the log's, not a constant: 25 turns here, and a shorter match
    // would have a shorter chart.
    const shorter = matchLogSchema.parse({
      ...structuredClone(golden01),
      config: { ...matchLogSchema.parse(golden01).config, turns: 12 },
    }) as MatchLog;
    expect(chartView(shorter, TURN_11).axis).toBe(12);
    expect(chartView(shorter, TURN_11).slots).toHaveLength(12);
  });
});
