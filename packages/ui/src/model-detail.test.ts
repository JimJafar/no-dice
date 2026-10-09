/**
 * The console's detail of one model over real HTTP: `GET /api/model-detail?label=…`
 * — the pooled headline figures, and one block per series that counted a match
 * for that label.
 *
 * **Every figure is checked against the stats package, never against a second
 * calculation.** Each test reads the same directories back through `seriesReport`
 * and `seriesEvidence` — the calls `no-dice stats` and `no-dice evidence` make —
 * and requires the block the console answered with to be those figures: the
 * headline the sums of the per-series model rows, the interval one Wilson
 * interval over the *pooled* `n`, the block's figures that series' own `ModelRow`,
 * the rules' counters that series' own evidence totals and means. The one figure
 * no report answers is the wall clock per match, and that is checked to be the
 * series' own `wallMs` over the matches the block links — the same scope as the
 * `matches` the block counts, which is what makes the two agree.
 *
 * **A link is followed, not just named.** Each block's replay links are fetched
 * back from the console that served them, because a link that 404s is a bug in
 * this file rather than in the page that draws it, and the kept report links are
 * checked against a reports root that holds one copy and not the other — the
 * state `docs/series-notes.md` §7 says is normal, because the copies are made by
 * hand.
 *
 * **What cannot be read is still answered.** A series whose record this console
 * cannot read is a block carrying the line it failed on, beside the blocks that
 * could be read; a label no report names is one refusal line rather than an empty
 * answer.
 *
 * Every run is bot against bot, because that is the only kind a test may start:
 * one model match is nineteen minutes and 4.59M tokens
 * (`docs/pi-harness-notes.md` §7), a bot match 1.3 s. The roots are always
 * somewhere other than the current directory.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as evidenceModule from "@no-dice/stats/rules-evidence";
import { seriesEvidence } from "@no-dice/stats/rules-evidence";
import { seriesReport } from "@no-dice/stats/series-report";
import type { ModelRow, SeriesReport } from "@no-dice/stats/series-report";
import { wilsonInterval, zOf } from "@no-dice/stats/wilson";

import { MODEL_DETAIL_PATH, detailLabelOf, modelDetailOf } from "./model-detail.ts";
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
  const home = tempDir("nd-ui-model-detail-");
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
 * it did not finish cleanly. A bot-versus-bot match is 1.3 s, so this is over in
 * a second or two.
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

/** The route's address for one label. */
const detailPathOf = (label: string): string => `${MODEL_DETAIL_PATH}?label=${encodeURIComponent(label)}`;

/** `GET /api/model-detail?label=…`, parsed, and failed the test unless it answered. */
async function detailAt(port: number, label: string): Promise<Detail> {
  const answer = await get(port, detailPathOf(label));
  if (answer.status !== 200) {
    throw new Error(`${MODEL_DETAIL_PATH} for ${label} answered ${String(answer.status)}: ${answer.body}`);
  }
  return JSON.parse(answer.body) as Detail;
}

/** The answer, as these tests read it — the shape the page reads too. */
interface Detail {
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
  series: {
    name: string;
    dir: string;
    error: string | null;
    result: { winRate: { n: number }; interval: { low: number; high: number } | null } | null;
    seatSplit: { A: { winRate: { n: number } }; B: { winRate: { n: number } } } | null;
    figures: {
      turnCount: number;
      wallMs: number;
      wallMsPerMatch: number;
      perTurn: { wallMs: number; costUsd: number; tokens: number };
      tokens: { input: number; output: number; cache_read: number; cache_write: number; total: number };
      costUsd: number;
      passedTurns: number;
      passes: Record<string, number>;
      compactions: number;
    } | null;
    rules: Record<string, number | string>;
    matches: { name: string; path: string; url: string; viewerUrl: string; seed: number }[];
    links: {
      reportUrl: string;
      keptReportUrl: string;
      keptEvidenceUrl: string;
      keptReport: boolean;
      keptEvidence: boolean;
    };
  }[];
}

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

describe("GET /api/model-detail", () => {
  it("answers the pooled headline figures and one block per series that counted the label", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "alpha" });
    // The same pairing the other way round, so the swap moves each model to the
    // other seat in the second series and one pooled row has to be made of both.
    await runTo(port, { ...SERIES, a: "bot:random", b: "bot:greedy", name: "beta" });

    const detail = await detailAt(port, "bot:greedy");
    expect(detail.label).toBe("bot:greedy");

    // The reports in the order the walk reads them: by name. The blocks are in
    // that same order, so the page draws the series in the order it draws them
    // everywhere else.
    const reports = [await seriesReport(join(at.seriesRoot, "alpha")), await seriesReport(join(at.seriesRoot, "beta"))];
    const rows = reports.map((report) => reportRow(report, "bot:greedy"));
    expect(detail.series.map((each) => each.name)).toEqual(["alpha", "beta"]);
    expect(detail.series.map((each) => each.dir)).toEqual(reports.map((report) => report.dir));

    // The headline is the sums over both series, not the figures of one of them.
    expect(detail.matches).toBe(sum(rows, (each) => each.matches));
    expect(detail.result.winRate.wins).toBe(sum(rows, (each) => each.result.winRate.wins));
    expect(detail.result.winRate.losses).toBe(sum(rows, (each) => each.result.winRate.losses));
    expect(detail.result.winRate.draws).toBe(sum(rows, (each) => each.result.winRate.draws));
    expect(detail.result.winRate.n).toBe(sum(rows, (each) => each.result.winRate.n));
    expect(detail.seats.A).toBe(sum(rows, (each) => each.seats.A));
    expect(detail.seats.B).toBe(sum(rows, (each) => each.seats.B));
    expect(detail.missing).toBe(reports.reduce((total, each) => total + each.missing.total, 0));
    // The note is the stats package's own words for that count, passed through
    // unchanged rather than rewritten here: with nothing missing it says so.
    expect(detail.missing).toBe(0);
    expect(detail.missingNote).toContain("went missing");

    // The rate and the interval are taken over the pooled counts. The formula is
    // the stats package's and is tested there; what is pinned here is the scope —
    // one interval over every match the label played, not an average of the two
    // series' intervals.
    const { wins, losses, draws, n, rate } = detail.result.winRate;
    expect(wins + losses + draws).toBe(n);
    expect(rate).toBe((wins + draws / 2) / n);
    expect(detail.result.confidence).toBe(0.95);
    expect(detail.result.interval).toEqual(wilsonInterval({ successes: wins + draws / 2, n, z: zOf(0.95) }));

    // The seat split is over the same matches, split by the seat each match's own
    // header said this model held.
    expect(detail.seatSplit.A.winRate.n + detail.seatSplit.B.winRate.n).toBe(detail.matches);

    // Each block is that series' own row for the label: its rate, its 95%
    // interval and its seat split, figure for figure.
    for (const [index, block] of detail.series.entries()) {
      const row = rows[index]!;
      expect(block.error).toBeNull();
      expect(block.result).toEqual(row.result);
      expect(block.seatSplit).toEqual(row.seatSplit);
      expect(block.result!.interval).not.toBeNull();
      expect(block.seatSplit!.A.winRate.n + block.seatSplit!.B.winRate.n).toBe(row.matches);
    }
  }, 120_000);

  it("answers each block's figures and rules counters as that series' own report and evidence answer them", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "gamma" });

    const detail = await detailAt(port, "bot:random");
    const dir = join(at.seriesRoot, "gamma");
    const row = reportRow(await seriesReport(dir), "bot:random");
    const evidence = await seriesEvidence(dir);
    const [block] = detail.series;

    // Every figure is the report's own metric for that model in that series.
    expect(block!.figures!.turnCount).toBe(row.metrics.turnCount);
    expect(block!.figures!.wallMs).toBe(row.metrics.wallMs);
    expect(block!.figures!.tokens).toEqual(row.metrics.tokens);
    expect(block!.figures!.costUsd).toBe(row.metrics.costUsd);
    expect(block!.figures!.perTurn).toEqual({
      wallMs: row.metrics.perTurn.wallMs,
      costUsd: row.metrics.perTurn.costUsd,
      tokens: row.metrics.perTurn.tokens,
    });
    expect(block!.figures!.passedTurns).toBe(row.metrics.passedTurns);
    // The passes by reason, which is where a timeout is counted: a turn that ran
    // out of the clock is a pass, and the detail has to be able to say how many.
    expect(block!.figures!.passes).toEqual(row.metrics.passes);
    expect(block!.figures!.passes.timeout).toBe(row.metrics.passes.timeout);
    expect(block!.figures!.compactions).toBe(row.metrics.context.compactionTurns.length);

    // The one figure the route works out: the series' wall clock over the matches
    // this model played in it. `perTurn.wallMs` is already a mean over turns,
    // so there is nothing else to take it from, and the denominator is the same
    // `matches` the block's own row counts.
    expect(block!.figures!.wallMsPerMatch).toBe(row.metrics.wallMs / row.matches);
    expect(block!.figures!.wallMsPerMatch * block!.matches.length).toBeCloseTo(block!.figures!.wallMs, 6);

    // The rules' five counters, out of the same series' evidence — and the same
    // five the rules ask, not a per-model share of them, which is why a
    // block for either seat of the pairing answers the same numbers.
    expect(block!.rules).toEqual({
      leadChanges: evidence.totals.leadChanges,
      flipsPerTurn: evidence.means.perTurn.flips,
      nodeHandChanges: evidence.totals.nodeHandChanges,
      neutralCaptures: evidence.totals.neutralCaptures,
      reScouts: evidence.totals.reScouts,
    });
  }, 120_000);

  it("links each block's matches to the replays it serves, and its reports to the kept copies that are on disk", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "delta" });

    // The state `docs/series-notes.md` §7 says is normal: the report was copied
    // out of the gitignored series directory and the evidence was not.
    mkdirSync(at.reportsRoot, { recursive: true });
    writeFileSync(join(at.reportsRoot, "delta.md"), "# Kept report\n", "utf8");

    const detail = await detailAt(port, "bot:greedy");
    const [block] = detail.series;
    const dir = join(at.seriesRoot, "delta");
    const row = reportRow(await seriesReport(dir), "bot:greedy");
    const evidence = await seriesEvidence(dir);

    // The matches the block counts are the matches that counted, and it links
    // every one of them: the same set the figures were taken over.
    expect(block!.matches).toHaveLength(row.matches);
    expect(block!.matches.map((each) => each.name)).toEqual(evidence.rows.map((each) => basename(each.path)));
    for (const [index, link] of block!.matches.entries()) {
      const record = evidence.rows[index]!;
      expect(link.path).toBe(record.path);
      expect(link.seed).toBe(record.seed);
      expect(link.url).toBe(`/logs/delta/matches/${link.name}`);
      // The viewer opened on that log, back to the leaderboard this block sits in
      // rather than to the matches listing.
      expect(link.viewerUrl).toBe(`/viewer/?log=${link.url}&back=%23leaderboard`);

      // And the link is one this console serves: the log itself, as JSON.
      const answer = await get(port, link.url);
      expect(answer.status).toBe(200);
      expect(answer.type).toContain("application/json");
      expect(JSON.parse(answer.body).seed).toBe(record.seed);
    }

    // The reports: the runner's copy inside the series directory, and the two
    // kept copies — each named, and each said as present or absent.
    expect(block!.links.reportUrl).toBe("/logs/delta/report.md");
    expect(block!.links.keptReportUrl).toBe("/reports/delta.md");
    expect(block!.links.keptEvidenceUrl).toBe("/reports/delta-evidence.md");
    expect(block!.links.keptReport).toBe(true);
    expect(block!.links.keptEvidence).toBe(false);

    const kept = await get(port, block!.links.keptReportUrl);
    expect(kept.status).toBe(200);
    expect(kept.body).toContain("Kept report");
    // The copy that was never written is not offered as a link that works.
    expect((await get(port, block!.links.keptEvidenceUrl)).status).toBe(404);
  }, 120_000);

  it("keeps a series whose record it cannot read as a block carrying the line it failed on", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "epsilon" });

    mkdirSync(join(at.seriesRoot, "broken"), { recursive: true });
    writeFileSync(join(at.seriesRoot, "broken", "series.json"), '{"max_pairs": 2}\n', "utf8");

    // The state a killed run leaves behind beside the broken directory: a record
    // that still names a match whose log is not on disk. Its missing match is in
    // the headline, and the stats package's own note says it is not a loss.
    const logs = readdirSync(join(at.seriesRoot, "epsilon", "matches"));
    rmSync(join(at.seriesRoot, "epsilon", "matches", logs[0]!));

    const detail = await detailAt(port, "bot:greedy");
    expect(detail.series.map((each) => each.name)).toEqual(["broken", "epsilon"]);
    expect(detail.missing).toBe(1);
    expect(detail.missingNote).toContain("not a loss");

    const [block] = detail.series;
    expect(block!.dir).toBe(join(at.seriesRoot, "broken"));
    expect(block!.error).toContain("is not a series record");
    // Nothing was read of it, so nothing is claimed about it — and the line is
    // said where the rules' counters would have been, which is where the page
    // that cannot show them says why.
    expect(block!.result).toBeNull();
    expect(block!.seatSplit).toBeNull();
    expect(block!.figures).toBeNull();
    expect(block!.matches).toEqual([]);
    expect(block!.rules).toEqual({ error: block!.error });
    // It is still a series under the root, so its links are still its links.
    expect(block!.links.reportUrl).toBe("/logs/broken/report.md");

    // And the series that could be read is answered in full beside it.
    const report = await seriesReport(join(at.seriesRoot, "epsilon"));
    const row = reportRow(report, "bot:greedy");
    expect(detail.matches).toBe(row.matches);
    expect(detail.series[1]!.figures!.turnCount).toBe(row.metrics.turnCount);
    expect(detail.series[1]!.rules).toHaveProperty("leadChanges");
  }, 120_000);

  it("keeps a block whose evidence it cannot read, with its figures and the line it failed on", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "zeta" });

    // The state the second read can fail in and the first cannot: the
    // record opens for the report and not for the evidence. It is forced here
    // because it is what a half-readable series directory looks
    // like, and the block has to say which read failed rather than go missing.
    const failing = vi.spyOn(evidenceModule, "seriesEvidence").mockRejectedValue(new Error("evidence read failed"));

    const detail = await detailAt(port, "bot:greedy");
    failing.mockRestore();

    const [block] = detail.series;
    expect(block!.name).toBe("zeta");
    expect(block!.error).toBe("evidence read failed");
    expect(block!.rules).toEqual({ error: "evidence read failed" });
    // The figures came out of the report and stand; the links came out of the
    // read that failed, and there is nothing to invent them from.
    expect(block!.figures).not.toBeNull();
    expect(block!.result).not.toBeNull();
    expect(block!.matches).toEqual([]);
    expect(block!.links.reportUrl).toBe("/logs/zeta/report.md");
  }, 120_000);

  it("refuses a label no report on this disk names with one line, and not with an empty detail", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "eta" });

    const answer = await get(port, detailPathOf("nobody/never-played"));
    expect(answer.status).toBe(404);
    const refused = JSON.parse(answer.body) as { error: string };
    expect(refused.error).toMatch(/not a model/);
    // The line says which root was read, so an operator looking for a series
    // that is not in it knows where to look.
    expect(refused.error).toContain(at.seriesRoot);
  }, 120_000);

  it("refuses a request that names no label, in the words the page can show", async () => {
    const at = consoleAt();
    const port = await at.port;

    for (const path of [MODEL_DETAIL_PATH, `${MODEL_DETAIL_PATH}?label=`, `${MODEL_DETAIL_PATH}?series=eta`]) {
      const answer = await get(port, path);
      expect(answer.status).toBe(400);
      expect((JSON.parse(answer.body) as { error: string }).error).toContain("label");
    }
  });

  it("is a read: GET and HEAD answer, POST does not, and no Origin is asked for", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "theta" });

    const head = await get(port, detailPathOf("bot:greedy"), "HEAD");
    expect(head.status).toBe(200);
    expect(head.type).toContain("application/json");
    expect(head.body).toBe("");

    // A page on another domain may read it: the `Host` check is what keeps a
    // rebound domain off this port, and a read has nothing to guard.
    const foreign = await send(port, detailPathOf("bot:greedy"), "GET", undefined, {
      origin: "http://elsewhere.example",
    });
    expect(foreign.status).toBe(200);

    const posted = await post(port, MODEL_DETAIL_PATH, { label: "bot:greedy" });
    expect(posted.status).toBe(405);
    expect(posted.headers.allow).toBe("GET, HEAD");
  }, 120_000);

  it("walks the series root once for the whole answer, not once per block", async () => {
    const at = consoleAt();
    const port = await at.port;
    await runTo(port, { ...SERIES, name: "iota" });
    await runTo(port, { ...SERIES, a: "bot:random", b: "bot:greedy", name: "kappa" });

    // The spy calls through to the real walk, so the answer is the real answer;
    // what is asserted is that the route asked for one walk of every match log of
    // every series, and took the per-series blocks out of the reports it returned
    // rather than reading each series again.
    const walked = vi.spyOn(results, "seriesEntries");
    const detail = await detailAt(port, "bot:greedy");
    expect(walked).toHaveBeenCalledTimes(1);
    walked.mockRestore();

    expect(detail.series).toHaveLength(2);
  }, 120_000);

  it("answers nothing for a label a series outside the root played", async () => {
    const at = consoleAt();
    const port = await at.port;

    // `--dir` is the operator's escape hatch, and a series started with it is real
    // work this route will never show. The refusal line names the root it did
    // read, so the missing series is not mistaken for one that never ran.
    const elsewhere = join(at.cwd, "not-under-the-root");
    await runTo(port, { ...SERIES, dir: elsewhere });

    const answer = await get(port, detailPathOf("bot:greedy"));
    expect(answer.status).toBe(404);
    expect((JSON.parse(answer.body) as { error: string }).error).toContain(at.seriesRoot);
  }, 120_000);
});

describe("the label behind the route", () => {
  it("takes the label as the query spells it, percent-encoding and all", () => {
    // `bot:greedy` is spelled with a colon, which a query percent-encodes; the
    // label has to come back as the log header wrote it, or no report matches it.
    expect(detailLabelOf("http://127.0.0.1:8818/api/model-detail?label=bot%3Agreedy")).toEqual({
      ok: true,
      label: "bot:greedy",
    });
    expect(detailLabelOf("http://127.0.0.1:8818/api/model-detail?label=marvin%2Fsubagent")).toEqual({
      ok: true,
      label: "marvin/subagent",
    });
    expect(detailLabelOf(undefined).ok).toBe(false);
    expect(detailLabelOf("/api/model-detail").ok).toBe(false);
    expect(detailLabelOf("/api/model-detail?label=").ok).toBe(false);
  });

  it("refuses a label no report names, and names the root it read", async () => {
    const at = rootsAt();
    const answer = await modelDetailOf(at, "bot:nobody", null);
    if (answer.ok) throw new Error(`answered a detail for a label no report names: ${JSON.stringify(answer.detail)}`);
    expect(answer.error).toMatch(/not a model/);
    // The line says which root was read, so an operator looking for a series that
    // is not in it knows where to look.
    expect(answer.error).toContain(at.seriesRoot);
  });
});
