/**
 * The console's run estimate over real HTTP: `GET /api/estimate` and what it
 * answers for each of the two seats — the figures of the series under the
 * root that have played that seat, or the one documented figure for a seat
 * nothing under the root has played.
 *
 * **Every figure is checked against the report, not against a second
 * calculation.** Each test reads the same directories back through `seriesReport`
 * — the call `no-dice stats --series <dir>` makes — and requires the seat's
 * figures to be that report's `models[]` row for that label: its `matches`,
 * `metrics.turnCount`, `metrics.tokens.total`, `metrics.costUsd` and
 * `metrics.wallMs`, summed over the series that played the seat and scaled by a
 * whole factor to the matches being asked about. The factor is a whole number in
 * every test, so the expectation is a multiplication of the report's own figure
 * rather than a copy of the route's arithmetic.
 *
 * **What is pinned about the shape, and why.** A series is named by the name the
 * results listing gives it, and no answer carries a path — not even the
 * root it was read from, which every other listing echoes. `seatMs` is a seat's
 * own clock, so the two seats' figures are each the report's `wallMs` and
 * asking with a concurrency of 4 changes nothing but the echo. A seat nothing
 * played is answered as unmeasured with the documented figure quoted, and the
 * route is the only place that figure is spelled out.
 *
 * Every run is bot against bot, because that is the only kind a test may start:
 * one model match is nineteen minutes and 4.59M tokens
 * (`docs/pi-harness-notes.md` §7), a bot match 1.3 s. The roots are always
 * somewhere other than the current directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seriesReport } from "@no-dice/stats/series-report";
import type { ModelRow, SeriesReport } from "@no-dice/stats/series-report";

import { DOCUMENTED_MATCH, estimateQueryOf, estimateRows } from "./estimate.ts";
import * as results from "./results.ts";
import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";

/** A response, read to the end. */
interface Answer {
  status: number;
  type: string;
  body: string;
}

/** One seat of the answer, as far as these tests read it. */
interface Seat {
  label: string;
  measured: {
    series: string[];
    matches: number;
    perMatch: { turns: number; tokens: number; costUsd: number; seatMs: number };
  } | null;
  run?: { turns: number; tokens: number; costUsd: number; seatMs: number };
  fallback?: { perMatch: { tokens: number; seatMs: number }; line: string };
}

/** What `GET /api/estimate` answers. */
interface Estimate {
  pairs: number;
  matches: number;
  concurrency: number;
  seats: Seat[];
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

/** One GET, with the path sent exactly as written. */
const get = (port: number, path: string, method = "GET"): Promise<Answer> =>
  new Promise((done, failed) => {
    const req = request({ host: HOST, port, path, method, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        done({
          status: response.statusCode ?? 0,
          type: String(response.headers["content-type"]),
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", failed);
    req.end();
  });

const post = (port: number, path: string, body: unknown): Promise<Answer> =>
  new Promise((done, failed) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        host: HOST,
        port,
        path,
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          done({
            status: response.statusCode ?? 0,
            type: String(response.headers["content-type"]),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", failed);
    req.end(payload);
  });

/** A console's three roots, and the directory it runs in — none of them the cwd. */
function rootsAt(): { cwd: string; seriesRoot: string; matchesRoot: string; reportsRoot: string } {
  const home = tempDir("nd-ui-estimate-");
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
function consoleAt(): { port: Promise<number> } & ReturnType<typeof rootsAt> {
  const at = rootsAt();
  return { ...at, port: listen({ port: 0, ...at }) };
}

/** The series the tests start: two bots, one pair, so two matches. */
const SERIES = { game: "salient", a: "bot:greedy", b: "bot:random", maxPairs: 1 };

/** The run snapshot at `/api/run`, parsed. */
interface Snapshot {
  state: string;
  exitCode: number | null;
}

/**
 * Start a series run, poll `/api/run` until it has stopped, and fail the test if
 * it did not finish cleanly. A bot-versus-bot match is 1.3 s, so this is over in
 * a second or two.
 */
async function runTo(port: number, body: Record<string, unknown>): Promise<Snapshot> {
  expect((await post(port, "/api/run/series", body)).status).toBe(202);

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

/** One ask, answered. */
const estimateAt = async (
  port: number,
  query = "a=bot:greedy&b=bot:random&pairs=5&concurrency=1",
): Promise<Estimate> => {
  const answer = await get(port, `/api/estimate?${query}`);
  expect(answer.status).toBe(200);
  expect(answer.type).toContain("application/json");
  return JSON.parse(answer.body) as Estimate;
};

/** The seat for `label`, or a failure that names the seats the answer had. */
const seatOf = (estimate: Estimate, label: string): Seat => {
  const seat = estimate.seats.find((each) => each.label === label);
  if (seat === undefined) {
    throw new Error(`no seat for ${label}: ${estimate.seats.map((each) => each.label).join(", ")}`);
  }
  return seat;
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

describe("GET /api/estimate", () => {
  it("answers each seat with the figures the report prints for it", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    const estimate = await estimateAt(port);
    expect(estimate).toMatchObject({ pairs: 5, matches: 10, concurrency: 1 });
    expect(estimate.seats.map((each) => each.label)).toEqual(["bot:greedy", "bot:random"]);

    const report = await seriesReport(join(at.seriesRoot, "alpha"));
    for (const label of ["bot:greedy", "bot:random"]) {
      const row = reportRow(report, label);
      const seat = seatOf(estimate, label);
      expect(seat.measured).not.toBeNull();
      expect(seat.measured!.matches).toBe(row.matches);
      expect(seat.measured!.series).toEqual(["alpha"]);

      // The run is 10 matches against the 2 that were measured, so every figure
      // is the report's own times five — a multiplication of the report's
      // number, not a second calculation of it.
      const factor = estimate.matches / row.matches;
      expect(seat.run!.turns).toBe(row.metrics.turnCount * factor);
      expect(seat.run!.tokens).toBe(row.metrics.tokens.total * factor);
      expect(seat.run!.costUsd).toBe(row.metrics.costUsd * factor);
      expect(seat.run!.seatMs).toBe(row.metrics.wallMs * factor);

      // And the per-match figures are the same totals over the matches measured:
      // a bot plays 25 turns a match, and used no tokens and no money at all. A
      // millisecond that does not divide is rounded down, so a per-match figure
      // never claims more than the report measured.
      expect(seat.measured!.perMatch.turns).toBe(row.metrics.turnCount / row.matches);
      expect(seat.measured!.perMatch.tokens).toBe(row.metrics.tokens.total / row.matches);
      expect(seat.measured!.perMatch.costUsd).toBe(row.metrics.costUsd / row.matches);
      expect(seat.measured!.perMatch.seatMs).toBe(Math.floor(row.metrics.wallMs / row.matches));
    }
  }, 120_000);

  it("names each series by the name the results listing gives it, and carries no path", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });
    // The same two seats with the seats swapped, so `bot:greedy` is measured in a
    // series where it sat in the other position: a seat is measured by its label,
    // not by which side of the pairing the series ran it on.
    await runTo(port, { ...SERIES, a: "bot:random", b: "bot:greedy", name: "beta" });

    const answer = await get(port, "/api/estimate?a=bot:greedy&b=bot:random&pairs=5&concurrency=1");
    const estimate = JSON.parse(answer.body) as Estimate;

    // The name the page already shows for a series — the directory's own name,
    // which is what `--name` gave it — and not the directory.
    for (const label of ["bot:greedy", "bot:random"]) {
      expect(seatOf(estimate, label).measured!.series).toEqual(["alpha", "beta"]);
    }

    // Nothing in the answer is a path, or part of one: not the root the walk read
    // from, which every other listing echoes, and not even a separator — these
    // two seats are bots, whose labels have none.
    expect(answer.body).not.toContain(at.seriesRoot);
    expect(answer.body).not.toContain("/");
    expect(estimate).not.toHaveProperty("seriesRoot");
  }, 120_000);

  it("pools the figures of every series under the root that played the seat", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });
    await runTo(port, { ...SERIES, name: "beta" });

    const estimate = await estimateAt(port, "a=bot:greedy&b=bot:random&pairs=10&concurrency=1");
    const reports = [
      await seriesReport(join(at.seriesRoot, "alpha")),
      await seriesReport(join(at.seriesRoot, "beta")),
    ];
    const rows = reports.map((report) => reportRow(report, "bot:greedy"));

    const seat = seatOf(estimate, "bot:greedy");
    expect(seat.measured!.series).toEqual(["alpha", "beta"]);
    // Four matches measured, not two: the seat was played in both series, and the
    // answer names both of them.
    expect(seat.measured!.matches).toBe(sum(rows, (row) => row.matches));
    // 20 matches asked over 4 measured: every figure is the sum of the two
    // reports' own figures, times five.
    expect(seat.run!.turns).toBe(sum(rows, (row) => row.metrics.turnCount) * 5);
    expect(seat.run!.seatMs).toBe(sum(rows, (row) => row.metrics.wallMs) * 5);
  }, 120_000);

  it("answers a seat nothing under the root has played as unmeasured, quoting the documented figure", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    const estimate = await estimateAt(port, "a=marvin/subagent&b=bot:greedy&pairs=5&concurrency=1");
    const seat = seatOf(estimate, "marvin/subagent");

    expect(seat.measured).toBeNull();
    expect(seat.run).toBeUndefined();
    // The figure the notes carry, quoted rather than computed: nineteen minutes
    // and 4.59M tokens for one model match, and nothing else — Marvin prices
    // nothing, so there is no cost to offer, and the notes' row is a time and a
    // token count.
    expect(seat.fallback).toEqual({
      perMatch: { tokens: 4_590_000, seatMs: 1_140_000 },
      line: expect.stringContaining("Marvin"),
    });
    expect(seat.fallback!.line).toContain("19 minutes");
    expect(seat.fallback!.line).toContain("4.59M tokens");
    // Named in words, because a browser has no use for a path into the repo.
    expect(seat.fallback!.line).not.toContain("docs/");
    expect(seat.fallback!.line).not.toContain("/");

    // The other seat of the same ask is still measured: an unmeasured seat is a
    // fact about one seat, not about the pairing.
    expect(seatOf(estimate, "bot:greedy").measured).not.toBeNull();
  }, 120_000);

  it("echoes the concurrency and divides nothing by it", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    const one = await estimateAt(port, "a=bot:greedy&b=bot:random&pairs=5&concurrency=1");
    const four = await estimateAt(port, "a=bot:greedy&b=bot:random&pairs=5&concurrency=4");

    expect(four.concurrency).toBe(4);
    expect(one.concurrency).toBe(1);
    // `wallMs` is a seat's own clock and the two seats of a match play in turn,
    // so playing four pairs at once changes the wall clock of the run and not the
    // figure in a seat. Dividing it here would be the route inventing a quantity
    // the report never measured.
    expect(four.seats).toEqual(one.seats);
  }, 120_000);

  it("refuses a seat the query does not parse as a seat, in the terminal's own words", async () => {
    const at = consoleAt();
    const port = await at.port;

    const noModel = await get(port, "/api/estimate?a=marvin&b=bot:greedy&pairs=5");
    expect(noModel.status).toBe(400);
    expect(JSON.parse(noModel.body).error).toBe(
      '--a takes bot:random, bot:greedy and <provider>/<model-id>, not "marvin"',
    );

    const notABot = await get(port, "/api/estimate?a=bot:surprise&b=bot:greedy&pairs=5");
    expect(notABot.status).toBe(400);
    expect(JSON.parse(notABot.body).error).toContain("bot:surprise");

    const noSeat = await get(port, "/api/estimate?b=bot:greedy&pairs=5");
    expect(noSeat.status).toBe(400);
    expect(JSON.parse(noSeat.body).error).toContain("required");

    // The same parser answers for the counts: `pairs` is `--max-pairs`, and the
    // CLI refuses zero of them.
    const noPairs = await get(port, "/api/estimate?a=bot:greedy&b=bot:random&pairs=0");
    expect(noPairs.status).toBe(400);
    expect(JSON.parse(noPairs.body).error).toContain("--max-pairs takes a whole number of 1 or more");
  }, 120_000);

  it("leaves a limit the query left out at the runner's default", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    // A blank field is not a zero: it is the runner's default, the same rule the
    // run form applies, and the page has to be able to say so.
    const estimate = await estimateAt(port, "a=bot:greedy&b=bot:random");
    expect(estimate.pairs).toBe(75);
    expect(estimate.matches).toBe(150);
    expect(estimate.concurrency).toBe(1);

    const report = await seriesReport(join(at.seriesRoot, "alpha"));
    const row = reportRow(report, "bot:greedy");
    expect(seatOf(estimate, "bot:greedy").run!.turns).toBe(row.metrics.turnCount * 75);
  }, 120_000);

  it("reads a root nobody has run a series into as two unmeasured seats", async () => {
    const at = consoleAt();
    const estimate = await estimateAt(await at.port);

    expect(estimate.seats.map((each) => each.measured)).toEqual([null, null]);
    expect(estimate.seats.every((each) => each.fallback!.line.includes("Marvin"))).toBe(true);
  });

  it("takes nothing from a series whose record it cannot read, and does not name it", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    mkdirSync(join(at.seriesRoot, "broken"), { recursive: true });
    writeFileSync(join(at.seriesRoot, "broken", "series.json"), '{"max_pairs": 2}\n', "utf8");

    const estimate = await estimateAt(port);
    const report = await seriesReport(join(at.seriesRoot, "alpha"));
    const row = reportRow(report, "bot:greedy");

    const seat = seatOf(estimate, "bot:greedy");
    expect(seat.measured!.series).toEqual(["alpha"]);
    expect(seat.measured!.matches).toBe(row.matches);
    // The unreadable directory is listed, with the line it failed on, on
    // `/api/series` — which is the route that is allowed to name a path.
    const series = JSON.parse((await get(port, "/api/series")).body) as { unreadable: unknown[] };
    expect(series.unreadable).toHaveLength(1);
  }, 120_000);

  it("walks the series root once for the whole answer, not once per seat", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });

    // The spy calls through to the real walk, so the answer is the real answer;
    // what is asserted is that the route asked for one read of every match log
    // and used it for both seats.
    const walked = vi.spyOn(results, "seriesEntries");
    const estimate = await estimateAt(port);
    expect(walked).toHaveBeenCalledTimes(1);
    walked.mockRestore();

    expect(estimate.seats).toHaveLength(2);
  }, 120_000);

  it("answers a root it cannot walk with the same line the results routes give", async () => {
    const at = rootsAt();
    // A root that is a file: `readdir` answers ENOTDIR whoever asks, and the
    // route does not invent its own line for it.
    mkdirSync(at.cwd, { recursive: true });
    mkdirSync(join(at.seriesRoot, ".."), { recursive: true });
    writeFileSync(at.seriesRoot, "not a directory\n", "utf8");
    const port = await listen({ port: 0, ...at });

    const estimate = await get(port, "/api/estimate?a=bot:greedy&b=bot:random&pairs=5");
    const series = await get(port, "/api/series");

    expect(estimate.status).toBe(500);
    expect(series.status).toBe(500);
    const estimateLine = (JSON.parse(estimate.body) as { error: string }).error;
    const seriesLine = (JSON.parse(series.body) as { error: string }).error;
    expect(estimateLine).toContain("ENOTDIR");
    // One line, said the same way by both routes, with only the route's own path
    // differing in it.
    const said = (line: string, path: string): string => line.replace(path, "<route>");
    expect(said(estimateLine, "/api/estimate")).toBe(said(seriesLine, "/api/series"));
  }, 120_000);

  it("is a read: GET and HEAD answer, POST does not, and no Origin is asked for", async () => {
    const at = consoleAt();
    const port = await at.port;

    const head = await get(port, "/api/estimate?a=bot:greedy&b=bot:random&pairs=5", "HEAD");
    expect(head.status).toBe(200);
    expect(head.type).toContain("application/json");
    expect(head.body).toBe("");

    const posted = await post(port, "/api/estimate", {});
    expect(posted.status).toBe(405);
  }, 120_000);
});

describe("the query behind the route", () => {
  it("reads the two seats as the labels a report's model rows are keyed by", () => {
    const asked = estimateQueryOf("/api/estimate?a=bot:greedy&b=marvin/subagent&pairs=3&concurrency=2");
    expect(asked).toEqual({
      ok: true,
      query: { a: "bot:greedy", b: "marvin/subagent", pairs: 3, concurrency: 2 },
    });
  });

  it("refuses a query it cannot read as a run, with the CLI's line", () => {
    const asked = estimateQueryOf("/api/estimate?a=bot:greedy&b=bot:greedy&pairs=2.5");
    expect(asked.ok).toBe(false);
    expect((asked as { error: string }).error).toContain("--max-pairs");
  });

  it("answers the same estimate over the rows the walk read", async () => {
    const at = rootsAt();
    // A series that recorded no pairs: a real record, read by the same
    // report, and one that needs no run to make. With no counted match it has no
    // model row, so both seats come back unmeasured.
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

    const estimate = await estimateRows(
      at,
      { a: "bot:greedy", b: "bot:random", pairs: 1, concurrency: 1 },
      null,
    );
    const unmeasured = (label: string): Seat => ({
      label,
      measured: null,
      fallback: {
        perMatch: { tokens: DOCUMENTED_MATCH.tokens, seatMs: DOCUMENTED_MATCH.seatMs },
        line: DOCUMENTED_MATCH.line,
      },
    });
    expect(estimate).toEqual({
      pairs: 1,
      matches: 2,
      concurrency: 1,
      seats: [unmeasured("bot:greedy"), unmeasured("bot:random")],
    });
  });
});
