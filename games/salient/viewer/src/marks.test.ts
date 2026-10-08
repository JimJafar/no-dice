/**
 * The marks a turn carries: which seats are marked, for what, and in what words.
 *
 * The golden fixtures' scripted bots had nothing to be marked for — no
 * submission was ever refused, no seat passed, no context was compacted — so
 * every mark here is asked for by editing golden-01's turn records and parsing
 * the result back through `matchLogSchema`, which is what proves the marks come
 * from the log rather than from an assumption about the bots that made it.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { Seat, TurnPlayerRecord } from "@no-dice/log";

import { marksFor, marksOfTurn, markText } from "./marks.ts";
import golden01 from "../fixtures/golden-01-time-win.json";

const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** golden-01 with `edit` applied to one seat's record of turn 11. */
function withTurn(seat: Seat, edit: (player: TurnPlayerRecord) => void) {
  const source = structuredClone(golden01) as Record<string, unknown>;
  const turns = source.turns as { n: number; players: Record<Seat, TurnPlayerRecord> }[];
  edit(turns.find((turn) => turn.n === TURN_11)!.players[seat]);
  return matchLogSchema.parse(source);
}

/** The record of turn 11 of a log. */
const turnOf = (logJson: ReturnType<typeof withTurn>) => logJson.turns.find((turn) => turn.n === TURN_11)!;

describe("the marks of a turn", () => {
  it("finds nothing to mark in the scripted bots' turn", () => {
    expect(marksOfTurn(turnOf(log))).toEqual([]);
  });

  it("marks a refused first submission with the reasons from its wasted entries", () => {
    const marked = withTurn("A", (player) => {
      player.rejected_submission = {
        orders: [{ from: "F5", to: "F7", troops: 2 }],
        wasted: [{ order: { from: "F5", to: "F7", troops: 2 }, reason: "hexes are not adjacent" }],
      };
    });
    const [mark] = marksOfTurn(turnOf(marked));
    expect(mark?.seat).toBe("A");
    expect(mark?.rejected).toEqual(["hexes are not adjacent"]);
  });

  it("marks a pass with the reason the log names, and a compaction on its own", () => {
    const passed = withTurn("B", (player) => {
      player.passed = "token_budget";
    });
    expect(marksOfTurn(turnOf(passed))).toEqual([{ seat: "B", rejected: [], passed: "token_budget", compacted: false }]);

    const compacted = withTurn("A", (player) => {
      player.compacted = true;
    });
    expect(marksOfTurn(turnOf(compacted))[0]?.compacted).toBe(true);
  });

  it("says a seat that never took the prompt in words that are not the turn cap", () => {
    // `timeout` is brief §6.3's turn cap: the runner stopping a seat that was
    // playing. `prompt_timeout` is the harness giving up on the `prompt` command
    // itself, so the mark says the seat never took the question, and a reader
    // cannot turn one into the other.
    const wedged = withTurn("A", (player) => {
      player.passed = "prompt_timeout";
    });
    const [mark] = marksOfTurn(turnOf(wedged));
    expect(mark).toEqual({ seat: "A", rejected: [], passed: "prompt_timeout", compacted: false });
    expect(markText(mark!)).toEqual(["passed: never took the prompt"]);

    const capped = withTurn("A", (player) => {
      player.passed = "timeout";
    });
    expect(markText(marksOfTurn(turnOf(capped))[0]!)).toEqual(["passed: ran out of time"]);
  });

  it("lists both seats when both are marked, A first", () => {
    const source = structuredClone(golden01) as Record<string, unknown>;
    const turns = source.turns as { n: number; players: Record<Seat, TurnPlayerRecord> }[];
    const turn = turns.find((t) => t.n === TURN_11)!;
    turn.players.A.compacted = true;
    turn.players.B.passed = "no_submission";
    expect(marksOfTurn(turnOf(matchLogSchema.parse(source)))).toEqual([
      { seat: "A", rejected: [], passed: null, compacted: true },
      { seat: "B", rejected: [], passed: "no_submission", compacted: false },
    ]);
  });

  it("leaves a seat with no marks out of the turn's marks altogether", () => {
    const oneSeat = withTurn("B", (player) => {
      player.rejected_submission = {
        orders: [{ from: "H6", to: "H7", troops: 4 }],
        wasted: [{ order: { from: "H6", to: "H7", troops: 4 }, reason: "destination is blocked" }],
      };
    });
    const marks = marksOfTurn(turnOf(oneSeat));
    expect(marks.map((mark) => mark.seat)).toEqual(["B"]);
    expect(marks[0]?.rejected).toEqual(["destination is blocked"]);
  });

  it("reads one seat's record on its own, for a panel that shows one seat", () => {
    const record = turnOf(log);
    expect(marksFor(record.players.A, "A")).toEqual({ seat: "A", rejected: [], passed: null, compacted: false });
  });
});
