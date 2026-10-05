/**
 * The series runner: brief §6.5's loop over the plan, and brief §8's resume test.
 *
 * Every match here is played by a scripted `playMatch`, which is what the seam
 * `runSeries` exposes is for: one real bot-versus-bot match takes about 1.3 s and
 * a model match nineteen minutes (`docs/pi-harness-notes.md` §7), so the 75-pair
 * series brief §6.5 runs by default can never be a test fixture. The script is
 * not a stub of the match though — it writes a real `salient-log/1` file at the
 * path the plan named, so the resume test exercises the same on-disk state a real
 * run leaves, and the runner's resume rule is the one on disk rather than one in
 * memory:
 *
 * - a run plays every match the plan says is missing, at the plan's paths, with
 *   model X in seat A in one match of a pair and seat B in the other;
 * - `series.json` names the pairing, the seed list, both matches of every pair
 *   with their result, cost and tokens, and the run's stop state;
 * - restarting plays nothing whose log already exists and ends on the same set of
 *   logs, a pair left half played plays only the match that is missing, and a log
 *   that cannot be read stops the run rather than being replayed over;
 * - a match that throws leaves no log, is recorded as failed with its reason, is
 *   never counted as played, and is played again by the next run.
 *
 * The record is written after every batch of 5 pairs, which the last test watches
 * from inside the script: the match that opens the second batch is asked for while
 * the first batch is already on disk in `series.json`.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { MatchVoided } from "@no-dice/harness";
import { cellsFor, matchLogSchema } from "@no-dice/log";
import type { MatchLog, Seat, Usage } from "@no-dice/log";
import { boardCells, DEFAULT_CONFIG, generateMap, hexKey, score } from "@no-dice/salient-engine";
import { keyToLabel, matchConstants } from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SeatArg } from "./args.ts";
import { seatSpec } from "./match.ts";
import type { RunMatchOptions, SeatSpec } from "./match.ts";
import { runSeries } from "./series.ts";
import type { PlayMatch, SeriesMatchRecord, SeriesRecord } from "./series.ts";
import { planSeries } from "./series-plan.ts";

/** Model X: the model the series measures, and the one the seat swap moves. */
const X: SeatArg = { kind: "model", provider: "marvin", model: "subagent" };

/** The opponent every pair is played against. */
const OPPONENT: SeatArg = { kind: "bot", bot: "greedy" };

/** What every scripted match reports: X wins seat A's match by 12 on time. */
const WIN = {
  type: "time" as const,
  winner: "A" as Seat | null,
  margin: 12,
  costUsd: 0.75,
  tokens: { input: 300, output: 30, cache_read: 1200, cache_write: 3 },
};

/** Where a series is run, in a directory that is gone when the suite is done. */
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-series-run-"));
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

/** `series.json` as written, typed as the record the runner defines. */
const readRecord = async (seriesDir: string): Promise<SeriesRecord> =>
  JSON.parse(await readFile(join(seriesDir, "series.json"), "utf8")) as SeriesRecord;

/** The paths of the logs a series has on disk, in name order. */
const logsOf = async (seriesDir: string): Promise<string[]> =>
  (await readdir(join(seriesDir, "matches"))).sort().map((name) => join(seriesDir, "matches", name));

/** What a scripted run records about each match it was asked to play. */
interface PlayCall {
  seed: number;
  /** Which seat model X played, read back from the seats the run was handed. */
  seat: Seat;
  out: string;
  matchDir: string;
  seats: Record<Seat, SeatSpec>;
}

/**
 * What one scripted match reports. `tokens` and `costUsd` are the whole match's,
 * which the log this writes splits over its two turns and its two seats, so a
 * test that names them once still proves the runner summed every seat of every
 * turn of the match.
 */
interface Scripted {
  type: "time" | "knockout";
  winner: Seat | null;
  margin: number;
  costUsd: number;
  tokens: Usage;
}

/** The log a scripted match leaves: the map its seed deals, and a played result. */
const logOf = (seed: number, seats: Record<Seat, SeatSpec>, outcome: Scripted): MatchLog => {
  const config = DEFAULT_CONFIG;
  const state = generateMap(seed, config);
  const hexes = boardCells(config.radius).map((at) => state.hexes[hexKey(at.q, at.r)]);
  const supply = { A: score(state, "A", config), B: score(state, "B", config) };
  const cells = cellsFor(hexes, supply.A.supplied, supply.B.supplied);
  const troops = (seat: Seat): number =>
    hexes.reduce((total, hex) => (hex.owner === seat ? total + hex.troops : total), 0);

  // The match's cost and tokens spread over its two turns and its two seats, so
  // the figures the record carries are proved to be a sum over every seat of
  // every turn rather than one turn's numbers read back.
  const spread = (total: number, at: number, whole: boolean): number => {
    const each = whole ? Math.floor(total / 4) : total / 4;
    return at === 3 ? total - each * 3 : each;
  };
  const usage = (turn: 0 | 1, seat: 0 | 1): Usage => {
    const at = turn * 2 + seat;
    return {
      input: spread(outcome.tokens.input, at, true),
      output: spread(outcome.tokens.output, at, true),
      cache_read: spread(outcome.tokens.cache_read, at, true),
      cache_write: spread(outcome.tokens.cache_write, at, true),
    };
  };
  const cost = (turn: 0 | 1, seat: 0 | 1): number =>
    spread(outcome.costUsd, turn * 2 + seat, false);

  // The score the result says: the winner ahead by the margin, a knockout being
  // the whole board's 93 points to nothing.
  const final = ((): { A: number; B: number } => {
    if (outcome.winner === "A") return { A: 93, B: 93 - outcome.margin };
    if (outcome.winner === "B") return { A: 93 - outcome.margin, B: 93 };
    return { A: 93, B: 93 };
  })();

  const playerFor = (seat: Seat) => {
    const spec = seats[seat];
    return spec.kind === "bot"
      ? { kind: "bot" as const, bot: spec.bot }
      : { kind: "pi" as const, model: spec.model, thinking: spec.thinking, context_window: 131_072 };
  };
  const turnPlayer = (turn: 0 | 1, seat: 0 | 1) => ({
    tool_calls: [],
    scouts: [],
    rejected_submission: null,
    orders: [],
    wasted: [],
    intent: "Marching on the node.",
    prediction: "The other seat takes the node.",
    passed: null,
    notes_after: "",
    usage: usage(turn, seat),
    cost_usd: cost(turn, seat),
    context_tokens: 1000 * (turn + 1),
    compacted: false,
    wall_ms: 100,
  });

  return matchLogSchema.parse({
    format: "salient-log/1",
    ruleset: "v0",
    engine_version: "0.1.0",
    created: "2026-10-05T00:00:00.000Z",
    seed,
    config: matchConstants(config),
    harness: {
      pi_version: null,
      context: "continuous",
      compaction: true,
      tool_call_cap: 12,
      simulate_cap: 3,
      resubmissions: 1,
      turn_timeout_s: 300,
      output_token_budget: null,
    },
    players: { A: playerFor("A"), B: playerFor("B") },
    map: hexes.map((hex) => ({ id: hex.id, q: hex.q, r: hex.r, terrain: hex.terrain })),
    bases: { A: keyToLabel(state.base.A, config.radius), B: keyToLabel(state.base.B, config.radius) },
    start: { cells, score: { A: supply.A.points, B: supply.B.points } },
    turns: [
      {
        n: 1,
        players: { A: turnPlayer(0, 0), B: turnPlayer(0, 1) },
        events: [],
        after: { cells, score: { A: 20, B: 8 }, troops: { A: troops("A"), B: troops("B") } },
      },
      {
        n: 2,
        players: { A: turnPlayer(1, 0), B: turnPlayer(1, 1) },
        events: [],
        after: { cells, score: final, troops: { A: troops("A"), B: troops("B") } },
      },
    ],
    result: { type: outcome.type, winner: outcome.winner, turn: 2, score: final, margin: outcome.margin },
  });
};

/**
 * The scripted `playMatch` brief §8's series tests are written with. It is given
 * the plan's path, `matchDir` and seat order, records the call, writes a real log
 * at that path and hands back the result — and a `decide` that throws leaves no
 * log behind, which is what a voided match does.
 */
const scripted = (
  calls: PlayCall[],
  decide: (call: PlayCall) => Scripted | Promise<Scripted>,
): PlayMatch => {
  return async (options: RunMatchOptions) => {
    const call: PlayCall = {
      seed: options.seed,
      seat: options.seats.A.kind === "pi" ? "A" : "B",
      out: options.out,
      matchDir: options.matchDir ?? "",
      seats: options.seats,
    };
    calls.push(call);
    const outcome = await decide(call);
    const log = logOf(options.seed, options.seats, outcome);
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(log, null, 2)}\n`, "utf8");
    return { path: options.out, log };
  };
};

/** A script that throws for the match at position `at` (1-based) and plays the rest. */
const throwingOn = (calls: PlayCall[], at: number, error: Error): PlayMatch =>
  scripted(calls, () => {
    if (calls.length === at) throw error;
    return WIN;
  });

/**
 * A recorded match the test expects to have been played. The record's union puts
 * a result and its figures beside a played match and a reason beside a failed
 * one, so asking for the figures says which of the two the test means.
 */
const playedMatch = (match: SeriesMatchRecord): Extract<SeriesMatchRecord, { status: "played" }> => {
  if (match.status !== "played") throw new Error(`expected a played match, got ${match.status}`);
  return match;
};

/** The same for a match the test expects to have failed. */
const failedMatch = (match: SeriesMatchRecord): Extract<SeriesMatchRecord, { status: "failed" }> => {
  if (match.status !== "failed") throw new Error(`expected a failed match, got ${match.status}`);
  return match;
};

describe("a run plays what the plan says is missing", () => {
  it("plays six matches for three pairs, at the plan's paths and seat maps", async () => {
    const seriesDir = await seriesAt("three-pairs");
    const plan = await planSeries({ dir: seriesDir, a: X, b: OPPONENT, maxPairs: 3, seedBase: 1234 });
    const calls: PlayCall[] = [];

    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 3,
      seedBase: 1234,
      playMatch: scripted(calls, () => WIN),
    });

    expect(calls).toHaveLength(6);
    expect(await logsOf(seriesDir)).toHaveLength(6);
    expect(run.played).toBe(6);
    expect(run.failed).toBe(0);
    expect(run.skipped).toBe(0);

    // Every planned match, in the plan's order, at the plan's path and with the
    // plan's `matchDir` for a Pi seat's home.
    expect(calls.map((call) => call.out)).toEqual(plan.matches.map((match) => match.out));
    for (const [i, call] of calls.entries()) {
      const match = plan.matches[i];
      expect(call.matchDir).toBe(match.matchDir);
      expect(call.seed).toBe(match.seed);
      // The seats are handed over as seats the runner plays, in the plan's order.
      expect(call.seats).toEqual({ A: seatSpec(match.seats.A), B: seatSpec(match.seats.B) });
      expect(call.matchDir).toBe(join(seriesDir, "sessions", basename(match.out, ".json")));
    }

    // Each seed is played twice with the seats swapped: model X in seat A, then
    // in seat B, so the board cannot decide the pairing's result.
    for (const seed of plan.seeds) {
      const pair = calls.filter((call) => call.seed === seed);
      expect(pair).toHaveLength(2);
      expect(pair.map((call) => call.seat)).toEqual(["A", "B"]);
      expect(pair[0].seats).toEqual({ A: seatSpec(X), B: seatSpec(OPPONENT) });
      expect(pair[1].seats).toEqual({ A: seatSpec(OPPONENT), B: seatSpec(X) });
    }

    // Every log on disk is a match log, not a placeholder: the resume test below
    // reads these back, and so would a real series.
    for (const call of calls) {
      const onDisk = matchLogSchema.parse(JSON.parse(await readFile(call.out, "utf8")) as unknown);
      expect(onDisk.seed).toBe(call.seed);
      expect(onDisk.players.A.kind).toBe(call.seats.A.kind);
    }
  });

  it("names every pair, both its matches and the run's stop state in series.json", async () => {
    const seriesDir = await seriesAt("record");
    const calls: PlayCall[] = [];

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 3,
      seedBase: 4242,
      playMatch: scripted(
        calls,
        (call) => (call.seat === "B" ? { ...WIN, type: "knockout", winner: "B", margin: 93 } : WIN),
      ),
    });

    const record = await readRecord(seriesDir);
    expect(record.pairing).toEqual({ a: X, b: OPPONENT });
    expect(record.seed_base).toBe(4242);
    expect(record.max_pairs).toBe(3);
    expect(record.seeds).toHaveLength(3);

    expect(record.pairs).toHaveLength(3);
    for (const [i, pair] of record.pairs.entries()) {
      expect(pair.seed).toBe(record.seeds[i]);
      expect(pair.matches.map((match) => match.seat)).toEqual(["A", "B"]);

      const [first, second] = pair.matches;
      expect(first.path).toBe(join(seriesDir, "matches", `${String(pair.seed)}-marvin-subagent-greedy.json`));
      expect(second.path).toBe(join(seriesDir, "matches", `${String(pair.seed)}-greedy-marvin-subagent.json`));
      expect(playedMatch(first).result).toEqual({ type: "time", winner: "A", margin: 12 });
      expect(playedMatch(second).result).toEqual({ type: "knockout", winner: "B", margin: 93 });

      // The whole match's cost and tokens, summed over both seats and both turns
      // of the log the script wrote.
      expect(playedMatch(first).cost_usd).toBe(WIN.costUsd);
      expect(playedMatch(first).tokens).toEqual({ ...WIN.tokens, total: 1533 });
      expect(playedMatch(second).tokens).toEqual({ ...WIN.tokens, total: 1533 });
    }

    expect(record.state).toEqual({
      pairs_played: 3,
      matches_played: 6,
      matches_failed: 0,
      stop_reason: "max_pairs",
      stopped_early: false,
    });
  });

  it("writes the record after every batch of 5 pairs", async () => {
    const seriesDir = await seriesAt("batches");
    const calls: PlayCall[] = [];
    /** What `series.json` held when the match that opens the second batch was asked for. */
    const seen: number[] = [];

    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 7,
      seedBase: 909,
      playMatch: scripted(calls, async () => {
        // The first match of the series, and the one that opens the second batch:
        // 5 pairs of matches have been played by then, so brief §6.5's first batch
        // is already recorded and the second is not.
        if (calls.length === 1 || calls.length === 11)
          seen.push((await readRecord(seriesDir)).pairs.length);
        return WIN;
      }),
    });

    // Brief §6.5's batch is 5 pairs: the first batch is already recorded, and the
    // second is not, before its first match is played. The record is a whole record
    // from before the first match, with no pairs in it yet.
    expect(seen).toEqual([0, 5]);
    expect((await readRecord(seriesDir)).pairs).toHaveLength(7);
  });
});

describe("a restart replays nothing that already has a log", () => {
  it("plays nothing, leaves the same logs, and still records every match", async () => {
    const seriesDir = await seriesAt("resume");
    const first: PlayCall[] = [];
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 3,
      seedBase: 1234,
      playMatch: scripted(first, () => WIN),
    });
    const logs = await logsOf(seriesDir);

    // The same series asked for again — with another seed base, which the recorded
    // seed list outranks.
    const again: PlayCall[] = [];
    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 3,
      seedBase: 987_654,
      playMatch: scripted(again, () => WIN),
    });

    expect(again).toEqual([]);
    expect(await logsOf(seriesDir)).toEqual(logs);
    expect(run.played).toBe(0);
    expect(run.skipped).toBe(6);

    // The record still names every match, with the result read back out of the log
    // on disk rather than remembered from a run that has long finished.
    const record = await readRecord(seriesDir);
    expect(record.pairs).toHaveLength(3);
    for (const pair of record.pairs) {
      for (const match of pair.matches) {
        expect(playedMatch(match).result).toEqual({ type: "time", winner: "A", margin: 12 });
        expect(playedMatch(match).tokens.total).toBe(1533);
        expect(existsSync(match.path)).toBe(true);
      }
    }
    expect(record.state).toEqual({
      pairs_played: 3,
      matches_played: 6,
      matches_failed: 0,
      stop_reason: "max_pairs",
      stopped_early: false,
    });
  });

  it("plays only the missing match of a pair left half played", async () => {
    const seriesDir = await seriesAt("half-pair");
    const first: PlayCall[] = [];
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 2,
      seedBase: 55,
      playMatch: scripted(first, () => WIN),
    });
    const logs = await logsOf(seriesDir);

    // A series killed between the two matches of its second pair.
    const missing = first[3].out;
    await rm(missing);

    const again: PlayCall[] = [];
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 2,
      seedBase: 55,
      playMatch: scripted(again, () => WIN),
    });

    expect(again).toHaveLength(1);
    expect(again[0].out).toBe(missing);
    expect(await logsOf(seriesDir)).toEqual(logs);
  });

  it("refuses a log it cannot read rather than replaying over it", async () => {
    const seriesDir = await seriesAt("corrupt-log");
    const first: PlayCall[] = [];
    await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 1,
      seedBase: 31,
      playMatch: scripted(first, () => WIN),
    });

    // A log a match left, then something else wrote over it.
    const logs = await logsOf(seriesDir);
    await writeFile(logs[1], "not a log\n", "utf8");

    const again: PlayCall[] = [];
    await expect(
      runSeries({
        dir: seriesDir,
        a: X,
        b: OPPONENT,
        maxPairs: 1,
        seedBase: 31,
        playMatch: scripted(again, () => WIN),
      }),
    ).rejects.toThrow(/not a salient-log\/1 log/);

    // A log is the proof a match was played, and replaying over one would replace
    // a match the series had already counted, so nothing was played and the run
    // stopped where it could not say what had happened.
    expect(again).toEqual([]);
    expect(await logsOf(seriesDir)).toHaveLength(2);
  });
});

describe("a match that throws", () => {
  it("leaves no log, is recorded as failed with its reason, and is played again", async () => {
    const seriesDir = await seriesAt("voided");
    const first: PlayCall[] = [];
    const voided = new MatchVoided("tool_surface", "seat A reached outside the seven tools");

    const run = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 2,
      seedBase: 77,
      playMatch: throwingOn(first, 2, voided),
    });

    // The match that threw left nothing for a resume to mistake for a match, and
    // the rest of the series was played and recorded around it.
    const voidedCall = first[1];
    expect(existsSync(voidedCall.out)).toBe(false);
    expect(await logsOf(seriesDir)).toHaveLength(3);
    expect(run.played).toBe(3);
    expect(run.failed).toBe(1);

    const record = await readRecord(seriesDir);
    const failed = failedMatch(record.pairs[0].matches[1]);
    expect(failed.path).toBe(voidedCall.out);
    // The reason a report prints: what the seat did, and the rule it broke.
    expect(failed.error).toBe(
      "MatchVoided: seat A reached outside the seven tools (tool_surface)",
    );

    // A voided match is never counted as one that was played: the pair it belongs
    // to is not a played pair either.
    expect(record.state).toEqual({
      pairs_played: 1,
      matches_played: 3,
      matches_failed: 1,
      stop_reason: "max_pairs",
      stopped_early: false,
    });

    // The next run plays the match that is missing, and only that one.
    const again: PlayCall[] = [];
    const resumed = await runSeries({
      dir: seriesDir,
      a: X,
      b: OPPONENT,
      maxPairs: 2,
      seedBase: 77,
      playMatch: scripted(again, () => WIN),
    });

    expect(again).toHaveLength(1);
    expect(again[0].out).toBe(voidedCall.out);
    expect(resumed.failed).toBe(0);
    expect(await logsOf(seriesDir)).toHaveLength(4);
    expect((await readRecord(seriesDir)).state).toEqual({
      pairs_played: 2,
      matches_played: 4,
      matches_failed: 0,
      stop_reason: "max_pairs",
      stopped_early: false,
    });
  });
});
