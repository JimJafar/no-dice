/**
 * One `salient-log/1` becomes brief §6.7's per-seat counts.
 *
 * Two logs, because each proves what the other cannot:
 *
 * - **A real bot-versus-bot match**, played here by `runMatch` (1.3 s, so it is a
 *   legitimate fixture and not a committed megabyte of tool results). It proves
 *   the counts equal what a log written by the runner actually holds — every
 *   figure re-counted from the parsed turns by plain loops in this file — and
 *   that a bot seat's `context_tokens` of 0 is a stated figure, not a missing
 *   one: a bot runs no provider, so its context really is nought.
 * - **A synthetic log** for what a bot match never produces: all six pass
 *   reasons, wasted orders and their reasons, a refused submission, tool errors,
 *   scouts, `simulate` calls, and two compaction turns — one of them logged with
 *   `context_tokens: 0` because Pi will not state a size it has just rewritten
 *   (`docs/pi-harness-notes.md` §3), which must not read as a context that
 *   shrank to nothing. It also runs to 30 turns, so the deepest band's open top
 *   can be shown to hold the turns past 25 rather than drop them.
 *
 * The depth split is checked both ways: that each band holds the turns the brief
 * names, and that the three bands together hold every played turn exactly once.
 *
 * The real-log fixture imports the runner, which `@no-dice/stats` deliberately
 * does not declare as a dependency: `pnpm-workspace.yaml` keeps it a rule that no
 * workspace package depends back on `@no-dice/runner`, and the series runner is
 * about to depend on stats for its stopping test, so a `stats` → `runner` edge
 * would be a cycle. The workspace root already declares `@no-dice/runner` as a
 * devDependency — it is how `scripts/measure-match.mjs` reaches the runner too —
 * and that is what resolves this import.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog, PassReason, Seat, WasteReason } from "@no-dice/log";
import { runMatch } from "@no-dice/runner/match";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEPTH_BANDS, bandOf, matchMetrics } from "./match-metrics.ts";
import type { BandMetrics, BandName, TurnMetrics } from "./match-metrics.ts";

/** The pass reasons the format allows, so the test can ask for each by name. */
const PASS_REASONS: PassReason[] = [
  "no_submission",
  "timeout",
  "token_budget",
  "provider_error",
  "harness_crash",
  "tool_surface",
];

/** The waste reasons the format allows, same reason. */
const WASTE_REASONS: WasteReason[] = [
  "no action points left",
  "unknown hex",
  "source hex not owned",
  "destination is blocked",
  "hexes are not adjacent",
  "troop count must be a positive integer",
  "not enough troops in source hex",
];

/**
 * What one seat's turn records hold, counted with plain loops over the parsed
 * log. This is the side of the test that says what the log holds, so it shares
 * no code with the module under test.
 */
const counted = (log: MatchLog, seat: Seat): Counted => {
  const passes = new Map<PassReason, number>();
  const wastedByReason = new Map<WasteReason, number>();
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const context: { turn: number; tokens: number | null; compacted: boolean }[] = [];
  let wastedOrders = 0;
  let rejectedSubmissions = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let scouts = 0;
  let simulations = 0;
  let costUsd = 0;
  let wallMs = 0;

  for (const turn of log.turns) {
    const record = turn.players[seat];
    if (record.passed !== null) {
      passes.set(record.passed, (passes.get(record.passed) ?? 0) + 1);
    }
    for (const dropped of record.wasted) {
      wastedOrders += 1;
      wastedByReason.set(dropped.reason, (wastedByReason.get(dropped.reason) ?? 0) + 1);
    }
    if (record.rejected_submission !== null) rejectedSubmissions += 1;
    for (const call of record.tool_calls) {
      toolCalls += 1;
      if (call.error) toolErrors += 1;
      if (call.tool === "simulate") simulations += 1;
    }
    scouts += record.scouts.length;
    tokens.input += record.usage.input;
    tokens.output += record.usage.output;
    tokens.cache_read += record.usage.cache_read;
    tokens.cache_write += record.usage.cache_write;
    costUsd += record.cost_usd;
    wallMs += record.wall_ms;
    context.push({
      turn: turn.n,
      tokens: record.compacted && record.context_tokens === 0 ? null : record.context_tokens,
      compacted: record.compacted,
    });
  }

  const stated = context.flatMap((sample) => (sample.tokens === null ? [] : [sample.tokens]));
  return {
    turns: log.turns.map((turn) => turn.n),
    passes,
    wastedOrders,
    wastedByReason,
    rejectedSubmissions,
    toolCalls,
    toolErrors,
    scouts,
    simulations,
    tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cache_read + tokens.cache_write },
    costUsd,
    wallMs,
    context: {
      byTurn: context,
      compactionTurns: context.flatMap((sample) => (sample.compacted ? [sample.turn] : [])),
      unstatedTurns: context.flatMap((sample) => (sample.tokens === null ? [sample.turn] : [])),
      mean: stated.length === 0 ? null : stated.reduce((total, n) => total + n, 0) / stated.length,
      min: stated.length === 0 ? null : Math.min(...stated),
      max: stated.length === 0 ? null : Math.max(...stated),
      first: stated.length === 0 ? null : stated[0],
      last: stated.length === 0 ? null : stated.at(-1)!,
    },
  };
};

interface Counted {
  turns: number[];
  passes: Map<PassReason, number>;
  wastedOrders: number;
  wastedByReason: Map<WasteReason, number>;
  rejectedSubmissions: number;
  toolCalls: number;
  toolErrors: number;
  scouts: number;
  simulations: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number; total: number };
  costUsd: number;
  wallMs: number;
  context: {
    byTurn: { turn: number; tokens: number | null; compacted: boolean }[];
    compactionTurns: number[];
    unstatedTurns: number[];
    mean: number | null;
    min: number | null;
    max: number | null;
    first: number | null;
    last: number | null;
  };
}

/** Every figure the module reports for one seat, against the same log counted by hand. */
const expectCounts = (metrics: TurnMetrics, log: MatchLog, seat: Seat): void => {
  const expected = counted(log, seat);
  expect(metrics.turns).toEqual(expected.turns);
  for (const reason of PASS_REASONS) {
    expect(metrics.passes[reason], `pass ${reason}`).toBe(expected.passes.get(reason) ?? 0);
  }
  expect(metrics.passedTurns).toBe(
    PASS_REASONS.reduce((total, reason) => total + (expected.passes.get(reason) ?? 0), 0),
  );
  expect(metrics.wastedOrders).toBe(expected.wastedOrders);
  for (const reason of WASTE_REASONS) {
    expect(metrics.wastedByReason[reason], `wasted ${reason}`).toBe(
      expected.wastedByReason.get(reason) ?? 0,
    );
  }
  expect(metrics.rejectedSubmissions).toBe(expected.rejectedSubmissions);
  expect(metrics.toolCalls).toBe(expected.toolCalls);
  expect(metrics.toolErrors).toBe(expected.toolErrors);
  expect(metrics.scouts).toBe(expected.scouts);
  expect(metrics.simulations).toBe(expected.simulations);
  expect(metrics.tokens).toEqual(expected.tokens);
  expect(metrics.costUsd).toBeCloseTo(expected.costUsd, 10);
  expect(metrics.wallMs).toBe(expected.wallMs);
  expect(metrics.context).toEqual(expected.context);
};

/** The turns of `log` the band named by `name` holds, counted from the parsed log. */
const turnsInBand = (log: MatchLog, name: string): number[] =>
  log.turns.flatMap((turn) => (bandOf(turn.n).name === name ? [turn.n] : []));

/**
 * The bands hold every played turn, and hold it exactly once: the three turn
 * lists are disjoint and their union is the match's turns in order.
 */
const expectBandsPartition = (bands: Record<BandName, BandMetrics>, turns: number[]): void => {
  const seen = DEPTH_BANDS.flatMap((band) => bands[band.name].metrics.turns);
  expect(seen).toHaveLength(turns.length);
  expect(new Set(seen).size).toBe(turns.length);
  expect([...seen].sort((a, b) => a - b)).toEqual([...turns].sort((a, b) => a - b));
};

describe("a real bot-versus-bot log", () => {
  let dir: string;
  let log: MatchLog;
  let metrics: ReturnType<typeof matchMetrics>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "no-dice-stats-"));
    // A match the runner really played: Greedy against Random on the map the
    // other suites use, written to disk and read back.
    const { path } = await runMatch({
      out: join(dir, "135.json"),
      seed: 135,
      seats: { A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "random" } },
    });
    const json: unknown = JSON.parse(await readFile(path, "utf8"));
    log = matchLogSchema.parse(json);
    metrics = matchMetrics(json);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("counts what the log holds, for both seats", () => {
    expect(log.turns).toHaveLength(25);
    expect(metrics.turns).toEqual(log.turns.map((turn) => turn.n));
    expectCounts(metrics.seats.A.metrics, log, "A");
    expectCounts(metrics.seats.B.metrics, log, "B");
  });

  it("names each seat by the header the log carries", () => {
    expect(metrics.seats.A.player).toEqual({ kind: "bot", bot: "greedy" });
    expect(metrics.seats.B.player).toEqual({ kind: "bot", bot: "random" });
  });

  it("counts the tool calls the seats made, and their mean per turn", () => {
    // Both seats drove the same three tools every turn, and a bot calls no
    // `simulate` and scouts no hex, which the log says as plainly as this.
    for (const seat of ["A", "B"] as const) {
      const made = log.turns.reduce((total, turn) => total + turn.players[seat].tool_calls.length, 0);
      expect(made).toBeGreaterThan(0);
      expect(metrics.seats[seat].metrics.toolCalls).toBe(made);
      expect(metrics.seats[seat].metrics.toolErrors).toBe(0);
      expect(metrics.seats[seat].metrics.scouts).toBe(0);
      expect(metrics.seats[seat].metrics.simulations).toBe(0);
      expect(metrics.seats[seat].metrics.perTurn.toolCalls).toBeCloseTo(made / 25, 10);
      expect(metrics.seats[seat].metrics.perTurn.tokens).toBe(0);
      expect(metrics.seats[seat].metrics.tokens.total).toBe(0);
      expect(metrics.seats[seat].metrics.costUsd).toBe(0);
    }
    // Wall time is measured, so it is only compared with the log's own sum.
    const wall = log.turns.reduce((total, turn) => total + turn.players.A.wall_ms, 0);
    expect(metrics.seats.A.metrics.wallMs).toBe(wall);
    expect(metrics.seats.A.metrics.perTurn.wallMs).toBeCloseTo(wall / 25, 10);
  });

  it("splits the match into turns 1-8, 9-17 and 18-25, and every turn into exactly one", () => {
    for (const seat of ["A", "B"] as const) {
      const bands = metrics.seats[seat].bands;
      expect(Object.keys(bands).sort()).toEqual(["1-8", "18-25", "9-17"]);
      expect(bands["1-8"].metrics.turns).toEqual(turnsInBand(log, "1-8"));
      expect(bands["9-17"].metrics.turns).toEqual(turnsInBand(log, "9-17"));
      expect(bands["18-25"].metrics.turns).toEqual(turnsInBand(log, "18-25"));
      expect(bands["1-8"].metrics.turns).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(bands["9-17"].metrics.turns).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
      expect(bands["18-25"].metrics.turns).toEqual([18, 19, 20, 21, 22, 23, 24, 25]);
      expectBandsPartition(bands, metrics.turns);

      // Each band's counts are the same counts over the turns it holds.
      for (const band of DEPTH_BANDS) {
        const inBand = log.turns.filter((turn) => bandOf(turn.n).name === band.name);
        const held = bands[band.name].metrics;
        expect(held.toolCalls).toBe(
          inBand.reduce((total, turn) => total + turn.players[seat].tool_calls.length, 0),
        );
        expect(held.wallMs).toBe(inBand.reduce((total, turn) => total + turn.players[seat].wall_ms, 0));
        expect(held.perTurn.toolCalls).toBeCloseTo(held.toolCalls / inBand.length, 10);
      }
      // The whole match is the three bands added together.
      const sums = bands["1-8"].metrics.toolCalls + bands["9-17"].metrics.toolCalls + bands["18-25"].metrics.toolCalls;
      expect(sums).toBe(metrics.seats[seat].metrics.toolCalls);
    }
  });

  it("treats a bot's context of nought as a stated figure, not a missing one", () => {
    // A bot runs no provider, so `context_tokens` is 0 on every turn and no turn
    // compacted. Only a nought beside `compacted: true` is Pi declining to say.
    const context = metrics.seats.A.metrics.context;
    expect(context.compactionTurns).toEqual([]);
    expect(context.unstatedTurns).toEqual([]);
    expect(context.byTurn.every((sample) => sample.tokens === 0 && !sample.compacted)).toBe(true);
    expect(context.mean).toBe(0);
    expect(context.min).toBe(0);
    expect(context.max).toBe(0);
  });
});

describe("the depth bands", () => {
  it("are the brief's, and hold every positive turn number", () => {
    expect(DEPTH_BANDS.map((band) => band.name)).toEqual(["1-8", "9-17", "18-25"]);
    expect(bandOf(1).name).toBe("1-8");
    expect(bandOf(8).name).toBe("1-8");
    expect(bandOf(9).name).toBe("9-17");
    expect(bandOf(17).name).toBe("9-17");
    expect(bandOf(18).name).toBe("18-25");
    expect(bandOf(25).name).toBe("18-25");
    // A match played past the brief's 25 turns keeps its turns in the deepest
    // band rather than losing them from the split.
    expect(bandOf(26).name).toBe("18-25");
    expect(bandOf(200).name).toBe("18-25");
    expect(() => bandOf(0)).toThrow(/no depth band/);
  });
});

/**
 * The synthetic log: 30 turns, seat A a Pi seat with every kind of trouble a bot
 * match never gets into, seat B a clean seat whose context is a stated nought.
 */
interface SyntheticTurn {
  n: number;
  passed?: PassReason;
  scouts?: string[];
  wasted?: { from: string; to: string; troops: number; reason: WasteReason }[];
  rejected?: { from: string; to: string; troops: number; reason: WasteReason }[];
  toolCalls?: { tool: string; error: boolean }[];
  usage?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  costUsd?: number;
  contextTokens?: number;
  compacted?: boolean;
  wallMs?: number;
}

/** One dropped order, in the log's shape. */
const dropped = (from: string, to: string, reason: WasteReason, troops = 3): unknown => ({
  order: { from, to, troops },
  reason,
});

/** One seat's turn record, with noughts for everything the fixture does not name. */
const playerOf = (turn: SyntheticTurn): unknown => ({
  tool_calls: (turn.toolCalls ?? []).map((call) => ({
    tool: call.tool,
    args: null,
    result: null,
    error: call.error,
    ms: 5,
  })),
  scouts: turn.scouts ?? [],
  rejected_submission:
    turn.rejected === undefined
      ? null
      : {
          orders: turn.rejected.map((each) => ({ from: each.from, to: each.to, troops: each.troops })),
          wasted: turn.rejected.map((each) => dropped(each.from, each.to, each.reason, each.troops)),
        },
  orders: (turn.wasted ?? []).map((each) => ({ from: each.from, to: each.to, troops: each.troops })),
  wasted: (turn.wasted ?? []).map((each) => dropped(each.from, each.to, each.reason, each.troops)),
  intent: "",
  prediction: "",
  passed: turn.passed ?? null,
  notes_after: "",
  usage: {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    ...(turn.usage ?? {}),
  },
  cost_usd: turn.costUsd ?? 0,
  // A seat's conversation grows by a thousand tokens a turn, so a nought that
  // does not belong there cannot hide among real figures.
  context_tokens: turn.contextTokens ?? turn.n * 1000,
  compacted: turn.compacted ?? false,
  wall_ms: turn.wallMs ?? 0,
});

/** Seat A's turns that do something, every other turn of its 30 being uneventful. */
const SEAT_A: SyntheticTurn[] = [
  {
    n: 1,
    passed: "no_submission",
    toolCalls: [{ tool: "get_rules", error: false }],
    usage: { input: 100 },
    costUsd: 0.25,
    wallMs: 100,
  },
  {
    n: 2,
    scouts: ["A1", "B2"],
    wasted: [
      { from: "A1", to: "B2", troops: 3, reason: "unknown hex" },
      { from: "B2", to: "A1", troops: 3, reason: "hexes are not adjacent" },
    ],
    toolCalls: [
      { tool: "scout", error: false },
      { tool: "simulate", error: false },
    ],
    usage: { input: 200, output: 50 },
    wallMs: 200,
  },
  {
    // A refused first submission: its orders are in `rejected_submission`, not in
    // the turn's `wasted`, and the seat still played the turn out.
    n: 3,
    rejected: [{ from: "A1", to: "B2", troops: 3, reason: "no action points left" }],
    // The full tool name is not the name the log counts simulations under.
    toolCalls: [{ tool: "mcp__salient__simulate", error: false }],
    wallMs: 300,
  },
  // Pi compacted here, and so reported no context size: the log's 0 is "could not
  // say", and must not enter the mean or the minimum.
  {
    n: 9,
    passed: "timeout",
    compacted: true,
    contextTokens: 0,
    toolCalls: [{ tool: "submit_orders", error: true }],
    wallMs: 900,
  },
  { n: 12, passed: "token_budget" },
  { n: 15, passed: "provider_error" },
  // A compaction turn that did state a size: still a compaction turn, and its
  // figure still counts.
  {
    n: 18,
    compacted: true,
    contextTokens: 5000,
    wasted: [{ from: "A1", to: "B2", troops: 0, reason: "troop count must be a positive integer" }],
    toolCalls: [{ tool: "simulate", error: false }],
    wallMs: 1800,
  },
  { n: 20, passed: "harness_crash" },
  {
    n: 22,
    passed: "tool_surface",
    toolCalls: [
      { tool: "scout", error: true },
      { tool: "scout", error: true },
    ],
  },
  {
    n: 27,
    scouts: ["A1"],
    wasted: [{ from: "B2", to: "A1", troops: 3, reason: "source hex not owned" }],
    toolCalls: [{ tool: "simulate", error: false }],
  },
  { n: 30, usage: { cache_read: 40, cache_write: 5 }, costUsd: 0.5, wallMs: 3000 },
];

/** A whole log the schema accepts: two hexes, and boards that align with them. */
const syntheticLog = (turns = 30): Record<string, unknown> => ({
  format: "salient-log/1",
  ruleset: "v0",
  engine_version: "0.1.0",
  created: "2026-10-04T22:00:00.000Z",
  seed: 7,
  config: {
    turns,
    action_points: 6,
    start_troops: 5,
    base_production: 2,
    node_production: 1,
    node_garrison: 3,
    home_bonus: 1,
    points: { plain: 1, base: 1, node: 3 },
  },
  harness: {
    pi_version: "1.0.2",
    context: "continuous",
    compaction: true,
    tool_call_cap: 12,
    simulate_cap: 3,
    resubmissions: 1,
    turn_timeout_s: 300,
    output_token_budget: 8000,
  },
  players: {
    A: { kind: "pi", model: "marvin/subagent", thinking: "medium", context_window: 131072 },
    B: { kind: "bot", bot: "greedy" },
  },
  map: [
    { id: "A1", q: 0, r: 0, terrain: "plain" },
    { id: "B2", q: 1, r: 0, terrain: "base" },
  ],
  bases: { A: "A1", B: "B2" },
  start: { cells: [[1, 5, 0, 0], [2, 5, 3, 0]], score: { A: 1, B: 1 } },
  turns: Array.from({ length: turns }, (_, i) => ({
    n: i + 1,
    players: {
      A: playerOf(SEAT_A.find((each) => each.n === i + 1) ?? { n: i + 1 }),
      B: playerOf({ n: i + 1, contextTokens: 0 }),
    },
    events: [],
    after: { cells: [[1, 5, 0, 0], [2, 5, 3, 0]], score: { A: 10, B: 4 }, troops: { A: 5, B: 5 } },
  })),
  result: { type: "time", winner: "A", turn: turns, score: { A: 10, B: 4 }, margin: 6 },
});

describe("a synthetic log with compaction and every pass reason", () => {
  const source = syntheticLog();
  const log = matchLogSchema.parse(source);
  const metrics = matchMetrics(source);
  const seatA = metrics.seats.A;

  it("refuses a source the log format does not describe", () => {
    // The counts are taken from a parsed log, never from an object shaped like one.
    expect(() => matchMetrics({ ...source, format: "salient-log/2" })).toThrow();
    expect(() => matchMetrics({ turns: [] })).toThrow();
  });

  it("counts what the log holds, for both seats", () => {
    expectCounts(seatA.metrics, log, "A");
    expectCounts(metrics.seats.B.metrics, log, "B");
  });

  it("counts passes by reason, and wasted orders by theirs", () => {
    expect(seatA.metrics.passes).toEqual({
      no_submission: 1,
      timeout: 1,
      prompt_timeout: 0,
      token_budget: 1,
      provider_error: 1,
      harness_crash: 1,
      tool_surface: 1,
    });
    expect(seatA.metrics.passedTurns).toBe(6);
    expect(seatA.metrics.wastedOrders).toBe(4);
    expect(seatA.metrics.wastedByReason).toEqual({
      "no action points left": 0,
      "unknown hex": 1,
      "source hex not owned": 1,
      "destination is blocked": 0,
      "hexes are not adjacent": 1,
      "troop count must be a positive integer": 1,
      "not enough troops in source hex": 0,
    });
    // A refused submission counts once for the turn that was refused, whatever
    // the attempt carried.
    expect(seatA.metrics.rejectedSubmissions).toBe(1);
  });

  it("counts tool errors, scouts and simulations per turn", () => {
    expect(seatA.metrics.toolCalls).toBe(9);
    expect(seatA.metrics.toolErrors).toBe(3);
    expect(seatA.metrics.scouts).toBe(3);
    // Three bare `simulate` calls; the `mcp__salient__simulate` one on turn 3 is
    // logged as a different tool and is not a simulation.
    expect(seatA.metrics.simulations).toBe(3);
    expect(seatA.metrics.perTurn.scouts).toBeCloseTo(3 / 30, 10);
    expect(seatA.metrics.perTurn.simulations).toBeCloseTo(3 / 30, 10);
    expect(seatA.metrics.perTurn.toolCalls).toBeCloseTo(9 / 30, 10);
  });

  it("counts tokens and cost per turn, and the wall time", () => {
    expect(seatA.metrics.tokens).toEqual({
      input: 300,
      output: 50,
      cache_read: 40,
      cache_write: 5,
      total: 395,
    });
    expect(seatA.metrics.perTurn.tokens).toBeCloseTo(395 / 30, 10);
    expect(seatA.metrics.costUsd).toBeCloseTo(0.75, 10);
    expect(seatA.metrics.perTurn.costUsd).toBeCloseTo(0.75 / 30, 10);
    expect(seatA.metrics.wallMs).toBe(6300);
    expect(seatA.metrics.perTurn.wallMs).toBeCloseTo(6300 / 30, 10);
    // A bot seat has no provider, so its tokens and cost are nought.
    expect(metrics.seats.B.metrics.tokens.total).toBe(0);
    expect(metrics.seats.B.metrics.costUsd).toBe(0);
  });

  it("reports a compacted turn with no context figure as a compaction turn, not a nought", () => {
    const context = seatA.metrics.context;
    expect(context.compactionTurns).toEqual([9, 18]);
    expect(context.unstatedTurns).toEqual([9]);
    expect(context.byTurn[8]).toEqual({ turn: 9, tokens: null, compacted: true });
    expect(context.byTurn[17]).toEqual({ turn: 18, tokens: 5000, compacted: true });
    // The nought on turn 9 is out of every figure: were it in, the minimum would
    // read as a context that had shrunk to nothing.
    expect(context.min).toBe(1000);
    expect(context.max).toBe(30000);
    expect(context.first).toBe(1000);
    expect(context.last).toBe(30000);
    expect(context.mean).toBeCloseTo(443000 / 29, 6);
  });

  it("splits the same counts into turns 1-8, 9-17 and 18-25", () => {
    const bands = seatA.bands;
    // The deepest band is open at the top, so turns 26-30 are in it too.
    expect(bands["1-8"].metrics.turns).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bands["9-17"].metrics.turns).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(bands["18-25"].metrics.turns).toEqual([
      18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ]);
    expectBandsPartition(bands, metrics.turns);

    expect(bands["1-8"].metrics.passes).toEqual({
      no_submission: 1,
      timeout: 0,
      prompt_timeout: 0,
      token_budget: 0,
      provider_error: 0,
      harness_crash: 0,
      tool_surface: 0,
    });
    expect(bands["1-8"].metrics.wastedOrders).toBe(2);
    expect(bands["1-8"].metrics.rejectedSubmissions).toBe(1);
    expect(bands["1-8"].metrics.toolErrors).toBe(0);
    expect(bands["1-8"].metrics.scouts).toBe(2);
    expect(bands["1-8"].metrics.simulations).toBe(1);
    expect(bands["1-8"].metrics.context.mean).toBe(4500);
    expect(bands["1-8"].metrics.context.compactionTurns).toEqual([]);

    expect(bands["9-17"].metrics.passes).toEqual({
      no_submission: 0,
      timeout: 1,
      prompt_timeout: 0,
      token_budget: 1,
      provider_error: 1,
      harness_crash: 0,
      tool_surface: 0,
    });
    expect(bands["9-17"].metrics.wastedOrders).toBe(0);
    expect(bands["9-17"].metrics.toolErrors).toBe(1);
    expect(bands["9-17"].metrics.context.compactionTurns).toEqual([9]);
    expect(bands["9-17"].metrics.context.unstatedTurns).toEqual([9]);
    // Turn 9's nought is out, so this band's context is turns 10-17 alone.
    expect(bands["9-17"].metrics.context.mean).toBe(13500);
    expect(bands["9-17"].metrics.context.min).toBe(10000);

    expect(bands["18-25"].metrics.passes).toEqual({
      no_submission: 0,
      timeout: 0,
      prompt_timeout: 0,
      token_budget: 0,
      provider_error: 0,
      harness_crash: 1,
      tool_surface: 1,
    });
    expect(bands["18-25"].metrics.wastedOrders).toBe(2);
    expect(bands["18-25"].metrics.toolErrors).toBe(2);
    expect(bands["18-25"].metrics.scouts).toBe(1);
    expect(bands["18-25"].metrics.simulations).toBe(2);
    expect(bands["18-25"].metrics.context.compactionTurns).toEqual([18]);
    expect(bands["18-25"].metrics.context.unstatedTurns).toEqual([]);
    expect(bands["18-25"].metrics.context.mean).toBe(23000);
    expect(bands["18-25"].metrics.context.min).toBe(5000);

    // The bands add up to the match, so nothing was counted twice or lost.
    for (const key of [
      "passedTurns",
      "wastedOrders",
      "rejectedSubmissions",
      "toolCalls",
      "toolErrors",
      "scouts",
      "simulations",
      "wallMs",
    ] as const) {
      const total = DEPTH_BANDS.reduce(
        (sum, band) => sum + bands[band.name].metrics[key],
        0,
      );
      expect(total, key).toBe(seatA.metrics[key]);
    }
    const tokens = DEPTH_BANDS.reduce(
      (sum, band) => sum + bands[band.name].metrics.tokens.total,
      0,
    );
    expect(tokens).toBe(seatA.metrics.tokens.total);
  });

  it("leaves a band a short match never reached empty rather than wrong", () => {
    // A knockout on turn 7 leaves the two deeper bands with no turns at all, and
    // no mean that could be read as a measurement.
    const short = matchMetrics(syntheticLog(7));
    const bands = short.seats.A.bands;
    expect(bands["1-8"].metrics.turns).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(bands["9-17"].metrics.turns).toEqual([]);
    expect(bands["18-25"].metrics.turns).toEqual([]);
    expect(bands["9-17"].metrics.context.mean).toBeNull();
    expect(bands["9-17"].metrics.context.min).toBeNull();
    expect(bands["9-17"].metrics.context.byTurn).toEqual([]);
    expect(bands["9-17"].metrics.perTurn.toolCalls).toBe(0);
  });
});
