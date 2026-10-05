/**
 * A series directory `runSeries` wrote is a directory `seriesReport` reads.
 *
 * `@no-dice/stats` reads the runner's `series.json` with a schema and a path
 * convention of its own — it cannot import the runner's writer's schema, because
 * the runner already depends on stats for its stopping test — so the two ends of
 * that contract have to be tested against each other rather than against a
 * hand-written record. This runs a real series (scripted matches, real
 * `salient-log/1` files on disk) with a *relative* `--dir`, which is what
 * `series-cli` defaults to, and then reports the directory from a working
 * directory that is not the one the run started in.
 *
 * That combination is the one that used to report nothing: the record's paths
 * carry the series directory's own prefix (`matchOf` writes
 * `<dir>/matches/<seed>-<seats>.json`), so from elsewhere they resolve to
 * nothing, and re-joining them under the series directory doubles the prefix. A
 * 150-match series read that way printed "0 counted, 150 missing" instead of
 * failing, which is the quietest way a report can be wrong.
 *
 * The series is run under the repository's own `series/`, which `.gitignore`
 * keeps out of the tree, because a relative `--dir` is the whole point; it is
 * then copied to a temporary directory and the original removed, so the paths as
 * written are genuinely missing where the report reads them.
 */
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { renderSeriesReport, seriesReport } from "@no-dice/stats/series-report";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SeatArg } from "./args.ts";
import { runSeries } from "./series.ts";
import type { SeriesRecord } from "./series.ts";
import { scripted } from "./scripted-series.ts";
import type { PlayCall } from "./scripted-series.ts";

/** Model X: the model the series measures, and the one the seat swap moves. */
const X: SeatArg = { kind: "model", provider: "marvin", model: "subagent" };

/** The opponent every pair is played against. */
const OPPONENT: SeatArg = { kind: "bot", bot: "greedy" };

/** What a scripted match reports when X holds the seat: a win by 12 on time. */
const WIN = {
  type: "time" as const,
  winner: "A" as "A" | "B" | null,
  margin: 12,
  costUsd: 0.75,
  tokens: { input: 300, output: 30, cache_read: 1200, cache_write: 3 },
};

/** What a scripted match reports when X plays the other seat: it loses by 5. */
const LOSS = { ...WIN, margin: 5 };

/** The scratch the integration series lives in, under the gitignored `series/`. */
const SCRATCH = join("series", "series-report-integration");

/** Where the series is run: relative to the working directory, as `--dir` defaults to. */
const SERIES_DIR = join(SCRATCH, "marvin-subagent-vs-greedy");

/** The copy of that directory, somewhere the paths it wrote cannot resolve. */
let moved: string;

beforeAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
  const calls: PlayCall[] = [];
  await runSeries({
    dir: SERIES_DIR,
    a: X,
    b: OPPONENT,
    maxPairs: 2,
    seedBase: 7,
    // X wins the match it plays from seat A and loses the one it plays from B,
    // so the seat split the report prints is not a tie.
    playMatch: scripted(calls, (call) => (call.seat === "A" ? WIN : LOSS)),
  });
  expect(calls).toHaveLength(4);

  const elsewhere = await mkdtemp(join(tmpdir(), "no-dice-series-moved-"));
  moved = join(elsewhere, basename(SERIES_DIR));
  await cp(SERIES_DIR, moved, { recursive: true });
  // The directory the run wrote is gone: the paths its record wrote, read from
  // here, name files that are no longer where they say they are.
  await rm(SERIES_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(moved, { recursive: true, force: true });
  await rm(SCRATCH, { recursive: true, force: true });
});

describe("a series the runner wrote", () => {
  it("names its logs by paths that carry the series directory", async () => {
    // The contract the report has to keep up with, asserted at the source rather
    // than assumed: a relative `--dir` puts a relative path in `series.json`.
    const record = JSON.parse(await readFile(join(moved, "series.json"), "utf8")) as SeriesRecord;
    const paths = record.pairs.flatMap((pair) => pair.matches.map((match) => match.path));
    expect(paths).toHaveLength(4);
    for (const path of paths) {
      expect(path).not.toMatch(/^\//);
      expect(path).toContain(SERIES_DIR);
      expect(path).toMatch(/matches\/\d+-(marvin-subagent-greedy|greedy-marvin-subagent)\.json$/);
    }
  });

  it("reports every match it played, read from another working directory", async () => {
    const report = await seriesReport(moved);
    expect(report.xLabel).toBe("marvin/subagent");
    expect(report.opponentLabel).toBe("bot:greedy");
    expect(report.pairs).toBe(2);
    expect(report.matches).toBe(4);
    expect(report.counted).toBe(4);
    expect(report.missing.total).toBe(0);
    expect(report.result.winRate).toEqual({
      wins: 2,
      losses: 2,
      draws: 0,
      n: 4,
      successes: 2,
      rate: 0.5,
    });
    expect(report.seatSplit.A.winRate.rate).toBe(1);
    expect(report.seatSplit.B.winRate.rate).toBe(0);
    expect(report.models.map((model) => model.label)).toEqual(["marvin/subagent", "bot:greedy"]);
    // The scripted log plays two turns, so four matches of it is eight turns.
    expect(report.models[0].metrics.turnCount).toBe(8);
    expect(report.stop.reason).toBe("max_pairs");
    expect(report.stop.stoppedEarly).toBe(false);
  });

  it("writes its report beside the record it read", async () => {
    const written = await renderSeriesReport(moved);
    expect(written.path).toBe(join(moved, "report.md"));
    expect(written.markdown).toContain("# Series report: marvin/subagent vs bot:greedy");
    expect(written.markdown).toContain("**4 counted**, **0 missing**");
  });
});
