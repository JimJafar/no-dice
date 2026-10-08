/**
 * The leaderboard read, on the page: the shape it accepts from
 * `GET /api/leaderboard`, and what it does when the answer is not that shape.
 *
 * The figures themselves are the stats package's, and
 * `packages/ui/src/leaderboard.test.ts` checks the console's answer against
 * `seriesReport` and `pooledModelRows` figure for figure. What is checked here is
 * narrower: that the page keeps every figure it draws, that a field it reads
 * and the answer does not carry is one readable line rather than an `undefined`
 * drawn into a table, and that a series with nothing counted stays a series with
 * no rate rather than becoming one with a rate of nought.
 *
 * The listings are built here by hand rather than by importing the server's
 * types, which read the filesystem and pull in `@no-dice/stats`.
 */
import { describe, expect, it } from "vitest";

import { LEADERBOARD_PATH, fetchLeaderboard, parseLeaderboard } from "./leaderboard.ts";

/** One series, as the leaderboard answers it: seven counted matches, a full-length stop. */
const SERIES = {
  name: "alpha",
  dir: "/repo/series/alpha",
  reportUrl: "/logs/alpha/report.md",
  a: "bot:greedy",
  b: "marvin/subagent",
  maxPairs: 4,
  pairs: 4,
  matches: 8,
  counted: 7,
  missing: 1,
  stopReason: "max_pairs",
  stoppedEarly: false,
  winRate: 0.6428571428571429,
  interval: { low: 0.38712960064025523, high: 0.836883786832949 },
  confidence: 0.95,
};

/** One result, as the console answers it: `winRate`'s counts, and the interval over them. */
const result = (n: number, wins: number, losses: number, draws: number, low: number, high: number) => ({
  winRate: {
    n,
    wins,
    losses,
    draws,
    successes: wins + draws / 2,
    rate: n === 0 ? null : (wins + draws / 2) / n,
  },
  interval: n === 0 ? null : { low, high },
  confidence: 0.95,
});

/** One pooled model, as the leaderboard answers it: ten counted matches, two missing. */
const MODEL = {
  label: "bot:greedy",
  matches: 10,
  seats: { A: 5, B: 5 },
  result: result(10, 6, 3, 1, 0.354, 0.872),
  seatSplit: { A: result(5, 4, 0, 1, 0.4, 0.99), B: result(5, 2, 3, 0, 0.12, 0.73) },
  missing: 2,
  missingNote:
    "2 missing matches attributed to the pairing rather than to this model: a match that never " +
    "produced a log was denied to both of its seats, and is not a loss.",
  series: ["/repo/series/alpha", "/repo/series/beta"],
};

/** The whole answer, as the console gives it. */
const ANSWER = {
  seriesRoot: "/repo/series",
  series: [SERIES],
  models: [MODEL],
  unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "series.json is not JSON" }],
};

describe("parseLeaderboard", () => {
  it("keeps both tables and both lists of what is not in them", () => {
    const board = parseLeaderboard(ANSWER);

    expect(board.seriesRoot).toBe("/repo/series");
    // The row as the page reads it: the figures it draws, and nothing it does
    // not. `seats` and the counts of wins and losses are in the answer and on no
    // leaderboard row, so they are not in the shape either. `dir` is kept, though
    // no row shows it, because a pooled row names its series by directory and
    // this is the answer that says what each of those directories is called.
    expect(board.series).toEqual([
      {
        name: "alpha",
        dir: "/repo/series/alpha",
        a: "bot:greedy",
        b: "marvin/subagent",
        maxPairs: 4,
        pairs: 4,
        matches: 8,
        counted: 7,
        missing: 1,
        stopReason: "max_pairs",
        stoppedEarly: false,
        winRate: 0.6428571428571429,
        interval: { low: 0.38712960064025523, high: 0.836883786832949 },
        confidence: 0.95,
        reportUrl: "/logs/alpha/report.md",
      },
    ]);
    expect(board.models).toEqual([
      {
        label: "bot:greedy",
        matches: 10,
        result: { n: 10, rate: 0.65, interval: { low: 0.354, high: 0.872 }, confidence: 0.95 },
        seatSplit: {
          A: { n: 5, rate: 0.9, interval: { low: 0.4, high: 0.99 }, confidence: 0.95 },
          B: { n: 5, rate: 0.4, interval: { low: 0.12, high: 0.73 }, confidence: 0.95 },
        },
        missing: 2,
        missingNote: MODEL.missingNote,
        series: ["/repo/series/alpha", "/repo/series/beta"],
      },
    ]);
    expect(board.unreadable).toEqual([
      { name: "broken", dir: "/repo/series/broken", error: "series.json is not JSON" },
    ]);
  });

  it("names the field when the answer is missing one, rather than drawing undefined", () => {
    const { reportUrl, ...withoutReport } = SERIES;
    expect(reportUrl).toBeTypeOf("string");
    expect(() => parseLeaderboard({ ...ANSWER, series: [withoutReport] })).toThrow(
      "series[0].reportUrl is not a string",
    );

    const { missingNote, ...withoutNote } = MODEL;
    expect(missingNote).toBeTypeOf("string");
    expect(() => parseLeaderboard({ ...ANSWER, models: [withoutNote] })).toThrow(
      "models[0].missingNote is not a string",
    );

    // The seat split is the part a reader is most likely to be shown, so a
    // split missing one seat is named down to the seat.
    const { B, ...splitWithoutB } = MODEL.seatSplit;
    expect(B).toBeDefined();
    expect(() => parseLeaderboard({ ...ANSWER, models: [{ ...MODEL, seatSplit: splitWithoutB }] })).toThrow(
      "models[0].seatSplit.B is not an object",
    );

    expect(() => parseLeaderboard({ ...ANSWER, seriesRoot: undefined })).toThrow("seriesRoot is not a string");
    expect(() => parseLeaderboard([])).toThrow("the answer from /api/leaderboard is not an object");
    expect(() => parseLeaderboard({ ...ANSWER, models: {} })).toThrow("models is not a list");
  });

  it("keeps a series with nothing counted as having no rate and no interval", () => {
    const board = parseLeaderboard({
      ...ANSWER,
      series: [{ ...SERIES, counted: 0, missing: 8, winRate: null, interval: null }],
      models: [],
    });

    expect([board.series[0]!.winRate, board.series[0]!.interval]).toEqual([null, null]);
  });

  it("keeps a seat with no counted match as having no rate of its own", () => {
    const noSeatA = { ...MODEL, seatSplit: { A: result(0, 0, 0, 0, 0, 0), B: MODEL.seatSplit.B } };
    const board = parseLeaderboard({ ...ANSWER, models: [noSeatA] });
    const [row] = board.models;

    expect([row!.seatSplit.A.n, row!.seatSplit.A.rate, row!.seatSplit.A.interval]).toEqual([0, null, null]);
    expect(row!.seatSplit.B.rate).toBe(0.4);
  });
});

describe("fetchLeaderboard", () => {
  it("reads both views in one request to the console", async () => {
    const asked: string[] = [];
    const board = await fetchLeaderboard((path) => {
      asked.push(path);
      return Promise.resolve(Response.json(ANSWER));
    });

    // One read, not two: the two tables are two views of one walk of every match
    // log, and asking twice would walk it twice and could get two answers.
    expect(asked).toEqual([LEADERBOARD_PATH]);
    expect(LEADERBOARD_PATH).toBe("/api/leaderboard");
    expect(board.series[0]!.name).toBe("alpha");
    expect(board.models[0]!.label).toBe("bot:greedy");
  });

  it("fails with the console's own line when it refuses", async () => {
    const refuses = (): Promise<Response> =>
      Promise.resolve(Response.json({ error: "the series root is not there" }, { status: 500 }));

    await expect(fetchLeaderboard(refuses)).rejects.toThrow("the series root is not there");
  });
});
