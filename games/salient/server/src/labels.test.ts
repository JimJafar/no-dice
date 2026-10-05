/**
 * The translation between the engine's `"q,r"` keys and the board labels the
 * tools and the log use. Every hex on a real board round-trips through it, and
 * the labels that come back are the ones the log's own schema accepts.
 */
import { DEFAULT_CONFIG, generateMap } from "@no-dice/salient-engine";
import type { TurnEvent } from "@no-dice/salient-engine";
import { hexLabelSchema } from "@no-dice/runner/log";
import { describe, expect, it } from "vitest";

import { eventsToLog, keyToLabel, labelToCoord, labelToKey, ordersToEngine, wastedToLog } from "./labels";

describe("labels", () => {
  it("names every hex of a generated board, and reads the label back", () => {
    const state = generateMap(135, DEFAULT_CONFIG);
    const keys = Object.keys(state.hexes);
    expect(keys).toHaveLength(91);

    for (const key of keys) {
      const label = keyToLabel(key, DEFAULT_CONFIG.radius);
      expect(hexLabelSchema.safeParse(label).success, `${label} is not a log label`).toBe(true);
      expect(labelToKey(label, DEFAULT_CONFIG.radius), `${label} does not read back`).toBe(key);
      // The engine's own id for the hex is the label the server uses.
      expect(state.hexes[key].id).toBe(label);
    }
  });

  it("knows the bases and the centre by name", () => {
    expect(labelToKey("B6", 5)).toBe("-4,0");
    expect(labelToKey("F6", 5)).toBe("0,0");
    expect(labelToKey("J6", 5)).toBe("4,0");
    expect(labelToKey("A6", 5)).toBe("-5,0");
    expect(labelToKey("F1", 5)).toBe("0,-5");
    expect(labelToKey("A11", 5)).toBe("-5,5");
  });

  it("reads a label from the board it was drawn for", () => {
    // A radius-3 board is centred on D4, not F6.
    expect(labelToCoord("D4", 3)).toEqual({ q: 0, r: 0 });
    expect(keyToLabel("0,0", 3)).toBe("D4");
    expect(labelToKey("F6", 3)).toBeNull();
  });

  it("refuses a string that is not a hex label", () => {
    for (const notALabel of ["", "4,0", "a6", "F", "F0", "F000", "F 6", "6F"]) {
      expect(labelToKey(notALabel, 5), `${notALabel} is not a hex`).toBeNull();
    }
  });

  it("refuses a well-formed label that is off the board", () => {
    // Z9 is a column past the edge, A1 a corner the radius cuts off, F12 a row below it.
    for (const offBoard of ["Z9", "A1", "F12"]) {
      expect(labelToKey(offBoard, 5), `${offBoard} is off the board`).toBeNull();
    }
    // The coordinate is still readable, which is what lets the engine be the one
    // to refuse an order from there.
    expect(labelToCoord("Z9", 5)).toEqual({ q: 20, r: 3 });
  });

  it("turns submitted orders into engine orders", () => {
    expect(ordersToEngine([{ from: "B6", to: "C6", troops: 2 }], 5)).toEqual([
      { from: "-4,0", to: "-3,0", troops: 2 },
    ]);
  });

  it("names the hexes of an order the engine wasted", () => {
    expect(
      wastedToLog([{ order: { from: "-4,0", to: "-2,0", troops: 2 }, reason: "hexes are not adjacent" }], 5),
    ).toEqual([{ order: { from: "B6", to: "D6", troops: 2 }, reason: "hexes are not adjacent" }]);
  });

  it("names the hexes of every kind of event", () => {
    const events: TurnEvent[] = [
      { type: "clash", between: ["-3,0", "-2,0"], A: 3, B: 2 },
      { type: "battle", at: "0,0", A: 4, B: 1, owner: "B" },
      { type: "repelled", at: "4,0", by: "A", n: 3 },
      { type: "capture", at: "-3,0", by: "A", from: null, terrain: "plain" },
    ];

    expect(eventsToLog(events, 5)).toEqual([
      { type: "clash", between: ["C6", "D6"], A: 3, B: 2 },
      { type: "battle", at: "F6", A: 4, B: 1, owner: "B" },
      { type: "repelled", at: "J6", by: "A", n: 3 },
      { type: "capture", at: "C6", by: "A", from: null, terrain: "plain" },
    ]);
  });
});
