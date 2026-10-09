/**
 * The console's leaderboard over real HTTP: `GET /api/leaderboard` and the two
 * tables it answers — one row per series under the root, and one row per model
 * pooled over every one of them.
 *
 * **Every figure is checked against the report, not against a second
 * calculation.** Each test reads the same directories back through
 * `seriesReport` — the call `no-dice stats --series <dir>` makes — and requires
 * the row the console answered with to be that report's figures: the pairing row
 * its headline counts, the pooled row the sums of the per-model rows over the
 * series it was pooled from. The first test also fits the console's row into the
 * lines the report prints, which is the epic's acceptance: the page and the CLI
 * cannot disagree. The pooled interval is checked to be one Wilson
 * interval over the *pooled* `n` rather than an average of the per-series
 * intervals — the difference between a leaderboard and a mean of means. The
 * formula itself is `packages/stats/src/wilson.test.ts`'s business; what is
 * checked here is the scope the console takes it over.
 *
 * **The walk is one walk.** One test counts the calls to `seriesEntries` while
 * the route answers, because the cost of this route is every match log of every
 * series under the root (`docs/pi-harness-notes.md` §7 measures a real match log
 * at about a megabyte), and a second walk of the same disk for the second table
 * is the one way this answer can get slow without anyone noticing. The spy calls
 * through to the real walk: what is asserted is the count, not a stand-in's
 * return value.
 *
 * Every run is bot against bot, because that is the only kind a test may start:
 * one model match is nineteen minutes and 4.59M tokens
 * (`docs/pi-harness-notes.md` §7), a bot match 1.3 s. The roots are always
 * somewhere other than the current directory, and one test puts a series outside
 * them on purpose.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderSeriesReportMarkdown, seriesReport } from "@no-dice/stats/series-report";
import type { ModelRow, SeriesReport } from "@no-dice/stats/series-report";
import { wilsonInterval, zOf } from "@no-dice/stats/wilson";
import { processAlive } from "@no-dice/runner/series-lock";

import { leaderboardRows } from "./leaderboard.ts";
import * as results from "./results.ts";
import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";

/** A response, read to the end, with its headers kept. */
interface Answer {
  status: number;
  type: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** One series row of the answer, as far as these tests read it. */
interface SeriesRow {
  name: string;
  dir: string;
  reportUrl: string;
  pairs: number;
  matches: number;
  counted: number;
  missing: number;
  stopReason: string;
  stoppedEarly: boolean;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  interval: { low: number; high: number } | null;
}

/** One pooled model row of the answer. */
interface ModelRowAnswer {
  label: string;
  matches: number;
  seats: { A: number; B: number };
  result: {
    winRate: { n: number; wins: number; losses: number; draws: number; rate: number | null };
    interval: { low: number; high: number } | null;
    confidence: number;
  };
  seatSplit: { A: { winRate: { n: number } }; B: { winRate: { n: number } } };
  missing: number;
  missingNote: string;
  series: string[];
}

/** What `GET /api/leaderboard` answers. */
interface Leaderboard {
  seriesRoot: string;
  series: SeriesRow[];
  models: ModelRowAnswer[];
  unreadable: { name: string; dir: string; error: string }[];
}

let server: Server | null = null;
const temps: string[] = [];

/** A temp directory for this test, removed when the test ends. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/**
 * A pid that names no process on this machine: what a lock left by a killed run
 * names. Probed rather than assumed, because a large number is a perfectly
 * nameable pid — `kernel.pid_max` is 4194304 on this Linux.
 */
function aGonePid(): number {
  for (const candidate of [999_999, 4_194_303]) {
    if (!processAlive(candidate)) return candidate;
  }
  throw new Error("every candidate pid names a live process on this machine");
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
            type: String(response.headers["content-type"]),
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", failed);
    req.end(payload);
  });

const get = (port: number, path: string, method = "GET"): Promise<Answer> => send(port, path, method);
const post = (port: number, path: string, body: unknown): Promise<Answer> =>
  send(port, path, "POST", body);

/** A console's three roots, and the directory it runs in — none of them the cwd. */
function rootsAt(): { cwd: string; seriesRoot: string; matchesRoot: string; reportsRoot: string } {
  const home = tempDir("nd-ui-leaderboard-");
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

/** The run snapshot at `/api/run`, parsed. */
interface Snapshot {
  state: string;
  dir: string | null;
  exitCode: number | null;
}

/**
 * Start a series run, poll `/api/run` until it has stopped, and fail the test if
 * it did not finish cleanly. A bot-versus-bot match is 1.3 s, so
 * this is over in a second or two.
 */
async function runTo(port: number, body: Record<string, unknown>): Promise<Snapshot> {
  const started = await post(port, "/api/run/series", body);
  expect(started.status).toBe(202);

  const deadline = Date.now() + 60_000;
  for (;;) {
    const snapshot = JSON.parse((await get(port, "/api/run")).body) as Snapshot;
    if (snapshot.state === "running") {
      if (Date.now() > deadline) throw new Error("the run was still running after 60000ms");
      await new Promise((later) => setTimeout(later, 100));
      continue;
    }
    expect(snapshot.state).toBe("done");
    expect(snapshot.exitCode).toBe(0);
    return snapshot;
  }
}

/** `/api/leaderboard`, parsed. */
const leaderboardAt = async (port: number): Promise<Leaderboard> =>
  JSON.parse((await get(port, "/api/leaderboard")).body) as Leaderboard;

/** The number as the stats report prints it. */
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** The pooled row for `label`, or a failure that names the rows the answer had. */
const pooledRow = (lb: Leaderboard, label: string): ModelRowAnswer => {
  const row = lb.models.find((each) => each.label === label);
  if (row === undefined) {
    throw new Error(`no pooled row for ${label}: ${lb.models.map((each) => each.label).join(", ")}`);
  }
  return row;
};

/** The report's own row for `label`, or a failure that says which report had none. */
const reportRow = (report: SeriesReport, label: string): ModelRow => {
  const row = report.models.find((each) => each.label === label);
  if (row === undefined) throw new Error(`no row for ${label} in ${report.dir}`);
  return row;
};

/** What the same pick adds up to over several of the report's model rows. */
const sum = (rows: readonly ModelRow[], pick: (row: ModelRow) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0);

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

describe("GET /api/leaderboard", () => {
  it("answers one row per series with the figures `no-dice stats` prints for it", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    const lb = await leaderboardAt(port);
    expect(lb.seriesRoot).toBe(at.seriesRoot);
    expect(lb.unreadable).toEqual([]);
    expect(lb.series).toHaveLength(1);

    const dir = join(at.seriesRoot, "alpha");
    const report = await seriesReport(dir);
    const [row] = lb.series;
    expect(row!.dir).toBe(dir);

    // The per-pairing row is the report's headline row, figure for figure.
    expect(row!.counted).toBe(report.counted);
    expect(row!.missing).toBe(report.missing.total);
    expect(row!.winRate).toBe(report.result.winRate.rate);
    expect(row!.interval).toEqual(report.result.interval);
    expect([row!.wins, row!.losses, row!.draws]).toEqual([
      report.result.winRate.wins,
      report.result.winRate.losses,
      report.result.winRate.draws,
    ]);

    // And the row fits the lines the CLI prints for that directory, built
    // out of the row the console answered with: a row with its own arithmetic
    // would not fit them.
    const markdown = renderSeriesReportMarkdown(report);
    expect(markdown).toContain(
      `${String(row!.pairs)} pairs recorded, ${String(row!.matches)} matches: ` +
        `**${String(row!.counted)} counted**, **${String(row!.missing)} missing**.`,
    );
    expect(markdown).toContain(
      `Stopped on \`${row!.stopReason}\` — ` +
        `${row!.stoppedEarly ? "short of its pair limit" : "its full length"}.`,
    );
    expect(markdown).toContain(
      `| ${[row!.wins, row!.losses, row!.draws, row!.counted].map(String).join(" | ")} | ` +
        `${pct(row!.winRate!)} | ${pct(row!.interval!.low)} – ${pct(row!.interval!.high)} |`,
    );
  }, 120_000);

  it("pools that one series into rows equal to its own report's model rows", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    const lb = await leaderboardAt(port);
    const report = await seriesReport(join(at.seriesRoot, "alpha"));
    expect(lb.models.map((each) => each.label).sort()).toEqual(report.models.map((each) => each.label).sort());

    for (const model of report.models) {
      const pooled = pooledRow(lb, model.label);
      expect(pooled.matches).toBe(model.matches);
      expect(pooled.result.winRate.rate).toBe(model.result.winRate.rate);
      expect(pooled.result.winRate.n).toBe(model.result.winRate.n);
      expect(pooled.result.confidence).toBe(0.95);
      expect(pooled.seats).toEqual(model.seats);
      // Nothing went missing from this run, and the pooled row says so with the
      // report's own count; the next test is the one with a gap.
      expect(pooled.missing).toBe(report.missing.total);
      expect(pooled.series).toEqual([report.dir]);
      // The seat split is over the same matches, split by the seat that match's
      // own header said this model held.
      expect(pooled.seatSplit.A.winRate.n + pooled.seatSplit.B.winRate.n).toBe(pooled.matches);
    }
  }, 120_000);

  it("counts a series' missing matches in the pooled row, and says they are not losses", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "eta" });

    // The state a killed run leaves behind: a record that still names a match
    // whose log is not on disk.
    const dir = join(at.seriesRoot, "eta");
    const logs = readdirSync(join(dir, "matches"));
    expect(logs).toHaveLength(2);
    rmSync(join(dir, "matches", logs[0]!));

    const lb = await leaderboardAt(port);
    const report = await seriesReport(dir);
    expect(report.missing.total).toBe(1);

    for (const model of report.models) {
      const pooled = pooledRow(lb, model.label);
      // The match that never happened is missing for both seats of the pairing,
      // and it is not taken off the matches this model did play.
      expect(pooled.matches).toBe(model.matches);
      expect(pooled.missing).toBe(1);
      expect(pooled.missingNote).toContain("not a loss");
    }
  }, 120_000);

  it("links each series to the report the CLI wrote for it, served as text", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "beta" });

    const [row] = (await leaderboardAt(port)).series;
    expect(row!.reportUrl).toBe("/logs/beta/report.md");

    const answer = await get(port, row!.reportUrl);
    expect(answer.status).toBe(200);
    // Text, so the link opens as the report it is instead of downloading as
    // bytes the browser will not show.
    expect(answer.type).toContain("text/plain");
    expect(answer.body).toContain("Series report");

    // The same answer for a `HEAD`, which is what a link check makes.
    const head = await get(port, row!.reportUrl, "HEAD");
    expect(head.status).toBe(200);
    expect(head.type).toContain("text/plain");
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(answer.body)));
  }, 120_000);

  it("pools one row per model over every series under the root, with the seat split", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "gamma" });
    // The same pairing the other way round, so the swap moves each model to the
    // other seat in the second series and one pooled row has to be made of both.
    await runTo(port, { ...SERIES, a: "bot:random", b: "bot:greedy", name: "delta" });

    const lb = await leaderboardAt(port);
    expect(lb.series.map((each) => each.name)).toEqual(["delta", "gamma"]);

    // The reports in the order the walk reads them: by name.
    const reports = [
      await seriesReport(join(at.seriesRoot, "delta")),
      await seriesReport(join(at.seriesRoot, "gamma")),
    ];
    const dirs = reports.map((report) => report.dir);

    for (const label of ["bot:greedy", "bot:random"]) {
      const rows = reports.map((report) => reportRow(report, label));
      const pooled = pooledRow(lb, label);

      // The counts are the sums over both series, not the counts of one of them.
      expect(pooled.matches).toBe(sum(rows, (each) => each.matches));
      expect(pooled.result.winRate.wins).toBe(sum(rows, (each) => each.result.winRate.wins));
      expect(pooled.result.winRate.losses).toBe(sum(rows, (each) => each.result.winRate.losses));
      expect(pooled.result.winRate.draws).toBe(sum(rows, (each) => each.result.winRate.draws));
      expect(pooled.result.winRate.n).toBe(sum(rows, (each) => each.result.winRate.n));
      expect(pooled.seats.A).toBe(sum(rows, (each) => each.seats.A));
      expect(pooled.seats.B).toBe(sum(rows, (each) => each.seats.B));
      expect(pooled.series).toEqual(dirs);

      // The rate and the interval are taken over the pooled counts. The formula
      // is the stats package's and is tested there; what is pinned here is the
      // scope — one interval over every match, not an average of the two
      // series' intervals.
      const { wins, losses, draws, n } = pooled.result.winRate;
      expect(wins + losses + draws).toBe(n);
      expect(pooled.result.winRate.rate).toBe((wins + draws / 2) / n);
      expect(pooled.result.interval).toEqual(wilsonInterval({ successes: wins + draws / 2, n, z: zOf(0.95) }));

      // The seat split, so a model that only ever wins from one seat is visible
      // as that rather than as a good model.
      for (const seat of ["A", "B"] as const) {
        expect(pooled.seatSplit[seat].winRate.n).toBe(sum(rows, (each) => each.seatSplit[seat].winRate.n));
      }
      expect(pooled.seatSplit.A.winRate.n + pooled.seatSplit.B.winRate.n).toBe(pooled.matches);
    }
  }, 120_000);

  it("leaves a series outside the root out of both views", async () => {
    const at = consoleAt();
    const port = await at.port;

    // `--dir` is the operator's escape hatch, and a series started with it is
    // real work this page will never show. It is in neither table, and the
    // answer names the root it did read so the page can say so in as many words.
    const elsewhere = join(at.cwd, "not-under-the-root");
    await runTo(port, { ...SERIES, dir: elsewhere });
    expect(existsSync(join(elsewhere, "series.json"))).toBe(true);

    const lb = await leaderboardAt(port);
    expect(lb.seriesRoot).toBe(at.seriesRoot);
    expect(lb.series).toEqual([]);
    expect(lb.models).toEqual([]);
    expect(lb.unreadable).toEqual([]);
  }, 120_000);

  it("lists a record it cannot read with the line it failed on, and pools nothing from it", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "epsilon" });

    mkdirSync(join(at.seriesRoot, "broken"), { recursive: true });
    writeFileSync(join(at.seriesRoot, "broken", "series.json"), '{"max_pairs": 2}\n', "utf8");

    const lb = await leaderboardAt(port);
    expect(lb.series).toHaveLength(1);
    expect(lb.unreadable).toHaveLength(1);
    expect(lb.unreadable[0]!.name).toBe("broken");
    expect(lb.unreadable[0]!.dir).toBe(join(at.seriesRoot, "broken"));
    expect(lb.unreadable[0]!.error).toContain("is not a series record");

    // The unreadable series adds nothing: every pooled figure is the one series
    // that could be read, and that row names only that series.
    const report = await seriesReport(join(at.seriesRoot, "epsilon"));
    for (const model of report.models) {
      const pooled = pooledRow(lb, model.label);
      expect(pooled.matches).toBe(model.matches);
      expect(pooled.missing).toBe(report.missing.total);
      expect(pooled.series).toEqual([report.dir]);
    }
  }, 120_000);

  it("lists a series whose lock will not open in `unreadable`, and pools the rest", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "zeta" });

    // A `series.lock` that will not open: a directory where the runner's one line
    // of JSON should be, which answers EISDIR whoever asks — the same failure a
    // lock another user wrote and closed (`EACCES`) makes in a shared series root.
    // The route that reads every series on disk does not go down with one such
    // directory: it lists that one with the line the read failed on.
    const closed = join(at.seriesRoot, "closed");
    mkdirSync(join(closed, "series.lock"), { recursive: true });
    writeFileSync(join(closed, "series.json"), '{"max_pairs": 2}\n', "utf8");

    const lb = await leaderboardAt(port);
    expect(lb.series.map((row) => row.name)).toEqual(["zeta"]);
    expect(lb.unreadable).toHaveLength(1);
    expect(lb.unreadable[0]!.name).toBe("closed");
    expect(lb.unreadable[0]!.error).toContain(join(closed, "series.lock"));
    // And the pooled table is still the one series that could be read.
    expect(lb.models.length).toBeGreaterThan(0);
    for (const model of lb.models) {
      expect(model.series).toEqual([join(at.seriesRoot, "zeta")]);
    }
  }, 120_000);

  it("walks the series root once for the whole answer, not once per table", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "zeta" });

    // The spy calls through to the real walk, so the answer is the real answer;
    // what is asserted is that the route asked for one walk and used the reports
    // it returned for both tables.
    const walked = vi.spyOn(results, "seriesEntries");
    const lb = await leaderboardAt(port);
    expect(walked).toHaveBeenCalledTimes(1);
    walked.mockRestore();

    expect(lb.series).toHaveLength(1);
    expect(lb.models.length).toBeGreaterThan(0);
  }, 120_000);

  it("is a read: GET and HEAD answer, POST does not, and no Origin is asked for", async () => {
    const at = consoleAt();
    const port = await at.port;

    const head = await get(port, "/api/leaderboard", "HEAD");
    expect(head.status).toBe(200);
    expect(head.type).toContain("application/json");
    expect(head.body).toBe("");

    // A page on another domain may read it: the `Host` check is what keeps a
    // rebound domain off this port, and a read has nothing to guard.
    const foreign = await send(port, "/api/leaderboard", "GET", undefined, {
      origin: "http://elsewhere.example",
    });
    expect(foreign.status).toBe(200);

    const posted = await post(port, "/api/leaderboard", {});
    expect(posted.status).toBe(405);
    expect(posted.headers.allow).toBe("GET, HEAD");
  });

  it("answers both empty tables for a root nobody has run a series into", async () => {
    const at = consoleAt();
    const lb = await leaderboardAt(await at.port);
    expect(lb).toEqual({ seriesRoot: at.seriesRoot, series: [], models: [], unreadable: [] });
  });
});

describe("the rows behind the route", () => {
  it("answers the same series rows `/api/series` answers, from the same walk", async () => {
    const at = rootsAt();
    // A series that recorded no pairs: a real record, read by the same report,
    // and one that needs no run to make.
    mkdirSync(join(at.seriesRoot, "one"), { recursive: true });
    writeFileSync(
      join(at.seriesRoot, "one", "series.json"),
      JSON.stringify({
        max_pairs: 1,
        seeds: [],
        pairing: { a: { kind: "bot", bot: "greedy" }, b: { kind: "bot", bot: "random" } },
        pairs: [],
        state: { stop_reason: "max_pairs", stopped_early: false },
      }),
      "utf8",
    );
    // And a lock left by a run whose process has gone. The rows this file answers
    // with are the walk's, so they carry what it read of that lock; a second walk
    // to find out who had the directory is what this file exists to avoid. The pid
    // is probed to name no process — `kernel.pid_max` is 4194304 on this Linux, so
    // a large number is a perfectly nameable one.
    const gonePid = aGonePid();
    writeFileSync(
      join(at.seriesRoot, "one", "series.lock"),
      `{"pid":${String(gonePid)},"started_at":"2026-01-01T00:00:00.000Z"}`,
      "utf8",
    );

    const listing = results.seriesListingOf(await results.seriesEntries(at, null));
    const lb = await leaderboardRows(at, null);

    expect(lb.seriesRoot).toBe(listing.seriesRoot);
    expect(lb.series).toEqual(listing.series);
    expect(lb.unreadable).toEqual(listing.unreadable);
    expect(lb.series[0]!.reportUrl).toBe("/logs/one/report.md");
    expect(lb.series[0]!.playing).toBeNull();
    expect(lb.series[0]!.stale).toEqual({ pid: gonePid, startedAt: "2026-01-01T00:00:00.000Z" });
    // Nothing is playing it, so there is no run in flight to carry counters for,
    // and a gone run is no reason not to offer the series as a resume.
    expect(lb.series[0]!.progress).toBeNull();
    expect(lb.series[0]!.resumable).toBe(true);
    // A series with no counted match has no model row: a rate of `null` over
    // nothing is not a leaderboard entry.
    expect(lb.models).toEqual([]);
  });
});
