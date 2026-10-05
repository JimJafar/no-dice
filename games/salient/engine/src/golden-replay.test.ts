/**
 * The five golden logs replayed end to end. Each log carries its own map, its
 * own start position, its own rules' constants and every turn's orders, so a
 * replay exercises the whole engine — validation, movement, the edge clash,
 * combat, garrisons, ownership, supply, production and the end of the match —
 * against a match that was actually played.
 *
 * `salient/docs/reference/replay-check.js` pins these same numbers through the
 * prototype; this is the shipped engine reproducing them. The logs are the
 * copies under `games/salient/golden`, so the tests read their own fixtures and
 * not the prototype's; `salient/docs/golden` keeps the originals.
 *
 * The logs are the older shape: no `format` field, `orders` as
 * `[from, to, troops]` triples, terrain under `t`, `cfg` as `{turns, ap,
 * radius}`, `map` as `{id, q, r, t}`, and `start.cells` and each turn's
 * `after.cells` as `[owner, troops, garrison]` with owner 0 neutral, 1 A, 2 B.
 */
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { generateMap } from "./board";
import { DEFAULT_CONFIG, type Config } from "./config";
import { hexKey } from "./hex";
import { resolveTurn } from "./resolve";
import { score } from "./supply";
import type { Hex, HexKey, MatchState, Order, Seat, Terrain, TurnEvent } from "./types";

/** The five matches, in the order they are numbered. */
const LOG_NAMES = [
  "golden-01-time-win.json",
  "golden-02-knockout-by-A.json",
  "golden-03-knockout-by-B.json",
  "golden-04-mirror-draw.json",
  "golden-05-random-chaos.json",
] as const;

const GOLDEN_DIR = new URL("../../golden/", import.meta.url);
const ORIGINAL_DIR = new URL("../../../../salient/docs/golden/", import.meta.url);

/** A hex as a log writes it: board label, coordinates, terrain under `t`. */
interface GoldenHex {
  id: string;
  q: number;
  r: number;
  t: Terrain;
}

/** One hex of a logged board: `[owner, troops, garrison]`, owner 0 neutral, 1 A, 2 B. */
type GoldenCell = [number, number, number, ...number[]];

/** One logged order: `[from, to, troops]` by board label. */
type GoldenOrder = [string, string, number];

interface GoldenTurn {
  n: number;
  orders: Record<Seat, GoldenOrder[]>;
  after: { cells: GoldenCell[]; score: Record<Seat, number> };
}

interface GoldenLog {
  seed: number;
  cfg: { turns: number; ap: number; radius: number };
  map: GoldenHex[];
  base: Record<Seat, string>;
  start: { cells: GoldenCell[] };
  turns: GoldenTurn[];
  result: { type: string; winner: Seat | null; turn: number; score: Record<Seat, number> };
}

/** A log plus the `"q,r"` key each of its board labels names. */
interface Golden {
  name: string;
  log: GoldenLog;
  key: Record<string, HexKey>;
}

const SEAT_BY_OWNER: readonly (Seat | null)[] = [null, "A", "B"];

const load = (name: string): GoldenLog =>
  JSON.parse(readFileSync(new URL(name, GOLDEN_DIR), "utf8")) as GoldenLog;

const logs = new Map<string, Golden>();

/** The log by name, read once: nothing here changes what it holds. */
function goldenOf(name: string): Golden {
  const cached = logs.get(name);
  if (cached !== undefined) return cached;
  const log = load(name);
  const key: Record<string, HexKey> = {};
  for (const hex of log.map) key[hex.id] = hexKey(hex.q, hex.r);
  const golden: Golden = { name, log, key };
  logs.set(name, golden);
  return golden;
}

/** The match's own constants: the log names turns, action points and radius. */
const configOf = (log: GoldenLog): Config => ({
  ...DEFAULT_CONFIG,
  radius: log.cfg.radius,
  turns: log.cfg.turns,
  actionPoints: log.cfg.ap,
});

/** The board the log starts from: its map, its start position, its seeds. */
function startState(golden: Golden): MatchState {
  const hexes: Record<HexKey, Hex> = {};
  golden.log.map.forEach((hex, i) => {
    const cell = golden.log.start.cells[i];
    hexes[golden.key[hex.id]] = {
      id: hex.id,
      q: hex.q,
      r: hex.r,
      terrain: hex.t,
      owner: SEAT_BY_OWNER[cell[0]] ?? null,
      troops: cell[1],
      garrison: cell[2],
    };
  });
  return {
    turn: 1,
    seed: golden.log.seed,
    hexes,
    base: { A: golden.key[golden.log.base.A], B: golden.key[golden.log.base.B] },
    over: false,
    result: null,
  };
}

const ordersOf = (golden: Golden, list: readonly GoldenOrder[]): Order[] =>
  list.map(([from, to, troops]) => ({ from: golden.key[from], to: golden.key[to], troops }));

/** The board as one string per hex, in the order the log lists its hexes. */
function boardOf(golden: Golden, state: MatchState): string[] {
  return golden.log.map.map((hex) => {
    const at = state.hexes[golden.key[hex.id]];
    return `${hex.id} ${at.owner ?? "-"} ${at.troops} ${at.garrison}`;
  });
}

/** The same strings for a board as the log wrote it. */
function loggedBoard(golden: Golden, cells: readonly GoldenCell[]): string[] {
  return cells.map(
    (cell, i) => `${golden.log.map[i].id} ${SEAT_BY_OWNER[cell[0]] ?? "-"} ${cell[1]} ${cell[2]}`,
  );
}

interface ReplayTurn {
  /** The turn counter the engine had when it resolved this turn. */
  turn: number;
  /** The whole board as it stands for the next turn, result included. */
  state: MatchState;
  /** The same board as one string per hex, in the log's own order. */
  board: string[];
  /** Both seats' points after the turn, by the supply flood fill. */
  score: Record<Seat, number>;
  /** What the turn did, in the order the engine saw it. */
  events: TurnEvent[];
  over: boolean;
  /** True when `resolveTurn` left the state it was handed exactly as it found it. */
  inputUntouched: boolean;
}

/**
 * Play a logged match from `state`, one turn at a time, with no scouting: the
 * logs were played with every action point spent on orders. One entry per
 * logged turn, the last of them holding the end of the match.
 */
function replay(golden: Golden, state: MatchState): ReplayTurn[] {
  const config = configOf(golden.log);
  const turns: ReplayTurn[] = [];
  for (const logged of golden.log.turns) {
    const before = JSON.stringify(state);
    const outcome = resolveTurn(
      state,
      { A: ordersOf(golden, logged.orders.A), B: ordersOf(golden, logged.orders.B) },
      {},
      config,
    );
    turns.push({
      turn: state.turn,
      state: outcome.state,
      board: boardOf(golden, outcome.state),
      score: {
        A: score(outcome.state, "A", config).points,
        B: score(outcome.state, "B", config).points,
      },
      events: outcome.events,
      over: outcome.state.over,
      inputUntouched: JSON.stringify(state) === before,
    });
    state = outcome.state;
  }
  return turns;
}

const replays = new Map<string, ReplayTurn[]>();

/** The log replayed from the map it carries, once per run: the engine is pure. */
function replayOf(name: string): ReplayTurn[] {
  const cached = replays.get(name);
  if (cached !== undefined) return cached;
  const golden = goldenOf(name);
  const run = replay(golden, startState(golden));
  replays.set(name, run);
  return run;
}

/** How many of `seat`'s hexes its own Base cannot reach. */
function cutOffHexes(state: MatchState, seat: Seat, config: Config): number {
  const supplied = score(state, seat, config).supplied;
  return Object.values(state.hexes).filter(
    (hex) => hex.owner === seat && !supplied.has(hexKey(hex.q, hex.r)),
  ).length;
}

describe("the golden logs", () => {
  it("are the five matches the prototype played, and are copies of the originals", () => {
    const found = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort();
    expect(found).toEqual([...LOG_NAMES]);
    for (const name of LOG_NAMES) {
      expect(readFileSync(new URL(name, GOLDEN_DIR), "utf8"), `${name} differs from the original`).toBe(
        readFileSync(new URL(name, ORIGINAL_DIR), "utf8"),
      );
    }
  });

  it("cover a time win, a knockout each way, a mirror draw and a one-sided time win", () => {
    const played = LOG_NAMES.map((name) => {
      const log = goldenOf(name).log;
      return [
        log.seed,
        log.turns.length,
        log.result.type,
        log.result.winner,
        log.result.score.A,
        log.result.score.B,
      ];
    });
    expect(played).toEqual([
      [135, 25, "time", "A", 49, 41],
      [92, 23, "knockout", "A", 93, 0],
      [108, 19, "knockout", "B", 0, 93],
      [7, 25, "time", null, 42, 42],
      [189, 25, "time", "B", 25, 36],
    ]);
  });

  for (const name of LOG_NAMES) {
    describe(name, () => {
      it("reproduces every logged board and both logged scores, turn by turn", () => {
        const golden = goldenOf(name);
        const run = replayOf(name);
        expect(run).toHaveLength(golden.log.turns.length);
        golden.log.turns.forEach((logged, i) => {
          expect(run[i].turn, `${name} turn ${logged.n}`).toBe(logged.n);
          expect(run[i].board, `${name} turn ${logged.n} board`).toEqual(
            loggedBoard(golden, logged.after.cells),
          );
          expect(run[i].score, `${name} turn ${logged.n} score`).toEqual(logged.after.score);
        });
      });

      it("ends on the logged turn with the logged result", () => {
        const log = goldenOf(name).log;
        const run = replayOf(name);
        const last = run[run.length - 1];
        // The match ends on the last logged turn, and on no turn before it.
        expect(run.slice(0, -1).every((turn) => !turn.over), `${name} ended too early`).toBe(true);
        expect(last.over).toBe(true);
        expect(last.state.result).toEqual({
          type: log.result.type,
          winner: log.result.winner,
          turn: log.result.turn,
          score: log.result.score,
        });
      });
    });
  }
});

describe("what the golden logs exercise", () => {
  it("cuts hexes off from their Base in the time win, on both sides of the board", () => {
    const golden = goldenOf("golden-01-time-win.json");
    const config = configOf(golden.log);
    const run = replayOf(golden.name);
    // How many of each seat's hexes its own Base cannot reach, turn by turn.
    const outOfSupply = (seat: Seat): number[] => run.map((turn) => cutOffHexes(turn.state, seat, config));

    // Turn 11 is the frame the spectator mock-up shows: 43 to 33, with five of
    // seat B's hexes out of reach of its own Base.
    expect(run[10].score).toEqual({ A: 43, B: 33 });
    expect(outOfSupply("B")[10]).toBe(5);
    // The cut is not one-sided, and a cut region comes back into the score once
    // it is reconnected.
    expect(Math.max(...outOfSupply("A"))).toBeGreaterThan(0);
    expect(outOfSupply("B")[15]).toBe(0);
  });

  it("ends the two knockouts by taking a Base, recorded as the whole board", () => {
    const knockouts: readonly [string, Seat][] = [
      ["golden-02-knockout-by-A.json", "A"],
      ["golden-03-knockout-by-B.json", "B"],
    ];
    for (const [name, winner] of knockouts) {
      const golden = goldenOf(name);
      const run = replayOf(name);
      const last = run[run.length - 1];
      const loser = winner === "A" ? "B" : "A";
      const base = last.state.base;
      // The seat that lost its Base no longer owns it; the winner still does.
      expect(last.state.hexes[base[loser]].owner).toBe(winner);
      expect(last.state.hexes[base[winner]].owner).toBe(winner);
      expect(last.state.result?.type).toBe("knockout");
      // The winner is recorded as every point on the board, the loser as none.
      expect(last.state.result?.score).toEqual(golden.log.result.score);
      expect(golden.log.result.score).toEqual(winner === "A" ? { A: 93, B: 0 } : { A: 0, B: 93 });
    }
  });

  it("keeps both seats level all the way through the mirror draw", () => {
    const name = "golden-04-mirror-draw.json";
    const run = replayOf(name);
    const last = run[run.length - 1];
    for (const turn of run) {
      expect(turn.score.A, `${name} turn ${turn.turn}`).toBe(turn.score.B);
    }
    expect(last.score).toEqual({ A: 42, B: 42 });
    expect(last.state.result?.winner).toBe(null);
  });
});

describe("determinism", () => {
  it("replays a log to byte-identical output, run after run", () => {
    const golden = goldenOf("golden-01-time-win.json");
    const first = JSON.stringify(replay(golden, startState(golden)));
    const second = JSON.stringify(replay(golden, startState(golden)));
    // The trace is the whole match: every turn's board, scores, events, result.
    expect(JSON.parse(first), `${golden.name} trace is not the whole match`).toHaveLength(
      golden.log.turns.length,
    );
    expect(second).toBe(first);
  });

  it("plays a seeded match twice to the same match, from the map its seed generates", () => {
    for (const name of LOG_NAMES) {
      const golden = goldenOf(name);
      const config = configOf(golden.log);
      // The log's own map and start position are what its seed generates.
      const seeded = generateMap(golden.log.seed, config);
      expect(boardOf(golden, seeded), `${name} map is not its seed's map`).toEqual(
        loggedBoard(golden, golden.log.start.cells),
      );
      const first = JSON.stringify(replay(golden, seeded));
      const second = JSON.stringify(replay(golden, generateMap(golden.log.seed, config)));
      expect(second, `${name} replayed from its seed twice`).toBe(first);
      expect(first, `${name} replayed from its seed`).toBe(JSON.stringify(replayOf(name)));
    }
  });

  it("leaves the state it resolved untouched, on every turn of every log", () => {
    for (const name of LOG_NAMES) {
      const mutated = replayOf(name).filter((turn) => !turn.inputUntouched).map((turn) => turn.turn);
      expect(mutated, `${name} resolved a turn by changing the state it was handed`).toEqual([]);
    }
  });
});
