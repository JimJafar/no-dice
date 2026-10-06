/**
 * The rules' open questions, counted out of the match logs.
 *
 * Four fixtures, because the questions are about shapes a match may or may not
 * happen to produce:
 *
 * - **A hand-built 20-turn log** whose boards and scores are written out hex by
 *   hex, so every figure this module reports has an expected number a reader can
 *   count off the fixture: 10 flips, 2 of them from neutral, 9 Node owner
 *   changes, one Node ping-ponging and one not, two lead changes, a largest
 *   swing of 7 on turn 3, and a seat that re-scouts. The turn bands are covered
 *   too — turns 18-20 flip once a turn, which is the figure the rules' "about
 *   6.5 hexes a turn late on" is compared with.
 * - **Short logs** for the cases the long one cannot hold at once: a lead that
 *   changes through a level board (one change, not two), a match whose lead never
 *   changes (`finalChangeTurn` 0), and a Node that changes owner three times
 *   without ever doing it on consecutive turns (not ping-pong).
 * - **A real bot-versus-bot match**, played by `runMatch`, with every figure
 *   re-counted in this file by plain loops over the parsed log. That is the side
 *   that says the module agrees with what the runner actually writes.
 * - **A series directory on disk**: two matches that count, one voided by a pass,
 *   one whose seat failed and one pair whose logs never arrived, so the totals
 *   show the missing matches being left out rather than averaged as noughts.
 *
 * The real-log fixture imports the runner, which `@no-dice/stats` deliberately
 * does not depend on; the workspace root's devDependency is what resolves it, as
 * in `match-metrics.test.ts`.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog, Seat } from "@no-dice/log";
import { runMatch } from "@no-dice/runner/match";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { matchEvidence, renderSeriesEvidence, seriesEvidence } from "./rules-evidence.ts";
import type { MatchEvidence, SeriesEvidence } from "./rules-evidence.ts";

/** The fixture map: two Bases' worth of plain hexes, two Nodes, and a plain hex both sides can trade. */
const MAP = [
  { id: "A1", q: 0, r: 0, terrain: "plain" },
  { id: "B2", q: 1, r: 0, terrain: "node" },
  { id: "C3", q: 2, r: 0, terrain: "node" },
  { id: "D4", q: 3, r: 0, terrain: "base" },
  { id: "E5", q: 4, r: 0, terrain: "plain" },
];

/** One board as owner codes: 0 neutral, 1 A, 2 B — troops and garrison are not counted here. */
type Owners = readonly [number, number, number, number, number];

/** The same owners in the log's cell shape. */
const cellsOf = (owners: Owners): unknown[] => owners.map((owner) => [owner, 5, 0, 0]);

/** One turn of the fixture: the board after it, and the score after it. */
interface FixtureTurn {
  score: { A: number; B: number };
  owners: Owners;
  /** What each seat scouted on this turn, as hex labels. */
  scouts?: Partial<Record<Seat, string[]>>;
  /** A pass reason, which is what voids a whole match in the series reader. */
  passed?: string;
}

/**
 * The 20-turn fixture. Turns 6-17 repeat turn 5's board and score, so the bands
 * past turn 8 have turns in them that flip nothing, and turns 18-20 flip one hex
 * each. `B2` changes owner on turns 1, 3, 4, 5, 18, 19 and 20 — ping-pong; `C3`
 * only on turns 3 and 5 — not.
 */
const FIXTURE_TURNS: FixtureTurn[] = [
  { score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2], scouts: { A: ["B2", "C3"] } },
  { score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2], scouts: { A: ["B2"] } },
  { score: { A: 2, B: 6 }, owners: [1, 2, 1, 2, 2] },
  { score: { A: 2, B: 6 }, owners: [1, 1, 1, 2, 2] },
  { score: { A: 5, B: 3 }, owners: [1, 2, 2, 2, 1], scouts: { A: ["B2", "D4"] } },
  // Turns 6-17: nothing moves, so the middle band has turns that flip nothing.
  ...Array.from({ length: 12 }, (): FixtureTurn => ({ score: { A: 5, B: 3 }, owners: [1, 2, 2, 2, 1] })),
  // Turn 18: the seat scouts a hex it scouted earlier in the same turn.
  { score: { A: 5, B: 3 }, owners: [1, 1, 2, 2, 1], scouts: { A: ["A1", "A1"] } },
  { score: { A: 5, B: 3 }, owners: [1, 2, 2, 2, 1] },
  { score: { A: 5, B: 3 }, owners: [1, 1, 2, 2, 1] },
];

/** One seat's turn record, with noughts for everything the fixture does not name. */
const playerOf = (turn: FixtureTurn, seat: Seat): unknown => ({
  tool_calls: [],
  scouts: turn.scouts?.[seat] ?? [],
  rejected_submission: null,
  orders: [],
  wasted: [],
  intent: "",
  prediction: "",
  passed: turn.passed ?? null,
  notes_after: "",
  usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  cost_usd: 0,
  context_tokens: 0,
  compacted: false,
  wall_ms: 0,
});

/** A whole log the schema accepts, from a starting board and the turns that follow it. */
const logOf = (input: {
  start: { owners: Owners; score: { A: number; B: number } };
  turns: FixtureTurn[];
}): Record<string, unknown> => ({
  format: "salient-log/1",
  ruleset: "v0",
  engine_version: "0.1.0",
  created: "2026-10-06T00:00:00.000Z",
  seed: 11,
  config: {
    turns: input.turns.length,
    action_points: 6,
    start_troops: 5,
    base_production: 2,
    node_production: 1,
    node_garrison: 3,
    home_bonus: 1,
    points: { plain: 1, base: 1, node: 3 },
  },
  harness: {
    pi_version: null,
    context: "continuous",
    compaction: false,
    tool_call_cap: 12,
    simulate_cap: 3,
    resubmissions: 1,
    turn_timeout_s: 300,
    output_token_budget: null,
  },
  players: { A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "random" } },
  map: MAP,
  bases: { A: "A1", B: "D4" },
  start: { cells: cellsOf(input.start.owners), score: input.start.score },
  turns: input.turns.map((turn, i) => ({
    n: i + 1,
    players: { A: playerOf(turn, "A"), B: playerOf(turn, "B") },
    events: [],
    after: { cells: cellsOf(turn.owners), score: turn.score, troops: { A: 5, B: 5 } },
  })),
  result: {
    type: "time",
    winner: "A",
    turn: input.turns.length,
    score: input.turns.at(-1)!.score,
    margin: 2,
  },
});

const fixture = logOf({
  start: { owners: [1, 0, 0, 2, 2], score: { A: 1, B: 1 } },
  turns: FIXTURE_TURNS,
});

describe("a hand-built log", () => {
  const evidence: MatchEvidence = matchEvidence(fixture);

  it("counts the turns the lead changed, the largest swing and the turn of the last change", () => {
    // A starts level, goes ahead on turn 1 (not a change), loses it on turn 3 and
    // takes it back on turn 5.
    expect(evidence.turns).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(evidence.lead.changes).toBe(2);
    expect(evidence.lead.changeTurns).toEqual([3, 5]);
    expect(evidence.lead.finalChangeTurn).toBe(5);
    // The differential is 0, +3, +3, -4, -4, +2 and then stays at +2.
    expect(evidence.lead.swings.map((each) => each.count)).toEqual([
      3, 0, 7, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(evidence.lead.largestSwing).toEqual({ points: 7, turn: 3 });
  });

  it("counts the hex flips per turn, and the mean over turns 18-25", () => {
    expect(evidence.flips.perTurn).toEqual([
      { turn: 1, count: 1 },
      { turn: 3, count: 2 },
      { turn: 4, count: 1 },
      { turn: 5, count: 3 },
      { turn: 18, count: 1 },
      { turn: 19, count: 1 },
      { turn: 20, count: 1 },
    ]);
    expect(evidence.flips.total).toBe(10);
    expect(evidence.flips.mean).toBeCloseTo(10 / 20, 10);
    // The bands' means are over the turns the match played in them, which is what
    // "hexes a turn" means: turns 9-17 are played and flip nothing.
    expect(evidence.flips.byBand["1-8"]).toEqual({ turns: 8, total: 7, mean: 7 / 8 });
    expect(evidence.flips.byBand["9-17"]).toEqual({ turns: 9, total: 0, mean: 0 });
    expect(evidence.flips.byBand["18-25"]).toEqual({ turns: 3, total: 3, mean: 1 });
    expect(evidence.flips.lateMean).toBeCloseTo(1, 10);
  });

  it("counts Node hand changes and flags the Node that ping-pongs", () => {
    expect(evidence.nodes.perTurn).toEqual([
      { turn: 1, count: 1 },
      { turn: 3, count: 2 },
      { turn: 4, count: 1 },
      { turn: 5, count: 2 },
      { turn: 18, count: 1 },
      { turn: 19, count: 1 },
      { turn: 20, count: 1 },
    ]);
    expect(evidence.nodes.handChanges).toBe(9);
    expect(evidence.nodes.byBand["1-8"].total).toBe(6);
    expect(evidence.nodes.byBand["18-25"].total).toBe(3);
    expect(evidence.nodes.hexes).toEqual([
      { hex: "B2", turns: [1, 3, 4, 5, 18, 19, 20] },
      { hex: "C3", turns: [3, 5] },
    ]);
    expect(evidence.nodes.pingPong).toBe(true);
    expect(evidence.nodes.pingPongHexes).toEqual(["B2"]);
  });

  it("counts captures of neutral hexes per turn band", () => {
    expect(evidence.neutralCaptures.perTurn).toEqual([
      { turn: 1, count: 1 },
      { turn: 3, count: 1 },
    ]);
    expect(evidence.neutralCaptures.total).toBe(2);
    expect(evidence.neutralCaptures.byBand["1-8"]).toEqual({ turns: 8, total: 2, mean: 2 / 8 });
    expect(evidence.neutralCaptures.byBand["9-17"]).toEqual({ turns: 9, total: 0, mean: 0 });
    expect(evidence.neutralCaptures.byBand["18-25"]).toEqual({ turns: 3, total: 0, mean: 0 });
  });

  it("counts a seat's re-scouts, including a repeat inside one turn", () => {
    // Seat A scouted B2 on turns 1, 2 and 5, C3 on turn 1, D4 on turn 5 and A1
    // twice on turn 18: seven scouts, of which three were of a hex it had seen.
    expect(evidence.scouts.A).toEqual({ scouts: 7, reScouts: 3, distinct: 4 });
    expect(evidence.scouts.B).toEqual({ scouts: 0, reScouts: 0, distinct: 0 });
  });
});

describe("the cases the long fixture cannot hold", () => {
  it("counts a lead that changes through a level board as one change", () => {
    // A ahead, level, B ahead: the level board is not a lead, so the side ahead
    // changed once, on the turn B went in front.
    const evidence = matchEvidence(
      logOf({
        start: { owners: [1, 0, 0, 2, 2], score: { A: 2, B: 1 } },
        turns: [
          { score: { A: 1, B: 1 }, owners: [1, 0, 0, 2, 2] },
          { score: { A: 0, B: 3 }, owners: [1, 0, 0, 2, 2] },
          { score: { A: 0, B: 3 }, owners: [1, 0, 0, 2, 2] },
        ],
      }),
    );
    expect(evidence.lead.changes).toBe(1);
    expect(evidence.lead.changeTurns).toEqual([2]);
    expect(evidence.lead.finalChangeTurn).toBe(2);
    expect(evidence.lead.swings).toEqual([
      { turn: 1, count: 1 },
      { turn: 2, count: 3 },
      { turn: 3, count: 0 },
    ]);
  });

  it("reports no lead change as turn 0, and a first lead as no change", () => {
    // The match opens level and A goes ahead: nobody's lead changed.
    const evidence = matchEvidence(
      logOf({
        start: { owners: [1, 0, 0, 2, 2], score: { A: 0, B: 0 } },
        turns: [
          { score: { A: 3, B: 0 }, owners: [1, 0, 0, 2, 2] },
          { score: { A: 4, B: 0 }, owners: [1, 0, 0, 2, 2] },
        ],
      }),
    );
    expect(evidence.lead.changes).toBe(0);
    expect(evidence.lead.changeTurns).toEqual([]);
    expect(evidence.lead.finalChangeTurn).toBe(0);
    expect(evidence.lead.largestSwing).toEqual({ points: 3, turn: 1 });
  });

  it("does not flag a Node that changes owner three times on turns that are not consecutive", () => {
    // B2 changes owner on turns 1, 3 and 5: three changes, none of them back to
    // back, which is a capture and a recapture rather than the ping-pong.
    const evidence = matchEvidence(
      logOf({
        start: { owners: [1, 0, 0, 2, 2], score: { A: 1, B: 1 } },
        turns: [
          { score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2] },
          { score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2] },
          { score: { A: 4, B: 2 }, owners: [1, 2, 0, 2, 2] },
          { score: { A: 4, B: 2 }, owners: [1, 2, 0, 2, 2] },
          { score: { A: 4, B: 3 }, owners: [1, 1, 0, 2, 2] },
        ],
      }),
    );
    expect(evidence.nodes.hexes).toEqual([{ hex: "B2", turns: [1, 3, 5] }]);
    expect(evidence.nodes.handChanges).toBe(3);
    expect(evidence.nodes.pingPong).toBe(false);
    expect(evidence.nodes.pingPongHexes).toEqual([]);
    // Two consecutive changes on one Node are not ping-pong either: three turns
    // is the rule, and this Node has two.
    const two = matchEvidence(
      logOf({
        start: { owners: [1, 0, 0, 2, 2], score: { A: 1, B: 1 } },
        turns: [
          { score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2] },
          { score: { A: 4, B: 1 }, owners: [1, 2, 0, 2, 2] },
        ],
      }),
    );
    expect(two.nodes.hexes).toEqual([{ hex: "B2", turns: [1, 2] }]);
    expect(two.nodes.pingPong).toBe(false);
  });

  it("leaves the late bands without a mean when the match never got that late", () => {
    const evidence = matchEvidence(
      logOf({
        start: { owners: [1, 0, 0, 2, 2], score: { A: 1, B: 1 } },
        turns: [{ score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2] }],
      }),
    );
    expect(evidence.flips.byBand["1-8"]).toEqual({ turns: 1, total: 1, mean: 1 });
    expect(evidence.flips.byBand["9-17"]).toEqual({ turns: 0, total: 0, mean: null });
    expect(evidence.flips.byBand["18-25"]).toEqual({ turns: 0, total: 0, mean: null });
    expect(evidence.flips.lateMean).toBeNull();
    expect(evidence.flips.mean).toBe(1);
  });
});

describe("a real bot-versus-bot log", () => {
  let dir: string;
  let log: MatchLog;
  let evidence: MatchEvidence;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "no-dice-evidence-"));
    const { path } = await runMatch({
      out: join(dir, "135.json"),
      seed: 135,
      seats: { A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "random" } },
    });
    const json: unknown = JSON.parse(await readFile(path, "utf8"));
    log = matchLogSchema.parse(json);
    evidence = matchEvidence(json);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Every figure re-counted from the parsed log with plain loops, sharing no code with the module. */
  const recount = (): {
    changes: number;
    changeTurns: number[];
    largestSwing: { points: number; turn: number } | null;
    flips: number;
    flipsByBand: Record<string, number>;
    nodeChanges: number;
    neutralCaptures: number;
    scouts: Record<Seat, { scouts: number; reScouts: number; distinct: number }>;
  } => {
    const changeTurns: number[] = [];
    const flipsByBand = { "1-8": 0, "9-17": 0, "18-25": 0 };
    let ahead = log.start.score.A === log.start.score.B ? null : log.start.score.A > log.start.score.B ? "A" : "B";
    let differential = log.start.score.A - log.start.score.B;
    let largestSwing: { points: number; turn: number } | null = null;
    let flips = 0;
    let nodeChanges = 0;
    let neutralCaptures = 0;

    let previous = log.start.cells;
    for (const turn of log.turns) {
      const next = turn.after.score.A - turn.after.score.B;
      const swing = Math.abs(next - differential);
      if (largestSwing === null || swing > largestSwing.points) largestSwing = { points: swing, turn: turn.n };
      differential = next;
      const now = turn.after.score.A === turn.after.score.B ? null : turn.after.score.A > turn.after.score.B ? "A" : "B";
      if (now !== null) {
        if (ahead !== null && now !== ahead) changeTurns.push(turn.n);
        ahead = now;
      }
      const band = turn.n <= 8 ? "1-8" : turn.n <= 17 ? "9-17" : "18-25";
      for (let i = 0; i < turn.after.cells.length; i++) {
        if (previous[i]![0] === turn.after.cells[i]![0]) continue;
        flips += 1;
        flipsByBand[band] += 1;
        if (previous[i]![0] === 0) neutralCaptures += 1;
        if (log.map[i]!.terrain === "node") nodeChanges += 1;
      }
      previous = turn.after.cells;
    }

    const scouts = {} as Record<Seat, { scouts: number; reScouts: number; distinct: number }>;
    for (const seat of ["A", "B"] as const) {
      const seen = new Set<string>();
      let total = 0;
      let again = 0;
      for (const turn of log.turns) {
        for (const hex of turn.players[seat].scouts) {
          total += 1;
          if (seen.has(hex)) again += 1;
          else seen.add(hex);
        }
      }
      scouts[seat] = { scouts: total, reScouts: again, distinct: seen.size };
    }

    return {
      changes: changeTurns.length,
      changeTurns,
      largestSwing,
      flips,
      flipsByBand,
      nodeChanges,
      neutralCaptures,
      scouts,
    };
  };

  it("counts what the log holds", () => {
    const expected = recount();
    expect(log.turns).toHaveLength(25);
    expect(evidence.turns).toEqual(log.turns.map((turn) => turn.n));

    expect(evidence.lead.changes).toBe(expected.changes);
    expect(evidence.lead.changeTurns).toEqual(expected.changeTurns);
    expect(evidence.lead.finalChangeTurn).toBe(
      expected.changeTurns.length === 0 ? 0 : expected.changeTurns.at(-1)!,
    );
    expect(evidence.lead.largestSwing).toEqual(expected.largestSwing);

    expect(evidence.flips.total).toBe(expected.flips);
    for (const band of ["1-8", "9-17", "18-25"] as const) {
      expect(evidence.flips.byBand[band].total, band).toBe(expected.flipsByBand[band]);
    }
    expect(evidence.nodes.handChanges).toBe(expected.nodeChanges);
    expect(evidence.neutralCaptures.total).toBe(expected.neutralCaptures);
    expect(evidence.scouts).toEqual(expected.scouts);
  });

  it("reports a real match's figures as numbers a rules review can quote", () => {
    // A Greedy-versus-Random match does change the board: the rules' own figures
    // for bots come from matches like this one, so a zero here would mean the
    // counters are reading a board that is not there.
    expect(evidence.flips.total).toBeGreaterThan(0);
    expect(evidence.flips.lateMean).not.toBeNull();
    expect(evidence.lead.largestSwing!.points).toBeGreaterThan(0);
    expect(evidence.turns).toHaveLength(25);
    // The bands hold every turn of the match exactly once.
    const turns = ["1-8", "9-17", "18-25"].reduce(
      (sum, band) => sum + evidence.flips.byBand[band as "1-8" | "9-17" | "18-25"].turns,
      0,
    );
    expect(turns).toBe(25);
    expect(evidence.flips.total).toBe(
      evidence.flips.byBand["1-8"].total +
        evidence.flips.byBand["9-17"].total +
        evidence.flips.byBand["18-25"].total,
    );
  });

  it("refuses a source the log format does not describe", () => {
    expect(() => matchEvidence({ ...fixture, format: "salient-log/2" })).toThrow();
    expect(() => matchEvidence({ turns: [] })).toThrow();
  });
});

/**
 * A series fixture on disk: two matches that count, one voided by a pass, one
 * whose seat failed, and one pair whose logs never arrived. The figures of the
 * two counted matches are hand-counted below, and the missing four must not
 * average a nought into any of them.
 */
const SERIES_MATCH_A = logOf({
  start: { owners: [1, 0, 0, 2, 2], score: { A: 1, B: 1 } },
  turns: [
    { score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2], scouts: { A: ["B2", "C3"] } },
    { score: { A: 2, B: 6 }, owners: [1, 2, 1, 2, 2], scouts: { A: ["B2"] } },
    { score: { A: 2, B: 6 }, owners: [1, 2, 1, 2, 2] },
    { score: { A: 5, B: 3 }, owners: [1, 2, 2, 2, 1] },
  ],
});

/** X plays seat B in this one, and `B2` ping-pongs on turns 2, 3 and 4. */
const SERIES_MATCH_B = logOf({
  start: { owners: [1, 0, 0, 2, 2], score: { A: 1, B: 1 } },
  turns: [
    { score: { A: 1, B: 4 }, owners: [1, 0, 0, 2, 2], scouts: { B: ["C3"] } },
    { score: { A: 1, B: 4 }, owners: [1, 2, 0, 2, 2], scouts: { B: ["C3"] } },
    { score: { A: 3, B: 2 }, owners: [1, 1, 0, 2, 2], scouts: { B: ["C3"] } },
    { score: { A: 3, B: 2 }, owners: [2, 2, 0, 2, 2] },
  ],
});

/** A log whose pass reason voids the whole match, exactly as `series-report` treats it. */
const SERIES_MATCH_VOIDED = logOf({
  start: { owners: [1, 0, 0, 2, 2], score: { A: 1, B: 1 } },
  turns: [{ score: { A: 4, B: 1 }, owners: [1, 1, 0, 2, 2], passed: "tool_surface" }],
});

const playedRecord = (seat: Seat, name: string): Record<string, unknown> => ({
  seat,
  path: `matches/${name}`,
  status: "played",
  result: { type: "time", winner: "A", margin: 2 },
});

const failedRecord = (seat: Seat, name: string): Record<string, unknown> => ({
  seat,
  path: `matches/${name}`,
  status: "failed",
  error: "seat B: turn 2: model call failed",
});

const SERIES_RECORD = {
  format: "salient-series/1",
  ruleset: "v0",
  created: "2026-10-06T00:00:00.000Z",
  max_pairs: 3,
  seeds: [201, 202, 203],
  pairing: { a: { kind: "bot", bot: "greedy" }, b: { kind: "bot", bot: "random" } },
  pairs: [
    { seed: 201, matches: [playedRecord("A", "201-a.json"), playedRecord("B", "201-b.json")] },
    { seed: 202, matches: [playedRecord("A", "202-a.json"), failedRecord("B", "202-b.json")] },
    { seed: 203, matches: [playedRecord("A", "203-a.json"), playedRecord("B", "203-b.json")] },
  ],
  state: { stop_reason: "complete", stopped_early: false },
};

describe("over a series", () => {
  let dir: string;
  let evidence: SeriesEvidence;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "no-dice-evidence-series-"));
    await mkdir(join(dir, "matches"), { recursive: true });
    await writeFile(join(dir, "matches", "201-a.json"), JSON.stringify(SERIES_MATCH_A));
    await writeFile(join(dir, "matches", "201-b.json"), JSON.stringify(SERIES_MATCH_B));
    await writeFile(join(dir, "matches", "202-a.json"), JSON.stringify(SERIES_MATCH_VOIDED));
    await writeFile(join(dir, "series.json"), JSON.stringify(SERIES_RECORD));
    evidence = await seriesEvidence(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("counts the matches that count and lists the rest as missing", () => {
    expect(evidence.pairs).toBe(3);
    expect(evidence.matches).toBe(6);
    expect(evidence.counted).toBe(2);
    expect(evidence.missing.total).toBe(4);
    expect(evidence.missing.byReason.map((group) => [group.reason, group.count])).toEqual([
      ["the record names a log that is not on disk", 2],
      ["tool_surface", 1],
      ["seat B: turn 2: model call failed", 1],
    ]);
    expect(evidence.missing.byKind).toEqual({
      failed: 1,
      missing_log: 2,
      unreadable_log: 0,
      voided: 1,
    });
    expect(evidence.rows.map((row) => [row.seed, row.seat])).toEqual([
      [201, "A"],
      [201, "B"],
    ]);
    expect(evidence.rows[0]!.path).toBe(join(dir, "matches", "201-a.json"));
    expect(evidence.rows[0]!.players).toEqual({ A: "bot:greedy", B: "bot:random" });
  });

  it("totals the figures over the counted matches only", () => {
    // Match A: 2 lead changes, 5 flips, 2 neutral captures, 4 Node hand changes.
    // Match B: 1 lead change, 4 flips, 1 neutral capture, 3 Node hand changes.
    expect(evidence.turnCount).toBe(8);
    expect(evidence.totals).toEqual({
      leadChanges: 3,
      flips: 9,
      nodeHandChanges: 7,
      neutralCaptures: 3,
      scouts: 6,
      reScouts: 3,
      matchesWithLeadChange: 2,
      pingPongMatches: 1,
    });
  });

  it("takes the means over matches, and over the turns those matches played", () => {
    expect(evidence.means.perMatch.leadChanges).toBeCloseTo(1.5, 10);
    expect(evidence.means.perMatch.flips).toBeCloseTo(4.5, 10);
    expect(evidence.means.perMatch.nodeHandChanges).toBeCloseTo(3.5, 10);
    expect(evidence.means.perMatch.neutralCaptures).toBeCloseTo(1.5, 10);
    expect(evidence.means.perMatch.reScouts).toBeCloseTo(1.5, 10);
    // The two matches' largest swings are 7 (turn 2) and 4 (turn 3).
    expect(evidence.means.perMatch.largestSwing).toBeCloseTo(5.5, 10);
    expect(evidence.means.perMatch.maxLargestSwing).toBe(7);
    // The final lead changes came on turns 4 and 3.
    expect(evidence.means.perMatch.finalChangeTurn).toBeCloseTo(3.5, 10);
    expect(evidence.means.perTurn.flips).toBeCloseTo(9 / 8, 10);
    expect(evidence.means.perTurn.neutralCaptures).toBeCloseTo(3 / 8, 10);
    expect(evidence.means.perTurn.nodeHandChanges).toBeCloseTo(7 / 8, 10);
  });

  it("keeps the turn bands across the whole series", () => {
    expect(evidence.byBand.flips["1-8"]).toEqual({ turns: 8, total: 9, mean: 9 / 8 });
    // Neither match got past turn 4, so the late bands have no turns and no mean.
    expect(evidence.byBand.flips["18-25"]).toEqual({ turns: 0, total: 0, mean: null });
    expect(evidence.byBand.neutralCaptures["1-8"].total).toBe(3);
    expect(evidence.byBand.nodeHandChanges["1-8"].total).toBe(7);
  });

  it("lists the Nodes that ping-ponged, with the turns they changed owner on", () => {
    expect(evidence.pingPong.matches).toBe(1);
    expect(evidence.pingPong.nodes).toEqual([{ seed: 201, hex: "B2", turns: [2, 3, 4] }]);
  });

  it("groups the scouts by player, whichever seat each player sat in", () => {
    // Greedy scouted three hexes in one match and nothing in the other; Random
    // scouted the same hex three times in its one match.
    expect(evidence.scouts).toEqual([
      { label: "bot:greedy", matches: 2, scouts: 3, reScouts: 1, distinct: 2, reScoutsPerMatch: 0.5 },
      { label: "bot:random", matches: 2, scouts: 3, reScouts: 2, distinct: 1, reScoutsPerMatch: 1 },
    ]);
  });

  it("writes the evidence as markdown beside the record", async () => {
    const written = await renderSeriesEvidence(dir);
    expect(written.path).toBe(join(dir, "evidence.md"));
    expect(written.markdown).toBe(await readFile(join(dir, "evidence.md"), "utf8"));

    expect(written.markdown).toContain("# Rules evidence: bot:greedy vs bot:random");
    expect(written.markdown).toContain("3 pairs recorded, 6 matches: **2 counted**, **4 missing**.");
    // The two counted matches' rows, and no row for the matches that did not count.
    expect(written.markdown).toContain("| 201 | A | 4 | 2 | 7 (turn 2) | 4 | 5 | — | 4 | — | 2 |");
    expect(written.markdown).toContain("| 201 | B | 4 | 1 | 4 (turn 3) | 3 | 4 | — | 3 | B2 | 1 |");
    expect(written.markdown).not.toContain("| 202 |");
    expect(written.markdown).not.toContain("| 203 |");
    // The rules' own bot figures, beside what this series measured.
    expect(written.markdown).toContain("hexes flipped a turn late on (turns 18-25)");
    expect(written.markdown).toContain("| 6.5 | 1 to 2.4 | — |");
    expect(written.markdown).toContain("| 3.2 | 1.4 | 1.50 |");
    expect(written.markdown).toContain(
      "**1 of 2 counted matches** had a Node change owner on three or more turns",
    );
    expect(written.markdown).toContain("- seed `201`, hex `B2`, turns 2, 3, 4");
    expect(written.markdown).toContain("| bot:random | 2 | 3 | 2 | 1 | 1.00 |");
    expect(written.markdown).toContain("| the record names a log that is not on disk | missing_log | 2 |");
  });

  it("refuses a directory that is not a series", async () => {
    const empty = await mkdtemp(join(tmpdir(), "no-dice-evidence-not-a-series-"));
    try {
      await expect(seriesEvidence(empty)).rejects.toThrow(/is not there, so there is no series to report/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
