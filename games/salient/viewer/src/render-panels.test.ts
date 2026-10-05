// @vitest-environment happy-dom
/**
 * What the panel decides about the DOM: which numbers go in the three boxes, how
 * a tool call is drawn and marked when it errored, which seat gets a context
 * meter and which does not, and what a marked turn says about itself. The
 * numbers themselves are `panels.test.ts`'s, so this file never recomputes one —
 * it asks whether the panel the log describes is the panel that gets drawn, in
 * the mock-up's shape (`salient/docs/mockups/spectator-view.html`).
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { Seat } from "@no-dice/log";

import { panelsView } from "./panels.ts";
import { renderPanel } from "./render-panels.ts";
import golden01 from "../fixtures/golden-01-time-win.json";

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** One seat's panel, drawn into a fresh element. */
function panel(logJson: unknown, frame: number, seat: Seat): HTMLElement {
  const el = document.createElement("div");
  renderPanel(el, panelsView(matchLogSchema.parse(logJson), frame)[seat]);
  return el;
}

/** The three small boxes, in the order the mock-up draws them. */
function boxes(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>(".boxes .box .value")].map((value) => value.textContent ?? "");
}

/** The labels of the panel's blocks, top to bottom. */
function labels(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>(".label")].map((label) => label.textContent ?? "");
}

/** The trace's calls, in the order they are drawn. */
function calls(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(".calls .call")];
}

/** The panel's mark chips, in the order they are drawn. */
function chips(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>(".marks .chip")].map((chip) => chip.textContent ?? "");
}

/** golden-01 with turn 11's A record edited: five calls, one refused, one scout. */
function tracedLog(): unknown {
  const source = structuredClone(golden01) as Record<string, unknown>;
  const turns = source.turns as { n: number; players: Record<Seat, Record<string, unknown>> }[];
  const player = turns.find((turn) => turn.n === TURN_11)!.players.A;
  player.tool_calls = [
    { tool: "get_state", args: {}, result: { score: { A: 33, B: 43 } }, error: false, ms: 4 },
    { tool: "scout", args: { hex: "F6" }, result: { hex: "F6" }, error: false, ms: 6 },
    { tool: "scout", args: { hex: "G4" }, result: { error: "no action points left" }, error: true, ms: 250 },
    { tool: "simulate", args: { orders: [{ from: "F5", to: "F6", troops: 5 }] }, result: {}, error: false, ms: 12 },
    { tool: "submit_orders", args: { orders: [], intent: "x", prediction: "y" }, result: {}, error: false, ms: 3 },
  ];
  player.scouts = ["F6"];
  return source;
}

/** golden-01 with turn 11 marked: A refused and compacted, B passing. */
function markedLog(): unknown {
  const source = structuredClone(golden01) as Record<string, unknown>;
  const turns = source.turns as { n: number; players: Record<Seat, Record<string, unknown>> }[];
  const turn = turns.find((t) => t.n === TURN_11)!;
  turn.players.A.rejected_submission = {
    orders: [{ from: "F5", to: "F7", troops: 2 }],
    wasted: [{ order: { from: "F5", to: "F7", troops: 2 }, reason: "hexes are not adjacent" }],
  };
  turn.players.A.compacted = true;
  turn.players.B.passed = "timeout";
  return source;
}

/** golden-01 with A played by a model in a 131,072-token window. */
function modelLog(): unknown {
  const source = structuredClone(golden01) as Record<string, unknown>;
  const players = source.players as Record<Seat, Record<string, unknown>>;
  players.A = { kind: "pi", model: "marvin/subagent", thinking: "medium", context_window: 131_072 };
  const turns = source.turns as { n: number; players: Record<Seat, Record<string, unknown>> }[];
  turns.find((turn) => turn.n === TURN_11)!.players.A.context_tokens = 32_768;
  return source;
}

describe("the panel of the frame the mock-ups drew", () => {
  it("draws A's three boxes as 22 troops, 2 Nodes held and 6 of 6 actions", () => {
    expect(boxes(panel(golden01, TURN_11, "A"))).toEqual(["22", "2", "6 of 6"]);
  });

  it("draws B's three boxes as 24 troops, 1 Node held and 6 of 6 actions", () => {
    expect(boxes(panel(golden01, TURN_11, "B"))).toEqual(["24", "1", "6 of 6"]);
  });

  it("shows the intent and the prediction as sentences", () => {
    const el = panel(golden01, TURN_11, "A");
    expect(el.querySelector(".intent .text")?.textContent).toContain("5 from F5 to F6");
    expect(el.querySelector(".prediction .text")?.textContent).toBe(
      "The largest move, 5 troops, heads for F6: expect B to answer there.",
    );
    // The mock-up's order: intent, prediction, tool calls, then the boxes.
    expect(labels(el)).toEqual(["INTENT", "PREDICTION", "TOOL CALLS THIS TURN", "TROOPS", "NODES HELD", "ACTIONS"]);
  });

  it("says which seat the panel belongs to and what drives it", () => {
    const el = panel(golden01, TURN_11, "B");
    expect(el.dataset.seat).toBe("B");
    expect(el.className).toBe("panel panel-b");
    expect(el.querySelector(".panel-seat")?.textContent).toBe("PLAYER B");
    expect(el.querySelector(".panel-name")?.textContent).toBe("striker");
  });

  it("says the scripted bots made no tool calls, where the mock-up puts its placeholder", () => {
    const el = panel(golden01, TURN_11, "A");
    expect(calls(el)).toHaveLength(0);
    expect(el.querySelector(".trace")?.textContent).toContain("The log holds no tool calls for this turn.");
  });

  it("shows the start position with its boxes and no sentences", () => {
    const el = panel(golden01, 0, "A");
    expect(boxes(el)).toEqual(["5", "0", "0 of 6"]);
    expect(el.querySelector(".intent .text")?.textContent).toBe("No turn has been played yet.");
    expect(el.querySelector(".intent .text")?.classList.contains("empty")).toBe(true);
    expect(el.querySelector(".marks")).toBeNull();
  });
});

describe("the tool-call trace", () => {
  it("draws one line per call, in the log's order", () => {
    const el = panel(tracedLog(), TURN_11, "A");
    expect(calls(el).map((call) => call.querySelector(".call-tool")?.textContent)).toEqual([
      "get_state",
      "scout",
      "scout",
      "simulate",
      "submit_orders",
    ]);
  });

  it("marks the call that errored, and gives every line its milliseconds and its arguments", () => {
    const el = panel(tracedLog(), TURN_11, "A");
    expect(calls(el).map((call) => call.className)).toEqual(["call", "call", "call errored", "call", "call"]);
    expect(calls(el).map((call) => call.querySelector(".call-ms")?.textContent)).toEqual([
      "4 ms",
      "6 ms",
      "250 ms",
      "12 ms",
      "3 ms",
    ]);
    expect(calls(el)[2]?.querySelector(".call-error")?.textContent).toBe("errored");
    expect(calls(el)[1]?.querySelector(".call-args")?.textContent).toBe('{"hex": "F6"}');
    // A call that went through is not marked as one that did not.
    expect(calls(el)[0]?.querySelector(".call-error")).toBeNull();
  });

  it("lists the hexes the seat scouted alongside the trace", () => {
    expect(panel(tracedLog(), TURN_11, "A").querySelector(".scouted")?.textContent).toBe("Scouted F6");
    expect(panel(golden01, TURN_11, "A").querySelector(".scouted")).toBeNull();
  });
});

describe("the context meter", () => {
  it("draws a meter for a seat played by a model, against its own window", () => {
    const el = panel(modelLog(), TURN_11, "A");
    expect(el.querySelector(".context .context-line")?.textContent).toBe("32,768 of 131,072 tokens (25%)");
    expect(el.querySelector<HTMLElement>(".context .meter span")?.style.width).toBe("25%");
  });

  it("draws no meter at all for a bot seat, rather than an empty one", () => {
    // Both of golden-01's seats are bots, and their turn records report 0
    // context tokens; a meter would claim a context of zero tokens.
    for (const seat of ["A", "B"] as const) {
      const el = panel(golden01, TURN_11, seat);
      expect(el.querySelector(".context")).toBeNull();
      expect(el.querySelector(".meter")).toBeNull();
    }
  });

  it("draws a meter for the model seat and none for the bot beside it", () => {
    expect(panel(modelLog(), TURN_11, "A").querySelector(".context")).not.toBeNull();
    expect(panel(modelLog(), TURN_11, "B").querySelector(".context")).toBeNull();
  });
});

describe("the marks in the panel", () => {
  it("chips a refused submission with the reasons from its wasted entries", () => {
    const el = panel(markedLog(), TURN_11, "A");
    expect(chips(el)).toEqual(["first submission refused: hexes are not adjacent", "context compacted"]);
    expect([...el.querySelectorAll<HTMLElement>(".marks .chip")].map((chip) => chip.className)).toEqual([
      "chip rejected",
      "chip compacted",
    ]);
  });

  it("chips a pass with the reason the log names for it", () => {
    expect(chips(panel(markedLog(), TURN_11, "B"))).toEqual(["passed: ran out of time"]);
  });

  it("chips nothing for the scripted bots, whose turn records carry no marks", () => {
    const el = panel(golden01, TURN_11, "A");
    expect(el.querySelector(".marks")).toBeNull();
  });

  it("leaves no verdict tag beside the prediction, scored or not", () => {
    // The mock-up's "Called it" / "Missed" tag is placeholder: how predictions
    // are scored is undecided, so the panel shows the prediction alone.
    const el = panel(markedLog(), TURN_11, "A");
    expect(el.querySelector(".prediction .text")).not.toBeNull();
    expect(el.querySelector(".verdict")).toBeNull();
    expect(el.textContent).not.toMatch(/called it|missed/i);
  });
});

describe("re-rendering", () => {
  it("replaces the panel it is given, so a stepped frame keeps nothing from the last", () => {
    const el = panel(tracedLog(), TURN_11, "A");
    renderPanel(el, panelsView(matchLogSchema.parse(golden01), TURN_11).A);
    expect(calls(el)).toHaveLength(0);
    expect(el.querySelectorAll(".calls")).toHaveLength(0);
    expect(boxes(el)).toEqual(["22", "2", "6 of 6"]);
  });
});
