/**
 * What the console answers about each finished match: `GET /api/match-facts`
 * and the rows it gives — the two seats, the winner, the final score, the seed and
 * the day, beside the `url`, `viewerUrl` and `series` `/api/matches` gives.
 *
 * **The facts are checked against the log, not against a second reading of it.**
 * Each test that reads a real log parses the same file again with `JSON.parse` and
 * requires the row to carry that file's own `seed`, `created` and `result`
 * fields. That is the acceptance: the route reports what the log says, and a row
 * that quietly recomputed a score or took a winner from the series record would
 * fail here. The one label the log does not spell out — a seat's name — is checked
 * against `playerLabel`'s spelling, which is the stats package's and not this
 * file's.
 *
 * **The two answers are the same logs.** Each test asks `/api/matches` as
 * well and requires the fact rows and the listing rows to be the same logs,
 * with the same URLs, in the same order — the reason this route walks the roots
 * through `matchRows` rather than with a walk of its own.
 *
 * **A log that will not parse is one entry in `unreadable`.** Fixtures put a file
 * that is not JSON and a file that is JSON but not a log beside one that is, and
 * the answer has to keep the good row and name both failures with the line each
 * failed on — the same shape an unreadable series record already has on
 * `/api/series`.
 *
 * Every run is bot against bot, because that is the only kind a test may start:
 * one model match is nineteen minutes and 4.59M tokens
 * (`docs/pi-harness-notes.md` §7), a bot match 1.3 s. The pi seat in the fixture
 * log is a header only — nothing here seats a model. The two roots are always
 * somewhere other than the current directory.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as seriesReport from "@no-dice/stats/series-report";
import type { PlayerHeader } from "@no-dice/log";

import { MATCH_FACTS_PATH, factsOfRow, matchFactsRows } from "./match-facts.ts";
import type { MatchFactsListing } from "./match-facts.ts";
import * as results from "./results.ts";
import type { MatchListing, MatchRow } from "./results.ts";
import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";

/** A response, read to the end. */
interface Answer {
  status: number;
  body: string;
}

/** One finished log as its own JSON spells it, which is what the rows are checked against. */
interface RawLog {
  seed: number;
  created: string;
  players: { A: PlayerHeader; B: PlayerHeader };
  result: { type: string; winner: "A" | "B" | null; turn: number; score: { A: number; B: number }; margin: number };
}

let server: Server | null = null;
const temps: string[] = [];

/** A temp directory for this test, removed when the test ends. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Listen on a free port, and hand that port back. */
async function listen(options: UiOptions): Promise<number> {
  server = await startServer(options);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the console did not listen on a TCP port");
  }
  return address.port;
}

/** One request, with the body sent as JSON and the answer read to the end. */
const send = (port: number, path: string, method: string, body?: unknown): Promise<Answer> =>
  new Promise((done, failed) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: HOST,
        port,
        path,
        method,
        agent: false,
        headers: payload === undefined ? {} : { "content-type": "application/json" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          done({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", failed);
    req.end(payload);
  });

const get = (port: number, path: string): Promise<Answer> => send(port, path, "GET");
const post = (port: number, path: string, body: unknown): Promise<Answer> =>
  send(port, path, "POST", body);

/** A console's three roots, and the directory it runs in — none of them the cwd. */
function rootsAt(): { cwd: string; seriesRoot: string; matchesRoot: string; reportsRoot: string } {
  const home = tempDir("nd-ui-facts-");
  const cwd = join(home, "repo");
  mkdirSync(cwd, { recursive: true });
  return {
    cwd,
    seriesRoot: join(home, "elsewhere", "series"),
    matchesRoot: join(home, "elsewhere", "matches"),
    reportsRoot: join(home, "elsewhere", "reports", "series"),
  };
}

/** A console listening on a free port, with those roots. */
function consoleAt(options: Partial<UiOptions> = {}): { port: Promise<number> } & ReturnType<typeof rootsAt> {
  const at = rootsAt();
  return { ...at, port: listen({ port: 0, ...at, ...options }) };
}

/** The series the tests start: two bots, one pair, so two matches. */
const SERIES = { game: "salient", a: "bot:greedy", b: "bot:random", maxPairs: 1 };

/** The match the tests start: two bots, one seed, nothing to type. */
const MATCH = { game: "salient", a: "bot:greedy", b: "bot:random", seed: 135 };

/** The run snapshot at `/api/run`, parsed. */
interface Snapshot {
  state: string;
  dir: string | null;
  exitCode: number | null;
}

const snapshotAt = async (port: number): Promise<Snapshot> =>
  JSON.parse((await get(port, "/api/run")).body) as Snapshot;

/**
 * Poll `/api/run` until the run has stopped running. The page polls the same way
 * and at the same granularity; a bot-versus-bot match is 1.3 s, so this is over
 * in a second or two.
 */
async function untilStopped(port: number, limitMs = 60_000): Promise<Snapshot> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const snapshot = await snapshotAt(port);
    if (snapshot.state !== "running") return snapshot;
    if (Date.now() > deadline) throw new Error(`the run was still running after ${String(limitMs)}ms`);
    await new Promise((later) => setTimeout(later, 100));
  }
}

/** Start a run, wait for it, and fail the test if it did not finish cleanly. */
async function runTo(port: number, route: string, body: unknown): Promise<Snapshot> {
  const started = await post(port, route, body);
  expect(started.status, route).toBe(202);
  const done = await untilStopped(port);
  expect(done.state, route).toBe("done");
  expect(done.exitCode, route).toBe(0);
  return done;
}

const seriesAt = async (port: number, body: Record<string, unknown>): Promise<Snapshot> =>
  runTo(port, "/api/run/series", body);

/** `/api/match-facts`, parsed. */
const factsAt = async (port: number): Promise<MatchFactsListing> =>
  JSON.parse((await get(port, MATCH_FACTS_PATH)).body) as MatchFactsListing;

/** `/api/matches`, parsed. */
const matchListingAt = async (port: number): Promise<MatchListing> =>
  JSON.parse((await get(port, "/api/matches")).body) as MatchListing;

/** The log at `path`, as its own JSON spells it. */
const rawLogAt = (path: string): RawLog => JSON.parse(readFileSync(path, "utf8")) as RawLog;

/**
 * A finished log written as a fixture: a draw between the greedy bot and a Pi
 * seat, on a board of two hexes. It parses under `matchLogSchema` — the reader
 * `readLogOf` uses — and it is here because no bot match can be made to draw on
 * purpose, and no test may seat a model to get a Pi seat's label.
 */
const FIXTURE_LOG = {
  format: "salient-log/1",
  ruleset: "v0",
  engine_version: "0.0.0-fixture",
  created: "2026-03-04T05:06:07.008Z",
  seed: 4242,
  config: {
    turns: 25,
    action_points: 3,
    start_troops: 4,
    base_production: 2,
    node_production: 1,
    node_garrison: 1,
    home_bonus: 1,
    points: { plain: 1, base: 3, node: 2 },
  },
  harness: {
    pi_version: null,
    context: "continuous",
    compaction: false,
    tool_call_cap: 8,
    simulate_cap: 2,
    resubmissions: 1,
    turn_timeout_s: 240,
    output_token_budget: null,
  },
  players: {
    A: { kind: "bot", bot: "greedy" },
    B: { kind: "pi", model: "marvin/subagent", thinking: "medium", context_window: 131072 },
  },
  map: [
    { id: "A1", q: 0, r: 0, terrain: "base" },
    { id: "B1", q: 1, r: 0, terrain: "base" },
  ],
  bases: { A: "A1", B: "B1" },
  start: { cells: [[1, 4, 0, 0], [2, 4, 0, 0]], score: { A: 0, B: 0 } },
  turns: [],
  result: { type: "time", winner: null, turn: 25, score: { A: 12, B: 12 }, margin: 0 },
};

/** One log's row, as `matchRows` would hand it over — for the row-level tests. */
const rowFor = (path: string, name: string, series: string | null): MatchRow => ({
  name,
  path,
  url: `/logs/${name}`,
  viewerUrl: `/viewer/?log=/logs/${name}&back=%23matches`,
  series,
});

afterEach(async () => {
  const running = server;
  server = null;
  if (running !== null) {
    running.closeAllConnections();
    await new Promise<void>((closed) => running.close(() => closed()));
  }
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/match-facts", () => {
  it("answers one fact row per finished log, beside the URLs the listing gives it", async () => {
    const at = consoleAt();
    const port = await at.port;

    await seriesAt(port, { ...SERIES, name: "eta" });
    await runTo(port, "/api/run/match", MATCH);

    const facts = await factsAt(port);
    const listing = await matchListingAt(port);

    expect(facts.matchesRoot).toBe(at.matchesRoot);
    expect(facts.unreadable).toEqual([]);

    // The same logs, the same URLs, the same order — one walk, not two.
    expect(facts.matches).toHaveLength(3);
    expect(facts.matches.map((each) => each.url)).toEqual(listing.matches.map((each) => each.url));
    for (const [fact, row] of facts.matches.map((each, index) => [each, listing.matches[index]!] as const)) {
      expect(fact.name).toBe(row.name);
      expect(fact.path).toBe(row.path);
      expect(fact.viewerUrl).toBe(row.viewerUrl);
      expect(fact.series).toBe(row.series);
    }

    // Every fact is the log's own, read out of the file rather than recomputed.
    for (const fact of facts.matches) {
      const raw = rawLogAt(fact.path);
      expect(fact.seed).toBe(raw.seed);
      expect(fact.created).toBe(raw.created);
      expect(fact.score).toEqual(raw.result.score);
      expect(fact.type).toBe(raw.result.type);
      expect(fact.turn).toBe(raw.result.turn);
      expect(fact.margin).toBe(raw.result.margin);
      expect(fact.winner).toBe(raw.result.winner === null ? null : fact.seats[raw.result.winner]);
      expect(Number.isInteger(fact.seed)).toBe(true);
      expect(Number.isNaN(Date.parse(fact.created))).toBe(false);
      // The two seats are the stats package's spelling of the log's own header,
      // not a label this route makes up.
      expect(fact.seats).toEqual({
        A: seriesReport.playerLabel(raw.players.A),
        B: seriesReport.playerLabel(raw.players.B),
      });
    }

    // The two matches of the pair name the series they belong to; the single
    // match, which is only under the matches root, names nothing.
    const bySeries = facts.matches.filter((each) => each.series === "eta");
    const alone = facts.matches.filter((each) => each.series === null);
    expect(bySeries).toHaveLength(2);
    expect(alone).toHaveLength(1);
    expect(alone[0]!.name).toBe("135-greedy-random.json");
    expect(alone[0]!.url).toBe("/logs/135-greedy-random.json");
    expect(alone[0]!.viewerUrl).toBe("/viewer/?log=/logs/135-greedy-random.json&back=%23matches");
    expect(alone[0]!.seed).toBe(135);
    expect(alone[0]!.seats).toEqual({ A: "bot:greedy", B: "bot:random" });
    expect(["bot:greedy", "bot:random"]).toContain(alone[0]!.winner);
    expect(alone[0]!.score.A + alone[0]!.score.B).toBeGreaterThan(0);
  }, 120_000);

  it("names a draw, a Pi seat and a log that will not parse, and lists the rest", async () => {
    const at = consoleAt();
    const port = await at.port;
    mkdirSync(at.matchesRoot, { recursive: true });

    // A draw, spelled as the log spells one: `result.winner` is null.
    writeFileSync(join(at.matchesRoot, "4242-greedy-marvin-subagent.json"), JSON.stringify(FIXTURE_LOG), "utf8");
    // Two logs the console lists and cannot read: not JSON at all, and JSON that
    // is not a `salient-log/1` log.
    writeFileSync(join(at.matchesRoot, "9-greedy-random.json"), "this is not JSON\n", "utf8");
    writeFileSync(join(at.matchesRoot, "8-greedy-random.json"), JSON.stringify({ format: "salient-log/1" }), "utf8");

    const facts = await factsAt(port);
    const listing = await matchListingAt(port);

    // The listing still lists all three; the facts answer one and name two.
    expect(listing.matches).toHaveLength(3);
    expect(facts.matches).toHaveLength(1);

    const [draw] = facts.matches;
    expect(draw!.name).toBe("4242-greedy-marvin-subagent.json");
    expect(draw!.series).toBeNull();
    expect(draw!.url).toBe("/logs/4242-greedy-marvin-subagent.json");
    expect(draw!.viewerUrl).toBe("/viewer/?log=/logs/4242-greedy-marvin-subagent.json&back=%23matches");
    expect(draw!.seed).toBe(4242);
    expect(draw!.created).toBe("2026-03-04T05:06:07.008Z");
    // A seat as `playerLabel` spells one: `bot:<name>` for a bot, the model id for a Pi seat.
    expect(draw!.seats).toEqual({ A: "bot:greedy", B: "marvin/subagent" });
    expect(draw!.winner).toBeNull();
    expect(draw!.score).toEqual({ A: 12, B: 12 });
    expect(draw!.type).toBe("time");
    expect(draw!.turn).toBe(25);
    expect(draw!.margin).toBe(0);

    expect(facts.unreadable).toHaveLength(2);
    for (const broken of facts.unreadable) {
      expect(broken.path).toBe(join(at.matchesRoot, broken.name));
      expect(broken.url).toBe(`/logs/${broken.name}`);
      expect(broken.series).toBeNull();
      expect(broken.error).toContain(broken.path);
    }
    const notJson = facts.unreadable.find((each) => each.name === "9-greedy-random.json")!;
    expect(notJson.error).toContain("not JSON");
    const notALog = facts.unreadable.find((each) => each.name === "8-greedy-random.json")!;
    expect(notALog.error).toContain("not a salient-log/1 log");
  });

  it("answers two empty lists for roots nobody has run anything into", async () => {
    const at = consoleAt();
    const port = await at.port;

    expect(await factsAt(port)).toEqual({ matchesRoot: at.matchesRoot, matches: [], unreadable: [] });
  });
});

describe("the facts of one listed log", () => {
  it("reads the facts a row names, and says which log it could not find", async () => {
    const at = rootsAt();
    mkdirSync(at.matchesRoot, { recursive: true });

    const name = "4242-greedy-marvin-subagent.json";
    writeFileSync(join(at.matchesRoot, name), JSON.stringify(FIXTURE_LOG), "utf8");
    const read = await factsOfRow(rowFor(join(at.matchesRoot, name), name, null));
    expect(read.error).toBeNull();
    expect(read.row!.winner).toBeNull();
    expect(read.row!.seats).toEqual({ A: "bot:greedy", B: "marvin/subagent" });

    // A log the listing named and the disk no longer holds is a line naming the
    // file, not a row with nothing in it.
    const gone = await factsOfRow(rowFor(join(at.matchesRoot, "7-greedy-random.json"), "7-greedy-random.json", null));
    expect(gone.row).toBeNull();
    expect(gone.error).toContain(join(at.matchesRoot, "7-greedy-random.json"));
    expect(gone.error).toContain("not on disk");
  });

  it("walks the roots once and reads each listed log exactly once", async () => {
    const at = rootsAt();
    mkdirSync(at.matchesRoot, { recursive: true });
    for (const seed of [1, 2, 3]) {
      writeFileSync(
        join(at.matchesRoot, `${String(seed)}-greedy-random.json`),
        JSON.stringify({ ...FIXTURE_LOG, seed }),
        "utf8",
      );
    }

    // The spies call through to the real walk and the real reader: what is
    // asserted is the count. Every log under both roots, about a megabyte each
    // (`docs/pi-harness-notes.md` §7), is the whole cost of this route, and a
    // second walk or a second read of the same file is how it gets slow.
    const walked = vi.spyOn(results, "matchRows");
    const read = vi.spyOn(seriesReport, "readLogOf");
    const listing = await matchFactsRows(at);

    expect(listing.matches.map((each) => each.seed)).toEqual([1, 2, 3]);
    expect(listing.unreadable).toEqual([]);
    expect(walked).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(3);
    walked.mockRestore();
    read.mockRestore();
  });
});
