/**
 * The fog of war, worked out from the log and nothing else.
 *
 * The rule is the rules' ("Visibility and scouting"), restated here because the
 * viewer never imports the engine: a seat sees the hexes it owns and every hex
 * next to them, and the rest of the board is hidden. Terrain is never hidden, so
 * a hidden hex is a hex whose owner, troops and garrison are unknown — not a hex
 * that stops being drawn.
 *
 * The ground truth is the mock-up: `salient/docs/mockups/fog-of-war-view.html`
 * draws turn 11 of golden-01 as Player B knows it at the start of turn 12, and
 * hides 27 playable hexes doing it. What the frame does with those hexes — the
 * fog background, the `?` — is `render-board.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog, Seat } from "@no-dice/log";

import { AXIAL_DELTAS, fogView } from "./fog.ts";

import golden01 from "../fixtures/golden-01-time-win.json";
import golden02 from "../fixtures/golden-02-knockout-by-A.json";
import golden03 from "../fixtures/golden-03-knockout-by-B.json";
import golden04 from "../fixtures/golden-04-mirror-draw.json";
import golden05 from "../fixtures/golden-05-random-chaos.json";

/** Every golden match, validated the way the viewer validates every log. */
const logs: readonly MatchLog[] = [golden01, golden02, golden03, golden04, golden05].map((log) =>
  matchLogSchema.parse(log),
);

/** The turn the mock-ups were drawn from. */
const TURN_11 = 11;

/** The 27 playable hexes the fog mock-up hides, in the order golden-01's map lists them. */
const MOCKUP_HIDDEN_B = [
  "D3", "C4", "D4", "E4", "B5", "C5", "D5", "E5", "F5", "A6", "B6", "C6", "D6", "A7", "B7",
  "C7", "A8", "B8", "C8", "B9", "D9", "A10", "B10", "D10", "A11", "B11", "D11",
];

/** The labels of `log`'s hexes that fogView hides, in the map's own order. */
function hiddenLabels(log: MatchLog, turn: number, seat: Seat): string[] {
  const view = fogView(log, turn, seat);
  return log.map.filter((hex) => view.hidden.has(hex.id)).map((hex) => hex.id);
}

describe("fogView", () => {
  it("hides the mock-up's 27 playable hexes from B at turn 11", () => {
    const log = logs[0]!;
    const hidden = log.map.filter((hex) => fogView(log, TURN_11, "B").hidden.has(hex.id));
    // The mock-up hides exactly these, and counts them as the playable ones: a
    // blocked hex is drawn as blocked whether a seat can see it or not, having
    // no owner and no troops either way.
    expect(hidden.filter((hex) => hex.terrain !== "blocked").map((hex) => hex.id)).toEqual(MOCKUP_HIDDEN_B);
    expect(hidden.filter((hex) => hex.terrain === "blocked").map((hex) => hex.id)).toEqual([
      "E3", "A9", "C9", "C10", "C11",
    ]);
  });

  it("shows B the hexes it owns and every hex next to them, and no others", () => {
    const log = logs[0]!;
    const view = fogView(log, TURN_11, "B");

    // B holds H5 with 8 troops, so it sees H5 and every hex around it: the
    // A-held G5 among them, the blocked G6, and B's own H4, I4, I5 and H6.
    expect(view.visible.has("H5")).toBe(true);
    for (const neighbour of ["G5", "G6", "H4", "I4", "I5", "H6"]) expect(view.visible.has(neighbour), neighbour).toBe(true);
    // B's Base, and the Node on its own half, are seen.
    expect(view.visible.has("J6")).toBe(true);
    expect(view.visible.has("H6")).toBe(true);
    // A's half of the board, two hexes past B's front line, is not.
    for (const far of ["B6", "C6", "D6", "D9", "A11"]) expect(view.hidden.has(far), far).toBe(true);
  });

  it("leaves no hex of the map neither seen nor hidden", () => {
    const log = logs[0]!;
    for (const seat of ["A", "B"] as const) {
      const view = fogView(log, TURN_11, seat);
      const labels = log.map.map((hex) => hex.id);
      const both = labels.filter((id) => view.visible.has(id) && view.hidden.has(id));
      const neither = labels.filter((id) => !view.visible.has(id) && !view.hidden.has(id));
      expect(both, `${seat} sees and does not see the same hex`).toEqual([]);
      expect(neither, `${seat} has no view of some hex`).toEqual([]);
      expect(view.visible.size + view.hidden.size).toBe(log.map.length);
    }
  });

  it("hides a Base whose position is still known", () => {
    const log = logs[0]!;
    // A's Base is out of B's sight at turn 11, and B's is out of A's: the fog
    // view says so, and the renderer still draws both, because the log's map
    // says where they are.
    expect(fogView(log, TURN_11, "B").hidden.has("B6")).toBe(true);
    expect(fogView(log, TURN_11, "A").hidden.has("J6")).toBe(true);
    // A seat always sees the Base it still stands on.
    expect(fogView(log, TURN_11, "A").visible.has("B6")).toBe(true);
    expect(fogView(log, TURN_11, "B").visible.has("J6")).toBe(true);
  });

  it("reads the board the frame shows, not the one before it", () => {
    const log = logs[0]!;
    // Turn 0 is the start position: each seat holds only its Base, so it sees
    // that Base and its six neighbours and nothing else, in the map's own order.
    const seenAt0 = log.map.filter((hex) => fogView(log, 0, "A").visible.has(hex.id)).map((hex) => hex.id);
    expect(seenAt0).toEqual(["B5", "C5", "A6", "B6", "C6", "A7", "B7"]);
    // A turn later both seats have moved, and the fog has moved with them: the
    // view belongs to the board the frame draws, which is why the mock-up's
    // frame is turn 11's board as B knows it at the start of turn 12.
    expect(hiddenLabels(log, 1, "A")).not.toEqual(hiddenLabels(log, 0, "A"));
    expect(hiddenLabels(log, 1, "B")).not.toEqual(hiddenLabels(log, 0, "B"));
    expect(hiddenLabels(log, 12, "B")).not.toEqual(hiddenLabels(log, 11, "B"));
  });

  it("refuses a turn the log does not hold, like the board does", () => {
    expect(() => fogView(logs[0]!, 26, "A")).toThrow(/turn 26/);
  });

  it("keeps every hex a seat owns inside that seat's view, in every match and every turn", () => {
    for (const log of logs) {
      for (const turn of [0, ...log.turns.map((record) => record.n)]) {
        const cells = turn === 0 ? log.start.cells : log.turns.find((record) => record.n === turn)!.after.cells;
        for (const seat of ["A", "B"] as const) {
          const view = fogView(log, turn, seat);
          const owner = seat === "A" ? 1 : 2;
          const owned = log.map.flatMap((hex, i) => (cells[i][0] === owner ? [hex.id] : []));
          for (const label of owned) expect(view.visible.has(label), `${label} owned by ${seat} at turn ${turn}`).toBe(true);
        }
      }
    }
  });
});

describe("AXIAL_DELTAS", () => {
  it("steps to the six neighbours of any coordinate, and to nothing else", () => {
    // Six steps, each one hex long, in opposite pairs: the axial neighbours of
    // `(q, r)` on a pointy-top grid, which is what the log's `q`/`r` measure.
    expect(AXIAL_DELTAS).toHaveLength(6);
    const keys = new Set(AXIAL_DELTAS.map(([dq, dr]) => `${dq},${dr}`));
    expect(keys.size).toBe(6);
    for (const [dq, dr] of AXIAL_DELTAS) {
      expect(Math.abs(dq), `delta ${dq},${dr} across`).toBeLessThanOrEqual(1);
      expect(Math.abs(dr), `delta ${dq},${dr} down`).toBeLessThanOrEqual(1);
      expect(dq === 0 && dr === 0, `delta ${dq},${dr} is a step`).toBe(false);
      expect(keys, `delta ${dq},${dr} has no twin`).toContain(`${-dq},${-dr}`);
    }
  });
});
