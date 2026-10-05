/**
 * The five fixtures the replay viewer reads.
 *
 * `scripts/golden-to-log.mjs` is the only thing that turns the prototype's
 * golden logs into `salient-log/1`, so this is the test that the viewer's input
 * is the five matches that were actually played: every fixture validates against
 * `matchLogSchema`, regenerating all five writes the committed bytes again, the
 * boards and scores in a fixture are the boards and scores the golden log
 * recorded, and the numbers brief §8's viewer test and the mock-ups were written
 * against — golden-01 at turn 11, the two knockouts — are the fixture's own
 * numbers rather than a claim in a comment.
 *
 * The fixtures are compared as bytes, not as parsed objects: a fixture that
 * drifts in formatting is a diff in every later viewer task's review, and the
 * point of the fixed `created` timestamp is that there is no such diff.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";

import {
  CREATED,
  GOLDEN_NAMES,
  convertGolden,
  intentSentence,
  parseArgs,
  predictionSentence,
  writeFixtures,
} from "./golden-to-log.mjs";

const GOLDEN_DIR = fileURLToPath(new URL("../games/salient/golden/", import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL("../games/salient/viewer/fixtures/", import.meta.url));

const goldenText = (name) => readFileSync(join(GOLDEN_DIR, name), "utf8");
const fixtureTextOf = (name) => readFileSync(join(FIXTURE_DIR, name), "utf8");

/** The committed fixture, parsed and checked against the log format. */
function fixtureOf(name) {
  return matchLogSchema.parse(JSON.parse(fixtureTextOf(name)));
}

/** The golden log a fixture was made from, in its own older shape. */
function goldenOf(name) {
  return JSON.parse(goldenText(name));
}

/** The turn a fixture records for turn number `n`. */
const turnOf = (log, n) => {
  const turn = log.turns.find((each) => each.n === n);
  if (turn === undefined) throw new Error(`the fixture has no turn ${String(n)}`);
  return turn;
};

/** The hexes a fixture's board marks `cut_off`, with the cell that says so. */
function cutOffCells(log, turn) {
  return log.map
    .map((hex, i) => ({ id: hex.id, cell: turn.after.cells[i] }))
    .filter((entry) => entry.cell[3] === 1);
}

/** How many Nodes `seat` owned on a fixture's board. */
function nodesHeld(log, turn, seat) {
  const owner = seat === "A" ? 1 : 2;
  return log.map.filter((hex, i) => hex.terrain === "node" && turn.after.cells[i][0] === owner).length;
}

const temp = mkdtempSync(join(tmpdir(), "no-dice-fixtures-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("the five fixtures", () => {
  it("are one per golden log, and every one is a salient-log/1 log", () => {
    expect(GOLDEN_NAMES).toEqual([
      "golden-01-time-win.json",
      "golden-02-knockout-by-A.json",
      "golden-03-knockout-by-B.json",
      "golden-04-mirror-draw.json",
      "golden-05-random-chaos.json",
    ]);
    for (const name of GOLDEN_NAMES) {
      const log = fixtureOf(name);
      expect(log.format, name).toBe("salient-log/1");
      expect(log.ruleset, name).toBe("v0");
      expect(log.turns, name).toHaveLength(goldenOf(name).turns.length);
    }
  });

  it("regenerates to the committed bytes, so the viewer's input does not drift", () => {
    const written = writeFixtures({ goldenDir: GOLDEN_DIR, outDir: temp });
    expect(written.map((path) => path.split("/").pop())).toEqual([...GOLDEN_NAMES]);
    for (const name of GOLDEN_NAMES) {
      expect(readFileSync(join(temp, name), "utf8"), `${name} is not what the script writes`).toBe(
        fixtureTextOf(name),
      );
    }
  });

  it("carries the header facts the golden logs never recorded", () => {
    for (const name of GOLDEN_NAMES) {
      const log = fixtureOf(name);
      const golden = goldenOf(name);
      expect(log.engine_version, name).toBe("0.1.0");
      // Fixed, so a regenerated fixture is byte-identical to the committed one.
      expect(log.created, name).toBe(CREATED);
      expect(log.seed, name).toBe(golden.seed);
      expect(log.bases, name).toEqual(golden.base);
      expect(log.harness, name).toEqual({
        pi_version: null,
        context: "continuous",
        compaction: false,
        tool_call_cap: 0,
        simulate_cap: 0,
        resubmissions: 0,
        turn_timeout_s: 0,
        // No Pi seat ran, so there was no output budget to enforce.
        output_token_budget: null,
      });
      expect(log.players, name).toEqual({
        A: { kind: "bot", bot: golden.players.A.bot },
        B: { kind: "bot", bot: golden.players.B.bot },
      });
      // The engine's constants, renamed to the log's spelling, with the log's
      // own turns and action points.
      expect(log.config, name).toEqual({
        turns: golden.cfg.turns,
        action_points: golden.cfg.ap,
        start_troops: 5,
        base_production: 2,
        node_production: 1,
        node_garrison: 3,
        home_bonus: 1,
        points: { plain: 1, base: 1, node: 3 },
      });
      expect(log.map, name).toEqual(golden.map.map((hex) => ({ id: hex.id, q: hex.q, r: hex.r, terrain: hex.t })));
    }
  });

  it("keeps every board and score the golden log recorded, turn by turn", () => {
    for (const name of GOLDEN_NAMES) {
      const log = fixtureOf(name);
      goldenOf(name).turns.forEach((logged, i) => {
        const turn = log.turns[i];
        expect(turn.n, `${name} turn ${logged.n}`).toBe(logged.n);
        turn.after.cells.forEach((cell, hex) => {
          // The fixture's fourth place is the supply the prototype never
          // recorded; its first three are the logged board.
          expect(cell.slice(0, 3), `${name} turn ${logged.n} hex ${log.map[hex].id}`).toEqual(
            logged.after.cells[hex].slice(0, 3),
          );
        });
        expect(turn.after.score, `${name} turn ${logged.n} score`).toEqual(logged.after.score);
      });
    }
  });

  it("refuses a log the engine does not replay the way the log recorded it", () => {
    const golden = goldenOf("golden-01-time-win.json");
    // One order's troop count changed: the engine plays a different turn 11, and
    // the log's own turn-11 board no longer describes the match.
    golden.turns[10].orders.A[0] = ["F5", "F6", 1];
    expect(() => convertGolden(JSON.stringify(golden), "tampered.json")).toThrow(
      /tampered\.json turn 11/,
    );
  });

  it("refuses a file that is already a salient-log/1 log", () => {
    expect(() => convertGolden(fixtureTextOf("golden-01-time-win.json"), "golden-01-time-win.json")).toThrow(
      /already a salient-log\/1 log/,
    );
  });
});

describe("golden-01 at turn 11, the frame the mock-ups show", () => {
  const log = fixtureOf("golden-01-time-win.json");
  const turn = turnOf(log, 11);

  it("scores 43 and 33 with 22 and 24 troops on the board", () => {
    expect(turn.after.score).toEqual({ A: 43, B: 33 });
    expect(turn.after.troops).toEqual({ A: 22, B: 24 });
    expect(nodesHeld(log, turn, "A")).toBe(2);
    expect(nodesHeld(log, turn, "B")).toBe(1);
  });

  it("marks exactly five hexes cut off, all of them seat B's", () => {
    const cut = cutOffCells(log, turn);
    expect(cut.map((entry) => entry.id)).toEqual(["F1", "G1", "H1", "H2", "G3"]);
    expect(cut.map((entry) => entry.cell[0])).toEqual([2, 2, 2, 2, 2]);
  });

  it("shows the fight at F6 and then seat A taking it", () => {
    expect(turn.events).toEqual([
      { type: "capture", at: "K2", by: "B", from: null, terrain: "plain" },
      { type: "capture", at: "G4", by: "A", from: "B", terrain: "plain" },
      { type: "battle", at: "F6", A: 5, B: 3, owner: "B" },
      { type: "capture", at: "F6", by: "A", from: "B", terrain: "node" },
    ]);
  });

  it("is played on the 91-hex map the board is worth 93 points on", () => {
    const terrain = (kind) => log.map.filter((hex) => hex.terrain === kind).length;
    expect(log.map).toHaveLength(91);
    expect(log.map.filter((hex) => hex.terrain !== "blocked")).toHaveLength(79);
    expect(terrain("node")).toBe(7);
    expect(terrain("base")).toBe(2);
    // 70 plain and playable hexes at 1, 7 Nodes at 3, 2 Bases at 1: the whole
    // board, which is what a knockout is recorded as.
    expect(terrain("plain") + terrain("node") * 3 + terrain("base")).toBe(93);
    expect(log.start.score).toEqual({ A: 1, B: 1 });
  });
});

describe("the results the fixtures record", () => {
  it("keeps both knockouts at 93 to 0, with an unsigned margin", () => {
    for (const [name, winner, loggedMargin] of [
      ["golden-02-knockout-by-A.json", "A", 93],
      ["golden-03-knockout-by-B.json", "B", -93],
    ]) {
      const log = fixtureOf(name);
      expect(log.result.type, name).toBe("knockout");
      expect(log.result.winner, name).toBe(winner);
      expect(log.result.score, name).toEqual(winner === "A" ? { A: 93, B: 0 } : { A: 0, B: 93 });
      // The golden log records this margin signed — golden-03 logs -93, which
      // reads as a loss for whoever logged it — and that is not what `session.ts`
      // writes or what the viewer should show.
      expect(goldenOf(name).result.margin, name).toBe(loggedMargin);
      expect(log.result.margin, name).toBe(Math.abs(loggedMargin));
    }
  });

  it("unsigned the margin of every other match too", () => {
    for (const name of GOLDEN_NAMES) {
      const { result } = fixtureOf(name);
      expect(result.margin, name).toBe(Math.abs(result.score.A - result.score.B));
      expect(result.margin, name).toBeGreaterThanOrEqual(0);
    }
    // golden-05 logs -11 for a match seat B won.
    expect(goldenOf("golden-05-random-chaos.json").result.margin).toBe(-11);
    expect(fixtureOf("golden-05-random-chaos.json").result.margin).toBe(11);
  });
});

describe("the turn records the golden logs cannot fill", () => {
  it("holds no harness figures, because no harness drove these bots", () => {
    for (const name of GOLDEN_NAMES) {
      for (const turn of fixtureOf(name).turns) {
        for (const seat of ["A", "B"]) {
          const record = turn.players[seat];
          expect([record.tool_calls, record.scouts, record.wasted], `${name} turn ${turn.n} ${seat}`).toEqual([
            [],
            [],
            [],
          ]);
          expect(record.passed, `${name} turn ${turn.n} ${seat}`).toBeNull();
          expect(record.rejected_submission, `${name} turn ${turn.n} ${seat}`).toBeNull();
          expect(record.notes_after, `${name} turn ${turn.n} ${seat}`).toBe("");
          expect(record.compacted, `${name} turn ${turn.n} ${seat}`).toBe(false);
          expect(record.usage, `${name} turn ${turn.n} ${seat}`).toEqual({
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
          });
          expect(record.cost_usd, `${name} turn ${turn.n} ${seat}`).toBe(0);
          expect(record.context_tokens, `${name} turn ${turn.n} ${seat}`).toBe(0);
          expect(record.wall_ms, `${name} turn ${turn.n} ${seat}`).toBe(0);
        }
      }
    }
  });

  it("carries the orders the log recorded, in the log's own order", () => {
    for (const name of GOLDEN_NAMES) {
      const log = fixtureOf(name);
      goldenOf(name).turns.forEach((logged, i) => {
        for (const seat of ["A", "B"]) {
          expect(log.turns[i].players[seat].orders, `${name} turn ${logged.n} ${seat}`).toEqual(
            logged.orders[seat].map(([from, to, troops]) => ({ from, to, troops })),
          );
        }
      });
    }
  });

  it("says what each seat did, in sentences built from those orders", () => {
    const turn = turnOf(fixtureOf("golden-01-time-win.json"), 11);
    expect(turn.players.A.orders.length).toBe(6);
    expect(turn.players.A.intent).toContain("6 orders");
    for (const order of turn.players.A.orders) {
      expect(turn.players.A.intent).toContain(`${String(order.troops)} from ${order.from} to ${order.to}`);
    }
    // The prediction names where seat A's largest move is going: 5 troops to F6,
    // which is the hex the fight at F6 happened on.
    expect(turn.players.A.prediction).toContain("5 troops");
    expect(turn.players.A.prediction).toContain("F6");
    expect(turn.players.B.prediction).toContain("4 troops");
    expect(turn.players.B.prediction).toContain("H5");
  });

  it("says so when a seat played no orders", () => {
    expect(intentSentence([])).toBe("Held position: no orders this turn.");
    expect(predictionSentence([], "B")).toBe("Nothing moved, so there is nothing to answer.");
    expect(intentSentence([{ from: "F5", to: "F6", troops: 5 }])).toBe("1 order: 5 from F5 to F6.");
  });
});

describe("the command line", () => {
  it("defaults to all five logs into the viewer's fixtures", () => {
    expect(parseArgs([])).toEqual({ command: { out: null, names: [] } });
  });

  it("takes an output directory and the logs to convert", () => {
    expect(parseArgs(["--out", "tmp/fx", "games/salient/golden/golden-01-time-win.json"])).toEqual({
      command: { out: "tmp/fx", names: ["games/salient/golden/golden-01-time-win.json"] },
    });
  });

  it("refuses a command line it cannot run", () => {
    expect(parseArgs(["--into", "tmp"]).error).toContain('unknown flag "--into"');
    expect(parseArgs(["--out"]).error).toContain("--out needs a value");
    expect(parseArgs(["--out", "a", "--out", "b"]).error).toContain("--out given twice");
    expect(parseArgs(["golden-01.txt"]).error).toContain("golden-01.txt");
  });
});
