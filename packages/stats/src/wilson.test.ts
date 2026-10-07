/**
 * Brief §6.5's win rate and the Wilson interval the stopping test and the report
 * share.
 *
 * The interval is checked against figures worked out from the standard Wilson
 * score formula (the worked example in its own literature: 110 of 200 at 95% is
 * [0.48, 0.62], which the same arithmetic here reproduces as [0.480755,
 * 0.617361]) rather than against this module's own arithmetic, so a change to the
 * formula has to be a deliberate one.
 *
 * The two confidences are the point of the file, so they are tested against each
 * other: 15 wins in 20 is the case where the report's 95% interval excludes 50%
 * and the stopping test's 99% one does not. A series that stopped on the 95%
 * figure would have stopped on a test it was not supposed to apply.
 */
import { resultSchema } from "@no-dice/log";
import type { LogResult } from "@no-dice/log";
import { describe, expect, it } from "vitest";

import { outcomeOf, wilsonInterval, winRateOf, zOf } from "./wilson.ts";
import type { Outcome } from "./wilson.ts";

/** `n` outcomes of one kind, so a fixture can name its shape. */
const many = (outcome: Outcome, count: number): Outcome[] => Array.from({ length: count }, () => outcome);

/** A log's `result`, checked through the format's own schema. */
const result = (source: Record<string, unknown>): LogResult =>
  resultSchema.parse({ type: "time", turn: 25, score: { A: 10, B: 4 }, margin: 6, ...source });

describe("the win rate over a series' matches", () => {
  it("counts a draw as half a win", () => {
    // 10 wins, 4 draws and 6 losses: 12 successes out of 20, not 10 out of 14
    // and not 10 out of 20.
    const outcomes: Outcome[] = [...many("win", 10), ...many("draw", 4), ...many("loss", 6)];
    expect(winRateOf(outcomes)).toEqual({
      wins: 10,
      losses: 6,
      draws: 4,
      n: 20,
      successes: 12,
      rate: 0.6,
    });
  });

  it("counts an odd draw as a half, and every match as played", () => {
    const rate = winRateOf([...many("win", 1), ...many("draw", 1), ...many("loss", 1)]);
    expect(rate).toEqual({ wins: 1, losses: 1, draws: 1, n: 3, successes: 1.5, rate: 0.5 });
  });

  it("gives no rate over no matches, rather than a rate of nought", () => {
    // A 0 over nothing would read as a model that lost every match it never
    // played, and would sit in a report beside a 0.5 the interval excludes.
    expect(winRateOf([])).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      n: 0,
      successes: 0,
      rate: null,
    });
  });

  it("reads each match out of its own log result, from one seat's side", () => {
    const won = result({ winner: "A" });
    const lost = result({ winner: "B" });
    const level = result({ winner: null, score: { A: 7, B: 7 }, margin: 0 });
    expect(outcomeOf(won, "A")).toBe("win");
    expect(outcomeOf(lost, "A")).toBe("loss");
    expect(outcomeOf(level, "A")).toBe("draw");
    // The same match seen from the other seat, which is what the seat swap makes.
    expect(outcomeOf(won, "B")).toBe("loss");
    expect(outcomeOf(lost, "B")).toBe("win");
    expect(outcomeOf(level, "B")).toBe("draw");
  });

  it("calls a knockout that took both Bases a draw, as the log says", () => {
    // The engine scores that 0-0 with no winner; the score is never read here.
    const bothFell = result({ type: "knockout", winner: null, score: { A: 0, B: 0 }, margin: 0 });
    expect(outcomeOf(bothFell, "A")).toBe("draw");
    expect(winRateOf([outcomeOf(bothFell, "A")]).draws).toBe(1);
  });
});

describe("the Wilson interval", () => {
  it("takes z from the confidence: 1.96 at 95%, 2.5758 at 99%", () => {
    expect(zOf(0.95)).toBe(1.96);
    expect(zOf(0.99)).toBe(2.5758);
  });

  it("excludes 50% for 18 wins in 20 matches at 99%", () => {
    const interval = wilsonInterval({ successes: 18, n: 20, z: zOf(0.99) });
    expect(interval.low).toBeCloseTo(0.620506, 6);
    expect(interval.high).toBeCloseTo(0.980213, 6);
    expect(interval.low).toBeGreaterThan(0.5);
  });

  it("includes 50% for 10 wins in 20 matches at 99%", () => {
    const interval = wilsonInterval({ successes: 10, n: 20, z: zOf(0.99) });
    expect(interval.low).toBeCloseTo(0.25045, 6);
    expect(interval.high).toBeCloseTo(0.74955, 6);
    expect(interval.low).toBeLessThan(0.5);
    expect(interval.high).toBeGreaterThan(0.5);
  });

  it("gives the same 18-in-20 interval at 95%, narrower and inside the 99% one", () => {
    const report = wilsonInterval({ successes: 18, n: 20, z: zOf(0.95) });
    const stopping = wilsonInterval({ successes: 18, n: 20, z: zOf(0.99) });
    expect(report.low).toBeCloseTo(0.698962, 6);
    expect(report.high).toBeCloseTo(0.972134, 6);
    expect(report.low).toBeGreaterThan(stopping.low);
    expect(report.high).toBeLessThan(stopping.high);
  });

  it("stops on the 99% test where the report would have claimed a result at 95%", () => {
    // 15 wins in 20: the report's interval clears 50%, the stopping test's does
    // not. Brief §6.5's whole reason for the two confidences.
    const report = wilsonInterval({ successes: 15, n: 20, z: zOf(0.95) });
    const stopping = wilsonInterval({ successes: 15, n: 20, z: zOf(0.99) });
    expect(report.low).toBeGreaterThan(0.5);
    expect(stopping.low).toBeLessThan(0.5);
    expect(stopping.high).toBeGreaterThan(0.5);
  });

  it("takes the fractional successes a draw half a win leaves", () => {
    // 10 wins and 4 draws in 20 is 12 successes out of 20, and the interval the
    // report prints is that one — the same figures the whole-number path gives.
    const rate = winRateOf([...many("win", 10), ...many("draw", 4), ...many("loss", 6)]);
    const interval = wilsonInterval({ successes: rate.successes, n: rate.n, z: zOf(0.95) });
    expect(interval.low).toBeCloseTo(0.386578, 6);
    expect(interval.high).toBeCloseTo(0.781196, 6);
    expect(interval).toEqual(wilsonInterval({ successes: 12, n: 20, z: zOf(0.95) }));
  });

  it("stays inside 0 and 1 at the ends, where a normal interval would not", () => {
    const unbeaten = wilsonInterval({ successes: 5, n: 5, z: zOf(0.99) });
    expect(unbeaten.high).toBe(1);
    expect(unbeaten.low).toBeCloseTo(0.429747, 6);
    const winless = wilsonInterval({ successes: 0, n: 10, z: zOf(0.99) });
    expect(winless.low).toBe(0);
    expect(winless.high).toBeCloseTo(0.398849, 6);
  });

  it("puts the rate inside its own interval at the ends, at either confidence", () => {
    // Which side of 1 the arithmetic lands on depends on `n` and `z`: 5
    // for 5 at 99% comes out a hair past and clamps to 1, while 6 for 6 at the
    // report's 95% comes out a hair short — which would leave a model that won
    // every match of two series sitting outside the interval it is ranked by, and
    // a leaderboard row cannot do that.
    for (const { successes, n, confidence } of [
      { successes: 6, n: 6, confidence: 0.95 as const },
      { successes: 0, n: 6, confidence: 0.95 as const },
      { successes: 2, n: 2, confidence: 0.95 as const },
      { successes: 3, n: 3, confidence: 0.99 as const },
    ]) {
      const interval = wilsonInterval({ successes, n, z: zOf(confidence) });
      const rate = successes / n;
      expect(interval.low <= rate && rate <= interval.high, `${String(successes)} of ${String(n)}`).toBe(true);
      expect(interval.low).toBeGreaterThanOrEqual(0);
      expect(interval.high).toBeLessThanOrEqual(1);
    }
  });

  it("refuses a sample it cannot put an interval on", () => {
    // An interval out of no matches, or out of more successes than matches, is
    // what a series would stop on, so it fails at the call.
    expect(() => wilsonInterval({ successes: 0, n: 0, z: zOf(0.99) })).toThrow(/positive whole number/);
    expect(() => wilsonInterval({ successes: 3, n: 2.5, z: zOf(0.99) })).toThrow(/positive whole number/);
    expect(() => wilsonInterval({ successes: 13, n: 12, z: zOf(0.99) })).toThrow(/not a count out of/);
    expect(() => wilsonInterval({ successes: -1, n: 12, z: zOf(0.99) })).toThrow(/not a count out of/);
    expect(() => wilsonInterval({ successes: 1, n: 12, z: 0 })).toThrow(/positive z/);
  });
});
