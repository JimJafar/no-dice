/**
 * Brief §6.7's margin, and the bootstrap interval around its mean.
 *
 * The margin is read out of the log's own `result` — the format's `resultSchema`
 * parses every fixture here, so a fixture that stops being a log's result stops
 * being a test. The one figure the log does not settle is a knockout's: brief
 * §6.7 fixes it at 93, and the test that pins the constant does it from a match
 * the engine really played, by adding up the points of the map that match was
 * played on.
 *
 * The bootstrap is tested for the property that makes it worth having in a
 * published report — the same margins and the same seed give the same interval,
 * and a different seed gives a different one — and against one set of figures
 * worked out once, so a change to the generator or to the percentile convention
 * shows up as a changed number rather than as a report that quietly moved.
 *
 * The real-log fixture imports the runner, which `@no-dice/stats` deliberately
 * does not declare as a dependency: the workspace root already has `@no-dice/runner`
 * as a devDependency, and that is what resolves the import — the same arrangement
 * `match-metrics.test.ts` uses, and the reason stays the same (a `stats` → `runner`
 * edge would be a cycle once the series runner calls in here for its stopping test).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchLogSchema, resultSchema } from "@no-dice/log";
import type { LogResult, MatchLog } from "@no-dice/log";
import { runMatch } from "@no-dice/runner/match";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KNOCKOUT_MARGIN, bootstrapMargin, marginOf } from "./margin.ts";

/** A log's `result`, checked through the format's own schema. */
const result = (source: Record<string, unknown>): LogResult =>
  resultSchema.parse({ type: "time", turn: 25, winner: "A", score: { A: 10, B: 4 }, margin: 6, ...source });

/** The margins of a series that mixed knockouts, narrow wins and two draws. */
const SERIES_MARGINS = [93, 93, 12, 0, 7, 93, 4, 31, 0, 18, 93, 2, 25, 9, 93];

describe("the margin of one match", () => {
  it("counts a knockout as 93 whatever the logged score says", () => {
    // The engine scores a knockout as every point on the board, so on the brief's
    // map the log already says 93. A match played on a smaller map, or a log
    // written by hand, says something else, and is still 93: the margin says how
    // decisively the match ended, not how many hexes were on the board.
    expect(marginOf(result({ type: "knockout", turn: 14, score: { A: 93, B: 0 }, margin: 93 }))).toBe(
      KNOCKOUT_MARGIN,
    );
    expect(marginOf(result({ type: "knockout", turn: 14, score: { A: 61, B: 12 }, margin: 49 }))).toBe(93);
    expect(marginOf(result({ type: "knockout", turn: 3, score: { A: 20, B: 0 }, margin: 20 }))).toBe(93);
    expect(marginOf(result({ type: "knockout", turn: 22, score: { A: 0, B: 93 }, margin: 93 }))).toBe(93);
  });

  it("keeps a knockout that took both Bases at nought", () => {
    // Both Bases fell in the same turn: the engine recorded no winner and a 0-0
    // score. Counting that as 93 would give a drawn match the series' biggest
    // margin, which is the opposite of what §6.7's mean is for.
    const bothFell = result({ type: "knockout", turn: 19, winner: null, score: { A: 0, B: 0 }, margin: 0 });
    expect(marginOf(bothFell)).toBe(0);
  });

  it("takes a match that ran out of time as the log scored it", () => {
    expect(marginOf(result({ score: { A: 61, B: 23 }, margin: 38 }))).toBe(38);
    expect(marginOf(result({ score: { A: 40, B: 40 }, winner: null, margin: 0 }))).toBe(0);
    // The log's margin is the gap between the two scores, and is never recomputed
    // here: a score of its own is the engine's answer, not this module's.
    expect(marginOf(result({ score: { A: 7, B: 91 }, margin: 84 }))).toBe(84);
  });
});

describe("the 93 against a match the engine really played", () => {
  let dir: string;
  let log: MatchLog;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "no-dice-margin-"));
    // A real bot-versus-bot match on the default map: its own `map` and `config`
    // say what every point on that board is worth, which is what a knockout is
    // scored as (`pointsOnBoard` in the engine).
    const { path } = await runMatch({
      out: join(dir, "135.json"),
      seed: 135,
      seats: { A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "random" } },
    });
    log = matchLogSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is the whole board of the map a series is played on", () => {
    const points = log.map.reduce(
      (total, hex) =>
        hex.terrain === "blocked" ? total : total + log.config.points[hex.terrain],
      0,
    );
    expect(log.map).toHaveLength(91);
    expect(points).toBe(KNOCKOUT_MARGIN);
  });

  it("leaves a match that ran out of time at the margin its log recorded", () => {
    expect(log.result.type).toBe("time");
    expect(marginOf(log.result)).toBe(log.result.margin);
    expect(log.result.margin).toBe(Math.abs(log.result.score.A - log.result.score.B));
  });
});

describe("the bootstrap interval of the mean margin", () => {
  it("gives the same interval for the same margins and seed", () => {
    const first = bootstrapMargin(SERIES_MARGINS, { samples: 2000, seed: 42 });
    const again = bootstrapMargin(SERIES_MARGINS, { samples: 2000, seed: 42 });
    expect(first).toEqual(again);
    // Worked out once and written down: a report re-run next week over the same
    // logs prints these figures, and a change to the generator or to the
    // percentile convention moves them.
    expect(first).toEqual({
      n: 15,
      mean: 38.2,
      low: 18.866666666666667,
      high: 58.93333333333333,
      samples: 2000,
      confidence: 0.95,
    });
  });

  it("gives a different interval for a different seed", () => {
    const one = bootstrapMargin(SERIES_MARGINS, { samples: 2000, seed: 42 });
    const other = bootstrapMargin(SERIES_MARGINS, { samples: 2000, seed: 44 });
    expect(one.low).not.toBe(other.low);
    expect(one.high).not.toBe(other.high);
    // The mean is the margins' own, and does not depend on the seed at all.
    expect(one.mean).toBe(other.mean);
  });

  it("reports the mean of the margins it was handed", () => {
    const bootstrap = bootstrapMargin(SERIES_MARGINS, { samples: 500, seed: 7 });
    const counted = SERIES_MARGINS.reduce((total, margin) => total + margin, 0) / SERIES_MARGINS.length;
    expect(bootstrap.mean).toBeCloseTo(counted, 10);
    expect(bootstrap.n).toBe(SERIES_MARGINS.length);
  });

  it("brackets the mean and stays inside the margins the series had", () => {
    const bootstrap = bootstrapMargin(SERIES_MARGINS, { samples: 4000, seed: 1 });
    expect(bootstrap.low).toBeLessThanOrEqual(bootstrap.mean);
    expect(bootstrap.high).toBeGreaterThanOrEqual(bootstrap.mean);
    expect(bootstrap.low).toBeGreaterThanOrEqual(Math.min(...SERIES_MARGINS));
    expect(bootstrap.high).toBeLessThanOrEqual(Math.max(...SERIES_MARGINS));
  });

  it("collapses to the margin when every match had the same one", () => {
    // A series of nothing but knockouts has a mean of 93 and no spread at all:
    // an interval of nought width, rather than a spread the margins do not have.
    const bootstrap = bootstrapMargin(Array.from({ length: 8 }, () => 93), {
      samples: 1000,
      seed: 5,
    });
    expect(bootstrap).toEqual({ n: 8, mean: 93, low: 93, high: 93, samples: 1000, confidence: 0.95 });
  });

  it("widens as the confidence it is asked for widens", () => {
    const at95 = bootstrapMargin(SERIES_MARGINS, { samples: 2000, seed: 42, confidence: 0.95 });
    const at99 = bootstrapMargin(SERIES_MARGINS, { samples: 2000, seed: 42, confidence: 0.99 });
    expect(at99.low).toBeLessThanOrEqual(at95.low);
    expect(at99.high).toBeGreaterThanOrEqual(at95.high);
    expect(at99.confidence).toBe(0.99);
  });

  it("draws a single margin as an interval of nought width", () => {
    expect(bootstrapMargin([93], { samples: 100, seed: 0 })).toEqual({
      n: 1,
      mean: 93,
      low: 93,
      high: 93,
      samples: 100,
      confidence: 0.95,
    });
  });

  it("refuses margins and settings it cannot put an interval on", () => {
    expect(() => bootstrapMargin([], { samples: 100, seed: 1 })).toThrow(/at least one margin/);
    expect(() => bootstrapMargin([93, Number.NaN], { samples: 100, seed: 1 })).toThrow(/finite number/);
    expect(() => bootstrapMargin([93], { samples: 0, seed: 1 })).toThrow(/positive whole number/);
    expect(() => bootstrapMargin([93], { samples: 1.5, seed: 1 })).toThrow(/positive whole number/);
    expect(() => bootstrapMargin([93], { samples: 10, seed: 1, confidence: 1 })).toThrow(/between 0 and 1/);
  });
});
