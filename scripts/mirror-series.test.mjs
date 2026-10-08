/**
 * `scripts/mirror-series.mjs` plays the pairing `no-dice series` used to refuse:
 * one bot against itself.
 *
 * `planSeries` once threw for a pairing whose two seats fold to the same slug,
 * because brief §6.5 names a match by its seat map and both seat orders of that
 * pairing would write one log over the other's. The script named the two logs
 * apart — `<seed>-<seat-map>-A.json` and `-B.json` — and wrote the series record
 * in the shape `runSeries` writes, which is what lets `no-dice stats` and
 * `no-dice evidence` read the result like any other series. `docs/series-notes.md`
 * §7 and `docs/rules-review.md`'s Centre Node ping-pong section quote the series
 * it played, so this file keeps the four things that measurement rests on:
 *
 * - both seat orders are played, their logs land under the names the script says,
 *   and each validates against `salient-log/1`;
 * - the record is the runner's own shape, and `no-dice evidence` counts the
 *   series from it — 2 matches, 0 missing;
 * - a second run reads the logs already on disk instead of replaying them, which
 *   is brief §6.5's resume rule;
 * - the two matches of a pair come out alike, board for board. That is the
 *   caveat every document quoting one of these series states: a mirrored pairing
 *   is 10 positions played twice, not 20 positions.
 *
 * The matches are real bot matches, as in `packages/runner/src/cli.test.ts`: a
 * pair of Greedy matches is about a second and a half, and no seam is put under
 * the script, because the point of the script is that it drives the runner's own
 * `runMatch`.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";

const SCRIPT = fileURLToPath(new URL("./mirror-series.mjs", import.meta.url));
const CLI = fileURLToPath(new URL("../packages/runner/src/cli.ts", import.meta.url));

/** One pair, on a seed base of its own, so the run does not depend on other seeds. */
const flags = () => [
  "series",
  "--game",
  "salient",
  "--a",
  "bot:greedy",
  "--b",
  "bot:greedy",
  "--max-pairs",
  "1",
  "--seed-base",
  "7",
  "--dir",
  dir,
];

/** Where the series lands, in a directory that is gone when the suite is done. */
let dir;
/** What the one run the suite makes printed, kept for the resume test to compare with. */
let played;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-mirror-"));
  played = await run(SCRIPT, flags());
}, 30_000);
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const lines = (text) => text.split("\n").filter((line) => line !== "");

/** One run of one command line, with its output captured instead of printed. */
const run = (file, argv) =>
  new Promise((resolve) => {
    execFile(process.execPath, [file, ...argv], (error, stdout, stderr) => {
      resolve({
        code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
        out: lines(stdout),
        err: lines(stderr),
      });
    });
  });

/** The series record the script wrote. */
const record = async () => JSON.parse(await readFile(join(dir, "series.json"), "utf8"));

const logs = async () => (await readdir(join(dir, "matches"))).sort();

const readLog = async (name) =>
  matchLogSchema.parse(JSON.parse(await readFile(join(dir, "matches", name), "utf8")));

describe("a mirrored pairing played by the script `no-dice series` refuses", () => {
  it("plays both seat orders and names the two logs apart", async () => {
    expect(played.err.join("\n")).toBe("");
    expect(played.code).toBe(0);

    const seeds = (await record()).seeds;
    expect(seeds).toHaveLength(1);
    expect(await logs()).toEqual([
      `${String(seeds[0])}-greedy-greedy-A.json`,
      `${String(seeds[0])}-greedy-greedy-B.json`,
    ]);
    for (const name of await logs()) {
      const log = await readLog(name);
      expect(log.players).toEqual({ A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "greedy" } });
    }
  }, 30_000);

  it("writes the record `runSeries` writes, so `no-dice evidence` counts it", async () => {
    const written = await record();
    expect(written.pairing).toEqual({
      a: { kind: "bot", bot: "greedy" },
      b: { kind: "bot", bot: "greedy" },
    });
    expect(written.state).toEqual({
      pairs_played: 1,
      matches_played: 2,
      matches_failed: 0,
      stop_reason: "max_pairs",
      stopped_early: false,
    });
    expect(written.pairs[0].matches.map((match) => [match.seat, match.status])).toEqual([
      ["A", "played"],
      ["B", "played"],
    ]);

    const evidence = await run(CLI, ["evidence", "--series", dir]);
    expect(evidence.code).toBe(0);
    expect(evidence.out.join("\n")).toMatch(/1 pairs recorded, 2 matches: \*\*2 counted\*\*, \*\*0 missing\*\*/);
  }, 30_000);

  it("reads the logs a previous run left instead of replaying them", async () => {
    const before = await Promise.all((await logs()).map((name) => readFile(join(dir, "matches", name), "utf8")));
    const again = await run(SCRIPT, flags());
    expect(again.code).toBe(0);
    expect(again.out.join("\n")).toMatch(/0 played now, 2 already there, 0 failed/);
    const after = await Promise.all((await logs()).map((name) => readFile(join(dir, "matches", name), "utf8")));
    expect(after).toEqual(before);
  }, 30_000);

  it("plays the two matches of a pair alike, which is why the sample is half its count", async () => {
    const [first, second] = await Promise.all((await logs()).map(readLog));
    expect(first.seed).toBe(second.seed);
    expect(first.result).toEqual(second.result);
    expect(first.turns).toHaveLength(second.turns.length);
    // Board for board: the same map played from both sides by the same bot, so
    // the position at the end of the last turn is the same in both logs.
    expect(second.turns[second.turns.length - 1].after.cells).toEqual(
      first.turns[first.turns.length - 1].after.cells,
    );
  }, 30_000);
});
