/**
 * How a log reaches the viewer, and what answers a file that is not one. The
 * three sources are the ones `main.ts` wires — the file picker and a drop hand
 * over a `File`, `?log=` hands over a URL — and all three end in the same
 * `parseLog`, so the test asserts they end in the same log.
 */
import { describe, expect, it } from "vitest";

import { parseLog, pickLogSource, readLogSource } from "./load.ts";
import type { LogFile, LogSource } from "./load.ts";

/** The smallest log `matchLogSchema` accepts: two hexes, no turns played. */
const LOG = {
  format: "salient-log/1",
  ruleset: "v0",
  engine_version: "0.1.0",
  created: "2026-10-04T22:00:00Z",
  seed: 135,
  config: {
    turns: 25,
    action_points: 6,
    start_troops: 5,
    base_production: 2,
    node_production: 1,
    node_garrison: 3,
    home_bonus: 1,
    points: { plain: 1, base: 1, node: 3 },
  },
  harness: {
    pi_version: null,
    context: "continuous",
    compaction: false,
    tool_call_cap: 0,
    simulate_cap: 0,
    resubmissions: 0,
    turn_timeout_s: 0,
    output_token_budget: null,
  },
  players: { A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "raider" } },
  map: [
    { id: "B6", q: -4, r: 0, terrain: "base" },
    { id: "F6", q: 0, r: 0, terrain: "node" },
  ],
  bases: { A: "B6", B: "F6" },
  start: { cells: [[1, 5, 0, 0], [0, 0, 3, 0]], score: { A: 1, B: 0 } },
  turns: [],
  result: { type: "time", winner: "A", turn: 25, score: { A: 1, B: 0 }, margin: 1 },
};

const LOG_TEXT = JSON.stringify(LOG);

/** The file a source names, failing the test if it names none. */
function fileOf(source: LogSource): LogFile {
  if (source.kind !== "file") throw new Error(`expected a file source, got ${source.kind}`);
  return source.file;
}

/** A copy of the fixture with one field replaced, so each case changes only what it tests. */
function logWith(patch: Record<string, unknown>): string {
  return JSON.stringify({ ...structuredClone(LOG), ...patch });
}

describe("pickLogSource", () => {
  it("says there is no log yet when nothing was given", () => {
    expect(pickLogSource("", [])).toEqual({ kind: "none" });
    expect(pickLogSource("?seed=135", [])).toEqual({ kind: "none" });
    // An empty `?log=` names nothing, and is not a URL to fetch.
    expect(pickLogSource("?log=", [])).toEqual({ kind: "none" });
  });

  it("takes the URL ?log= names", () => {
    expect(pickLogSource("?log=/fixtures/golden-01-time-win.json", [])).toEqual({
      kind: "url",
      url: "/fixtures/golden-01-time-win.json",
    });
    // The search string arrives without its `?` when it is assembled by hand.
    expect(pickLogSource("log=match.json", [])).toEqual({ kind: "url", url: "match.json" });
  });

  it("takes a picked or a dropped file, and the first one when a drop carries several", () => {
    const picked = new File([LOG_TEXT], "match.json", { type: "application/json" });
    const dropped = new File([LOG_TEXT], "dropped.json", { type: "application/json" });
    expect(pickLogSource("", [picked])).toEqual({ kind: "file", file: picked });
    expect(pickLogSource("", [dropped])).toEqual({ kind: "file", file: dropped });
    expect(fileOf(pickLogSource("", [picked, dropped]))).toBe(picked);
  });

  it("prefers a file handed over now to the ?log= the page was opened with", () => {
    // The query string is the same on every later load, so it cannot outrank a
    // file the viewer was just given.
    const picked = new File([LOG_TEXT], "match.json", { type: "application/json" });
    expect(fileOf(pickLogSource("?log=/fixtures/golden-01-time-win.json", [picked]))).toBe(picked);
  });
});

describe("readLogSource", () => {
  it("reads the same log from the picker, a drop and ?log=", async () => {
    const picked = new File([LOG_TEXT], "match.json", { type: "application/json" });
    const dropped = new File([LOG_TEXT], "dropped.json", { type: "application/json" });
    const url = `data:application/json,${encodeURIComponent(LOG_TEXT)}`;

    const fromPicker = await readLogSource(pickLogSource("", [picked]));
    const fromDrop = await readLogSource(pickLogSource("", [dropped]));
    const fromQuery = await readLogSource(pickLogSource(`?log=${url}`, []));

    expect(fromPicker).toBe(LOG_TEXT);
    expect(fromDrop).toBe(fromPicker);
    expect(fromQuery).toBe(fromPicker);
  });

  it("refuses to read a source that names no log", async () => {
    await expect(readLogSource(pickLogSource("", []))).rejects.toThrow(/no log/);
  });
});

describe("parseLog", () => {
  it("accepts a salient-log/1 log and changes nothing in it", () => {
    expect(parseLog(LOG_TEXT)).toEqual(LOG);
  });

  it("says that a file which is not JSON is not a log", () => {
    expect(() => parseLog("<!doctype html><html></html>")).toThrow(/not JSON/);
    expect(() => parseLog("")).toThrow(/not JSON/);
  });

  it("says that a log in the prototype's shape is not a salient-log/1 log", () => {
    // The golden logs still have no `format` field, so this is the file a
    // viewer user is most likely to pick by mistake.
    const prototype = { seed: 135, cfg: { turns: 25 }, turns: [], players: {} };
    expect(() => parseLog(JSON.stringify(prototype))).toThrow(/not a salient-log\/1 log/);
    expect(() => parseLog(JSON.stringify(prototype))).toThrow(/format/);
  });

  it("names the field a log is wrong on, by its path in the log", () => {
    expect(() => parseLog(logWith({ map: [...LOG.map, { id: "G6", q: 1, r: 0, terrain: "plain" }] }))).toThrow(
      "start.cells holds 2 cells for a map of 3 hexes",
    );
    // An array index is part of the path, so a bad hex in a list is findable.
    expect(() => parseLog(logWith({ map: [{ id: "4,0", q: -4, r: 0, terrain: "base" }] }))).toThrow(/map\.0\.id/);
  });

  it("lists a few problems and says how many more there are", () => {
    let message = "";
    try {
      parseLog("{}");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/format: .*salient-log\/1/);
    expect(message).toMatch(/\(and \d+ more\)/);
    // Five problems listed, then the count of the rest.
    expect(message.split("; ")).toHaveLength(6);
  });
});
