/**
 * The frame index and what a frame shows: the numbers a stepped, scrubbed or
 * paused frame has to get right, and the order a turn animates in. The fixtures
 * are the logs the browser is handed, so a frame here is the frame the page
 * draws — and golden-02, which is knocked out at turn 23 of a 25-turn match, is
 * what pins the last frame to the log rather than to `config.turns`.
 *
 * Nothing here waits or reads a clock: `tick()` is the timer, and the test steps
 * it, which is the whole reason the animation lives in the view-model rather
 * than in a `setTimeout`.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

import { cellsAt } from "./board.ts";
import {
  arrowsFor,
  clampFrame,
  frameView,
  lastFrame,
  outlinesFor,
  turnFrames,
  PHASES,
} from "./turns.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import golden02 from "../fixtures/golden-02-knockout-by-A.json";

const log = matchLogSchema.parse(golden01);
const knockout = matchLogSchema.parse(golden02);

/** The turn record the log holds for turn `n`. */
function record(log: MatchLog, n: number) {
  return log.turns.find((turn) => turn.n === n)!;
}

/** The same log with `seat`'s turn `n` marked as passed. */
function passed(log: MatchLog, n: number, seat: "A" | "B"): MatchLog {
  const copy = structuredClone(log);
  copy.turns.find((turn) => turn.n === n)!.players[seat].passed = "no_submission";
  return copy;
}

describe("the frame index", () => {
  it("runs from the start position to the last logged turn", () => {
    expect(lastFrame(log)).toBe(25);
    expect(clampFrame(log, -3)).toBe(0);
    expect(clampFrame(log, 999)).toBe(25);
    expect(clampFrame(log, 11)).toBe(11);
  });

  it("ends on the last turn the log holds, not on config.turns, for a knockout", () => {
    // golden-02 was played under a 25-turn config and knocked out at turn 23.
    expect(knockout.config.turns).toBe(25);
    expect(knockout.turns.at(-1)!.n).toBe(23);
    expect(lastFrame(knockout)).toBe(23);
    expect(clampFrame(knockout, 25)).toBe(23);
    // The last frame is a real logged turn, so it settles on that turn's board.
    const frame = frameView(knockout, 25);
    expect(frame.frame).toBe(23);
    expect(frame.board).toBe(23);
  });

  it("shows the start position at frame 0, with no turn to animate", () => {
    const frame = frameView(log, 0);
    expect(frame).toEqual({ frame: 0, phase: "settled", board: 0, arrows: [], outlines: [] });
    expect(cellsAt(log, frame.board)).toEqual(log.start.cells);
  });

  it("lands a stepped or scrubbed frame on the logged after-state of its turn", () => {
    const frames = turnFrames(log);

    frames.scrub(0);
    frames.stepForward();
    expect(frames.view().frame).toBe(1);
    expect(cellsAt(log, frames.view().board)).toEqual(log.turns[0].after.cells);

    frames.scrub(11);
    expect(frames.state()).toEqual({ frame: 11, last: 25, playing: false });
    expect(frames.view().phase).toBe("settled");
    expect(cellsAt(log, frames.view().board)).toEqual(record(log, 11).after.cells);

    frames.stepBack();
    expect(frames.view().frame).toBe(10);
    expect(cellsAt(log, frames.view().board)).toEqual(record(log, 10).after.cells);

    // Stepping off either end stops on the frame there rather than running past
    // the log: frame 0 is the start position and frame 25 the last turn.
    frames.scrub(-4);
    expect(frames.frame()).toBe(0);
    frames.scrub(40);
    expect(frames.frame()).toBe(25);
    expect(frames.view().board).toBe(25);
  });

  it("pauses on the logged frame rather than a half-drawn turn", () => {
    const frames = turnFrames(log);
    frames.scrub(10);
    frames.play();
    frames.tick(); // turn 11, `before`
    frames.tick(); // turn 11, `orders` — arrows up, board still turn 10's
    expect(frames.view().phase).toBe("orders");
    expect(frames.view().board).toBe(10);

    frames.pause();
    expect(frames.playing()).toBe(false);
    expect(frames.view().phase).toBe("settled");
    expect(frames.view().board).toBe(11);
    expect(cellsAt(log, frames.view().board)).toEqual(record(log, 11).after.cells);
  });
});

describe("a turn's arrows", () => {
  it("draws the twelve orders of golden-01 turn 11, A's then B's, in the log's order", () => {
    const arrows = arrowsFor(log, record(log, 11));
    const turn = record(log, 11);
    // What the log submitted, in the order the board draws it: A's six, then B's.
    const submitted = (["A", "B"] as const).flatMap((seat) =>
      turn.players[seat].orders.map((order) => `${seat} ${order.from}->${order.to} ${order.troops}`),
    );

    expect(arrows).toHaveLength(12);
    expect(
      arrows.map((arrow) => `${arrow.seat} ${arrow.from}->${arrow.to} ${arrow.troops}`),
    ).toEqual(submitted);
    // The mock-up's own first arrow: A moving 5 from F5 to F6, which on this
    // grid is down and to the right — the 60deg its markup rotates it by.
    expect(arrows[0]).toMatchObject({ seat: "A", from: "F5", to: "F6", troops: 5, angle: 60 });
    // And two of its B arrows: H6 to H5 is up and to the left, I6 to H6 straight left along a row.
    expect(arrows[6]).toMatchObject({ seat: "B", from: "H6", to: "H5", angle: -120 });
    expect(arrows[8]).toMatchObject({ seat: "B", from: "I6", to: "H6", angle: 180 });
  });

  it("stands each arrow on the edge its order crossed, at the map's own hex centres", () => {
    const at = new Map(log.map.map((hex) => [hex.id, hex]));
    for (const arrow of arrowsFor(log, record(log, 11))) {
      const from = at.get(arrow.from)!;
      const to = at.get(arrow.to)!;
      expect(arrow.x).toBeCloseTo((64.09 * (from.q + from.r / 2) + 64.09 * (to.q + to.r / 2)) / 2, 6);
      expect(arrow.y).toBeCloseTo((55.5 * from.r + 55.5 * to.r) / 2, 6);
    }
  });

  it("draws no arrows for a seat that passed, and leaves the other seat's alone", () => {
    const frame = frameView(passed(log, 11, "B"), 11);
    expect(frame.arrows).toHaveLength(6);
    expect(frame.arrows.every((arrow) => arrow.seat === "A")).toBe(true);

    // A turn whose both seats passed has no arrows at all, whatever its records
    // hold — a pass is the log saying no orders were played.
    const both = passed(passed(log, 11, "A"), 11, "B");
    expect(frameView(both, 11).arrows).toEqual([]);
  });

  it("leaves out an order naming a hex the map does not hold", () => {
    const copy = structuredClone(log);
    copy.turns.find((turn) => turn.n === 11)!.players.A.orders.push({ from: "B6", to: "Z9", troops: 1 });
    const arrows = arrowsFor(copy, record(copy, 11));
    expect(arrows).toHaveLength(12);
    expect(arrows.some((arrow) => arrow.to === "Z9")).toBe(false);
  });
});

describe("a turn's fight outlines", () => {
  it("outlines the hex a battle was fought on, once, even when it was then captured", () => {
    // Turn 11: a battle at F6 and then A's capture of it, and two captures that
    // fought nobody.
    expect(outlinesFor(log, record(log, 11))).toEqual([{ label: "F6", x: 0, y: 0 }]);
  });

  it("outlines both hexes a clash crossed, since it names an edge and not a hex", () => {
    const turn = record(knockout, 17);
    // One clash on the edge between G8 and H7, and battles at H6 and G7: every
    // hex any of them was fought on is outlined, in the order the engine saw
    // them, and no other hex is.
    const fought = turn.events.flatMap((event) =>
      event.type === "clash" ? [...event.between] : event.type === "battle" ? [event.at] : [],
    );
    expect(fought).toEqual(["G8", "H7", "H6", "G7"]);
    expect(outlinesFor(knockout, turn).map((outline) => outline.label)).toEqual(fought);
  });

  it("outlines nothing for a turn whose events name no fight", () => {
    const quiet = structuredClone(log);
    quiet.turns.find((turn) => turn.n === 11)!.events = [{ type: "capture", at: "F6", by: "A", from: "B", terrain: "node" }];
    expect(outlinesFor(quiet, record(quiet, 11))).toEqual([]);
  });
});

describe("the order a turn animates in", () => {
  it("steps through the four phases in the order brief §6.8 asks for", () => {
    expect(PHASES).toEqual(["before", "orders", "fight", "settled"]);

    const frames = turnFrames(log);
    frames.scrub(10);
    frames.play();

    // The turn starts on the board the previous turn left.
    frames.tick();
    expect(frames.view()).toMatchObject({ frame: 11, phase: "before", board: 10 });
    expect(frames.view().arrows).toEqual([]);
    expect(frames.view().outlines).toEqual([]);

    // The orders appear, over that same board.
    frames.tick();
    expect(frames.view().phase).toBe("orders");
    expect(frames.view().board).toBe(10);
    expect(frames.view().arrows).toHaveLength(12);
    expect(frames.view().outlines).toEqual([]);

    // Then the fight flashes, with the arrows still up.
    frames.tick();
    expect(frames.view().phase).toBe("fight");
    expect(frames.view().board).toBe(10);
    expect(frames.view().arrows).toHaveLength(12);
    expect(frames.view().outlines.map((outline) => outline.label)).toEqual(["F6"]);

    // Then the board settles to what the log says, arrows and outline still drawn.
    frames.tick();
    expect(frames.view().phase).toBe("settled");
    expect(frames.view().board).toBe(11);
    expect(frames.view().arrows).toHaveLength(12);
    expect(frames.view().outlines.map((outline) => outline.label)).toEqual(["F6"]);
  });

  it("settles the start position rather than animating it", () => {
    const frames = turnFrames(log);
    frames.scrub(0);
    frames.play();
    frames.tick();
    expect(frames.view().frame).toBe(1);
    expect(frames.view().phase).toBe("before");
    // Turn 1 animates from the start position.
    expect(frames.view().board).toBe(0);
  });

  it("advances a turn at a time under a stepped timer, and stops on the last logged turn", () => {
    const frames = turnFrames(knockout);
    frames.scrub(21);
    frames.play();

    // Four steps to settle turn 22, four more to settle turn 23.
    for (let i = 0; i < 8; i++) frames.tick();
    expect(frames.view().frame).toBe(23);
    expect(frames.view().phase).toBe("settled");

    // The log has nothing after turn 23, so autoplay ends there rather than
    // holding a frame the match never played.
    frames.tick();
    expect(frames.frame()).toBe(23);
    expect(frames.playing()).toBe(false);
    expect(frames.view().phase).toBe("settled");
    expect(frames.view().board).toBe(23);
  });

  it("does not move a frame that is not playing", () => {
    const frames = turnFrames(log);
    frames.scrub(11);
    for (let i = 0; i < 4; i++) frames.tick();
    expect(frames.view().frame).toBe(11);
    expect(frames.view().phase).toBe("settled");
  });
});
