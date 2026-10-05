/**
 * The limits brief §6.2 puts on the server, the one resubmission it allows, and
 * the seat token every call is traced back to.
 *
 * The shape all of these share: a call that is refused changes nothing. The gate
 * runs before any tool does, so a 13th call spends no action point, a 4th
 * simulation runs no engine, an over-long note leaves the notes alone, and a
 * refused first submission commits no orders. The counters still move — brief
 * §6.2 counts every call but `submit_orders`, including the ones that answer an
 * error — and the transcript holds the refused call, because the log is what the
 * match is audited from.
 *
 * The resubmission is the one place where an invalid order is played rather than
 * refused: the first attempt is checked before anything is stored and answered
 * with a reason per order, and the second stands whatever it carries, its
 * invalid orders wasted by the engine under the same action-point budget — which
 * is what the last submission test here pins down, by showing a legal order
 * wasted because six illegal ones spent the points first.
 *
 * Seed 135 is the map the other server tests use: seat A's Base at B6 holds five
 * troops and touches C6 (empty plain), D6 (Node garrisoned to three) and, one
 * step beyond, E6, which is blocked.
 */
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { turnPlayerSchema } from "@no-dice/log";
import { describe, expect, it } from "vitest";

import { MatchServer } from "./server.ts";
import { NOTES_CHAR_LIMIT, SIMULATE_LIMIT, TOOL_CALL_LIMIT } from "./limits.ts";
import { TOOL_NAMES, type ToolName, type ToolOutcome } from "./session.ts";
import type { StateView } from "./view.ts";

/** A match with its first turn open, and both seats' tokens in hand. */
function openedMatch(seed = 135): {
  server: MatchServer;
  matchId: string;
  tokens: Record<"A" | "B", string>;
} {
  const server = new MatchServer();
  const { matchId, tokens } = server.createMatch(seed, DEFAULT_CONFIG);
  server.openTurn(matchId);
  return { server, matchId, tokens };
}

/** A tool call that worked, answered in the shape the tool documents. */
function call<T>(
  server: MatchServer,
  matchId: string,
  seat: Seat,
  tool: ToolName,
  args: unknown = {},
): T {
  const outcome = server.call(matchId, seat, tool, args);
  if (!outcome.ok) throw new Error(`${tool} answered ${outcome.error}`);
  return outcome.result as T;
}

const stateOf = (server: MatchServer, matchId: string, seat: Seat): StateView =>
  call<StateView>(server, matchId, seat, "get_state");

const notesOf = (server: MatchServer, matchId: string, seat: Seat): string =>
  call<{ notes: string }>(server, matchId, seat, "read_notes").notes;

/** Hand in a turn, and answer with what the server made of the attempt. */
const submit = (
  server: MatchServer,
  matchId: string,
  seat: Seat,
  args: unknown,
): ToolOutcome => server.call(matchId, seat, "submit_orders", args);

/** Spend `n` of the seat's twelve calls on `get_state`, which changes nothing. */
function spendCalls(server: MatchServer, matchId: string, seat: Seat, n: number): void {
  for (let i = 0; i < n; i++) stateOf(server, matchId, seat);
}

/** The six hexes seat A can scout without stepping on its own Base's ring twice. */
const SIX_SCOUTS = ["C6", "D6", "C5", "B5", "A6", "A7"];

describe("tool calls", () => {
  it("refuses the 13th call with tool_call_limit and changes nothing", () => {
    const { server, matchId } = openedMatch();
    spendCalls(server, matchId, "A", TOOL_CALL_LIMIT);

    // A scout is the call that could change something, so it is the one to try.
    const refused = server.call(matchId, "A", "scout", { hex: "D6" });

    expect(refused.error).toBe("tool_call_limit");
    expect(refused.result).toEqual({ error: "tool_call_limit" });
    // Nothing was bought: no action point spent, no hex revealed, and the seat
    // still sees only the ring it could see before.
    expect(server.match(matchId).counters("A")).toEqual({
      toolCalls: TOOL_CALL_LIMIT + 1,
      simulations: 0,
      apSpentOnScouts: 0,
      scouted: [],
    });
    expect(server.turnRecord(matchId, 1).A.scouts).toEqual([]);
    // Every tool answers it, not just the one that ran out.
    expect(server.call(matchId, "A", "get_state", {}).error).toBe("tool_call_limit");
    expect(server.call(matchId, "A", "read_notes", {}).error).toBe("tool_call_limit");
    expect(server.call(matchId, "A", "write_notes", { notes: "late" }).error).toBe("tool_call_limit");
    expect(server.turnRecord(matchId, 1).A.notes_after).toBe("");
    // The refused calls are still in the transcript, each marked as an error.
    const transcript = server.turnRecord(matchId, 1).A.tool_calls;
    expect(transcript).toHaveLength(TOOL_CALL_LIMIT + 4);
    expect(transcript.slice(TOOL_CALL_LIMIT).map((entry) => [entry.tool, entry.error])).toEqual([
      ["scout", true],
      ["get_state", true],
      ["read_notes", true],
      ["write_notes", true],
    ]);
  });

  it("still takes submit_orders once the twelve are spent", () => {
    const { server, matchId } = openedMatch();
    spendCalls(server, matchId, "A", TOOL_CALL_LIMIT);

    const submitted = server.call(matchId, "A", "submit_orders", {
      orders: [{ from: "B6", to: "C6", troops: 2 }],
      intent: "take C6",
      prediction: "uncontested",
    });

    // A seat that spent its calls looking still gets to play its turn.
    expect(submitted.ok).toBe(true);
    expect(server.status(matchId).submitted).toEqual({ A: true, B: false });
    expect(server.resolveTurn(matchId).events).toEqual([
      { type: "capture", at: "C6", by: "A", from: null, terrain: "plain" },
    ]);
  });

  it("counts the calls that answer an error, and counts down in get_state", () => {
    const { server, matchId } = openedMatch();

    for (let i = 0; i < TOOL_CALL_LIMIT; i++) {
      expect(server.call(matchId, "A", "scout", { hex: "somewhere" }).error).toBe("unknown_hex");
    }

    // Twelve failed calls are twelve calls: the seat has nothing left to ask with.
    expect(server.match(matchId).counters("A").toolCalls).toBe(TOOL_CALL_LIMIT);
    expect(server.call(matchId, "A", "get_state", {}).error).toBe("tool_call_limit");
    // The other seat has its own twelve, and spends none of them here.
    expect(stateOf(server, matchId, "B").limits).toEqual({
      tool_calls_left: TOOL_CALL_LIMIT,
      simulations_left: SIMULATE_LIMIT,
    });
  });

  it("counts down to the last call and refuses past it", () => {
    const { server, matchId } = openedMatch();
    spendCalls(server, matchId, "A", TOOL_CALL_LIMIT - 1);

    // `get_state` answers the twelfth call, and the answer counts it: the one
    // call left is this one.
    expect(stateOf(server, matchId, "A").limits.tool_calls_left).toBe(1);
    expect(server.call(matchId, "A", "read_notes", {}).error).toBe("tool_call_limit");
  });
});

describe("simulations", () => {
  it("refuses the 4th simulation with simulate_limit and runs nothing", () => {
    const { server, matchId } = openedMatch();
    for (let i = 0; i < SIMULATE_LIMIT; i++) {
      expect(server.call(matchId, "A", "simulate", { orders: [] }).ok).toBe(true);
    }

    const refused = server.call(matchId, "A", "simulate", {
      orders: [{ from: "B6", to: "C6", troops: 2 }],
    });

    expect(refused.error).toBe("simulate_limit");
    expect(refused.result).toEqual({ error: "simulate_limit" });
    // The call counted against the twelve and not against the three: no
    // simulation ran, so none is owed.
    expect(server.match(matchId).counters("A")).toMatchObject({
      toolCalls: SIMULATE_LIMIT + 1,
      simulations: SIMULATE_LIMIT,
    });
    // And the projection committed nothing anyway.
    expect(stateOf(server, matchId, "A").hexes.find((hex) => hex.id === "C6")).toEqual({
      id: "C6",
      owner: null,
      troops: 0,
    });
  });

  it("counts the three simulations against the seat that asked for them", () => {
    const { server, matchId } = openedMatch();
    for (let i = 0; i < SIMULATE_LIMIT; i++) {
      server.call(matchId, "A", "simulate", { orders: [] });
    }

    expect(server.call(matchId, "B", "simulate", { orders: [] }).ok).toBe(true);
    expect(server.match(matchId).counters("B")).toMatchObject({ simulations: 1 });
  });
});

describe("action points", () => {
  it("refuses a scout once the six action points are spent on scouting", () => {
    const { server, matchId } = openedMatch();
    for (const hex of SIX_SCOUTS) {
      expect(server.call(matchId, "A", "scout", { hex }).ok).toBe(true);
    }

    const refused = server.call(matchId, "A", "scout", { hex: "D5" });

    expect(refused.error).toBe("action_point_limit");
    expect(refused.result).toEqual({ error: "action_point_limit" });
    // The refused scout spent no point and revealed no hex.
    expect(server.match(matchId).counters("A").apSpentOnScouts).toBe(DEFAULT_CONFIG.actionPoints);
    expect(server.match(matchId).counters("A").scouted).toEqual(SIX_SCOUTS);
    expect(stateOf(server, matchId, "A").action_points_left).toBe(0);
    expect(server.turnRecord(matchId, 1).A.scouts).toEqual(SIX_SCOUTS);
  });

  it("tells a seat that spent its points on scouting that its orders have none left", () => {
    const { server, matchId } = openedMatch();
    for (const hex of SIX_SCOUTS) server.call(matchId, "A", "scout", { hex });
    const order = { from: "B6", to: "C6", troops: 2 };

    const first = server.call(matchId, "A", "submit_orders", {
      orders: [order],
      intent: "take C6",
      prediction: "uncontested",
    });
    const second = server.call(matchId, "A", "submit_orders", {
      orders: [order],
      intent: "take C6",
      prediction: "uncontested",
    });

    // The order is a legal move; what it lacks is a point to be paid with. The
    // first attempt is refused, and the second is played and wasted.
    const noPoints = [{ order, reason: "no action points left" }];
    expect(first.result).toEqual({ accepted: false, wasted: noPoints });
    expect(second.result).toEqual({ accepted: true, wasted: noPoints });

    server.resolveTurn(matchId);
    expect(server.match(matchId).state.hexes["-3,0"]).toMatchObject({ owner: null, troops: 0 });
    expect(server.turnRecord(matchId, 1).A.wasted).toEqual(noPoints);
  });
});

describe("notes", () => {
  it("keeps what a seat writes and replaces it on the next write", () => {
    const { server, matchId } = openedMatch();

    expect(notesOf(server, matchId, "A")).toBe("");
    expect(server.call(matchId, "A", "write_notes", { notes: "they always take D6" }).ok).toBe(true);
    expect(notesOf(server, matchId, "A")).toBe("they always take D6");
    server.call(matchId, "A", "write_notes", { notes: "they took it again" });
    expect(notesOf(server, matchId, "A")).toBe("they took it again");
    // The log records what was standing at the end of the turn.
    expect(server.turnRecord(matchId, 1).A.notes_after).toBe("they took it again");
  });

  it("refuses notes over 2,000 characters and leaves what is stored alone", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "A", "write_notes", { notes: "short" });

    const refused = server.call(matchId, "A", "write_notes", {
      notes: "x".repeat(NOTES_CHAR_LIMIT + 1),
    });

    expect(refused.error).toBe("notes_too_long");
    expect(refused.result).toEqual({ error: "notes_too_long" });
    expect(notesOf(server, matchId, "A")).toBe("short");
    // The longest note the server does take is stored whole.
    const long = "y".repeat(NOTES_CHAR_LIMIT);
    expect(server.call(matchId, "A", "write_notes", { notes: long }).ok).toBe(true);
    expect(notesOf(server, matchId, "A")).toBe(long);
    // A call that answered an error still counted against the twelve: three
    // writes, and the two reads that checked them.
    expect(server.match(matchId).counters("A").toolCalls).toBe(5);
  });

  it("carries notes into the next turn, where the seat can still rewrite them", () => {
    const { server, matchId } = openedMatch();
    call(server, matchId, "A", "write_notes", { notes: "turn one" });

    server.resolveTurn(matchId);
    server.openTurn(matchId);

    // Notes are the one thing a seat carries between turns: the counters reset,
    // and what it wrote to itself is still there to be read and replaced.
    expect(notesOf(server, matchId, "A")).toBe("turn one");
    const rewritten = call<{ stored: boolean }>(server, matchId, "A", "write_notes", {
      notes: "turn two",
    });
    expect(rewritten.stored).toBe(true);
    expect(notesOf(server, matchId, "A")).toBe("turn two");
  });

  it("refuses notes that are not text and stores nothing", () => {
    const { server, matchId } = openedMatch();

    expect(server.call(matchId, "A", "write_notes", { notes: 7 }).error).toBe("invalid_notes");
    expect(server.call(matchId, "A", "write_notes", {}).error).toBe("invalid_notes");
    expect(notesOf(server, matchId, "A")).toBe("");
  });
});

describe("submissions", () => {
  it("rejects a first submission with an invalid order, with a reason per order", () => {
    const { server, matchId } = openedMatch();
    const legal = { from: "B6", to: "C6", troops: 2 };
    const illegal = { from: "B6", to: "D6", troops: 2 };

    const attempt = submit(server, matchId, "A", {
      orders: [legal, illegal],
      intent: "edge forward",
      prediction: "B holds",
    });

    // The call itself went through: what it answered is the verdict on the orders.
    expect(attempt.ok).toBe(true);
    expect(attempt.result).toEqual({
      accepted: false,
      wasted: [{ order: illegal, reason: "hexes are not adjacent" }],
    });
    // Nothing was committed: the seat has no submission in, and the log holds the
    // attempt separately from the orders it played.
    expect(server.status(matchId)).toEqual({ submitted: { A: false, B: false } });
    expect(server.turnRecord(matchId, 1).A.orders).toEqual([]);
    expect(server.turnRecord(matchId, 1).A.rejected_submission).toEqual({
      orders: [legal, illegal],
      wasted: [{ order: illegal, reason: "hexes are not adjacent" }],
    });

    const record = server.turnRecord(matchId, 1);
    expect(turnPlayerSchema.safeParse(record.A).success).toBe(true);
    expect(server.resolveTurn(matchId).events).toEqual([]);
    // C6 is still unowned: the legal order was never played either.
    expect(server.match(matchId).state.hexes["-3,0"]).toMatchObject({ owner: null, troops: 0 });
    expect(server.turnRecord(matchId, 1).A.passed).toBe("no_submission");
  });

  it("takes a second submission whatever it carries, points and all", () => {
    const { server, matchId } = openedMatch();
    submit(server, matchId, "A", {
      orders: [{ from: "B6", to: "D6", troops: 2 }],
      intent: "one step too far",
      prediction: "B holds",
    });

    // Six orders the engine will drop, then one it would carry out. The six are
    // each checked, so each spends one of the six action points first, and the
    // legal order is left with nothing to be paid with.
    const orders = [
      { from: "B6", to: "D6", troops: 1 },
      { from: "B6", to: "E6", troops: 1 },
      { from: "C6", to: "B6", troops: 1 },
      { from: "A1", to: "A2", troops: 1 },
      { from: "B6", to: "C6", troops: 0 },
      { from: "B6", to: "C6", troops: 99 },
      { from: "B6", to: "C6", troops: 2 },
    ];
    const second = submit(server, matchId, "A", {
      orders,
      intent: "everything at once",
      prediction: "something lands",
    });

    expect(second.result).toEqual({
      accepted: true,
      wasted: [
        { order: orders[0], reason: "hexes are not adjacent" },
        { order: orders[1], reason: "destination is blocked" },
        { order: orders[2], reason: "source hex not owned" },
        { order: orders[3], reason: "unknown hex" },
        { order: orders[4], reason: "troop count must be a positive integer" },
        { order: orders[5], reason: "not enough troops in source hex" },
        { order: orders[6], reason: "no action points left" },
      ],
    });
    expect(server.status(matchId).submitted).toEqual({ A: true, B: false });

    const { events } = server.resolveTurn(matchId);

    expect(events).toEqual([]);
    const record = server.turnRecord(matchId, 1);
    // The submission is logged as the seat wrote it, invalid orders and all, and
    // the engine's verdict stands beside it.
    expect(record.A.orders).toEqual(orders);
    expect(record.A.wasted.map((waste) => waste.reason)).toEqual([
      "hexes are not adjacent",
      "destination is blocked",
      "source hex not owned",
      "unknown hex",
      "troop count must be a positive integer",
      "not enough troops in source hex",
      "no action points left",
    ]);
    // Nothing moved: the one legal order was wasted by the points the six
    // illegal ones had already spent.
    expect(server.match(matchId).state.hexes["-3,0"]).toMatchObject({ owner: null, troops: 0 });
    expect(server.match(matchId).state.hexes["-4,0"]).toMatchObject({ owner: "A", troops: 7 });
  });

  it("will not replace an accepted first submission", () => {
    const { server, matchId } = openedMatch();
    const first = {
      orders: [{ from: "B6", to: "C6", troops: 2 }],
      intent: "take C6",
      prediction: "one",
    };
    const second = {
      orders: [{ from: "B6", to: "C5", troops: 2 }],
      intent: "changed my mind",
      prediction: "two",
    };

    expect(submit(server, matchId, "A", first).result).toEqual({ accepted: true });
    const replaced = submit(server, matchId, "A", second);

    expect(replaced.error).toBe("already_submitted");
    expect(server.resolveTurn(matchId).events).toEqual([
      { type: "capture", at: "C6", by: "A", from: null, terrain: "plain" },
    ]);
    expect(server.turnRecord(matchId, 1).A.orders).toEqual(first.orders);
    expect(server.turnRecord(matchId, 1).A.intent).toBe("take C6");
  });

  it("refuses a submission that fails the schema, without using up the resubmission", () => {
    const { server, matchId } = openedMatch();
    const orders = [{ from: "B6", to: "C6", troops: 2 }];

    for (const bad of [
      { orders, intent: "", prediction: "an empty intent" },
      { orders, intent: "x".repeat(281), prediction: "too long" },
      { orders, intent: "no prediction" },
      {
        orders: [{ from: "B6", to: "C6", troops: 2, why: "because" }],
        intent: "an extra field",
        prediction: "not an order",
      },
      { orders: "not even a list", intent: "wrong shape", prediction: "still wrong" },
    ]) {
      expect(submit(server, matchId, "A", bad).error).toBe("invalid_submission");
    }

    // None of those was a submission, so the seat has its two attempts left.
    expect(server.status(matchId)).toEqual({ submitted: { A: false, B: false } });
    expect(server.turnRecord(matchId, 1).A.rejected_submission).toBeNull();
    const accepted = submit(server, matchId, "A", { orders, intent: "take C6", prediction: "one" });
    expect(accepted.result).toEqual({ accepted: true });
  });

  it("does not count a call that fails the schema as the seat's one rejected attempt", () => {
    const { server, matchId } = openedMatch();
    const illegal = {
      orders: [{ from: "B6", to: "D6", troops: 2 }],
      intent: "one step too far",
      prediction: "B holds",
    };

    // Not shaped as a submission, so not an attempt: the seat's one refusal is
    // still ahead of it.
    const malformed = submit(server, matchId, "A", { ...illegal, intent: "" });
    expect(malformed.error).toBe("invalid_submission");

    // The first real attempt is refused, exactly as it would have been without
    // that call in the way.
    const refused = submit(server, matchId, "A", illegal);
    expect(refused.result).toEqual({
      accepted: false,
      wasted: [{ order: illegal.orders[0], reason: "hexes are not adjacent" }],
    });

    // Now the attempt is used up, and the submission after it is taken as it is.
    expect(submit(server, matchId, "A", illegal).result).toEqual({
      accepted: true,
      wasted: [{ order: illegal.orders[0], reason: "hexes are not adjacent" }],
    });
    expect(server.turnRecord(matchId, 1).A.orders).toEqual(illegal.orders);
  });

  it("refuses every tool once a submission is accepted, until the next turn opens", () => {
    const { server, matchId } = openedMatch();
    submit(server, matchId, "A", {
      orders: [{ from: "B6", to: "C6", troops: 2 }],
      intent: "take C6",
      prediction: "uncontested",
    });

    for (const tool of TOOL_NAMES) {
      expect(server.call(matchId, "A", tool, { notes: "later", orders: [] }).error).toBe(
        "already_submitted",
      );
    }
    // The other seat is still playing its own turn.
    expect(server.call(matchId, "B", "get_state", {}).ok).toBe(true);

    server.resolveTurn(matchId);
    server.openTurn(matchId);
    expect(server.call(matchId, "A", "get_state", {}).ok).toBe(true);
    const again = submit(server, matchId, "A", { orders: [], intent: "wait", prediction: "nothing" });
    expect(again.result).toEqual({ accepted: true });
  });

  it("leaves a seat whose first attempt was refused free to call, not its third", () => {
    const { server, matchId } = openedMatch();
    submit(server, matchId, "A", {
      orders: [{ from: "B6", to: "D6", troops: 2 }],
      intent: "one step too far",
      prediction: "B holds",
    });

    // A rejected attempt is not a submission, and does not even count as a call:
    // the seat is still in its turn with everything it had.
    expect(stateOf(server, matchId, "A").limits).toEqual({ tool_calls_left: 12, simulations_left: 3 });
    expect(server.call(matchId, "A", "scout", { hex: "D6" }).ok).toBe(true);
    const second = submit(server, matchId, "A", { orders: [], intent: "hold", prediction: "nothing" });
    expect(second.result).toEqual({ accepted: true });

    // That second submission was final, so there is no third.
    const third = submit(server, matchId, "A", { orders: [], intent: "again", prediction: "again" });
    expect(third.error).toBe("already_submitted");
    expect(server.turnRecord(matchId, 1).A.orders).toEqual([]);
    expect(server.turnRecord(matchId, 1).A.intent).toBe("hold");
  });
});

describe("seat tokens", () => {
  it("keeps one seat's notes, submission and counters from the other seat", () => {
    const { server, matchId, tokens } = openedMatch();

    server.callAs(tokens.A, "write_notes", { notes: "A's own plan" });
    spendCalls(server, matchId, "A", TOOL_CALL_LIMIT - 1);
    server.callAs(tokens.A, "submit_orders", {
      orders: [{ from: "B6", to: "C6", troops: 2 }],
      intent: "take C6",
      prediction: "uncontested",
    });

    // Seat B reads its own notes, has its own submission to make, and has its own
    // twelve calls: nothing seat A did is standing in its way.
    expect(stateOf(server, matchId, "B").limits).toEqual({
      tool_calls_left: TOOL_CALL_LIMIT,
      simulations_left: SIMULATE_LIMIT,
    });
    expect(JSON.stringify(stateOf(server, matchId, "B"))).not.toContain("A's own plan");
    expect(notesOf(server, matchId, "B")).toBe("");
    expect(server.status(matchId)).toEqual({ submitted: { A: true, B: false } });
    // A token names one seat, so there is no way to answer for the other one.
    expect(server.resolveToken(tokens.A)).toEqual({ matchId, seat: "A" });
    expect(server.turnRecord(matchId, 1).A.notes_after).toBe("A's own plan");
    expect(server.turnRecord(matchId, 1).B.notes_after).toBe("");
  });

  it("writes only the notes of the seat the token names", () => {
    const { server, matchId, tokens } = openedMatch();

    expect(server.callAs(tokens.A, "write_notes", { notes: "written as B" }).ok).toBe(true);

    expect(server.match(matchId).counters("B").toolCalls).toBe(0);
    expect(notesOf(server, matchId, "A")).toBe("written as B");
    expect(notesOf(server, matchId, "B")).toBe("");
  });

  it("gives a token one match and one seat, and refuses a token it never issued", () => {
    const server = new MatchServer();
    const first = server.createMatch(135, DEFAULT_CONFIG);
    const second = server.createMatch(136, DEFAULT_CONFIG);
    server.openTurn(first.matchId);
    server.openTurn(second.matchId);

    // A token names one match and one seat, and no other pair.
    expect(server.resolveToken(first.tokens.A)).toEqual({ matchId: first.matchId, seat: "A" });
    expect(server.resolveToken(second.tokens.B)).toEqual({ matchId: second.matchId, seat: "B" });

    server.callAs(first.tokens.A, "write_notes", { notes: "match one, seat A" });
    server.callAs(second.tokens.A, "get_state", {});

    // The second match's token reaches the second match only: seat A of the first
    // match still has empty notes and one call to its name.
    expect(server.match(first.matchId).counters("A").toolCalls).toBe(1);
    expect(server.match(second.matchId).counters("A").toolCalls).toBe(1);
    expect(notesOf(server, first.matchId, "A")).toBe("match one, seat A");
    expect(notesOf(server, second.matchId, "A")).toBe("");

    // A token this server never dealt is refused before anything is counted: seat
    // A of the first match has the read of its own notes and nothing else.
    const refused = server.callAs("not-a-token", "get_state", {});
    expect(refused.error).toBe("unknown_token");
    expect(refused.result).toEqual({ error: "unknown_token" });
    expect(server.match(first.matchId).counters("A").toolCalls).toBe(2);
  });

  it("takes a seat's token away and deals it a new one", () => {
    const { server, matchId, tokens } = openedMatch();

    // The runner rotates a seat's token when that seat's turn ran out while it
    // was still calling, so a call the abandoned turn had already sent cannot be
    // spent against the turn that follows it.
    const replacement = server.rotateToken(matchId, "A");

    expect(replacement).not.toBe(tokens.A);
    expect(server.resolveToken(tokens.A)).toBeNull();
    expect(server.resolveToken(replacement)).toEqual({ matchId, seat: "A" });

    // The old token reaches nothing, and nothing it asks for is counted. Seat B
    // is untouched: a rotation is one seat's, not the match's.
    expect(server.callAs(tokens.A, "get_state", {}).error).toBe("unknown_token");
    expect(server.match(matchId).counters("A").toolCalls).toBe(0);
    expect(server.callAs(tokens.B, "get_state", {}).ok).toBe(true);
    expect(server.match(matchId).counters("B").toolCalls).toBe(1);

    // The new token plays seat A of this match, and this match only.
    expect(server.callAs(replacement, "write_notes", { notes: "asked again" }).ok).toBe(true);
    expect(server.match(matchId).counters("A").toolCalls).toBe(1);
    expect(server.turnRecord(matchId, 1).A.notes_after).toBe("asked again");
    expect(server.turnRecord(matchId, 1).B.notes_after).toBe("");
  });
});
