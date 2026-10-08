/**
 * The series plan: brief §6.5's whole list of matches a pairing will play,
 * worked out on disk before any of them is played.
 *
 * What these tests pin down is the three rules the series runner is built on:
 *
 * - the seed list is drawn once and kept in `series.json`, so planning the same
 *   pairing again — with another seed base, next week, after a crash — sits on
 *   the same maps instead of drawing new ones;
 * - every seed is two matches with the seats swapped, at the layout brief §6.5
 *   names, each with a `matchDir` of its own under `sessions/` so a Pi seat's
 *   home never lands beside the log in `matches/`;
 * - a pair whose logs are already on disk is skipped, and a pair with one log
 *   plays only the match that is missing, so a pair is never left half played;
 * - a mirrored pairing — both seats folding to one slug, a bot against itself —
 *   names its two matches by the seat the pairing's first seat plays, since its
 *   seat map is the same string in both seat orders.
 *
 * Nothing here plays a match: the plan is paths and seat orders, which is what
 * the series runner and its resume test are written against.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SeatArg } from "./args.ts";
import { DEFAULT_MAX_PAIRS, planSeries } from "./series-plan.ts";

/** Model X: the model the series is measuring, and the one the seat swap moves. */
const X: SeatArg = { kind: "model", provider: "marvin", model: "subagent" };

/** The opponent every pair is played against. */
const OPPONENT: SeatArg = { kind: "bot", bot: "greedy" };

/** A mirrored pairing: one bot against itself, both seats folding to `greedy`. */
const GREEDY: SeatArg = { kind: "bot", bot: "greedy" };

/** Where a series is run, in a directory that is gone when the suite is done. */
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-series-plan-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A series directory of its own, so no test sees another one's files. */
const seriesAt = async (name: string): Promise<string> => {
  const path = join(dir, name);
  await mkdir(path, { recursive: true });
  return path;
};

/** What `series.json` says, parsed as written rather than as the plan sees it. */
const readRecord = async (seriesDir: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(seriesDir, "series.json"), "utf8")) as Record<string, unknown>;

describe("the seed list", () => {
  it("is drawn once and read back from series.json rather than drawn again", async () => {
    const seriesDir = await seriesAt("seeds-once");

    const first = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 5, seedBase: 12345 });

    // The first run records the list, and what it was drawn for.
    const record = await readRecord(seriesDir);
    expect(record["seeds"]).toEqual(first.seeds);
    expect(record["seed_base"]).toBe(12345);
    expect(record["max_pairs"]).toBe(5);
    expect(first.seeds).toHaveLength(5);

    // Planning the same pairing again, with a different seed base, reuses the
    // recorded list: a series started again next week sits on the same maps.
    const again = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 5, seedBase: 987654 });
    expect(again.seeds).toEqual(first.seeds);
    expect(again.pairs.map((pair) => pair.seed)).toEqual(first.seeds);
    expect((await readRecord(seriesDir))["seed_base"]).toBe(12345);
  });

  it("grows by appending when --max-pairs is raised, instead of replacing the list", async () => {
    const seriesDir = await seriesAt("seeds-grown");

    const three = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 3, seedBase: 7 });
    const six = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 6, seedBase: 7 });

    expect(six.seeds).toHaveLength(6);
    expect(six.seeds.slice(0, 3)).toEqual(three.seeds);
    expect(new Set(six.seeds).size).toBe(6);
    expect((await readRecord(seriesDir))["max_pairs"]).toBe(6);
  });

  it("is a list of seeds the engine can deal a map from", async () => {
    const seriesDir = await seriesAt("seeds-in-range");

    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 40, seedBase: 4242 });

    for (const seed of plan.seeds) {
      expect(Number.isInteger(seed)).toBe(true);
      // The engine takes its seed as `n | 0`; outside that range a rerun would
      // silently deal a different map than the one the plan named.
      expect(seed).toBeGreaterThanOrEqual(-2_147_483_648);
      expect(seed).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it("defaults to brief §6.5's 75 pairs", async () => {
    const seriesDir = await seriesAt("seeds-default");

    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT });

    expect(DEFAULT_MAX_PAIRS).toBe(75);
    expect(plan.seeds).toHaveLength(75);
    expect((await readRecord(seriesDir))["max_pairs"]).toBe(75);
  });

  it("keeps a field it does not know when the recorded list grows", async () => {
    const seriesDir = await seriesAt("seeds-extra-fields");

    await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 2, seedBase: 3 });
    // The series runner records its own state in the same file; growing the
    // list must not throw it away.
    const record = await readRecord(seriesDir);
    await writeFile(
      join(seriesDir, "series.json"),
      `${JSON.stringify({ ...record, stopped_early: false }, null, 2)}\n`,
      "utf8",
    );

    await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 4, seedBase: 3 });

    expect((await readRecord(seriesDir))["stopped_early"]).toBe(false);
    expect((await readRecord(seriesDir))["seeds"]).toHaveLength(4);
  });

  it("refuses a series.json that does not record a seed list", async () => {
    const seriesDir = await seriesAt("seeds-corrupt");
    await writeFile(join(seriesDir, "series.json"), '{"seeds": "not a list"}\n', "utf8");

    await expect(planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 2 })).rejects.toThrow(
      /series\.json/,
    );
  });

  it("refuses a seed base the engine cannot mix", async () => {
    const seriesDir = await seriesAt("seed-base-out-of-range");

    await expect(
      planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 2, seedBase: 2_147_483_648 }),
    ).rejects.toThrow(/--seed-base/);
  });

  it("refuses a pair limit that is not a whole number of pairs", async () => {
    const seriesDir = await seriesAt("max-pairs-bad");

    await expect(
      planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 0 }),
    ).rejects.toThrow(/--max-pairs/);
  });
});

describe("a pair is two matches with the seats swapped", () => {
  it("plays each seed twice at the seat-swapped paths, each in its own sessions directory", async () => {
    const seriesDir = await seriesAt("swapped");

    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 2, seedBase: 11 });
    expect(plan.pairs).toHaveLength(2);

    for (const pair of plan.pairs) {
      const [first, second] = pair.matches;

      // Model X in seat A, then model X in seat B, on one seed.
      expect(first.seats).toEqual({ A: X, B: OPPONENT });
      expect(second.seats).toEqual({ A: OPPONENT, B: X });
      expect(second.seed).toBe(pair.seed);

      // Brief §6.5's layout, with the seat map naming the match.
      const map = `${String(pair.seed)}-marvin-subagent-greedy`;
      const swapped = `${String(pair.seed)}-greedy-marvin-subagent`;
      expect(first.out).toBe(join(seriesDir, "matches", `${map}.json`));
      expect(second.out).toBe(join(seriesDir, "matches", `${swapped}.json`));

      // A Pi seat's home goes under `sessions/`, not beside the log in `matches/`.
      expect(first.matchDir).toBe(join(seriesDir, "sessions", map));
      expect(second.matchDir).toBe(join(seriesDir, "sessions", swapped));
    }

    // Nothing is on disk yet, so the whole list is still to play.
    expect(plan.matches).toHaveLength(4);
  });

  it("names a mirrored pairing's two matches by the seat its first seat plays", async () => {
    const seriesDir = await seriesAt("mirror");

    // A mirrored pairing's seat map is one string in both seat orders, so the
    // seat map alone cannot name its two matches. They are named by the seat the
    // pairing's first seat plays — the same letter the record's `seat` field
    // carries, and the naming `scripts/mirror-series.mjs` already used for the
    // Greedy-vs-Greedy series `docs/series-notes.md` §7 keeps the evidence for.
    const plan = await planSeries({ dir: seriesDir, a: GREEDY, b: GREEDY, maxPairs: 1, seedBase: 7 });
    expect(plan.pairs).toHaveLength(1);
    const [first, second] = plan.pairs[0]!.matches;
    const seed = String(plan.pairs[0]!.seed);

    // Both seat orders are still planned: the swap is what the pair exists
    // for, even when the two seats are played by the same bot.
    expect(first.seat).toBe("A");
    expect(second.seat).toBe("B");
    expect(first.seats).toEqual({ A: GREEDY, B: GREEDY });
    expect(second.seats).toEqual({ A: GREEDY, B: GREEDY });

    expect(first.out).toBe(join(seriesDir, "matches", `${seed}-greedy-greedy-A.json`));
    expect(second.out).toBe(join(seriesDir, "matches", `${seed}-greedy-greedy-B.json`));
    expect(first.matchDir).toBe(join(seriesDir, "sessions", `${seed}-greedy-greedy-A`));
    expect(second.matchDir).toBe(join(seriesDir, "sessions", `${seed}-greedy-greedy-B`));

    // Two names, so two logs, and both are still to play.
    expect(first.out).not.toBe(second.out);
    expect(plan.matches).toHaveLength(2);
  });
});

describe("a pair is never left half played", () => {
  it("skips a pair whose two logs are already on disk", async () => {
    const seriesDir = await seriesAt("both-logs");

    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 2, seedBase: 5 });
    const [finished, untouched] = plan.pairs;
    await mkdir(join(seriesDir, "matches"), { recursive: true });
    for (const match of finished.matches) {
      await writeFile(match.out, "{}\n", "utf8");
    }

    const resumed = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 2, seedBase: 5 });

    // The same maps, and the pair that is on disk marked as played rather than
    // planned again beside its own log.
    expect(resumed.seeds).toEqual(plan.seeds);
    expect(resumed.pairs[0]?.matches.every((match) => match.played)).toBe(true);
    expect(resumed.pairs[1]?.matches.every((match) => !match.played)).toBe(true);
    expect(resumed.matches).toEqual(untouched.matches);
  });

  it("plans only the missing match of a mirrored pair that has one log", async () => {
    const seriesDir = await seriesAt("mirror-one-log");

    const plan = await planSeries({ dir: seriesDir, a: GREEDY, b: GREEDY, maxPairs: 1, seedBase: 7 });
    const [first, second] = plan.pairs[0]!.matches;
    await mkdir(join(seriesDir, "matches"), { recursive: true });
    await writeFile(first.out, "{}\n", "utf8");

    const resumed = await planSeries({ dir: seriesDir, a: GREEDY, b: GREEDY, maxPairs: 1, seedBase: 7 });

    // The seat-letter names are the resume rule's handle: the log on disk is
    // the seat-A match, and only the seat-B one is played again.
    expect(resumed.pairs[0]!.matches.map((match) => match.played)).toEqual([true, false]);
    expect(resumed.matches).toHaveLength(1);
    expect(resumed.matches[0]?.out).toBe(second.out);
    expect(resumed.matches[0]?.seat).toBe("B");
  });

  it("plans only the missing match of a pair that has one log", async () => {
    const seriesDir = await seriesAt("one-log");

    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 1, seedBase: 5 });
    const [first] = plan.pairs;
    await mkdir(join(seriesDir, "matches"), { recursive: true });
    await writeFile(first.matches[1].out, "{}\n", "utf8");

    const resumed = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 1, seedBase: 5 });

    expect(resumed.matches).toHaveLength(1);
    expect(resumed.matches[0]?.out).toBe(first.matches[0].out);
    expect(resumed.matches[0]?.seats).toEqual({ A: X, B: OPPONENT });
    expect(resumed.matches[0]?.matchDir).toBe(first.matches[0].matchDir);
  });
});
