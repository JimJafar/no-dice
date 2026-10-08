/**
 * The sentence above the board: what one turn of a log did, in the shape the
 * mock-up's turn 11 line has (`salient/docs/mockups/spectator-view.html`),
 * "A takes the centre Node, 5 against 3, and cuts off five of B's hexes".
 *
 * Every sentence here is the log's own: the clauses come from `turns[n].events`
 * and the `cut_off` cells of `turns[n].after`, so the tests read the fixtures
 * rather than hand-built events, and a sentence that moves means the log says
 * something different. The golden logs cover the four event types between them:
 * golden-01 the fights and the supply, golden-02 a clash and a repelled attack
 * and a Base changing hands, golden-04 and golden-05 turns that logged nothing.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

import { headline } from "./headline.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import golden02 from "../fixtures/golden-02-knockout-by-A.json";
import golden03 from "../fixtures/golden-03-knockout-by-B.json";
import golden04 from "../fixtures/golden-04-mirror-draw.json";
import golden05 from "../fixtures/golden-05-random-chaos.json";

/** The match the mock-ups were drawn from. */
const log = matchLogSchema.parse(golden01);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/**
 * The same match with one hex of A's, at turn 11, left out of supply — which no
 * golden turn does, so the both-seats supply clause has to be asked for.
 */
function withAAlsoCutOff(): MatchLog {
  const source = structuredClone(golden01) as Record<string, unknown>;
  const turns = source.turns as { n: number; after: { cells: [number, number, number, number][] } }[];
  const cells = turns.find((turn) => turn.n === TURN_11)!.after.cells;
  cells[cells.findIndex((cell) => cell[0] === 1)][3] = 1;
  return matchLogSchema.parse(source);
}

/** golden-04's turn 16, which logged no events at all, with the seats' pass reasons set. */
function quietTurn(passA: string | null, passB: string | null): MatchLog {
  const source = structuredClone(golden04) as Record<string, unknown>;
  const turns = source.turns as { n: number; players: { A: Record<string, unknown>; B: Record<string, unknown> } }[];
  const turn = turns.find((t) => t.n === 16)!;
  turn.players.A.passed = passA;
  turn.players.B.passed = passB;
  return matchLogSchema.parse(source);
}

describe("headline", () => {
  it("names the Node capture, the 5 against 3 fight and the five cut-off hexes at turn 11", () => {
    // The mock-up's line, which is drawn from this turn: F6 is the map's centre
    // Node, the battle there was 5 troops to 3, and the turn leaves B's F1, G1,
    // H1, H2 and G3 out of supply.
    expect(headline(log, TURN_11)).toBe(
      "B takes K2, A takes G4, A takes the Node, 5 against 3, and cuts off five of B's hexes",
    );
  });

  it("names a Node and a Base by what they are, and a plain hex by its label", () => {
    // F6 is a Node and J6 is B's Base; G4 and K2 are plain, so they keep the
    // labels the orders and the intent text use.
    expect(headline(log, TURN_11)).toContain("A takes the Node");
    expect(headline(log, TURN_11)).toContain("B takes K2");
    expect(headline(log, TURN_11)).not.toContain("F6");
    expect(headline(matchLogSchema.parse(golden02), 23)).toContain("A takes B's Base, 14 against 6");
  });

  it("names the fight that took a plain hex as well as the one that took a Node", () => {
    // Turn 12 is two battles, each followed by the capture it won.
    expect(headline(log, 12)).toBe("B takes G5, 1 against 4, A takes E7, 3 against 1, and cuts off five of B's hexes");
  });

  it("leaves out a battle that led to no capture", () => {
    // Turn 14 ends with a fight at F7 that left the hex where it was, so the
    // turn's sentence does not mention F7 at all.
    expect(headline(log, 14)).toBe("A takes F5, 3 against 1, B takes the Node, 4 against 7, and A cuts off five of B's hexes");
    expect(headline(log, 14)).not.toContain("F7");
  });

  it("reads a clash as the two seats meeting on the edge between two hexes", () => {
    // Turn 20 of golden-02: both seats crossed the edge between H5 and I5, A
    // with 5 troops and B with 1.
    expect(headline(matchLogSchema.parse(golden02), 20)).toBe(
      "A and B clash on the edge between H5 and I5, 5 against 1, A takes I5, and A takes I7",
    );
  });

  it("reads a repelled as the seat turned back and the size of the force", () => {
    // Turn 16 of golden-02 is only that: B's single troop at plain H4 turned back.
    expect(headline(matchLogSchema.parse(golden02), 16)).toBe("B is repelled at H4, one troop turned back");
    // Turn 6 of the same match turns back two troops at a Node.
    expect(headline(matchLogSchema.parse(golden02), 6)).toContain("B is repelled at the Node, two troops turned back");
  });

  it("counts the cut-off hexes the turn leaves for each seat, naming who cut them off", () => {
    // A's hex cut off as well as B's five: the clause names the seat whose
    // advance did it, so the two clauses cannot be read as one seat's news.
    expect(headline(withAAlsoCutOff(), TURN_11)).toBe(
      "B takes K2, A takes G4, A takes the Node, 5 against 3, " +
        "B cuts off one of A's hexes, and A cuts off five of B's hexes",
    );
  });

  it("leaves out the supply clause when the turn leaves nobody out of supply", () => {
    expect(headline(log, 1)).toBe(
      "A takes B5, A takes C5, A takes C6, B takes I6, A takes B7, B takes I7, and B takes J7",
    );
  });

  it("says no hex changed hands for a turn that logged no events", () => {
    // Both golden-04's turn 16 and golden-05's turn 14 are orders that moved
    // troops between hexes their owner already held.
    expect(headline(matchLogSchema.parse(golden04), 16)).toBe("No hex changed hands");
    expect(headline(matchLogSchema.parse(golden05), 14)).toBe("No hex changed hands");
  });

  it("says which seat passed, and why, when a turn logged no events", () => {
    expect(headline(quietTurn("timeout", null), 16)).toBe("A ran out of time, and no hex changed hands");
    expect(headline(quietTurn("token_budget", "no_submission"), 16)).toBe(
      "A ran out of output tokens, B sent no orders, and no hex changed hands",
    );
    // The two timeouts side by side, so the sentence cannot blur them: `timeout`
    // is the runner cutting off a seat that was playing, `prompt_timeout` a seat
    // the harness never got an answer from at all.
    expect(headline(quietTurn("prompt_timeout", "timeout"), 16)).toBe(
      "A never took the prompt, B ran out of time, and no hex changed hands",
    );
  });

  it("gives a knockout turn a sentence rather than an empty line", () => {
    // The turn that ends golden-02 takes B's Base, and the one that ends
    // golden-03 takes A's; neither logs a special knockout event.
    expect(headline(matchLogSchema.parse(golden02), 23)).toBe(
      "B takes K2, A takes K4, A takes B's Base, 14 against 6, B takes G10, and A cuts off nine of B's hexes",
    );
    expect(headline(matchLogSchema.parse(golden03), 19)).toContain("B takes A's Base, 2 against 9");
  });

  it("opens the replay on the start position rather than an empty line", () => {
    expect(headline(log, 0)).toBe("The match opens with A holding its Base at B6 and B holding its Base at J6");
  });

  it("refuses a turn the log does not hold", () => {
    expect(() => headline(log, 26)).toThrow(/turn 26/);
    expect(() => headline(log, -1)).toThrow(/turn -1/);
  });
});
