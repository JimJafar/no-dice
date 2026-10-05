/**
 * What the side panels say about one seat at one frame.
 *
 * The numbers come from the fixtures, and the fixtures are the log: turn 11 of
 * golden-01 is the frame the mock-ups were drawn from, so its 22 troops, 2 Nodes
 * and 6 of 6 actions are the ones the mock-up prints
 * (`salient/docs/salient-mockups.md`). The golden bots make no tool calls, never
 * have a submission refused, never pass and never compact, so the trace, the
 * marks and the context meter are asked for by editing golden-01's turn records
 * in the test — which is also the check that the panels read the log rather than
 * assume the scripted bots the fixture happens to hold.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog, Seat, TurnPlayerRecord } from "@no-dice/log";

import { compactArgs, panelView, panelsView } from "./panels.ts";
import golden01 from "../fixtures/golden-01-time-win.json";

const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** One seat's turn record of one turn of golden-01, as the test can edit it. */
function playerOf(logJson: Record<string, unknown>, turn: number, seat: Seat): TurnPlayerRecord {
  const turns = logJson.turns as { n: number; players: Record<Seat, TurnPlayerRecord> }[];
  return turns.find((t) => t.n === turn)!.players[seat];
}

/** golden-01 with `edit` applied to one seat's turn record, parsed back as a log. */
function withTurn(turn: number, seat: Seat, edit: (player: TurnPlayerRecord) => void): MatchLog {
  const source = structuredClone(golden01) as Record<string, unknown>;
  edit(playerOf(source, turn, seat));
  return matchLogSchema.parse(source);
}

/** A seat played by a model with a 131,072-token window, and its context grown. */
function withContext(seat: Seat, tokens: number): MatchLog {
  const source = structuredClone(golden01) as Record<string, unknown>;
  const players = source.players as Record<Seat, Record<string, unknown>>;
  players[seat] = { kind: "pi", model: "marvin/subagent", thinking: "medium", context_window: 131_072 };
  playerOf(source, TURN_11, seat).context_tokens = tokens;
  return matchLogSchema.parse(source);
}

describe("the panels of the frame the mock-ups drew", () => {
  it("reads A's troops, Nodes held and actions at turn 11 of golden-01", () => {
    const panel = panelView(log, TURN_11, "A");
    expect(panel.troops).toBe(22);
    // D6 and F6, the two Nodes A holds after taking F6 that turn.
    expect(panel.nodesHeld).toBe(2);
    expect(panel.actionsUsed).toBe(6);
    expect(panel.actionPoints).toBe(6);
  });

  it("reads B's troops, Nodes held and actions at turn 11 of golden-01", () => {
    const panel = panelView(log, TURN_11, "B");
    expect(panel.troops).toBe(24);
    // Only H6: F6 changed hands that turn.
    expect(panel.nodesHeld).toBe(1);
    expect(panel.actionsUsed).toBe(6);
  });

  it("says what each seat is called and what it wrote", () => {
    const panels = panelsView(log, TURN_11);
    // The fixture's seats are the scripted prototype bots.
    expect(panels.A.name).toBe("raider");
    expect(panels.B.name).toBe("striker");
    expect(panels.A.intent).toContain("5 from F5 to F6");
    expect(panels.A.prediction).toBe("The largest move, 5 troops, heads for F6: expect B to answer there.");
    expect(panels.B.prediction).toContain("heads for H5");
  });

  it("counts the Nodes each seat holds at the frame, not the ones it held before", () => {
    // A took F6 on turn 11, so the frame before it holds one Node and B holds two.
    expect(panelView(log, 10, "A").nodesHeld).toBe(1);
    expect(panelView(log, 10, "B").nodesHeld).toBe(2);
  });

  it("shows the start position with no sentences and no actions spent", () => {
    const panels = panelsView(log, 0);
    expect(panels.A.troops).toBe(5);
    expect(panels.A.nodesHeld).toBe(0);
    expect(panels.A.actionsUsed).toBe(0);
    expect(panels.A.intent).toBe("");
    expect(panels.A.prediction).toBe("");
    expect(panels.A.toolCalls).toEqual([]);
    expect(panels.A.markLines).toEqual([]);
  });

  it("refuses a frame the log does not hold", () => {
    expect(() => panelView(log, 26, "A")).toThrow("the log holds no turn 26");
  });
});

describe("the actions box", () => {
  it("counts a scout against the action points as well as an order", () => {
    // The rules spend an action point on an order or a scout, so three scouts
    // and two orders is five of six spent.
    const edited = withTurn(TURN_11, "A", (player) => {
      player.orders = player.orders.slice(0, 2);
      player.scouts = ["F6", "G6", "H6"];
    });
    const panel = panelView(edited, TURN_11, "A");
    expect(panel.actionsUsed).toBe(5);
    expect(panel.actionPoints).toBe(6);
  });

  it("lists the hexes the seat scouted, in the order it scouted them", () => {
    const edited = withTurn(TURN_11, "A", (player) => {
      player.scouts = ["G4", "F6"];
    });
    expect(panelView(edited, TURN_11, "A").scouted).toEqual(["G4", "F6"]);
    expect(panelView(edited, TURN_11, "B").scouted).toEqual([]);
  });
});

describe("the tool-call trace", () => {
  /** A turn whose seat called five tools, one of them refused. */
  const traced = withTurn(TURN_11, "A", (player) => {
    player.tool_calls = [
      { tool: "get_state", args: {}, result: { score: { A: 33, B: 43 } }, error: false, ms: 4 },
      { tool: "scout", args: { hex: "F6" }, result: { hex: "F6" }, error: false, ms: 6 },
      { tool: "scout", args: { hex: "G4" }, result: { hex: "G4" }, error: true, ms: 250 },
      {
        tool: "simulate",
        args: { orders: [{ from: "F5", to: "F6", troops: 5 }] },
        result: { events: [] },
        error: false,
        ms: 12,
      },
      { tool: "submit_orders", args: { orders: [], intent: "x", prediction: "y" }, result: {}, error: false, ms: 3 },
    ];
    player.scouts = ["F6"];
  });

  it("lists the calls in the log's order, named as the player called them", () => {
    const panel = panelView(traced, TURN_11, "A");
    expect(panel.toolCalls.map((call) => call.tool)).toEqual([
      "get_state",
      "scout",
      "scout",
      "simulate",
      "submit_orders",
    ]);
  });

  it("marks the call that errored, and gives every call its milliseconds", () => {
    const panel = panelView(traced, TURN_11, "A");
    expect(panel.toolCalls.map((call) => call.error)).toEqual([false, false, true, false, false]);
    expect(panel.toolCalls.map((call) => call.ms)).toEqual([4, 6, 250, 12, 3]);
  });

  it("puts each call's arguments on its line in a compact form", () => {
    const panel = panelView(traced, TURN_11, "A");
    expect(panel.toolCalls[0]?.args).toBe("{}");
    expect(panel.toolCalls[1]?.args).toBe('{"hex": "F6"}');
    expect(panel.toolCalls[3]?.args).toBe('{"orders": [{"from": "F5", "to": "F6", "troops": 5}]}');
  });

  it("cuts a long argument list short rather than run over the panel", () => {
    const orders = Array.from({ length: 20 }, (_, i) => ({ from: "F5", to: "F6", troops: i + 1 }));
    const args = compactArgs({ orders });
    expect(args.length).toBe(120);
    expect(args.endsWith("…")).toBe(true);
    expect(args).toContain('{"orders": [{"from": "F5"');
  });

  it("leaves a string argument as the player wrote it", () => {
    // A `submit_orders` call carries the intent and the prediction, which are
    // sentences full of the commas and colons a compact form must not touch.
    expect(compactArgs({ intent: "Attack F6 from F5 with 5: bring 8 up, then hold" })).toBe(
      '{"intent": "Attack F6 from F5 with 5: bring 8 up, then hold"}',
    );
  });

  it("shows a call that handed no arguments as one that handed none", () => {
    expect(compactArgs(undefined)).toBe("no arguments");
  });

  it("shows no calls at all for a seat whose turn logged none", () => {
    expect(panelView(log, TURN_11, "A").toolCalls).toEqual([]);
  });
});

describe("the context meter", () => {
  it("measures a model seat's context against the window it was played in", () => {
    const panel = panelView(withContext("A", 32_768), TURN_11, "A");
    expect(panel.context).toEqual({ tokens: 32_768, window: 131_072, percent: 25 });
  });

  it("shows no meter for a bot seat, which has no window to measure against", () => {
    // Both of golden-01's seats are bots, and their turn records report 0
    // context tokens; an empty meter would read as a context that emptied.
    const panels = panelsView(log, TURN_11);
    expect(panels.A.context).toBeNull();
    expect(panels.B.context).toBeNull();
  });

  it("shows no meter for a seat whose window is 0", () => {
    const source = structuredClone(golden01) as Record<string, unknown>;
    const players = source.players as Record<Seat, Record<string, unknown>>;
    players.B = { kind: "pi", model: "marvin/subagent", thinking: "low", context_window: 0 };
    const panel = panelView(matchLogSchema.parse(source), TURN_11, "B");
    expect(panel.context).toBeNull();
  });

  it("leaves the other seat's meter alone when only one seat is a model", () => {
    const panels = panelsView(withContext("A", 13_107), TURN_11);
    expect(panels.A.context?.percent).toBe(10);
    expect(panels.B.context).toBeNull();
  });
});

describe("the marks a turn carries", () => {
  /** golden-01's turn 11 with A refused, B passing, and A's context compacted. */
  const marked = withTurn(TURN_11, "A", (player) => {
    player.rejected_submission = {
      orders: [
        { from: "F5", to: "F7", troops: 2 },
        { from: "F5", to: "Z9", troops: 1 },
      ],
      wasted: [
        { order: { from: "F5", to: "F7", troops: 2 }, reason: "hexes are not adjacent" },
        { order: { from: "F5", to: "Z9", troops: 1 }, reason: "unknown hex" },
      ],
    };
    player.compacted = true;
  });

  const withPass = withTurn(TURN_11, "B", (player) => {
    player.passed = "timeout";
  });

  it("marks a refused first submission with the reasons its wasted entries give", () => {
    const panel = panelView(marked, TURN_11, "A");
    expect(panel.marks.rejected).toEqual(["hexes are not adjacent", "unknown hex"]);
    expect(panel.markLines).toContain("first submission refused: hexes are not adjacent, unknown hex");
  });

  it("names a reason once when several refused orders share it", () => {
    const twice = withTurn(TURN_11, "A", (player) => {
      player.rejected_submission = {
        orders: [
          { from: "F5", to: "F7", troops: 2 },
          { from: "F5", to: "G7", troops: 1 },
        ],
        wasted: [
          { order: { from: "F5", to: "F7", troops: 2 }, reason: "hexes are not adjacent" },
          { order: { from: "F5", to: "G7", troops: 1 }, reason: "hexes are not adjacent" },
        ],
      };
    });
    expect(panelView(twice, TURN_11, "A").markLines).toEqual(["first submission refused: hexes are not adjacent"]);
  });

  it("marks a pass with the reason the log gives for it", () => {
    const panel = panelView(withPass, TURN_11, "B");
    expect(panel.marks.passed).toBe("timeout");
    expect(panel.markLines).toEqual(["passed: ran out of time"]);
  });

  it("marks a compaction", () => {
    const compacted = withTurn(TURN_11, "A", (player) => {
      player.compacted = true;
    });
    expect(panelView(compacted, TURN_11, "A").markLines).toEqual(["context compacted"]);
  });

  it("says every mark of a turn that carries more than one", () => {
    const both = withTurn(TURN_11, "B", (player) => {
      player.passed = "no_submission";
      player.compacted = true;
    });
    expect(panelView(both, TURN_11, "B").markLines).toEqual(["passed: sent no orders", "context compacted"]);
  });

  it("marks the seat the log marks and not the other one", () => {
    const panels = panelsView(marked, TURN_11);
    expect(panels.A.markLines.length).toBe(2);
    expect(panels.B.markLines).toEqual([]);
  });

  it("marks nothing for the golden bots, whose turn records carry none of the three", () => {
    const panels = panelsView(log, TURN_11);
    expect(panels.A.markLines).toEqual([]);
    expect(panels.B.markLines).toEqual([]);
  });
});
