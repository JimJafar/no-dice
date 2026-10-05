/**
 * The `salient-log/1` format. The fixture is brief §7's example log, so the
 * format is pinned to the document the runner, the stats package and the viewer
 * all work from; the rejections are the mistakes that would otherwise be
 * written silently into a log too late to fix.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateMap, DEFAULT_CONFIG, boardCells, hexKey, score } from "@no-dice/salient-engine";
import type { Hex, HexKey } from "@no-dice/salient-engine";
import { matchLogSchema as publishedMatchLogSchema } from "@no-dice/log";
import { describe, expect, it } from "vitest";
import type { ZodIssue } from "zod";

import { cellsFor, cellsSchema, matchLogSchema } from "./log.ts";
import type { Cell } from "./log.ts";

/**
 * Brief §7's example, field for field. Two places are written out where the
 * brief abbreviates: player B's record, shown as `{}`, and the boards, shown
 * with a single cell against a single-hex map.
 */
const BRIEF_LOG = {
  format: "salient-log/1",
  ruleset: "v0",
  engine_version: "0.1.0",
  created: "2026-10-04T22:00:00Z",
  seed: 135,
  config: {
    turns: 25,
    action_points: 6,
    start_troops: 5,
    base_production: 2,
    node_production: 1,
    node_garrison: 3,
    home_bonus: 1,
    points: { plain: 1, base: 1, node: 3 },
  },
  harness: {
    pi_version: "1.0.x",
    context: "continuous",
    compaction: true,
    tool_call_cap: 12,
    simulate_cap: 3,
    resubmissions: 1,
    turn_timeout_s: 300,
    output_token_budget: null,
  },
  players: {
    A: { kind: "pi", model: "<provider>/<model-id>", thinking: "medium", context_window: 0 },
    B: { kind: "bot", bot: "greedy" },
  },
  map: [{ id: "F1", q: 0, r: -5, terrain: "plain" }],
  bases: { A: "B6", B: "J6" },
  start: { cells: [[0, 0, 0, 0]], score: { A: 1, B: 1 } },
  turns: [
    {
      n: 1,
      players: {
        A: {
          tool_calls: [{ tool: "get_state", args: {}, result: {}, error: false, ms: 0 }],
          scouts: [],
          rejected_submission: null,
          orders: [{ from: "B6", to: "C6", troops: 2 }],
          wasted: [],
          intent: "…",
          prediction: "…",
          passed: null,
          notes_after: "…",
          usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          cost_usd: 0,
          context_tokens: 0,
          compacted: false,
          wall_ms: 0,
        },
        B: {
          tool_calls: [{ tool: "get_state", args: {}, result: {}, error: false, ms: 0 }],
          scouts: [],
          rejected_submission: null,
          orders: [{ from: "J6", to: "I6", troops: 2 }],
          wasted: [],
          intent: "…",
          prediction: "…",
          passed: null,
          notes_after: "…",
          usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          cost_usd: 0,
          context_tokens: 0,
          compacted: false,
          wall_ms: 0,
        },
      },
      events: [{ type: "capture", at: "C6", by: "A", from: null, terrain: "plain" }],
      after: { cells: [[0, 0, 0, 0]], score: { A: 3, B: 3 }, troops: { A: 7, B: 7 } },
    },
  ],
  result: { type: "time", winner: "A", turn: 25, score: { A: 49, B: 41 }, margin: 8 },
};

/** A copy of the fixture with one field replaced, so each case changes only what it tests. */
function logWith(patch: Record<string, unknown>): unknown {
  return { ...structuredClone(BRIEF_LOG), ...patch };
}

/** The issues a rejected log is reported with, failing the test if it was accepted. */
function rejectionOf(log: unknown): ZodIssue[] {
  const parsed = matchLogSchema.safeParse(log);
  if (parsed.success) throw new Error("expected the log to be rejected, but it validated");
  return parsed.error.issues;
}

describe("salient-log/1", () => {
  it("accepts the log brief §7 shows, unchanged", () => {
    const parsed = matchLogSchema.parse(BRIEF_LOG);
    // Nothing was dropped, defaulted or rewritten on the way through.
    expect(parsed).toEqual(BRIEF_LOG);
  });

  it("is published as @no-dice/log, the package the viewer and the stats package import", () => {
    expect(publishedMatchLogSchema.safeParse(BRIEF_LOG).success).toBe(true);
  });

  it("rejects a board that does not line up with the map", () => {
    const start = rejectionOf(logWith({ start: { cells: [[0, 0, 0, 0], [0, 0, 0, 0]], score: { A: 1, B: 1 } } }));
    expect(start).toHaveLength(1);
    expect(start[0]?.path).toEqual(["start", "cells"]);
    expect(start[0]?.message).toBe("start.cells holds 2 cells for a map of 1 hexes");

    const turn = structuredClone(BRIEF_LOG);
    (turn.turns[0].after as { cells: number[][] }).cells.push([0, 0, 0, 0]);
    const issues = rejectionOf(turn);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["turns", 0, "after", "cells"]);
    expect(issues[0]?.message).toBe("turn 1 after.cells holds 2 cells for a map of 1 hexes");
  });

  it("rejects an event type the format does not have", () => {
    const turn = structuredClone(BRIEF_LOG);
    (turn.turns[0].events as unknown[])[0] = { type: "siege", at: "C6" };
    const issues = rejectionOf(turn);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["turns", 0, "events", 0, "type"]);
    expect(issues[0]?.message).toBe("Invalid discriminator value. Expected 'clash' | 'battle' | 'repelled' | 'capture'");
  });

  it("rejects a log with no format", () => {
    const log = structuredClone(BRIEF_LOG) as Record<string, unknown>;
    delete log.format;
    const issues = rejectionOf(log);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["format"]);
    expect(issues[0]?.message).toContain("salient-log/1");
  });

  it("rejects a hex named by the engine's key instead of its board label", () => {
    const turn = structuredClone(BRIEF_LOG);
    (turn.turns[0].players.A.orders[0] as Record<string, unknown>).from = "4,0";
    const issues = rejectionOf(turn);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["turns", 0, "players", "A", "orders", 0, "from"]);
    expect(issues[0]?.message).toBe("hexes are named by their board label, e.g. F6");

    // The same mistake in an event's hex, and in a scout.
    const event = structuredClone(BRIEF_LOG);
    (event.turns[0].events[0] as Record<string, unknown>).at = "0,0";
    expect(rejectionOf(event)[0]?.path).toEqual(["turns", 0, "events", 0, "at"]);

    const scout = structuredClone(BRIEF_LOG);
    (scout.turns[0].players.A.scouts as unknown[])[0] = "-4,0";
    expect(rejectionOf(scout)[0]?.path).toEqual(["turns", 0, "players", "A", "scouts", 0]);
  });

  it("rejects a field the format does not name", () => {
    const turn = structuredClone(BRIEF_LOG);
    (turn.turns[0].players.A as Record<string, unknown>).mood = "confident";
    const issues = rejectionOf(turn);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["turns", 0, "players", "A"]);
    expect(issues[0]?.message).toContain("mood");
  });

  it("rejects a cell that is not [owner, troops, garrison, cut_off]", () => {
    const short = rejectionOf(logWith({ start: { cells: [[0, 0, 0]], score: { A: 1, B: 1 } } }));
    expect(short).toHaveLength(1);
    expect(short[0]?.path).toEqual(["start", "cells", 0]);
    expect(short[0]?.message).toBe("a cell is [owner, troops, garrison, cut_off]");

    const owners = rejectionOf(logWith({ start: { cells: [[3, 0, 0, 0]], score: { A: 1, B: 1 } } }));
    expect(owners).toHaveLength(1);
    expect(owners[0]?.path).toEqual(["start", "cells", 0, 0]);
    expect(owners[0]?.message).toBe("owner is 0 for neutral, 1 for A, 2 for B");

    const cutOff = rejectionOf(logWith({ start: { cells: [[1, 2, 0, 2]], score: { A: 1, B: 1 } } }));
    expect(cutOff).toHaveLength(1);
    expect(cutOff[0]?.path).toEqual(["start", "cells", 0, 3]);
    expect(cutOff[0]?.message).toBe("cut_off is 1 for a hex its owner is out of supply on, otherwise 0");
  });
});

describe("cellsFor", () => {
  /** Seed 135 with A holding a wedge from its Base, plus a blob cut off behind E6. */
  function scenario(): { hexes: Hex[]; suppliedA: Set<HexKey>; suppliedB: Set<HexKey> } {
    const state = generateMap(135, DEFAULT_CONFIG);
    const own = (key: HexKey, seat: "A" | "B", troops: number): void => {
      state.hexes[key].owner = seat;
      state.hexes[key].troops = troops;
    };
    own("-4,0", "A", 5); // B6, A's Base
    own("-3,0", "A", 3); // C6
    own("-2,0", "A", 4); // D6, A's home Node
    own("0,-1", "A", 2); // F5, cut off from B6 by the blocked hex at E6
    own("0,0", "A", 2); // F6, the centre Node, cut off the same way
    own("4,0", "B", 5); // J6, B's Base

    const board = boardCells(DEFAULT_CONFIG.radius).map((cell) => state.hexes[hexKey(cell.q, cell.r)]);
    return {
      hexes: board,
      suppliedA: score(state, "A", DEFAULT_CONFIG).supplied,
      suppliedB: score(state, "B", DEFAULT_CONFIG).supplied,
    };
  }

  it("writes an engine board as log cells", () => {
    const { hexes, suppliedA, suppliedB } = scenario();
    const cells = cellsFor(hexes, suppliedA, suppliedB);

    expect(cells).toHaveLength(91);
    expect(cellsSchema.safeParse(cells).success).toBe(true);

    const at = (label: string): Cell => {
      const index = hexes.findIndex((hex) => hex.id === label);
      if (index < 0) throw new Error(`${label} is not on this map`);
      return cells[index];
    };

    // Owners are numbers, troops and garrison come across as they stand.
    expect(at("B6")).toEqual([1, 5, 0, 0]);
    expect(at("C6")).toEqual([1, 3, 0, 0]);
    expect(at("J6")).toEqual([2, 5, 0, 0]);

    // A Node neither seat holds is neutral, keeps its garrison, and is never cut off.
    const neutral = hexes.find((hex) => hex.owner === null && hex.terrain === "node");
    if (!neutral) throw new Error("this map has no neutral Node");
    expect(neutral.garrison).toBe(DEFAULT_CONFIG.nodeGarrison);
    expect(at(neutral.id)).toEqual([0, 0, DEFAULT_CONFIG.nodeGarrison, 0]);
  });

  it("marks a hex its owner holds out of supply", () => {
    const { hexes, suppliedA, suppliedB } = scenario();
    const cutOff = cellsFor(hexes, suppliedA, suppliedB)
      .map((cell, i) => `${hexes[i].id}:${cell[0]}:${cell[3]}`)
      .filter((cell) => cell.endsWith(":1"));

    // F5 and F6 belong to A but are cut from B6 by the blocked hex at E6; the
    // wedge from B6 to D6 is supplied, and so is B's Base.
    expect(cutOff).toEqual(["F5:1:1", "F6:1:1"]);
  });
});

describe("the log module stays browser-safe", () => {
  /** Every module the log module reaches, following its relative imports. */
  function moduleGraph(entry: string, seen = new Set<string>()): string[] {
    const here = resolve(entry);
    if (seen.has(here)) return [];
    seen.add(here);
    const source = readFileSync(here, "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        moduleGraph(resolve(dirname(here), specifier), seen);
      }
    }
    return [...seen];
  }

  it("imports nothing from node:* and nothing from the engine", () => {
    const entry = resolve(dirname(fileURLToPath(import.meta.url)), "log.ts");
    const graph = moduleGraph(entry);
    expect(graph).toEqual([entry]);

    for (const file of graph) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from\s+"node:/);
      expect(source).not.toMatch(/require\(/);
      expect(source).not.toMatch(/@no-dice\//);
    }
  });
});
