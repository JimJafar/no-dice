/**
 * The header's numbers: the two scores, the names, the counter, and the three
 * segments of the score bar. The one number a log does not carry is what the
 * whole board is worth, so that is what most of this file checks — the mock-up's
 * 93 is golden-01's 79 playable hexes valued by `config.points`, and a log on a
 * smaller map or under other points has to move.
 *
 * What gets drawn — the classes, the flex of each segment, the order of the two
 * seats — is `render-header.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

import { boardTotal, headerView, scoreAt, seatName } from "./header.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import golden03 from "../fixtures/golden-03-knockout-by-B.json";
import golden04 from "../fixtures/golden-04-mirror-draw.json";

/** The first golden match, validated the way the viewer validates every log. */
const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** A copy of a log with whole top-level fields replaced, so each case changes one thing. */
function logWith(patch: Record<string, unknown>): MatchLog {
  return matchLogSchema.parse({ ...structuredClone(golden01), ...patch });
}

/**
 * The same match logged against a smaller map — the map's first `count` hexes,
 * with the cells of every frame trimmed to match, which is what `matchLogSchema`
 * requires of a board over a map. The scores stay as the log gives them, so only
 * the total the bar is drawn against moves.
 */
function onSmallerMap(count: number): MatchLog {
  const source = structuredClone(golden01) as Record<string, unknown>;
  const map = source.map as { terrain: string }[];
  const indexes = map.map((_, i) => i).slice(0, count);
  const trim = (cells: unknown[]) => indexes.map((i) => cells[i]);
  source.map = indexes.map((i) => map[i]);
  source.start = {
    ...(source.start as Record<string, unknown>),
    cells: trim((source.start as { cells: unknown[] }).cells),
  };
  source.turns = (source.turns as { after: Record<string, unknown> }[]).map((turn) => ({
    ...turn,
    after: { ...turn.after, cells: trim(turn.after.cells as unknown[]) },
  }));
  return matchLogSchema.parse(source);
}

describe("boardTotal", () => {
  it("values every playable hex of the map by config.points, and a blocked one by nothing", () => {
    // The mock-up's 93: 70 plain hexes and 2 Bases at 1, 7 Nodes at 3, 12 blocked
    // hexes worth nothing because nobody can hold them.
    expect(boardTotal(log)).toBe(93);
    expect(boardTotal(log)).toBe(70 * 1 + 2 * 1 + 7 * 3);
  });

  it("follows config.points rather than the rules' usual values", () => {
    // The same map with Nodes worth 5 is worth 14 more.
    const points = { plain: 1, base: 1, node: 5 };
    expect(boardTotal(logWith({ config: { ...log.config, points } }))).toBe(107);
  });

  it("follows the map rather than a constant, so a smaller map is worth less", () => {
    const smaller = onSmallerMap(84);
    expect(smaller.map).toHaveLength(84);
    // 64 plain, 2 Bases and 7 Nodes left on it, the last row and a half cut off.
    expect(boardTotal(smaller)).toBe(64 * 1 + 2 * 1 + 7 * 3);
    expect(boardTotal(smaller)).not.toBe(boardTotal(log));
  });
});

describe("seatName", () => {
  it("names a bot seat by its bot", () => {
    expect(seatName(log.players.A)).toBe("raider");
    expect(seatName(log.players.B)).toBe("striker");
  });

  it("names a pi seat by the model it was played with", () => {
    const players = {
      A: { kind: "pi", model: "marvin/subagent", thinking: "high", context_window: 200_000 },
      B: log.players.B,
    };
    expect(seatName(logWith({ players }).players.A)).toBe("marvin/subagent");
  });
});

describe("scoreAt", () => {
  it("opens on the start score at frame 0", () => {
    expect(scoreAt(log, 0)).toEqual(log.start.score);
    expect(scoreAt(log, 0)).toEqual({ A: 1, B: 1 });
  });

  it("reads the logged after-state of the frame it is asked for", () => {
    expect(scoreAt(log, TURN_11)).toEqual({ A: 43, B: 33 });
    expect(scoreAt(log, 25)).toEqual(log.result.score);
  });

  it("refuses a turn the log does not hold", () => {
    expect(() => scoreAt(log, 26)).toThrow(/turn 26/);
    expect(() => scoreAt(log, -1)).toThrow(/turn -1/);
  });
});

describe("headerView", () => {
  it("reads 43 and 33 at turn 11 of golden-01", () => {
    const view = headerView(log, TURN_11);
    expect(view.score).toEqual({ A: 43, B: 33 });
  });

  it("splits the bar into A's points, the points nobody is scoring, and B's", () => {
    const view = headerView(log, TURN_11);
    expect({ A: view.score.A, unscoring: view.unscoring, B: view.score.B }).toEqual({
      A: 43,
      unscoring: 17,
      B: 33,
    });
    // The middle segment is what supply costs: the five cut-off hexes of turn 11
    // are on the board and score nothing, and the neutral hexes score nothing too.
    expect(view.score.A + view.unscoring + view.score.B).toBe(view.total);
  });

  it("states the lead and how many of the total are not scoring", () => {
    expect(headerView(log, TURN_11).summary).toBe("A leads by 10. 17 of the 93 points are not scoring.");
  });

  it("says the scores are level rather than naming a leader when neither is ahead", () => {
    const draw = matchLogSchema.parse(golden04);
    // golden-04 ends 42 to 42, so 9 of the 93 points are held by nobody.
    expect(headerView(draw, 25).summary).toBe("The scores are level. 9 of the 93 points are not scoring.");
  });

  it("names the seat that is ahead, by however much it is ahead", () => {
    const knockout = matchLogSchema.parse(golden03);
    expect(headerView(knockout, 19).summary).toBe("B leads by 69. 24 of the 93 points are not scoring.");
  });

  it("counts the frame against config.turns, not against the turns the match played", () => {
    // golden-03 is a knockout at turn 19 of a 25-turn match.
    expect(headerView(log, TURN_11).counter).toBe("TURN 11 OF 25");
    expect(headerView(matchLogSchema.parse(golden03), 19).counter).toBe("TURN 19 OF 25");
    // Frame 0 is the start position, before any turn has been played.
    expect(headerView(log, 0).counter).toBe("TURN 0 OF 25");
  });

  it("names both seats from the log's players", () => {
    expect(headerView(log, TURN_11).names).toEqual({ A: "raider", B: "striker" });
  });

  it("keeps the three segments adding up to a total a different map gives it", () => {
    const smaller = headerView(onSmallerMap(84), TURN_11);
    expect(smaller.total).toBe(87);
    expect(smaller.score).toEqual({ A: 43, B: 33 });
    expect(smaller.unscoring).toBe(11);
    expect(smaller.score.A + smaller.unscoring + smaller.score.B).toBe(smaller.total);
    expect(smaller.summary).toBe("A leads by 10. 11 of the 87 points are not scoring.");
  });

  it("refuses a frame the log does not hold", () => {
    expect(() => headerView(log, 26)).toThrow(/turn 26/);
  });
});
