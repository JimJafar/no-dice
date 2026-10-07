/**
 * The counters the page is shown while a series is in flight, and the record they
 * come from.
 *
 * The rule these tests hold is that the counters are the series' own figures and
 * nothing else: `readRunCounters` reads the `series.json` the runner is writing,
 * and `GET /api/run` answers with what that file said at the moment it was asked.
 * There is no arithmetic here that the runner does not also do, and no reading of
 * the CLI's lines, because a counter derived from a line would be a second figure
 * that could disagree with the report.
 *
 * The integration half runs a real bot-versus-bot series in this process — the
 * only kind a test may start, a model match being nineteen minutes and 4.59M
 * tokens (`docs/pi-harness-notes.md` §7) — and polls it the way the page does.
 * The comparison against the file on disk is a sandwich rather than an equality:
 * the record is read, then the snapshot, then the record again, and the snapshot
 * has to sit between the two. The record only ever moves forward, at a batch
 * boundary, so a snapshot that agreed with neither would be a snapshot that had
 * read something the series never wrote.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readRunCounters } from "./progress.ts";
import type { RunCounters } from "./progress.ts";
import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";

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

/** A series directory holding `text` as its `series.json`, exactly as written. */
function rawDir(text: string): string {
  const dir = tempDir("nd-ui-record-");
  writeFileSync(join(dir, "series.json"), text, "utf8");
  return dir;
}

/** A series directory holding `record`, as the runner would have left it. */
function recordDir(record: unknown): string {
  return rawDir(`${JSON.stringify(record, null, 2)}\n`);
}

/** One pair of a record: two matches, in the shape `series.ts` writes them. */
const pairOf = (seed: number, matches: readonly unknown[]): unknown => ({ seed, matches });

/** One played match, with the figures a record keeps for it. */
const playedOf = (seat: "A" | "B", costUsd: number, tokens: number): unknown => ({
  seat,
  path: `/series/x/1-${seat}.json`,
  status: "played",
  result: { type: "time", winner: seat, margin: 3 },
  cost_usd: costUsd,
  tokens: { input: tokens, output: 0, cache_read: 0, cache_write: 0, total: tokens },
});

/** A failed match: no log, no figures. */
const failedOf = (seat: "A" | "B"): unknown => ({
  seat,
  path: `/series/x/failed-${seat}.json`,
  status: "failed",
  error: "MatchVoided: a seat called a tool by the bare name (tool_name)",
});

describe("readRunCounters", () => {
  it("reads the figures a finished series' record carries, summed over its played matches", () => {
    const dir = recordDir({
      seed_base: 7,
      max_pairs: 6,
      seeds: [1, 2, 3, 4, 5, 6],
      pairing: { a: { kind: "bot", bot: "greedy" }, b: { kind: "bot", bot: "random" } },
      pairs: [
        pairOf(1, [playedOf("A", 0.25, 160), playedOf("B", 0.5, 240)]),
        pairOf(2, [playedOf("A", 1.25, 1000), failedOf("B")]),
      ],
      state: {
        pairs_played: 1,
        matches_played: 3,
        matches_failed: 1,
        stop_reason: "max_tokens",
        stopped_early: true,
      },
      stop: {
        reason: "max_tokens",
        ceiling_tokens: 1000,
        totals: { cost_usd: 2, tokens: { input: 1400, output: 0, cache_read: 0, cache_write: 0, total: 1400 } },
        test: null,
      },
    });

    expect(readRunCounters(dir)).toEqual({
      maxPairs: 6,
      pairsPlayed: 1,
      pairsRemaining: 5,
      matchesPlayed: 3,
      matchesFailed: 1,
      // Summed over the played entries only: the failed match contributes nothing.
      costUsd: 2,
      tokens: 1400,
      stopReason: "max_tokens",
      stoppedEarly: true,
    });
  });

  it("reads the record a series writes before it has played anything as nothing played", () => {
    // `planSeries` writes the seed list first; `runSeries` adds `pairs` and `state`
    // at the first batch boundary. A series caught in between has drawn its pairs
    // and played none of them, and that is what the counters have to say.
    const dir = recordDir({ seed_base: 7, max_pairs: 75, seeds: [1, 2, 3] });

    expect(readRunCounters(dir)).toEqual({
      maxPairs: 75,
      pairsPlayed: 0,
      pairsRemaining: 75,
      matchesPlayed: 0,
      matchesFailed: 0,
      costUsd: 0,
      tokens: 0,
      stopReason: null,
      stoppedEarly: null,
    });
  });

  it("says there is no record for a directory that has none, or one it cannot read", () => {
    const empty = tempDir("nd-ui-none-");
    expect(readRunCounters(empty)).toBeNull();

    // A file that is not JSON at all, and one that is JSON but records no pair
    // limit, so there is nothing to count the pairs against.
    expect(readRunCounters(rawDir("{ not json"))).toBeNull();
    expect(readRunCounters(recordDir({ seeds: [1, 2] }))).toBeNull();
  });

  it("carries a field the record has that this file does not ask about", () => {
    // `series.ts` and `series-plan.ts` each own part of the file, and a reader
    // that fell over on a field it did not want would refuse a record a later
    // runner wrote.
    const dir = recordDir({
      seed_base: 7,
      max_pairs: 2,
      seeds: [1, 2],
      pairs: [pairOf(1, [playedOf("A", 0, 12), playedOf("B", 0, 30)])],
      state: {
        pairs_played: 1,
        matches_played: 2,
        matches_failed: 0,
        stop_reason: "max_pairs",
        stopped_early: false,
      },
      showcase_note: "a field this file has never heard of",
    });

    const counters = readRunCounters(dir);
    expect(counters).not.toBeNull();
    expect(counters?.pairsPlayed).toBe(1);
    expect(counters?.tokens).toBe(42);
    expect(counters?.stopReason).toBeNull();
    expect(counters?.stoppedEarly).toBe(false);
  });
});

/** A response, read to the end. */
interface Answer {
  status: number;
  body: string;
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

/** The snapshot at `/api/run`, parsed the way the page parses it. */
interface Snapshot {
  state: string;
  lines: string[];
  dir: string | null;
  counters: RunCounters | null;
  exitCode: number | null;
}

const snapshotAt = async (port: number): Promise<Snapshot> =>
  JSON.parse((await get(port, "/api/run")).body) as Snapshot;

/** A console listening on a free port, with its two roots somewhere of their own. */
function consoleAt(): { port: Promise<number>; seriesRoot: string } {
  const home = tempDir("nd-ui-progress-");
  const cwd = join(home, "repo");
  mkdirSync(cwd, { recursive: true });
  const seriesRoot = join(home, "elsewhere", "series");
  const matchesRoot = join(home, "elsewhere", "matches");
  return { port: listen({ port: 0, cwd, seriesRoot, matchesRoot }), seriesRoot };
}

/** The series these tests start: six pairs, so two batches of the runner's five. */
const SERIES = { game: "salient", a: "bot:greedy", b: "bot:random", maxPairs: 6, concurrency: 3 };

/** Whether `at` is no earlier in the series than `was`, figure by figure. */
const notBehind = (at: RunCounters, was: RunCounters): boolean =>
  at.maxPairs === was.maxPairs &&
  at.pairsPlayed >= was.pairsPlayed &&
  at.matchesPlayed >= was.matchesPlayed &&
  at.matchesFailed >= was.matchesFailed &&
  at.costUsd >= was.costUsd &&
  at.tokens >= was.tokens;

describe("GET /api/run while a series is in flight", () => {
  it(
    "answers with the pair lines as they happen, and counters the series' own record says",
    async () => {
      const at = consoleAt();
      const port = await at.port;

      const started = await post(port, "/api/run/series", { ...SERIES, name: "watched" });
      expect(started.status).toBe(202);
      const dir = join(at.seriesRoot, "watched");

      // Poll the way the page does, and hold every answer against the record read
      // either side of it.
      let sawPairLine = false;
      let sawCountersMove = false;
      const deadline = Date.now() + 120_000;
      for (;;) {
        const before = readRunCounters(dir);
        const run = await snapshotAt(port);
        const after = readRunCounters(dir);

        if (run.lines.some((line) => /^seed \d+: /.test(line))) sawPairLine = true;

        if (run.counters !== null) {
          if (before !== null) {
            expect(notBehind(run.counters, before), "counters do not go back").toBe(true);
          }
          if (after !== null) {
            expect(notBehind(after, run.counters), "counters are not ahead of the record").toBe(true);
          }
          // The lines move per pair; the counters move at the runner's batch
          // boundaries, which is what makes them lag behind the lines and say so.
          if (run.state === "running" && run.counters.pairsPlayed > 0) sawCountersMove = true;
        }

        if (run.state !== "running") {
          expect(run.state).toBe("done");
          break;
        }
        if (Date.now() > deadline) throw new Error("the series never finished");
        await new Promise((later) => setTimeout(later, 200));
      }

      expect(sawPairLine, "a pair line arrived while the run was in flight").toBe(true);
      expect(sawCountersMove, "the counters moved before the run ended").toBe(true);

      // The last answer is the finished series: the record's own final figures,
      // read off the file the run left behind, and the CLI's last lines still on
      // the page rather than cleared.
      const final = readRunCounters(dir);
      expect(final).not.toBeNull();
      const last = await snapshotAt(port);
      expect(last.counters).toEqual(final);
      expect(final?.maxPairs).toBe(6);
      expect(final?.pairsPlayed).toBe(6);
      expect(final?.pairsRemaining).toBe(0);
      expect(final?.matchesPlayed).toBe(12);
      expect(final?.matchesFailed).toBe(0);
      expect(final?.stopReason).toBe("max_pairs");
      expect(final?.stoppedEarly).toBe(false);
      expect(last.exitCode).toBe(0);

      expect(last.lines.at(-2)).toBe(`series.json: ${join(dir, "series.json")}`);
      expect(last.lines.at(-1)).toBe(`report.md: ${join(dir, "report.md")}`);
      expect(last.lines.some((line) => line.startsWith("stopped on max_pairs"))).toBe(true);
      expect(readdirSync(join(dir, "matches")).length).toBe(12);
    },
    180_000,
  );

  it("ends with the stop reason of a series that stopped short of its pair limit", async () => {
    const at = consoleAt();
    const port = await at.port;

    // Twelve pairs asked for, and `bot:greedy` clearing `bot:random` well enough
    // that the 99% interval excludes 50% at the boundary of the tenth. The rules
    // are asked at a batch boundary, so the series stops there with two pairs it
    // was asked for never played, and says which rule fired.
    const started = await post(port, "/api/run/series", {
      game: "salient",
      a: "bot:greedy",
      b: "bot:random",
      maxPairs: 12,
      concurrency: 3,
      name: "short",
    });
    expect(started.status).toBe(202);
    const dir = join(at.seriesRoot, "short");

    const deadline = Date.now() + 60_000;
    for (;;) {
      const run = await snapshotAt(port);
      if (run.state !== "running") break;
      if (Date.now() > deadline) throw new Error("the series never finished");
      await new Promise((later) => setTimeout(later, 200));
    }

    const run = await snapshotAt(port);
    expect(run.exitCode).toBe(0);
    expect(run.counters?.stopReason).toBe("wilson_interval");
    expect(run.counters?.stoppedEarly).toBe(true);
    expect(run.counters?.maxPairs).toBe(12);
    expect(run.counters?.pairsPlayed).toBe(10);
    expect(run.counters?.pairsRemaining).toBe(2);
    expect(run.counters?.matchesPlayed).toBe(20);
    expect(run.counters?.matchesFailed).toBe(0);
    expect(
      run.lines.some((line) => line.startsWith("stopped on wilson_interval — short of its pair limit")),
    ).toBe(true);
    // Short of its pair limit: the last two pairs were never played.
    expect(readdirSync(join(dir, "matches")).length).toBe(20);
  }, 90_000);
});

describe("the page that stops watching", () => {
  it("leaves the run to finish and its logs on disk when it hangs up mid-run", async () => {
    const at = consoleAt();
    const port = await at.port;

    const started = await post(port, "/api/run/series", {
      game: "salient",
      a: "bot:greedy",
      b: "bot:random",
      maxPairs: 2,
      name: "left",
    });
    expect(started.status).toBe(202);
    const dir = join(at.seriesRoot, "left");

    // A poll that is thrown away before its answer arrives: a page closed or
    // reloaded mid-run. Nothing in the console is watching that socket.
    const abandoned = request({ host: HOST, port, path: "/api/run", method: "GET", agent: false }, (r) =>
      r.resume(),
    );
    abandoned.on("error", () => undefined);
    abandoned.end();
    await new Promise((later) => setTimeout(later, 50));
    abandoned.destroy();

    const deadline = Date.now() + 60_000;
    for (;;) {
      const run = await snapshotAt(port);
      if (run.state !== "running") {
        expect(run.state).toBe("done");
        expect(run.exitCode).toBe(0);
        // The lines the page never saw are still the run's own, and still there.
        expect(run.lines.some((line) => /^seed \d+: /.test(line))).toBe(true);
        expect(run.lines.at(-1)).toBe(`report.md: ${join(dir, "report.md")}`);
        break;
      }
      if (Date.now() > deadline) throw new Error("the series never finished");
      await new Promise((later) => setTimeout(later, 200));
    }

    expect(readdirSync(join(dir, "matches")).length).toBe(4);
    expect(readFileSync(join(dir, "series.json"), "utf8")).toContain('"pairs_played": 2');
  }, 90_000);
});
