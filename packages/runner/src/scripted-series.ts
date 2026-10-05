/**
 * Test support: scripted matches for the series tests, and the real log each one
 * leaves behind.
 *
 * Brief §8's series tests are written "with scripted results", and they have to
 * be: one bot-versus-bot match already takes about 1.3 s and a model match
 * nineteen minutes (`docs/pi-harness-notes.md` §7), so the 75-pair series
 * `runSeries` plays by default can never be a fixture. The script is not a stub
 * of a match though — it writes a real `salient-log/1` file at the path the plan
 * named, so the runner's rules (resume, the record's cost and token totals, the
 * stopping rules) are exercised against the same on-disk state a real run leaves.
 *
 * It is not a test, and vitest never collects it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { cellsFor, matchLogSchema } from "@no-dice/log";
import type { MatchLog, Seat, Usage } from "@no-dice/log";
import { boardCells, DEFAULT_CONFIG, generateMap, hexKey, score } from "@no-dice/salient-engine";
import { keyToLabel, matchConstants } from "@no-dice/salient-server";

import type { PlayMatch } from "./series.ts";
import type { RunMatchOptions, SeatSpec } from "./match.ts";

/** What a scripted run records about each match it was asked to play. */
export interface PlayCall {
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
export interface Scripted {
  type: "time" | "knockout";
  winner: Seat | null;
  margin: number;
  costUsd: number;
  tokens: Usage;
}

/** The log a scripted match leaves: the map its seed deals, and a played result. */
export const logOf = (seed: number, seats: Record<Seat, SeatSpec>, outcome: Scripted): MatchLog => {
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
export const scripted = (
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
