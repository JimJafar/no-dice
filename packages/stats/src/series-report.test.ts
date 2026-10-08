/**
 * A finished series becomes brief §6.7's report.
 *
 * The fixture is a whole series directory on disk, in the shape the runner
 * leaves one: a `series.json` with the pairing, the seed list, both matches of
 * every pair and the stop record, and the match logs it names. Four pairs, eight
 * matches, and deliberately five that count and three that do not — one recorded
 * `failed` with a `tool_surface` reason, one whose log is on disk but carries a
 * `tool_surface` pass (a voided match whose partial log was kept), and one whose
 * log the record names and the disk does not have. That is the case the report
 * exists to be honest about: `docs/pi-harness-notes.md` §7 measured
 * `marvin/subagent` shortening a tool name often enough to void a match, so a
 * real series will lose matches this way and the report has to say so rather
 * than average them into the win rate.
 *
 * Every expected figure is re-counted in this file from the fixture logs with
 * plain loops, and the Wilson interval is recomputed from the textbook formula
 * here rather than taken from the module, so a change to either side shows up.
 * The same for the depth split: the bands' turn counts are counted from the
 * turns, not read back off the report.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { PassReason, Seat, WasteReason } from "@no-dice/log";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BOOTSTRAP_SAMPLES,
  renderSeriesReport,
  renderSeriesReportMarkdown,
  seriesReport,
} from "./series-report.ts";
import type { ModelMetrics, SeriesReport } from "./series-report.ts";

/** Model X, as the match log's header names it. */
const X_PLAYER = { kind: "pi", model: "marvin/subagent", thinking: "medium", context_window: 131072 } as const;

/** Model X, as the series record names it. */
const X = { kind: "model", provider: "marvin", model: "subagent" } as const;

/** The opponent every pair is played against. */
const OPPONENT = { kind: "bot", bot: "greedy" } as const;

/** One turn of trouble, applied to model X's seat. */
interface Trouble {
  turn: number;
  passed?: PassReason;
  wasted?: WasteReason[];
  toolErrors?: number;
  scouts?: number;
  compacted?: boolean;
  contextTokens?: number;
}

/** How one fixture match ended. */
interface Outcome {
  type: "time" | "knockout";
  winner: Seat | null;
  turn: number;
  margin: number;
}

/**
 * A `salient-log/1` the schema accepts: two hexes, boards that align with them,
 * model X in `xSeat` and the Greedy bot in the other. X's turns carry `trouble`
 * and a stated context of `n * 1000`; the bot's are clean and nought, as a bot
 * seat's really are.
 */
const logOf = (input: {
  seed: number;
  turns: number;
  xSeat: Seat;
  result: Outcome;
  trouble?: Trouble[];
  /** Turns on which the seat model X did not play compacted — used by a bot seat. */
  otherCompacted?: number[];
}): Record<string, unknown> => {
  const other: Seat = input.xSeat === "A" ? "B" : "A";
  const at = (turn: number): Trouble | undefined => input.trouble?.find((each) => each.turn === turn);
  const playerOf = (seat: Seat, turn: number): unknown => {
    if (seat === other) {
      return {
        tool_calls: [],
        scouts: [],
        rejected_submission: null,
        orders: [],
        wasted: [],
        intent: "",
        prediction: "",
        passed: null,
        notes_after: "",
        usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        cost_usd: 0,
        context_tokens: 0,
        // A bot seat runs no provider, so its context is a stated nought — unless
        // the fixture says it compacted, which is how a test pins that a model's
        // row names the seat *that model* held rather than model X's.
        compacted: (input.otherCompacted ?? []).includes(turn),
        wall_ms: 0,
      };
    }
    const trouble = at(turn) ?? { turn };
    const dropped = (trouble.wasted ?? []).map((reason): unknown => ({
      order: { from: "A1", to: "B2", troops: 3 },
      reason,
    }));
    return {
      tool_calls: Array.from({ length: trouble.toolErrors ?? 0 }, () => ({
        tool: "scout",
        args: null,
        result: null,
        error: true,
        ms: 5,
      })),
      scouts: Array.from({ length: trouble.scouts ?? 0 }, () => "A1"),
      rejected_submission: null,
      orders: (trouble.wasted ?? []).map(() => ({ from: "A1", to: "B2", troops: 3 })),
      wasted: dropped,
      intent: "",
      prediction: "",
      passed: trouble.passed ?? null,
      notes_after: "",
      // A stated 110 tokens and a cent a turn, so the series totals are the
      // turns counted times a number this file can name.
      usage: { input: 100, output: 10, cache_read: 0, cache_write: 0 },
      cost_usd: 0.01,
      context_tokens: trouble.contextTokens ?? turn * 1000,
      compacted: trouble.compacted ?? false,
      wall_ms: 100,
    };
  };
  const cells = [
    [1, 5, 0, 0],
    [2, 5, 3, 0],
  ];
  return {
    format: "salient-log/1",
    ruleset: "v0",
    engine_version: "0.1.0",
    created: "2026-10-05T00:00:00.000Z",
    seed: input.seed,
    config: {
      turns: input.turns,
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
      output_token_budget: null,
    },
    players: {
      A: input.xSeat === "A" ? X_PLAYER : OPPONENT,
      B: input.xSeat === "A" ? OPPONENT : X_PLAYER,
    },
    map: [
      { id: "A1", q: 0, r: 0, terrain: "plain" },
      { id: "B2", q: 1, r: 0, terrain: "base" },
    ],
    bases: { A: "A1", B: "B2" },
    start: { cells, score: { A: 1, B: 1 } },
    turns: Array.from({ length: input.turns }, (_, i) => ({
      n: i + 1,
      players: { A: playerOf("A", i + 1), B: playerOf("B", i + 1) },
      events: [],
      after: { cells, score: { A: 10, B: 4 }, troops: { A: 5, B: 5 } },
    })),
    result: {
      type: input.result.type,
      winner: input.result.winner,
      turn: input.result.turn,
      score: { A: 10, B: 4 },
      margin: input.result.margin,
    },
  };
};

/**
 * How the runner names a match in `series.json`: `<seed>-<seat A>-<seat B>.json`
 * under `matches/`, in a path that carries the series directory because `--dir`
 * defaults to the relative `series/<a>-vs-<b>` (`matchOf` in
 * `packages/runner/src/series-plan.ts`, `seatSlug` in `./args`). The log itself
 * sits at that name under the series directory's `matches/`, which is what the
 * report has to work out when it is handed the directory from elsewhere.
 */
const recordPathOf = (seed: number, xSeat: Seat): string =>
  `series/marvin-subagent-vs-greedy/matches/${String(
    seed,
  )}-${xSeat === "A" ? "marvin-subagent-greedy" : "greedy-marvin-subagent"}.json`;

/** The fixture's matches: what each is, and where its log goes. */
interface FixtureMatch {
  seed: number;
  /** The seat model X played, as the series record records it. */
  seat: Seat;
  /** The path the record names, in the runner's shape: see `recordPathOf`. */
  path: string;
  /** What the record says the match was, whether or not a log of it survives. */
  result: Outcome;
  /** null leaves no log, which is what a failed match and a lost one do. */
  log: Record<string, unknown> | null;
  /** Set for a match the record says failed, with the reason it says. */
  error?: string;
}

/** The eight matches of the fixture's four pairs. */
const FIXTURE: FixtureMatch[] = [
  {
    seed: 101,
    seat: "A",
    path: recordPathOf(101, "A"),
    result: { type: "time", winner: "A", turn: 25, margin: 12 },
    log: logOf({
      seed: 101,
      turns: 25,
      xSeat: "A",
      result: { type: "time", winner: "A", turn: 25, margin: 12 },
      trouble: [
        { turn: 3, toolErrors: 1 },
        { turn: 9, wasted: ["unknown hex"] },
        // A seat the harness could not get to take the prompt: its own pass
        // reason, and so its own row in the per-model table.
        { turn: 11, passed: "prompt_timeout" },
        { turn: 18, compacted: true, contextTokens: 0 },
        { turn: 20, toolErrors: 2 },
      ],
    }),
  },
  {
    seed: 101,
    seat: "B",
    path: recordPathOf(101, "B"),
    result: { type: "time", winner: "A", turn: 25, margin: 5 },
    log: logOf({
      seed: 101,
      turns: 25,
      xSeat: "B",
      result: { type: "time", winner: "A", turn: 25, margin: 5 },
      trouble: [{ turn: 5, passed: "timeout" }, { turn: 22, toolErrors: 1 }],
    }),
  },
  {
    seed: 102,
    seat: "A",
    path: recordPathOf(102, "A"),
    result: { type: "knockout", winner: "A", turn: 7, margin: 40 },
    log: logOf({
      seed: 102,
      turns: 7,
      xSeat: "A",
      result: { type: "knockout", winner: "A", turn: 7, margin: 40 },
      trouble: [{ turn: 2, scouts: 2 }],
    }),
  },
  {
    seed: 102,
    seat: "B",
    path: recordPathOf(102, "B"),
    result: { type: "time", winner: null, turn: 25, margin: 0 },
    log: logOf({
      seed: 102,
      turns: 25,
      xSeat: "B",
      result: { type: "time", winner: null, turn: 25, margin: 0 },
      trouble: [{ turn: 19, wasted: ["hexes are not adjacent"] }],
    }),
  },
  {
    seed: 103,
    seat: "A",
    path: recordPathOf(103, "A"),
    result: { type: "time", winner: null, turn: 0, margin: 0 },
    log: null,
    // How the runner records a voided match: the reason code in brackets.
    error: "MatchVoided: match 103-A is voided: the seat called `simulate` (tool_surface)",
  },
  {
    seed: 103,
    seat: "B",
    path: recordPathOf(103, "B"),
    result: { type: "time", winner: "B", turn: 4, margin: 30 },
    // A played record whose log carries a match-level pass: the partial log of a
    // voided match, which is not a result.
    log: logOf({
      seed: 103,
      turns: 4,
      xSeat: "B",
      result: { type: "time", winner: "B", turn: 4, margin: 30 },
      trouble: [{ turn: 3, passed: "tool_surface" }],
    }),
  },
  {
    seed: 104,
    seat: "A",
    path: recordPathOf(104, "A"),
    result: { type: "time", winner: "A", turn: 25, margin: 8 },
    // The record says played; the disk has nothing. Named, and left out.
    log: null,
  },
  {
    seed: 104,
    seat: "B",
    path: recordPathOf(104, "B"),
    result: { type: "knockout", winner: "B", turn: 15, margin: 93 },
    log: logOf({
      seed: 104,
      turns: 15,
      xSeat: "B",
      result: { type: "knockout", winner: "B", turn: 15, margin: 93 },
      trouble: [{ turn: 12, toolErrors: 1 }],
    }),
  },
];

/** The pairs of the record, in the order the runner writes them. */
const pairsOf = (): unknown[] => {
  const bySeed = new Map<number, unknown[]>();
  for (const match of FIXTURE) {
    const matches = bySeed.get(match.seed) ?? [];
    matches.push(
      match.error !== undefined
        ? { seat: match.seat, path: match.path, status: "failed", error: match.error }
        : {
            seat: match.seat,
            path: match.path,
            status: "played",
            result: {
              type: match.result.type,
              winner: match.result.winner,
              margin: match.result.margin,
            },
            cost_usd: 0.25,
            tokens: { input: 100, output: 10, cache_read: 0, cache_write: 0, total: 110 },
          },
    );
    bySeed.set(match.seed, matches);
  }
  return [...bySeed.entries()].map(([seed, matches]) => ({ seed, matches }));
};

/** `series.json` as the runner writes it, including the fields the report ignores. */
const recordOf = (): Record<string, unknown> => ({
  seed_base: 7,
  max_pairs: 4,
  seeds: [101, 102, 103, 104],
  pairing: { a: X, b: OPPONENT },
  pairs: pairsOf(),
  state: {
    pairs_played: 3,
    matches_played: 7,
    matches_failed: 1,
    stop_reason: "wilson_interval",
    stopped_early: true,
  },
  // A field no part of the report names, standing for whatever the runner learns
  // next: a report that refused it would stop reporting every series the runner
  // upgraded.
  resume_state: { batch: 2 },
  stop: {
    reason: "wilson_interval",
    totals: { cost_usd: 1.5, tokens: { input: 700, output: 70, cache_read: 0, cache_write: 0, total: 770 } },
    test: {
      confidence: 0.99,
      win_rate: { wins: 3, losses: 1, draws: 1, n: 5, successes: 3.5, rate: 0.7 },
      interval: { low: 0.251, high: 0.934 },
      excludes_half: true,
    },
  },
});

/** The logs the fixture writes; the ones it does not are the missing matches. */
const writeSeries = async (dir: string): Promise<void> => {
  await mkdir(join(dir, "matches"), { recursive: true });
  for (const match of FIXTURE) {
    if (match.log === null) continue;
    await writeFile(
      join(dir, "matches", basename(match.path)),
      `${JSON.stringify(match.log, null, 2)}\n`,
      "utf8",
    );
  }
  await writeFile(join(dir, "series.json"), `${JSON.stringify(recordOf(), null, 2)}\n`, "utf8");
};

/**
 * The Wilson score interval, from the textbook formula rather than from the
 * module, so the report's interval is proved to be one and to be at 95%.
 */
const wilson = (successes: number, n: number, z: number): { low: number; high: number } => {
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
};

/** The band one turn falls in, counted here so the split is proved, not echoed. */
const bandOf = (turn: number): "1-8" | "9-17" | "18-25" =>
  turn <= 8 ? "1-8" : turn <= 17 ? "9-17" : "18-25";

/** The fixture's counted matches: played, with a log, and not voided. */
const COUNTED = FIXTURE.filter((match) => {
  if (match.log === null) return false;
  const passed = (match.log as { turns: { players: { A: { passed: string | null }; B: { passed: string | null } } }[] })
    .turns;
  return !passed.some(
    (turn) => turn.players.A.passed === "tool_surface" || turn.players.B.passed === "tool_surface",
  );
});

let dir: string;
let report: SeriesReport;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-series-report-"));
  await writeSeries(dir);
  report = await seriesReport(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a series directory", () => {
  it("reads the pairing, the seed list and the pair limit from the record", () => {
    expect(report.xLabel).toBe("marvin/subagent");
    expect(report.opponentLabel).toBe("bot:greedy");
    expect(report.seeds).toEqual([101, 102, 103, 104]);
    expect(report.maxPairs).toBe(4);
    expect(report.pairs).toBe(4);
    expect(report.matches).toBe(8);
    expect(report.recordPath).toBe(join(dir, "series.json"));
    expect(report.reportPath).toBe(join(dir, "report.md"));
  });

  it("reports a record that carries more than the report reads", () => {
    // `seed_base`, `state.pairs_played`, `stop.totals` and `resume_state` are in
    // the fixture and nowhere in the report: a series record is the runner's, and
    // a report that refused a field it does not use would break every time the
    // runner learned something. The fields it does read came through.
    expect(report.maxPairs).toBe(4);
    expect(report.seeds).toEqual([101, 102, 103, 104]);
    expect(report.pairs).toBe(4);
    expect(report.matches).toBe(8);
    expect(report.counted).toBe(5);
    expect(report.stop.reason).toBe("wilson_interval");
  });

  it("finds the logs a record names by the series directory it was given", async () => {
    // The runner writes `out` as its `--dir` joined with `matches/`, and `--dir`
    // defaults to the relative `series/<a>-vs-<b>`, so the fixture's record names
    // `series/marvin-subagent-vs-greedy/matches/<seed>-<seats>.json` while the
    // logs sit under the series directory itself. Read from a working directory
    // that is not the one the run started in, the recorded path resolves to
    // nothing, and a report that only re-joined it under the series directory
    // would double the prefix and print "0 counted, 8 missing" for a series that
    // played them all.
    const record = JSON.parse(await readFile(join(dir, "series.json"), "utf8")) as {
      pairs: { matches: { path: string }[] }[];
    };
    const named = record.pairs.flatMap((pair) => pair.matches.map((match) => match.path));
    expect(named[0]).toBe("series/marvin-subagent-vs-greedy/matches/101-marvin-subagent-greedy.json");
    expect(report.counted).toBe(5);
    expect(report.missing.byKind.missing_log).toBe(1);
  });

  it("refuses a directory that is not a series", async () => {
    const empty = await mkdtemp(join(tmpdir(), "no-dice-not-a-series-"));
    try {
      await expect(seriesReport(empty)).rejects.toThrow(/series\.json is not there/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("refuses a series.json that is not a series record", async () => {
    const broken = await mkdtemp(join(tmpdir(), "no-dice-broken-series-"));
    try {
      await writeFile(join(broken, "series.json"), "{ not json", "utf8");
      await expect(seriesReport(broken)).rejects.toThrow(/is not JSON/);
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });
});

describe("the matches that count", () => {
  it("counts five of eight, and leaves the other three out of the win rate", () => {
    expect(report.counted).toBe(5);
    expect(COUNTED).toHaveLength(5);
    expect(report.missing.total).toBe(3);
    expect(report.result.winRate.n).toBe(5);
  });

  it("counts wins, losses and draws for model X, a draw being half a win", () => {
    // X won 101 from seat A, lost 101 from seat B, knocked out 102 from seat A,
    // drew 102 from seat B, and knocked out 104 from seat B.
    expect(report.result.winRate).toEqual({
      wins: 3,
      losses: 1,
      draws: 1,
      n: 5,
      successes: 3.5,
      rate: 0.7,
    });
  });

  it("gives the win rate a 95% Wilson interval", () => {
    expect(report.result.confidence).toBe(0.95);
    const expected = wilson(3.5, 5, 1.96);
    expect(report.result.interval!.low).toBeCloseTo(expected.low, 10);
    expect(report.result.interval!.high).toBeCloseTo(expected.high, 10);
    // Not the stopping test's interval: the report's is its own, at its own level.
    expect(report.result.interval).not.toEqual(report.stop.test?.interval);
  });

  it("splits model X's record by the seat it played, the check on the board", () => {
    const { A, B } = report.seatSplit;
    // Seat A: 101 won, 102 knocked out; 103 and 104 are missing and so are in
    // neither row. Seat B: 101 lost, 102 drew, 104 knocked out.
    expect(A.winRate).toEqual({ wins: 2, losses: 0, draws: 0, n: 2, successes: 2, rate: 1 });
    expect(B.winRate).toEqual({ wins: 1, losses: 1, draws: 1, n: 3, successes: 1.5, rate: 0.5 });
    expect(A.winRate.n + B.winRate.n).toBe(report.result.winRate.n);
    // A model 2 for 2 has an interval that stops at 1 rather than past it.
    expect(A.interval!.high).toBe(1);
    expect(A.interval!.low).toBeCloseTo(wilson(2, 2, 1.96).low, 10);
    expect(B.interval!.low).toBeCloseTo(wilson(1.5, 3, 1.96).low, 10);
    expect(B.interval!.high).toBeCloseTo(wilson(1.5, 3, 1.96).high, 10);
  });

  it("says whether the series stopped early, and names the test that stopped it", () => {
    expect(report.stop.stoppedEarly).toBe(true);
    expect(report.stop.reason).toBe("wilson_interval");
    expect(report.stop.test).toEqual({
      confidence: 0.99,
      interval: { low: 0.251, high: 0.934 },
      excludes_half: true,
      counted: 5,
    });
  });
});

describe("the matches that do not count", () => {
  it("counts failed, voided and missing-log matches separately from the win rate", () => {
    expect(report.missing.byKind).toEqual({
      failed: 1,
      voided: 1,
      missing_log: 1,
      unreadable_log: 0,
    });
    expect(report.missing.matches.map((match) => [match.seed, match.seat, match.kind])).toEqual([
      [103, "A", "failed"],
      [103, "B", "voided"],
      [104, "A", "missing_log"],
    ]);
  });

  it("groups the losses to `tool_surface` into one row that says how many there are", () => {
    // The reason a voided match is recorded under, in brackets in the runner's
    // message, is the same reason the partial log of one carries.
    expect(report.missing.byReason).toEqual([
      { reason: "tool_surface", kinds: ["failed", "voided"], count: 2 },
      { reason: "the record names a log that is not on disk", kinds: ["missing_log"], count: 1 },
    ]);
  });

  it("names each missing match, with the path the record gave it", () => {
    const failed = report.missing.matches.find((match) => match.kind === "failed")!;
    expect(failed.path).toBe(join(dir, "matches/103-marvin-subagent-greedy.json"));
    expect(failed.reason).toBe("tool_surface");
    const voided = report.missing.matches.find((match) => match.kind === "voided")!;
    expect(voided.reason).toBe("tool_surface");
    expect(voided.seat).toBe("B");
  });
});

describe("the margin", () => {
  it("means the margins with knockouts counted as 93", () => {
    // 12, 5, 93 (a knockout logged as 40), 0 (the draw), 93 (a knockout logged
    // as 93): the log's own margin is not what a knockout contributes.
    const margins = [12, 5, 93, 0, 93];
    expect(report.margin).not.toBeNull();
    expect(report.margin!.n).toBe(5);
    expect(report.margin!.mean).toBeCloseTo(margins.reduce((total, n) => total + n, 0) / 5, 10);
    expect(report.margin!.knockoutsCountedAs).toBe(93);
  });

  it("carries a bootstrap interval that brackets the mean", () => {
    const margin = report.margin!;
    expect(margin.samples).toBe(BOOTSTRAP_SAMPLES);
    expect(margin.confidence).toBe(0.95);
    expect(margin.low).toBeLessThanOrEqual(margin.mean);
    expect(margin.high).toBeGreaterThanOrEqual(margin.mean);
  });

  it("is the same interval every time the series is read", async () => {
    // A published figure: the same matches and the same seed give the same
    // interval, so `report.md` does not change every time it is rendered.
    const second = await seriesReport(dir);
    expect(second.margin).toEqual(report.margin);
  });
});

describe("the knockouts", () => {
  it("counts them, and lists the turns they happened on", () => {
    expect(report.knockouts.count).toBe(2);
    expect(report.knockouts.turns).toEqual([7, 15]);
    expect(report.knockouts.matches).toEqual([
      { seed: 102, seat: "A", winner: "A", turn: 7, margin: 40 },
      { seed: 104, seat: "B", winner: "B", turn: 15, margin: 93 },
    ]);
  });
});

describe("the per-model rows", () => {
  /** Every turn number of every counted match — the fixture's own count. */
  const turnsOf = (): number[] =>
    COUNTED.flatMap((match) => (match.log as { turns: { n: number }[] }).turns.map((turn) => turn.n));

  it("has one row per model, model X first", () => {
    expect(report.models.map((model) => model.label)).toEqual(["marvin/subagent", "bot:greedy"]);
    const x = report.models[0];
    expect(x.matches).toBe(5);
    expect(x.seats).toEqual({ A: 2, B: 3 });
    expect(report.models[1].matches).toBe(5);
  });

  it("splits each model's counts into turns 1-8, 9-17 and 18-25", () => {
    const x = report.models[0];
    // Every turn of every counted match lands in exactly one band, and the three
    // bands together hold all of them.
    const turns = turnsOf();
    expect(x.metrics.turnCount).toBe(turns.length);
    const expected = { "1-8": 0, "9-17": 0, "18-25": 0 };
    for (const turn of turns) expected[bandOf(turn)] += 1;
    expect(expected).toEqual({ "1-8": 39, "9-17": 34, "18-25": 24 });
    for (const band of ["1-8", "9-17", "18-25"] as const) {
      expect(x.bands[band].turnCount).toBe(expected[band]);
    }
    expect(x.bands["1-8"].turnCount + x.bands["9-17"].turnCount + x.bands["18-25"].turnCount).toBe(
      x.metrics.turnCount,
    );
  });

  it("counts each model's errors over the series and inside each band", () => {
    const x = report.models[0];
    // The fixture's tool errors: turn 3 (1) and turn 20 (2) in 101 seat A, turn
    // 22 (1) in 101 seat B, turn 12 (1) in 104 seat B.
    const errors = (metrics: ModelMetrics): number => metrics.toolErrors;
    expect(errors(x.metrics)).toBe(5);
    expect(errors(x.bands["1-8"])).toBe(1);
    expect(errors(x.bands["9-17"])).toBe(1);
    expect(errors(x.bands["18-25"])).toBe(3);

    expect(x.metrics.wastedOrders).toBe(2);
    expect(x.bands["9-17"].wastedOrders).toBe(1);
    expect(x.bands["18-25"].wastedOrders).toBe(1);
    expect(x.metrics.wastedByReason["unknown hex"]).toBe(1);
    expect(x.metrics.wastedByReason["hexes are not adjacent"]).toBe(1);

    expect(x.metrics.passes.timeout).toBe(1);
    expect(x.bands["1-8"].passes.timeout).toBe(1);
    // `prompt_timeout` is a reason of its own, counted in the band its turn
    // falls in — turn 11 of the 101 seat-A match.
    expect(x.metrics.passes.prompt_timeout).toBe(1);
    expect(x.bands["9-17"].passes.prompt_timeout).toBe(1);
    expect(x.metrics.scouts).toBe(2);
    expect(x.bands["1-8"].scouts).toBe(2);
  });

  it("sums tokens and cost over the series, and takes the per-turn means over its turns", () => {
    const x = report.models[0];
    const turns = x.metrics.turnCount;
    expect(x.metrics.tokens.total).toBe(110 * turns);
    expect(x.metrics.costUsd).toBeCloseTo(0.01 * turns, 10);
    expect(x.metrics.perTurn.tokens).toBeCloseTo(110, 10);
    expect(x.metrics.perTurn.costUsd).toBeCloseTo(0.01, 10);
    // A band's mean is over the turns that band holds.
    expect(x.bands["9-17"].perTurn.tokens).toBeCloseTo(110, 10);
    expect(x.bands["9-17"].tokens.total).toBe(110 * x.bands["9-17"].turnCount);
  });

  it("gives each model its own win rate, with the report's 95% interval", () => {
    // Model X's row is the headline row: the same five counted matches, seen
    // from X's seat either way.
    const x = report.models[0];
    expect(x.result).toEqual(report.result);
    expect(x.result.confidence).toBe(0.95);

    // The bot held the other seat of every one of those matches, so its counts
    // are the mirror of X's: it won the 101 seat-B match, drew the 102 seat-B
    // one, and lost the other three.
    const bot = report.models[1];
    expect(bot.result.winRate).toEqual({
      wins: 1,
      losses: 3,
      draws: 1,
      n: 5,
      successes: 1.5,
      rate: 0.3,
    });
    expect(bot.result.interval).toEqual(wilson(1.5, 5, 1.96));
    // The rate sits inside its own interval, which is the only check a pooled
    // row over several series can have.
    expect(bot.result.interval!.low).toBeLessThanOrEqual(bot.result.winRate.rate!);
    expect(bot.result.winRate.rate!).toBeLessThanOrEqual(bot.result.interval!.high);
  });

  it("splits each model's record by the seat that model held", () => {
    // The report's own seat split is model X's, so X's row repeats it exactly.
    const x = report.models[0];
    expect(x.seatSplit).toEqual(report.seatSplit);

    // The bot held seat A in the matches the record puts X in seat B for — 101
    // (won), 102 (drawn) and 104 (lost) — and seat B in 101 seat A
    // and 102 seat A, both of which it lost. A row that read model X's seat for
    // every model would print X's split here.
    const bot = report.models[1];
    expect(bot.seatSplit.A.winRate).toEqual({
      wins: 1,
      losses: 1,
      draws: 1,
      n: 3,
      successes: 1.5,
      rate: 0.5,
    });
    expect(bot.seatSplit.B.winRate).toEqual({
      wins: 0,
      losses: 2,
      draws: 0,
      n: 2,
      successes: 0,
      rate: 0,
    });
    expect(bot.seatSplit.A.interval).toEqual(wilson(1.5, 3, 1.96));

    for (const model of report.models) {
      expect(model.result.winRate.n).toBe(model.matches);
      expect(model.seatSplit.A.winRate.n + model.seatSplit.B.winRate.n).toBe(model.matches);
      expect(model.seatSplit.A.winRate.n).toBe(model.seats.A);
      expect(model.seatSplit.B.winRate.n).toBe(model.seats.B);
    }
  });

  it("keeps the context figures per match, and a compaction's nought out of them", () => {
    const x = report.models[0];
    // One compaction turn in the fixture, on turn 18 of seed 101 from seat A,
    // logged with no figure because Pi had just rewritten the context. The seat
    // travels with the turn: a seed names a pair, and only one of its two
    // matches has the turn.
    expect(x.metrics.context.compactionTurns).toEqual([{ seed: 101, seat: "A", turn: 18 }]);
    expect(x.metrics.context.unstatedTurns).toEqual([{ seed: 101, seat: "A", turn: 18 }]);
    const stated = COUNTED.flatMap((match) =>
      (
        match.log as {
          turns: { n: number; players: { A: { context_tokens: number }; B: { context_tokens: number } } }[];
        }
      )
        .turns.flatMap((turn) => {
          // Model X's seat, which is not the same seat in every match of a pair.
          const tokens = turn.players[match.seat].context_tokens;
          return tokens === 0 ? [] : [tokens];
        }),
    );
    expect(x.metrics.context.mean).toBeCloseTo(stated.reduce((total, n) => total + n, 0) / stated.length, 6);
    expect(x.metrics.context.min).toBe(1000);
    expect(x.metrics.context.max).toBe(25000);
    // The bot seat played the same matches and runs no provider: its context is a
    // stated nought on every turn, and its tokens and cost are nought.
    const bot = report.models[1];
    expect(bot.metrics.context.mean).toBe(0);
    expect(bot.metrics.context.unstatedTurns).toEqual([]);
    expect(bot.metrics.tokens.total).toBe(0);
    expect(bot.metrics.costUsd).toBe(0);
    expect(bot.metrics.turnCount).toBe(x.metrics.turnCount);
  });
});

describe("a series that is broken, or has nothing in it", () => {
  /** A one-pair series directory whose single log is `log`, in the runner's layout. */
  const seriesWith = async (log: unknown): Promise<string> => {
    const where = await mkdtemp(join(tmpdir(), "no-dice-series-edge-"));
    await mkdir(join(where, "matches"), { recursive: true });
    await writeFile(join(where, "matches/101-marvin-subagent-greedy.json"), JSON.stringify(log), "utf8");
    await writeFile(
      join(where, "series.json"),
      JSON.stringify({
        max_pairs: 1,
        seeds: [101],
        pairing: { a: X, b: OPPONENT },
        pairs: [
          {
            seed: 101,
            matches: [
              {
                seat: "A",
                path: recordPathOf(101, "A"),
                status: "played",
                result: { type: "time", winner: "A", margin: 4 },
              },
            ],
          },
        ],
        state: { stop_reason: "max_pairs", stopped_early: false },
      }),
      "utf8",
    );
    return where;
  };

  it("reports a file that is there but is not a log as missing, and says why", async () => {
    const where = await seriesWith({ format: "salient-log/1" });
    try {
      const broken = await seriesReport(where);
      expect(broken.counted).toBe(0);
      expect(broken.missing.byKind.unreadable_log).toBe(1);
      expect(broken.missing.matches[0].reason).toContain("not a salient-log/1 log");
      // Nothing counted, so nothing to give an interval over.
      expect(broken.result.interval).toBeNull();
      expect(broken.margin).toBeNull();
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it("reports a series that recorded no stop and played nothing", async () => {
    const where = await mkdtemp(join(tmpdir(), "no-dice-series-empty-"));
    try {
      await writeFile(
        join(where, "series.json"),
        JSON.stringify({
          max_pairs: 0,
          seeds: [],
          pairing: { a: X, b: OPPONENT },
          pairs: [],
          state: { stop_reason: "max_pairs", stopped_early: false },
        }),
        "utf8",
      );
      const empty = await seriesReport(where);
      expect(empty.counted).toBe(0);
      expect(empty.result.winRate.rate).toBeNull();
      expect(empty.seatSplit.A.interval).toBeNull();
      expect(empty.stop.test).toBeNull();
      expect(empty.stop.stoppedEarly).toBe(false);
      expect(empty.margin).toBeNull();
      expect(empty.knockouts.count).toBe(0);
      expect(empty.models).toEqual([]);
      const markdown = renderSeriesReportMarkdown(empty);
      expect(markdown).toContain("The series never reached the interval test");
      expect(markdown).toContain("No match was counted, so there is no margin to report.");
      expect(markdown).toContain("No match failed or was voided");
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });
});

describe("a pair that lost one of its two matches", () => {
  /**
   * A series directory in the runner's layout, one entry per pair: the seat
   * model X played in each of its two matches, the turns of that match which
   * compacted, and whether the match was voided for `tool_surface` — a log that
   * is on disk and carries the match-level pass, so it exists and is still not a
   * result. That is the shape the first real series left: seeds `479473028` and
   * `313966722` each lost one match to `tool_surface` and kept the other, and a
   * compaction line naming only the seed read as though it cited the match that
   * was voided.
   */
  const seriesOf = async (
    pairs: readonly {
      seed: number;
      matches: readonly { seat: Seat; compact: number[]; otherCompact?: number[]; voided?: boolean }[];
    }[],
  ): Promise<string> => {
    const where = await mkdtemp(join(tmpdir(), "no-dice-series-pair-"));
    await mkdir(join(where, "matches"), { recursive: true });
    for (const pair of pairs) {
      for (const match of pair.matches) {
        const log = logOf({
          seed: pair.seed,
          turns: 9,
          xSeat: match.seat,
          result: { type: "time", winner: match.seat, turn: 9, margin: 4 },
          trouble: [
            ...(match.voided === true ? [{ turn: 3, passed: "tool_surface" as const }] : []),
            ...match.compact.map((turn) => ({ turn, compacted: true, contextTokens: 0 })),
          ],
          otherCompacted: match.otherCompact ?? [],
        });
        await writeFile(
          join(where, "matches", basename(recordPathOf(pair.seed, match.seat))),
          `${JSON.stringify(log, null, 2)}\n`,
          "utf8",
        );
      }
    }
    await writeFile(
      join(where, "series.json"),
      `${JSON.stringify(
        {
          max_pairs: pairs.length,
          seeds: pairs.map((pair) => pair.seed),
          pairing: { a: X, b: OPPONENT },
          pairs: pairs.map((pair) => ({
            seed: pair.seed,
            matches: pair.matches.map((match) => ({
              seat: match.seat,
              path: recordPathOf(pair.seed, match.seat),
              status: "played",
              result: { type: "time", winner: match.seat, margin: 4 },
            })),
          })),
          state: { stop_reason: "max_pairs", stopped_early: false },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return where;
  };

  it("names the match each compaction turn came from, not only the pair's seed", async () => {
    const where = await seriesOf([
      {
        seed: 101,
        matches: [
          { seat: "A", compact: [6], voided: true },
          { seat: "B", compact: [4, 9], otherCompact: [3] },
        ],
      },
    ]);
    try {
      const pair = await seriesReport(where);
      expect(pair.counted).toBe(1);
      expect(pair.missing.matches.map((match) => [match.seed, match.seat, match.kind])).toEqual([
        [101, "A", "voided"],
      ]);

      const x = pair.models.find((model) => model.label === "marvin/subagent")!;
      // Both turns come from the seat-B match, and the row says so. The voided
      // seat-A match compacted on turn 6 as well; that turn is not in the
      // figures at all, because the match that logged it is not one.
      expect(x.metrics.context.compactionTurns).toEqual([
        { seed: 101, seat: "B", turn: 4 },
        { seed: 101, seat: "B", turn: 9 },
      ]);
      expect(x.metrics.context.unstatedTurns).toEqual([
        { seed: 101, seat: "B", turn: 4 },
        { seed: 101, seat: "B", turn: 9 },
      ]);
      // The per-turn rows name their match the same way, since they too span
      // more than one match of a pair.
      expect(x.metrics.context.byTurn.filter((sample) => sample.compacted)).toEqual([
        { seed: 101, seat: "B", turn: 4, tokens: null, compacted: true },
        { seed: 101, seat: "B", turn: 9, tokens: null, compacted: true },
      ]);

      const markdown = renderSeriesReportMarkdown(pair);
      expect(markdown).toContain(
        "Compaction turns: seed 101, marvin/subagent in seat B, turn 4; " +
          "seed 101, marvin/subagent in seat B, turn 9.",
      );
      // The same words the "Missing matches" list uses for the match it names.
      expect(markdown).toContain("seed `101`, marvin/subagent in seat A");

      // The seat travels with the model, not with the pair: the bot held the
      // other seat of the same match, and its row says so. A row that printed
      // model X's seat for every model would print seat B here.
      const bot = pair.models.find((model) => model.label === "bot:greedy")!;
      expect(bot.metrics.context.compactionTurns).toEqual([{ seed: 101, seat: "A", turn: 3 }]);
      expect(markdown).toContain("Compaction turns: seed 101, bot:greedy in seat A, turn 3.");
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });

  it("lists the turns in the order the record gives its matches", async () => {
    // The record lists seed 102 before 101. A report is a published figure, so
    // the line comes out in the record's order and not an order the report
    // invented: sorting it by seed would print a different report of one series
    // each time the matches were read in a different order.
    const where = await seriesOf([
      { seed: 102, matches: [{ seat: "A", compact: [5] }, { seat: "B", compact: [] }] },
      { seed: 101, matches: [{ seat: "A", compact: [] }, { seat: "B", compact: [7] }] },
    ]);
    try {
      const markdown = renderSeriesReportMarkdown(await seriesReport(where));
      expect(markdown).toContain(
        "Compaction turns: seed 102, marvin/subagent in seat A, turn 5; " +
          "seed 101, marvin/subagent in seat B, turn 7.",
      );
    } finally {
      await rm(where, { recursive: true, force: true });
    }
  });
});
describe("the markdown", () => {
  let markdown: string;
  beforeAll(() => {
    markdown = renderSeriesReportMarkdown(report);
  });

  it("names the pairing and says how many matches are missing, on its face", () => {
    expect(markdown).toContain("# Series report: marvin/subagent vs bot:greedy");
    expect(markdown).toContain("**5 counted**, **3 missing**");
    expect(markdown).toContain("**3 of the series' 8 matches are not in the figures above.**");
    expect(markdown).toContain("| tool_surface | failed, voided | 2 |");
  });

  it("prints the win rate with its 95% interval beside the 99% one it stopped on", () => {
    expect(markdown).toContain("| 3 | 1 | 1 | 5 | 70.0% |");
    const expected = wilson(3.5, 5, 1.96);
    expect(markdown).toContain(
      `${(expected.low * 100).toFixed(1)}% – ${(expected.high * 100).toFixed(1)}%`,
    );
    expect(markdown).toContain("The series stopped on its 99.0% interval, 25.1% – 93.4%");
    expect(markdown).toContain("which excludes 50%");
  });

  it("prints the margin with its interval, and knockouts as 93", () => {
    expect(markdown).toContain("A knockout counts as 93 points.");
    // 12 + 5 + 93 + 0 + 93 over five matches.
    expect(markdown).toContain("| 5 | 40.6 |");
  });

  it("prints the knockouts and the turns they happened on", () => {
    expect(markdown).toContain("2 knockouts, on turns 7, 15.");
    expect(markdown).toContain("| 102 | A | A | 7 | 40 |");
  });

  it("prints each model's rows split into turns 1-8, 9-17 and 18-25", () => {
    expect(markdown).toContain("|  | series | turns 1-8 | turns 9-17 | turns 18-25 |");
    expect(markdown).toContain("| tool errors | 5 | 1 | 1 | 3 |");
    expect(markdown).toContain("| turns | 97 | 39 | 34 | 24 |");
    // Every pass reason the format allows gets its own row, including the one a
    // seat that never took the prompt passes with.
    expect(markdown).toContain("| passed: prompt_timeout | 1 | 0 | 1 | 0 |");
    expect(markdown).toContain("Compaction turns: seed 101, marvin/subagent in seat A, turn 18.");
  });

  it("prints the seat split, which is the check on the board", () => {
    expect(markdown).toContain("## Seat effect");
    expect(markdown).toContain("| A | 2 | 0 | 0 | 2 | 100.0% |");
    expect(markdown).toContain("| B | 1 | 1 | 1 | 3 | 50.0% |");
  });

  it("prints no per-model win rate: the leaderboard reads the object, not this", () => {
    // The per-model section is brief §6.7's counts table. A model's win rate is
    // on the report once, under its own pairing, and the pooled rows the
    // leaderboard draws are read off the report object rather than off this
    // markdown — which is why adding those fields changes no line here.
    const perModel = markdown.slice(markdown.indexOf("## Per model"), markdown.indexOf("## Seat effect"));
    expect(perModel).not.toContain("win rate");
    expect(perModel).not.toContain("Wilson");
    expect(perModel).toContain("5 matches counted — 2 in seat A, 3 in seat B.");
  });
});

describe("renderSeriesReport", () => {
  it("writes the report beside the record it read", async () => {
    const written = await renderSeriesReport(dir);
    expect(written.path).toBe(join(dir, "report.md"));
    const onDisk = await readFile(join(dir, "report.md"), "utf8");
    expect(onDisk).toBe(written.markdown);
    expect(onDisk).toContain("# Series report: marvin/subagent vs bot:greedy");
    expect(written.report.counted).toBe(5);
  });
});
