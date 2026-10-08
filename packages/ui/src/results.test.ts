/**
 * What the console lists from disk, and what it serves of it: the series under
 * its series root, the finished match logs under both roots, the logs
 * themselves, the built viewer, and the resume of a series that stopped short.
 *
 * The figures are checked against the CLI's own output rather than
 * against a second calculation. Each series test takes the row the console
 * answers with, builds the lines `no-dice stats --series <dir>` prints out of
 * that row, and requires those lines to be in the markdown the stats package
 * renders for the same directory. A row that drifted from the report would
 * fail here, which is the point: the acceptance is that the page and the CLI
 * cannot disagree, and the only way to test that is to compare the two.
 *
 * Every run is bot against bot, because that is the only kind a test may start:
 * one model match is nineteen minutes and 4.59M tokens
 * (`docs/pi-harness-notes.md` §7), a bot match 1.3 s.
 *
 * The two roots are always somewhere other than the current directory, and
 * one test puts a series outside them on purpose: a listing that read the whole
 * filesystem would list runs this console never started, and the page would be a
 * list of someone else's work.
 *
 * A series another process is playing is listed from that process's
 * `series.lock`: one test starts a real `no-dice series` in a process of its
 * own and watches the row change, and the cheaper ones write a lock that names
 * this test process — a live pid, which is all the listing asks of one.
 * `GET /api/playing` is checked against a record `/api/series` refuses: the two
 * routes answer different questions, and the cheap one answers without reading a
 * single match log.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { renderSeriesReport } from "@no-dice/stats/series-report";
import { processAlive } from "@no-dice/runner/series-lock";

import { logPathOf, logUrlOf, resumeRecordOf, viewerUrlOf } from "./results.ts";
import type { MatchListing, PlayingListing, SeriesListing, SeriesRow } from "./results.ts";
import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";

/** A response, read to the end. */
interface Answer {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
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
const send = (
  port: number,
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> =>
  new Promise((done, failed) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: HOST,
        port,
        path,
        method,
        agent: false,
        headers: payload === undefined ? headers : { "content-type": "application/json", ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          done({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          }),
        );
      },
    );
    req.on("error", failed);
    req.end(payload);
  });

const get = (port: number, path: string): Promise<Answer> => send(port, path, "GET");
const post = (port: number, path: string, body: unknown): Promise<Answer> =>
  send(port, path, "POST", body);

/** A console's two roots, and the directory it runs in — none of them the cwd. */
function rootsAt(): { cwd: string; seriesRoot: string; matchesRoot: string } {
  const home = tempDir("nd-ui-results-");
  const cwd = join(home, "repo");
  mkdirSync(cwd, { recursive: true });
  return {
    cwd,
    seriesRoot: join(home, "elsewhere", "series"),
    matchesRoot: join(home, "elsewhere", "matches"),
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

/** `/api/series`, parsed. */
const seriesListingAt = async (port: number): Promise<SeriesListing> =>
  JSON.parse((await get(port, "/api/series")).body) as SeriesListing;

/** `/api/matches`, parsed. */
const matchListingAt = async (port: number): Promise<MatchListing> =>
  JSON.parse((await get(port, "/api/matches")).body) as MatchListing;

/** `/api/playing`, parsed. */
const playingListingAt = async (port: number): Promise<PlayingListing> =>
  JSON.parse((await get(port, "/api/playing")).body) as PlayingListing;

/** The started-at every fixture lock writes. */
const LOCKED_AT = "2026-01-01T00:00:00.000Z";

/**
 * A `series.lock` naming a live process — this test process, which is one, and
 * whether the pid is alive is the only question the listing asks of it. So a
 * series can be held by "another process" without a second process to keep.
 */
const lockHeldHere = (dir: string): void =>
  writeFileSync(
    join(dir, "series.lock"),
    `{"pid":${String(process.pid)},"started_at":"${LOCKED_AT}"}\n`,
    "utf8",
  );

/**
 * A pid that names no process on this machine: what a lock left by a killed run
 * names. Probed rather than assumed — `kernel.pid_max` is 4194304 on this Linux,
 * so a large number is a perfectly nameable process, and a stale assertion built
 * on one picked blindly would be about a pid that is alive.
 */
const aGonePid = (): number => {
  for (const candidate of [999_999, 4_194_303]) {
    if (!processAlive(candidate)) return candidate;
  }
  throw new Error("every candidate pid names a live process on this machine");
};

/**
 * A `series.lock` naming a process that is gone: a run that died where it stood.
 * The pid it wrote is handed back, because the row has to name that same one.
 */
const lockLeftByTheDead = (dir: string): number => {
  const pid = aGonePid();
  writeFileSync(join(dir, "series.lock"), `{"pid":${String(pid)},"started_at":"${LOCKED_AT}"}\n`, "utf8");
  return pid;
};

/**
 * A `series.lock` this console cannot open: a directory where the runner's one
 * line of JSON should be, so the read answers EISDIR whoever asks. That is the
 * same failure a lock another user wrote and closed (`EACCES`) makes in a shared
 * series root, without depending on which user runs the test.
 */
const lockUnopenable = (dir: string): string => {
  const path = join(dir, "series.lock");
  mkdirSync(path, { recursive: true });
  return path;
};

/**
 * A series record mid-run: one pair played, its two logs not on disk yet, and no
 * `stop` field because nothing has stopped. `seriesReport` reads it — the pair
 * it names is missing rather than counted — and `readRunCounters` reads the
 * same file for the row's `progress`.
 */
const MID_RUN_RECORD = JSON.stringify({
  max_pairs: 3,
  seeds: [11, 12, 13],
  pairing: { a: { kind: "bot", bot: "greedy" }, b: { kind: "bot", bot: "random" } },
  pairs: [
    {
      seed: 11,
      matches: [
        {
          seat: "A",
          path: "matches/11-greedy-random.json",
          status: "played",
          result: { type: "knockout", winner: "A", margin: 4 },
          cost_usd: 0.25,
          tokens: { total: 1200 },
        },
        {
          seat: "B",
          path: "matches/11-random-greedy.json",
          status: "played",
          result: { type: "time", winner: null, margin: 0 },
          cost_usd: 0.5,
          tokens: { total: 800 },
        },
      ],
    },
  ],
  state: {
    pairs_played: 1,
    matches_played: 2,
    matches_failed: 0,
    stop_reason: "max_pairs",
    stopped_early: false,
  },
});

/** The runner's CLI, in a process of its own: the terminal that plays a series. */
const RUNNER_CLI = fileURLToPath(new URL("../../runner/src/cli.ts", import.meta.url));

/** Until a spawned process has gone, with the code it went on. */
const ended = (child: ChildProcess): Promise<number> =>
  new Promise((closed) => child.once("close", (code) => void closed(code ?? -1)));

/**
 * Poll `/api/series` until the named series is in it. A run writes its record
 * asynchronously, so a listing asked for the instant a run started may not have
 * it yet.
 */
async function untilSeries(port: number, name: string, limitMs = 30_000): Promise<SeriesListing> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const listing = await seriesListingAt(port);
    if (listing.series.some((each) => each.name === name)) return listing;
    if (Date.now() > deadline) throw new Error(`${name} was never listed in ${String(limitMs)}ms`);
    await new Promise((later) => setTimeout(later, 100));
  }
}

/** The number as the stats report prints it. */
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A built viewer, as a fixture: an index that loads its assets relatively. */
function viewerFixture(): string {
  const root = tempDir("nd-ui-viewer-");
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><title>Salient replay viewer</title><script src="./assets/app.js"></script>\n',
    "utf8",
  );
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "assets", "app.js"), "export const viewer = true;\n", "utf8");
  return root;
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

describe("GET /api/series", () => {
  it("lists the series under the root with the figures `no-dice stats` prints for it", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "alpha" });

    const listing = await seriesListingAt(port);
    expect(listing.seriesRoot).toBe(at.seriesRoot);
    expect(listing.unreadable).toEqual([]);
    expect(listing.series).toHaveLength(1);

    const [row] = listing.series;
    expect(row!.name).toBe("alpha");
    expect(row!.dir).toBe(join(at.seriesRoot, "alpha"));
    // The pairing, spelled the way `--a` and `--b` spell it.
    expect([row!.a, row!.b]).toEqual(["bot:greedy", "bot:random"]);
    expect(row!.maxPairs).toBe(1);
    expect(row!.pairs).toBe(1);
    expect(row!.matches).toBe(2);
    expect(row!.counted).toBe(2);
    expect(row!.missing).toBe(0);
    expect(row!.stopReason).toBe("max_pairs");
    expect(row!.stoppedEarly).toBe(false);
    expect(row!.confidence).toBe(0.95);
    expect(row!.wins + row!.losses + row!.draws).toBe(2);
    expect(row!.winRate).toBe((row!.wins + row!.draws / 2) / 2);
    expect(row!.interval).not.toBeNull();
    // A run that named no ceiling recorded none, and the page has to be able to
    // say that rather than leave it blank.
    expect([row!.ceilingUsd, row!.ceilingTokens]).toEqual([null, null]);
    expect(row!.resumable).toBe(true);
    // Nothing holds this series: no lock, so no `playing`, no `stale`, and no run
    // in flight to carry counters of its own.
    expect([row!.playing, row!.stale, row!.progress]).toEqual([null, null, null]);
    // The report the CLI wrote beside that record, at the URL the `/logs/` route
    // already reaches — which is what the leaderboard links a series by.
    expect(row!.reportUrl).toBe("/logs/alpha/report.md");

    // The same figures the CLI prints. These are the lines
    // `renderSeriesReport` writes for this directory, built out of the row the
    // console answered with: a row that had its own arithmetic would not fit
    // them.
    const { markdown } = await renderSeriesReport(row!.dir);
    expect(markdown).toContain(
      `${String(row!.pairs)} pairs recorded, ${String(row!.matches)} matches: ` +
        `**${String(row!.counted)} counted**, **${String(row!.missing)} missing**.`,
    );
    expect(markdown).toContain(
      `Stopped on \`${row!.stopReason}\` — ` +
        `${row!.stoppedEarly ? "short of its pair limit" : "its full length"}.`,
    );
    const interval = row!.interval!;
    expect(markdown).toContain(
      `| ${[row!.wins, row!.losses, row!.draws, row!.counted].map(String).join(" | ")} | ` +
        `${pct(row!.winRate!)} | ${pct(interval.low)} – ${pct(interval.high)} |`,
    );
  }, 120_000);

  it("lists nothing outside the series root, including a series this console started outside it", async () => {
    const at = consoleAt();
    const port = await at.port;

    // `--dir` is the operator's escape hatch, and a series started with it is
    // not under the root. The listing has to leave it out — and the page says so
    // rather than leaving the operator to wonder where the run went.
    const elsewhere = join(at.cwd, "not-under-the-root");
    await seriesAt(port, { ...SERIES, dir: elsewhere });
    expect(existsSync(join(elsewhere, "series.json"))).toBe(true);

    const listing = await seriesListingAt(port);
    expect(listing.series).toEqual([]);
    expect(listing.unreadable).toEqual([]);
    expect((await matchListingAt(port)).matches).toEqual([]);
  }, 120_000);

  it("keeps a record it cannot report in the answer, with the line it failed on", async () => {
    const at = consoleAt();
    const port = await at.port;

    mkdirSync(join(at.seriesRoot, "broken"), { recursive: true });
    writeFileSync(join(at.seriesRoot, "broken", "series.json"), '{"max_pairs": 2}\n', "utf8");
    // A directory that is not a series at all is not listed, and is not an error.
    mkdirSync(join(at.seriesRoot, "just-sessions", "matches"), { recursive: true });

    const listing = await seriesListingAt(port);
    expect(listing.series).toEqual([]);
    expect(listing.unreadable).toHaveLength(1);
    expect(listing.unreadable[0]!.name).toBe("broken");
    expect(listing.unreadable[0]!.dir).toBe(join(at.seriesRoot, "broken"));
    expect(listing.unreadable[0]!.error).toContain("is not a series record");
  });

  it("answers an empty listing for a root nobody has run a series into", async () => {
    const at = consoleAt();
    const listing = await seriesListingAt(await at.port);
    expect(listing).toEqual({ seriesRoot: at.seriesRoot, series: [], unreadable: [] });
  });

  it("offers a series as resumable only once its run has stopped", async () => {
    const at = consoleAt();
    const port = await at.port;

    const started = await post(port, "/api/run/series", { ...SERIES, name: "beta" });
    expect(started.status).toBe(202);

    // While its own run is in flight, a second run into the same directory would
    // be a second run of the same matches, so the console does not offer one.
    const during = await untilSeries(port, "beta");
    expect(during.series).toHaveLength(1);
    expect(during.series[0]!.resumable).toBe(false);

    await untilStopped(port);
    const after = await seriesListingAt(port);
    expect(after.series[0]!.resumable).toBe(true);
  }, 120_000);
});

describe("a series another process is playing", () => {
  it("lists a series another process holds as playing, with its record's counters", async () => {
    const at = consoleAt();
    const port = await at.port;
    const dir = join(at.seriesRoot, "terminal");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "series.json"), MID_RUN_RECORD, "utf8");
    lockHeldHere(dir);

    const listing = await seriesListingAt(port);
    expect(listing.unreadable).toEqual([]);
    expect(listing.series).toHaveLength(1);
    const [row] = listing.series;

    expect(row!.playing).toEqual({ pid: process.pid, startedAt: LOCKED_AT });
    expect(row!.stale).toBeNull();
    // A second run into that directory would be a second run of the matches this
    // one is playing, so the console does not offer one.
    expect(row!.resumable).toBe(false);
    // The record's own counters, as `series.json` says them at the moment the
    // listing was asked for — not a reading of the run's lines.
    expect(row!.progress).toEqual({
      maxPairs: 3,
      pairsPlayed: 1,
      pairsRemaining: 2,
      matchesPlayed: 2,
      matchesFailed: 0,
      costUsd: 0.75,
      tokens: 2000,
      stopReason: null,
      stoppedEarly: false,
    });
    // The report's figures are still the report's, and this row is not a second
    // account of them: the pair the record names has no log on disk yet, and the
    // counters are the running run's, which a finished row never carries.
    expect(row!.pairs).toBe(1);
    expect(row!.counted).toBe(0);
    expect(row!.missing).toBe(2);
  });

  it("lists a lock whose process has gone as stale, and still offers the series as resumable", async () => {
    const at = consoleAt();
    const port = await at.port;
    const dir = join(at.seriesRoot, "abandoned");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "series.json"), MID_RUN_RECORD, "utf8");
    const pid = lockLeftByTheDead(dir);

    const [row] = (await seriesListingAt(port)).series;
    expect(row!.playing).toBeNull();
    expect(row!.stale).toEqual({ pid, startedAt: LOCKED_AT });
    // The run that left that lock has gone: the series is interrupted, which is
    // what a resume is for.
    expect(row!.resumable).toBe(true);
    // And nothing is playing it, so there is no run in flight to count.
    expect(row!.progress).toBeNull();
  });

  it("lists a series whose lock it cannot open as unreadable, and every other series beside it", async () => {
    const at = consoleAt();
    const port = await at.port;
    const closed = join(at.seriesRoot, "closed");
    mkdirSync(closed, { recursive: true });
    writeFileSync(join(closed, "series.json"), MID_RUN_RECORD, "utf8");
    const lockPath = lockUnopenable(closed);
    // A series this console can read perfectly well, in the same root, to be
    // listed alongside it.
    await seriesAt(port, { ...SERIES, name: "beside" });

    const listing = await seriesListingAt(port);
    // One closed file is the whole of the damage: the route answers, and the
    // series it can report is reported.
    expect(listing.series.map((each) => each.name)).toEqual(["beside"]);
    expect(listing.unreadable).toHaveLength(1);
    expect(listing.unreadable[0]!.name).toBe("closed");
    // The line is the read's own, naming the file that would not open, rather than
    // a paraphrase of it: the operator has to be able to find which file to fix.
    expect(listing.unreadable[0]!.error).toContain(lockPath);
  });

  it("lists a series a terminal process is playing, and resumes it once that process ends", async () => {
    const at = consoleAt();
    const port = await at.port;
    const dir = join(at.seriesRoot, "term");
    // Twelve pairs, not two. Every assertion below is about a run still playing,
    // and a two-pair bot series is over in the time it takes this test to ask
    // about it once.
    const MAX_PAIRS = 12;
    const child = spawn(
      process.execPath,
      [
        RUNNER_CLI,
        "series",
        "--game",
        "salient",
        "--a",
        "bot:greedy",
        "--b",
        "bot:greedy",
        "--max-pairs",
        String(MAX_PAIRS),
        "--dir",
        dir,
      ],
      { cwd: at.cwd, stdio: ["ignore", "pipe", "pipe"] },
    );

    /** What the run's own record says about how far it has got. */
    const recordStateOf = (): { pairs_played: number; matches_played: number } =>
      (JSON.parse(readFileSync(join(dir, "series.json"), "utf8")) as {
        state: { pairs_played: number; matches_played: number };
      }).state;

    const rowOf = (listing: { series: SeriesRow[] }): SeriesRow | undefined =>
      listing.series.find((each) => each.name === "term");

    let row: SeriesRow | undefined;
    try {
      // Poll until the row says somebody is playing it and has a pair counted.
      // The run writes its record before it takes the lock, and its played state
      // at the first batch boundary, so a series is listed, and listed as
      // playing, a while before it is listed with counters of its own.
      const deadline = Date.now() + 30_000;
      for (;;) {
        const listed = rowOf(await seriesListingAt(port));
        if (listed !== undefined && listed.playing !== null && (listed.progress?.pairsPlayed ?? 0) > 0) {
          row = listed;
          break;
        }
        if (Date.now() > deadline) {
          throw new Error("the terminal's series was never listed as playing with a pair counted");
        }
        await new Promise((later) => setTimeout(later, 100));
      }

      expect(row.playing!.pid).toBe(child.pid);
      expect(new Date(row.playing!.startedAt).getTime()).not.toBeNaN();
      expect(row.stale).toBeNull();
      expect(row.resumable).toBe(false);
      expect(row.progress!.maxPairs).toBe(MAX_PAIRS);

      // The counters are the record's, read at the moment the listing was asked
      // for. The record is read on both sides of that listing, because the run is
      // writing it while this is asked: the row's numbers have to sit between the
      // two readings, and a row matching neither is counting something else.
      const before = recordStateOf();
      const listed = rowOf(await seriesListingAt(port))!;
      const after = recordStateOf();
      expect(listed.progress!.pairsPlayed).toBeGreaterThanOrEqual(before.pairs_played);
      expect(listed.progress!.pairsPlayed).toBeLessThanOrEqual(after.pairs_played);
      expect(listed.progress!.matchesPlayed).toBeGreaterThanOrEqual(before.matches_played);
      expect(listed.progress!.matchesPlayed).toBeLessThanOrEqual(after.matches_played);

      // And the resume that row would have offered is refused at the moment it is
      // asked for, rather than started and answered with an error line. The row is
      // read again first: a series whose run has ended is not refused for being
      // held, and this asserts the refusal of one that is.
      expect(rowOf(await seriesListingAt(port))!.playing).not.toBeNull();
      const refused = await post(port, "/api/run/resume", { dir });
      expect(refused.status).toBe(400);
      expect(JSON.parse(refused.body).error).toContain(`pid ${String(child.pid)}`);
      expect((await snapshotAt(port)).state).toBe("idle");

      // Let it finish on its own: a run that ends lets go of its lock.
      expect(await ended(child)).toBe(0);
    } finally {
      child.kill("SIGKILL");
    }

    expect(existsSync(join(dir, "series.lock"))).toBe(false);
    const [after] = (await seriesListingAt(port)).series;
    expect(after!.playing).toBeNull();
    expect(after!.stale).toBeNull();
    expect(after!.progress).toBeNull();
    expect(after!.resumable).toBe(true);
  }, 120_000);
});

describe("GET /api/playing", () => {
  it("answers the counters of a series `/api/series` cannot report", async () => {
    const at = consoleAt();
    const port = await at.port;
    const dir = join(at.seriesRoot, "no-pairing");
    mkdirSync(dir, { recursive: true });
    // A record the report refuses — it names no pairing and no seeds — and that
    // still says how far the run got. Counters do not need a series' finished
    // logs, or its pairing, to be readable: that is the difference between this
    // route and `/api/series`.
    writeFileSync(
      join(dir, "series.json"),
      JSON.stringify({
        max_pairs: 4,
        state: { pairs_played: 2, matches_played: 4, matches_failed: 0, stopped_early: false },
      }),
      "utf8",
    );
    lockHeldHere(dir);

    const listing = await seriesListingAt(port);
    expect(listing.series).toEqual([]);
    expect(listing.unreadable).toHaveLength(1);

    const playing = await playingListingAt(port);
    expect(playing.seriesRoot).toBe(at.seriesRoot);
    expect(playing.playing).toEqual([
      {
        name: "no-pairing",
        dir,
        pid: process.pid,
        startedAt: LOCKED_AT,
        stale: false,
        progress: {
          maxPairs: 4,
          pairsPlayed: 2,
          pairsRemaining: 2,
          matchesPlayed: 4,
          matchesFailed: 0,
          costUsd: 0,
          tokens: 0,
          stopReason: null,
          stoppedEarly: false,
        },
      },
    ]);
  });

  it("names a lock whose process has gone as stale, and nothing for a series nobody plays", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "done" });

    // A finished series holds no lock, so the cheap route says nothing about it:
    // this route answers who is playing, and nobody is.
    expect((await playingListingAt(port)).playing).toEqual([]);

    const dir = join(at.seriesRoot, "done");
    const pid = lockLeftByTheDead(dir);
    const [row] = (await playingListingAt(port)).playing;
    expect(row!.name).toBe("done");
    expect(row!.dir).toBe(dir);
    expect(row!.pid).toBe(pid);
    expect(row!.startedAt).toBe(LOCKED_AT);
    expect(row!.stale).toBe(true);
    // The counters come out of the record, whatever state it was left in.
    expect(row!.progress!.pairsPlayed).toBe(1);
  });

  it("answers an empty listing for a root nobody has run a series into", async () => {
    const at = consoleAt();
    expect(await playingListingAt(await at.port)).toEqual({ seriesRoot: at.seriesRoot, playing: [] });
  });

  it("leaves out a directory whose lock it cannot open, and answers the ones it can", async () => {
    const at = consoleAt();
    const port = await at.port;
    // A directory holding nothing but a `series.lock` that will not open, beside a
    // series a live process is holding. The cheap route says who it can see
    // playing, and it cannot see that one; `/api/series` is where the closed file
    // is named, in `unreadable`, with the line it failed on.
    const closed = join(at.seriesRoot, "closed");
    mkdirSync(closed, { recursive: true });
    lockUnopenable(closed);
    const held = join(at.seriesRoot, "held");
    mkdirSync(held, { recursive: true });
    lockHeldHere(held);

    const playing = await playingListingAt(port);
    expect(playing.playing.map((each) => each.name)).toEqual(["held"]);
    expect(playing.playing[0]!.dir).toBe(held);
  });

  it("is a read: GET and HEAD answer, POST does not", async () => {
    const at = consoleAt();
    const port = await at.port;

    const head = await send(port, "/api/playing", "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toContain("application/json");
    expect(head.body).toBe("");

    const posted = await post(port, "/api/playing", {});
    expect(posted.status).toBe(405);
    expect(posted.headers.allow).toBe("GET, HEAD");
  });
});

describe("the viewer's URL for a log", () => {
  it("keeps the ?log= the viewer's load.ts fetches, and names the view beside it", () => {
    // `?log=` is the path `load.ts` reads, unchanged; `back` is the console view
    // the link sits in, which is what the viewer's way back goes to.
    expect(viewerUrlOf("/logs/135-greedy-random.json", "#matches")).toBe(
      "/viewer/?log=/logs/135-greedy-random.json&back=%23matches",
    );
  });

  it("escapes a `#` and nothing else", () => {
    // A bare `#` in a query is read as the start of a fragment, so the view would
    // arrive empty. Everything else stays plain enough to read in an address bar.
    expect(viewerUrlOf("/logs/alpha/matches/135-greedy-random.json", "#leaderboard")).toBe(
      "/viewer/?log=/logs/alpha/matches/135-greedy-random.json&back=%23leaderboard",
    );
    expect(viewerUrlOf("/logs/a.json", "matches")).toBe("/viewer/?log=/logs/a.json&back=matches");
  });
});

describe("GET /api/matches", () => {
  it("lists every finished log under both roots, each with the URL it is served at", async () => {
    const at = consoleAt();
    const port = await at.port;

    await seriesAt(port, { ...SERIES, name: "gamma" });
    await runTo(port, "/api/run/match", MATCH);

    const listing = await matchListingAt(port);
    expect(listing.matchesRoot).toBe(at.matchesRoot);
    expect(listing.matches).toHaveLength(3);

    const bySeries = listing.matches.filter((each) => each.series === "gamma");
    const alone = listing.matches.filter((each) => each.series === null);
    expect(bySeries).toHaveLength(2);
    expect(alone).toHaveLength(1);

    expect(alone[0]!.name).toBe("135-greedy-random.json");
    expect(alone[0]!.path).toBe(join(at.matchesRoot, "135-greedy-random.json"));
    expect(alone[0]!.url).toBe("/logs/135-greedy-random.json");
    // The viewer's own URL for that log: `?log=` is the path its `load.ts` fetches,
    // and `back` is the view this listing is drawn in, so the viewer can offer a
    // way back to the row the replay was clicked in.
    expect(alone[0]!.viewerUrl).toBe("/viewer/?log=/logs/135-greedy-random.json&back=%23matches");

    for (const match of bySeries) {
      expect(match.url).toMatch(/^\/logs\/gamma\/matches\/\d+-(greedy-random|random-greedy)\.json$/);
      expect(match.path).toBe(join(at.seriesRoot, "gamma", "matches", match.name));
      expect(match.viewerUrl).toBe(`/viewer/?log=${match.url}&back=%23matches`);
    }

    // One order, whatever the filesystem's was.
    const urls = listing.matches.map((each) => each.url);
    expect(urls).toEqual([...urls].sort());
  }, 120_000);

  it("lists a match whose log the series lost, and the report counts it as missing", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "epsilon" });

    const before = await seriesListingAt(port);
    const logs = (await matchListingAt(port)).matches;
    expect(logs).toHaveLength(2);
    rmSync(logs[0]!.path);

    // A log that has gone is a missing match, not a match that never happened:
    // the record still names it, and the report says how many are missing.
    const after = await seriesListingAt(port);
    expect(after.series[0]!.counted).toBe(1);
    expect(after.series[0]!.missing).toBe(1);
    expect((await matchListingAt(port)).matches).toHaveLength(1);
    expect(before.series[0]!.counted).toBe(2);
  }, 120_000);
});

describe("GET /logs/<path>", () => {
  it("serves a listed log as the JSON it is, from either root", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "zeta" });
    await runTo(port, "/api/run/match", MATCH);

    for (const match of (await matchListingAt(port)).matches) {
      const answer = await get(port, match.url);
      expect(answer.status, match.url).toBe(200);
      expect(answer.headers["content-type"]).toContain("application/json");
      const log = JSON.parse(answer.body) as { format: string; seed: number };
      expect(log.format).toBe("salient-log/1");
      expect(log.seed).toBeGreaterThan(0);
    }
  }, 120_000);

  it("refuses a path outside the two roots, in either form", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "eta" });

    // A percent-decoded climb. The URL parser folds `%2e%2e` into a dot segment
    // before the route ever sees it, and the doubly-encoded form reaches the
    // route with its `..` intact and is refused by `resolveStatic` after
    // decoding. Either way the answer is a 404 and no file outside the roots.
    for (const path of [
      "/logs/%2e%2e/package.json",
      "/logs/eta/%2e%2e%2f%2e%2e%2fpackage.json",
      "/logs/%2e%2e%2f%2e%2e%2fpackage.json",
    ]) {
      const answer = await send(port, path, "GET");
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).not.toContain('"name": "no-dice"');
    }

    // A path that is under a root and simply not there.
    const absent = await get(port, "/logs/eta/matches/nothing-here.json");
    expect(absent.status).toBe(404);

    // A file that is under the root but is not a log: the console serves what
    // it lists, and this is a record it does list a series by.
    const record = await get(port, "/logs/eta/series.json");
    expect(record.status).toBe(200);
    expect(JSON.parse(record.body).max_pairs).toBe(1);
  }, 120_000);

  it("refuses a symlink planted inside the root that leads out of it", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "theta" });

    const outside = tempDir("nd-ui-outside-");
    writeFileSync(join(outside, "elsewhere.json"), '{"format":"salient-log/1"}\n', "utf8");
    symlinkSync(outside, join(at.seriesRoot, "theta", "matches", "link"));

    const answer = await get(port, "/logs/theta/matches/link/elsewhere.json");
    expect(answer.status).toBe(404);
  }, 120_000);

  it("looks in the series root first, and in nothing else", () => {
    const home = tempDir("nd-ui-roots-");
    const roots = { seriesRoot: join(home, "series"), matchesRoot: join(home, "matches") };
    mkdirSync(join(roots.seriesRoot, "one", "matches"), { recursive: true });
    mkdirSync(roots.matchesRoot, { recursive: true });
    writeFileSync(join(roots.seriesRoot, "one", "matches", "2-a-b.json"), "{}", "utf8");
    writeFileSync(join(roots.matchesRoot, "4-a-b.json"), "{}", "utf8");
    writeFileSync(join(roots.matchesRoot, "3-a-b.json"), '{"from":"matches"}', "utf8");
    // The same file name under both roots: the series root is tried first, so the
    // log a series owns is the one served.
    writeFileSync(join(roots.seriesRoot, "3-a-b.json"), '{"from":"series"}', "utf8");

    expect(logPathOf(roots, "one/matches/2-a-b.json")).toBe(
      join(roots.seriesRoot, "one", "matches", "2-a-b.json"),
    );
    expect(logPathOf(roots, "/3-a-b.json")).toBe(join(roots.seriesRoot, "3-a-b.json"));
    expect(logPathOf(roots, "4-a-b.json")).toBe(join(roots.matchesRoot, "4-a-b.json"));

    // Nothing outside the two roots, in either form, and nothing that is not a
    // file: a directory is not a log.
    expect(logPathOf(roots, "../outside.json")).toBeNull();
    expect(logPathOf(roots, "%2e%2e/outside.json")).toBeNull();
    expect(logPathOf(roots, "one")).toBeNull();
    expect(logPathOf(roots, "")).toBeNull();
  });

  it("writes the URL of a path under a root, with the segments escaped", () => {
    expect(logUrlOf("one/matches/2-a-b.json")).toBe("/logs/one/matches/2-a-b.json");
    expect(logUrlOf("a series/matches/1-x-y.json")).toBe("/logs/a%20series/matches/1-x-y.json");
  });
});

describe("GET /viewer", () => {
  it("redirects /viewer to /viewer/, and serves the built app and its assets under it", async () => {
    const at = consoleAt({ viewerRoot: viewerFixture() });
    const port = await at.port;

    const bare = await get(port, "/viewer");
    expect(bare.status).toBe(302);
    expect(bare.headers.location).toBe("/viewer/");

    const index = await get(port, "/viewer/");
    expect(index.status).toBe(200);
    expect(index.body).toContain("Salient replay viewer");

    // The built index resolves its assets against itself, so they have to be
    // reachable under the mount point — which is what `base: "./"` in the
    // viewer's `vite.config.ts` is for.
    const asset = await get(port, "/viewer/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
  });

  it("says what to build when the viewer has not been built, and refuses a climb out of it", async () => {
    const at = consoleAt({ viewerRoot: join(tempDir("nd-ui-no-viewer-"), "dist") });
    const port = await at.port;

    const missing = await get(port, "/viewer/");
    expect(missing.status).toBe(200);
    expect(missing.body).toContain("Salient replay viewer");
    expect(missing.body).toContain("@no-dice/salient-viewer build");

    const climb = await send(port, "/viewer/%2e%2e/package.json", "GET");
    expect(climb.status).toBe(404);
  });

  it("serves the viewer without taking the console's own app down", async () => {
    const at = consoleAt({ viewerRoot: viewerFixture() });
    const port = await at.port;

    // The console's app root is not built in a test, and says so; that page is
    // not the viewer's, and the viewer's is not that one.
    const app = await get(port, "/");
    expect(app.body).toContain("No Dice console");
    expect(app.body).not.toContain("Salient replay viewer");
  });
});

describe("POST /api/run/resume", () => {
  it("finishes a series whose logs are partly on disk without replaying the ones that are", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "half" });

    const dir = join(at.seriesRoot, "half");
    const logs = (await matchListingAt(port)).matches;
    expect(logs).toHaveLength(2);

    // The state a killed run leaves behind: a record that names both matches of
    // the pair, and a disk that holds one of them.
    const kept = logs[1]!;
    const replayed = logs[0]!;
    const keptBefore = readFileSync(kept.path, "utf8");
    rmSync(replayed.path);

    const done = await runTo(port, "/api/run/resume", { dir });
    expect(done.dir).toBe(dir);

    // The match that was missing is played, and the one that was there is
    // untouched: a resume that replays a match writes a new log over it, and
    // these bytes are the proof that it did not.
    expect(existsSync(replayed.path)).toBe(true);
    expect(readFileSync(kept.path, "utf8")).toBe(keptBefore);
    expect((await matchListingAt(port)).matches).toHaveLength(2);

    const listing = await seriesListingAt(port);
    expect(listing.series).toHaveLength(1);
    expect(listing.series[0]!.counted).toBe(2);
    expect(listing.series[0]!.missing).toBe(0);
  }, 120_000);

  it("refuses a directory with no series to resume, in one line each", async () => {
    const at = consoleAt();
    const port = await at.port;

    const noDir = await post(port, "/api/run/resume", {});
    expect(noDir.status).toBe(400);
    expect(JSON.parse(noDir.body).error).toContain("series directory");

    const nowhere = await post(port, "/api/run/resume", { dir: join(at.seriesRoot, "never-ran") });
    expect(nowhere.status).toBe(400);
    expect(JSON.parse(nowhere.body).error).toContain("is not there");

    mkdirSync(join(at.seriesRoot, "broken"), { recursive: true });
    writeFileSync(join(at.seriesRoot, "broken", "series.json"), '{"max_pairs": 2}\n', "utf8");
    const noPairing = await post(port, "/api/run/resume", { dir: join(at.seriesRoot, "broken") });
    expect(noPairing.status).toBe(400);
    expect(JSON.parse(noPairing.body).error).toContain("does not record a pairing");

    expect((await snapshotAt(port)).state).toBe("idle");
  });

  it("refuses a series another process is playing, and takes over a lock whose process has gone", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "held" });
    const dir = join(at.seriesRoot, "held");

    lockHeldHere(dir);
    const refused = await post(port, "/api/run/resume", { dir });
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body).error).toContain("series.lock");
    expect(JSON.parse(refused.body).error).toContain(`pid ${String(process.pid)}`);
    // Nothing was started: the refusal is the whole answer, rather than a run
    // whose only output is the runner's own error line a minute later. The slot
    // still holds the run that finished above, rather than one now running.
    expect((await snapshotAt(port)).state).toBe("done");

    // A lock whose process has gone is an interrupted series, which is what a
    // resume is for: the runner takes that lock over, and lets go of it again.
    lockLeftByTheDead(dir);
    const done = await runTo(port, "/api/run/resume", { dir });
    expect(done.dir).toBe(dir);
    expect(existsSync(join(dir, "series.lock"))).toBe(false);
  }, 120_000);

  it("refuses a second run while a resumed one is in flight", async () => {
    const at = consoleAt();
    const port = await at.port;
    await seriesAt(port, { ...SERIES, name: "again" });
    const dir = join(at.seriesRoot, "again");
    for (const match of (await matchListingAt(port)).matches) rmSync(match.path);

    const started = await post(port, "/api/run/resume", { dir });
    expect(started.status).toBe(202);
    const busy = await post(port, "/api/run/resume", { dir });
    expect(busy.status).toBe(409);
    expect(JSON.parse(busy.body).error).toContain("already running");

    await untilStopped(port);
  }, 120_000);
});

describe("the record a resume reads", () => {
  it("takes the pairing, the pair limit and the ceilings the last run recorded", () => {
    const dir = tempDir("nd-ui-record-");
    writeFileSync(
      join(dir, "series.json"),
      JSON.stringify({
        max_pairs: 3,
        pairing: { a: { kind: "model", provider: "acme", model: "one" }, b: { kind: "bot", bot: "greedy" } },
        stop: { reason: "max_cost", ceiling_usd: 12.5 },
      }),
      "utf8",
    );

    const record = resumeRecordOf(dir);
    // Spelled as `--a` and `--b` take them, which is what lets the console start
    // the same pairing again.
    expect([record.a, record.b]).toEqual(["acme/one", "bot:greedy"]);
    expect(record.maxPairs).toBe(3);
    expect(record.ceilingUsd).toBe(12.5);
    expect(record.ceilingTokens).toBeNull();
  });

  it("says there is nothing to resume for a directory that holds no record", () => {
    expect(() => resumeRecordOf(tempDir("nd-ui-empty-"))).toThrow(/is not there/);
  });

  it("refuses a series whose lock names a live process, in one line naming that pid", () => {
    const dir = tempDir("nd-ui-locked-");
    writeFileSync(
      join(dir, "series.json"),
      JSON.stringify({
        max_pairs: 3,
        pairing: { a: { kind: "bot", bot: "greedy" }, b: { kind: "bot", bot: "random" } },
      }),
      "utf8",
    );
    lockHeldHere(dir);

    // The same fact the runner refuses the run for, said before the console
    // starts anything, and naming the process that holds the directory.
    expect(() => resumeRecordOf(dir)).toThrow(
      new Error(
        `another series run holds ${join(dir, "series.lock")}: pid ${String(process.pid)} started at ` +
          `${LOCKED_AT} and is still playing this series, so it is not resumed`,
      ),
    );
  });

  it("reads the record of a series whose lock names a process that is gone", () => {
    const dir = tempDir("nd-ui-stale-");
    writeFileSync(
      join(dir, "series.json"),
      JSON.stringify({
        max_pairs: 2,
        pairing: { a: { kind: "bot", bot: "greedy" }, b: { kind: "bot", bot: "random" } },
      }),
      "utf8",
    );
    lockLeftByTheDead(dir);

    // A dead run's lock is not a reason to refuse: resuming that series is the
    // recovery, and the runner takes the stale lock over when it starts.
    expect(resumeRecordOf(dir).maxPairs).toBe(2);
  });
});
