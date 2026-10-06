/**
 * The match the server holds: the tokens that reach it, the counters a turn
 * opens with, and the record the log is written from. The limits brief §6.2 sets
 * are tested in `limits.test.ts`; what is tested here is the bookkeeping they
 * refuse against — every call counted, including one that answers an error, and
 * every call kept for the log.
 */
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import { turnEventSchema, turnPlayerSchema } from "@no-dice/log";
import { describe, expect, it } from "vitest";

import { MatchServer } from "./server.ts";

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

describe("createMatch", () => {
  it("gives each seat its own opaque token, for one match and one seat", () => {
    const server = new MatchServer();
    const { matchId, tokens } = server.createMatch(135, DEFAULT_CONFIG);

    expect(tokens.A).not.toBe(tokens.B);
    // Opaque: neither the match's own id nor a seat name, and not guessable.
    expect(tokens.A).not.toBe(matchId);
    expect(tokens.A).toMatch(/^[A-Za-z0-9_-]{16,}$/);

    expect(server.resolveToken(tokens.A)).toEqual({ matchId, seat: "A" });
    expect(server.resolveToken(tokens.B)).toEqual({ matchId, seat: "B" });
  });

  it("keeps two matches on one server apart", () => {
    const server = new MatchServer();
    const first = server.createMatch(135, DEFAULT_CONFIG);
    const second = server.createMatch(136, DEFAULT_CONFIG);

    expect(first.matchId).not.toBe(second.matchId);
    expect(first.tokens.A).not.toBe(second.tokens.A);
    expect(server.resolveToken(first.tokens.A)).toEqual({ matchId: first.matchId, seat: "A" });
    expect(server.resolveToken(second.tokens.B)).toEqual({ matchId: second.matchId, seat: "B" });
    expect(server.resolveToken("not-a-token")).toBeNull();
  });

  it("refuses a call for a match it is not playing", () => {
    const server = new MatchServer();
    const { tokens } = server.createMatch(135, DEFAULT_CONFIG);

    const refused = server.call("00000000-0000-4000-8000-000000000000", "A", "get_state", {});
    expect(refused.error).toBe("unknown_match");
    expect(server.resolveToken(tokens.A)?.matchId).not.toBe("00000000-0000-4000-8000-000000000000");
  });
});

describe("call", () => {
  it("refuses every call before the turn is open, and records nothing", () => {
    const server = new MatchServer();
    const { matchId } = server.createMatch(135, DEFAULT_CONFIG);

    expect(server.call(matchId, "A", "get_state", {}).error).toBe("turn_not_open");
    expect(server.match(matchId).counters("A").toolCalls).toBe(0);
    expect(server.turnRecord(matchId, 1).A.tool_calls).toEqual([]);
  });

  it("counts every call a seat makes, including the ones that answer an error", () => {
    const { server, matchId } = openedMatch();

    // A name that is not one of the seven tools, and a call whose argument names
    // no hex: both answer an error, and both still count.
    expect(server.call(matchId, "A", "not_a_salient_tool", {}).error).toBe("unknown_tool");
    server.call(matchId, "A", "scout", { hex: "somewhere" });
    server.call(matchId, "A", "submit_orders", { orders: [], intent: "hold", prediction: "nothing moves" });

    // `submit_orders` is the one call the 12 do not count; the other two failed
    // and still count.
    expect(server.match(matchId).counters("A").toolCalls).toBe(2);
    const transcript = server.turnRecord(matchId, 1).A.tool_calls;
    expect(transcript.map((call) => call.tool)).toEqual(["not_a_salient_tool", "scout", "submit_orders"]);
    expect(transcript.map((call) => call.error)).toEqual([true, true, false]);
  });

  it("keeps what each call was given and what it answered, for the log", () => {
    const { server, matchId } = openedMatch();
    const submission = { orders: [], intent: "feel out the centre", prediction: "F6 stays neutral" };

    const outcome = server.call(matchId, "A", "submit_orders", submission);
    expect(outcome).toEqual({ ok: true, result: { accepted: true }, error: null, ms: expect.any(Number) });

    const [call] = server.turnRecord(matchId, 1).A.tool_calls;
    expect(call?.tool).toBe("submit_orders");
    expect(call?.args).toEqual(submission);
    expect(call?.result).toEqual({ accepted: true });
  });

  it("counts one seat's calls against that seat alone", () => {
    const { server, matchId } = openedMatch();

    server.call(matchId, "A", "get_state", {});
    server.call(matchId, "A", "get_state", {});
    server.call(matchId, "B", "get_state", {});

    expect(server.match(matchId).counters("A").toolCalls).toBe(2);
    expect(server.match(matchId).counters("B").toolCalls).toBe(1);
    expect(server.turnRecord(matchId, 1).B.tool_calls).toHaveLength(1);
  });

  it("measures each call's `ms` off the timer it was given", () => {
    // A timer that advances one millisecond per reading: every call reads it
    // twice, so every call costs the same millisecond, and a rerun says so in the
    // same bytes. Without the injected timer these are wall-clock numbers
    // no two runs agree on.
    let reading = 0;
    const server = new MatchServer(() => reading++);
    const { matchId } = server.createMatch(135, DEFAULT_CONFIG);
    server.openTurn(matchId);

    expect(server.call(matchId, "A", "get_state", {}).ms).toBe(1);
    expect(server.call(matchId, "A", "read_notes", {}).ms).toBe(1);
    expect(server.turnRecord(matchId, 1).A.tool_calls.map((call) => call.ms)).toEqual([1, 1]);
  });

  it("refuses a submission it could not write into the log", () => {
    const { server, matchId } = openedMatch();

    // A hex named by the engine's key, and an order with no destination.
    expect(server.call(matchId, "A", "submit_orders", { orders: [{ from: "-4,0", to: "-3,0", troops: 2 }], intent: "move", prediction: "take it" }).error).toBe("invalid_submission");
    expect(server.call(matchId, "A", "submit_orders", { orders: [{ from: "B6", troops: 2 }], intent: "move", prediction: "take it" }).error).toBe("invalid_submission");
    expect(server.status(matchId)).toEqual({ submitted: { A: false, B: false } });
  });
});

describe("status and openTurn", () => {
  it("reports which seats have a submission in", () => {
    const { server, matchId } = openedMatch();

    expect(server.status(matchId)).toEqual({ submitted: { A: false, B: false } });
    server.call(matchId, "B", "submit_orders", { orders: [], intent: "wait", prediction: "a quiet turn" });
    expect(server.status(matchId)).toEqual({ submitted: { A: false, B: true } });
  });

  it("resets the per-turn counters when the next turn opens", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "A", "get_state", {});
    server.call(matchId, "A", "get_state", {});
    server.resolveTurn(matchId);
    server.openTurn(matchId);

    expect(server.match(matchId).counters("A")).toEqual({
      toolCalls: 0,
      simulations: 0,
      apSpentOnScouts: 0,
      scouted: [],
    });
    expect(server.turnRecord(matchId, 2).A.tool_calls).toEqual([]);
    expect(server.call(matchId, "A", "read_notes", {}).ok).toBe(true);
  });

  it("keeps the turn before it readable once the next one opens", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "A", "get_state", {});
    server.resolveTurn(matchId);
    server.openTurn(matchId);

    expect(server.turnRecord(matchId, 1).A.tool_calls).toHaveLength(1);
    expect(() => server.turnRecord(matchId, 7)).toThrow("match " + matchId + " has no turn 7 to record");
  });
});

describe("resolveTurn", () => {
  it("plays a seat that never submitted as a pass, and leaves the other seat's orders alone", () => {
    const { server, matchId } = openedMatch();
    const move = { from: "B6", to: "C6", troops: 2 };
    server.call(matchId, "A", "submit_orders", { orders: [move], intent: "take C6", prediction: "uncontested" });

    const { events, result } = server.resolveTurn(matchId);

    // A's order is carried out exactly as submitted, and B's pass changes
    // nothing on B's half of the board.
    expect(events).toEqual([{ type: "capture", at: "C6", by: "A", from: null, terrain: "plain" }]);
    expect(result).toBeNull();

    const board = server.match(matchId).state;
    expect(board.turn).toBe(2);
    expect(board.hexes["-3,0"]).toMatchObject({ owner: "A", troops: 2 });
    expect(board.hexes["-4,0"]).toMatchObject({ owner: "A", troops: 5 });
    expect(board.hexes["4,0"]).toMatchObject({ owner: "B", troops: 7 });

    const record = server.turnRecord(matchId, 1);
    expect(record.A.orders).toEqual([move]);
    expect(record.A.wasted).toEqual([]);
    expect(record.A.passed).toBeNull();
    expect(record.B.orders).toEqual([]);
    expect(record.B.passed).toBe("no_submission");
  });

  it("wastes an order the engine refuses, naming it by label", () => {
    const { server, matchId } = openedMatch();
    const order = { from: "B6", to: "D6", troops: 2 };
    const attempt = { orders: [order], intent: "two steps", prediction: "arrive" };
    // The first attempt is refused and commits nothing, so an order only reaches
    // the engine through a seat that handed it in a second time.
    server.call(matchId, "A", "submit_orders", attempt);
    server.call(matchId, "A", "submit_orders", attempt);

    expect(server.resolveTurn(matchId).events).toEqual([]);

    const record = server.turnRecord(matchId, 1);
    // The submission is logged as the seat made it, and the engine's verdict
    // comes back beside it.
    expect(record.A.orders).toEqual([order]);
    expect(record.A.wasted).toEqual([{ order, reason: "hexes are not adjacent" }]);
    expect(server.match(matchId).state.hexes["-3,0"]).toMatchObject({ owner: null, troops: 0 });
  });

  it("remembers last turn for the seat that played it", () => {
    const { server, matchId } = openedMatch();
    const move = { from: "B6", to: "C6", troops: 2 };
    server.call(matchId, "A", "submit_orders", { orders: [move], intent: "take C6", prediction: "uncontested" });
    server.resolveTurn(matchId);

    expect(server.match(matchId).lastTurn).toEqual({
      events: [{ type: "capture", at: "C6", by: "A", from: null, terrain: "plain" }],
      orders: { A: [move], B: [] },
      wasted: { A: [], B: [] },
    });
  });
});

describe("turnRecord", () => {
  it("writes each seat's turn in the log's per-player shape", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "A", "get_state", {});
    server.call(matchId, "A", "submit_orders", {
      orders: [{ from: "B6", to: "C6", troops: 2 }],
      intent: "take C6",
      prediction: "uncontested",
    });
    const { events } = server.resolveTurn(matchId);

    const record = server.turnRecord(matchId, 1);
    for (const seat of ["A", "B"] as const) {
      const parsed = turnPlayerSchema.safeParse(record[seat]);
      if (!parsed.success) throw new Error(`${seat}: ${JSON.stringify(parsed.error.issues)}`);
      // Nothing was dropped or defaulted on the way through the schema.
      expect(parsed.data).toEqual(record[seat]);
    }
    expect(turnEventSchema.array().safeParse(events).success).toBe(true);

    expect(record.A.orders).toEqual([{ from: "B6", to: "C6", troops: 2 }]);
    expect(record.A.intent).toBe("take C6");
    expect(record.A.notes_after).toBe("");
    expect(record.A.rejected_submission).toBeNull();
    expect(record.A.scouts).toEqual([]);
    // The runner replaces what only the seat's own process can know.
    expect(record.A.usage).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
    expect(record.A.cost_usd).toBe(0);
    expect(record.A.context_tokens).toBe(0);
    expect(record.A.compacted).toBe(false);
  });

  it("reads the open turn before it is resolved, with nothing wasted yet", () => {
    const { server, matchId } = openedMatch();
    server.call(matchId, "B", "submit_orders", {
      orders: [{ from: "J6", to: "I6", troops: 1 }],
      intent: "edge out",
      prediction: "an empty hex",
    });

    const record = server.turnRecord(matchId, 1);
    expect(record.B.orders).toEqual([{ from: "J6", to: "I6", troops: 1 }]);
    expect(record.B.wasted).toEqual([]);
    expect(record.B.passed).toBeNull();
    expect(record.A.passed).toBe("no_submission");
  });
});
