/**
 * The run slot over real HTTP: a bot-versus-bot match played inside this
 * process, a second start refused while one is in flight, `parseArgs`'s own
 * wording for a run the command line would refuse, and a run that outlives the
 * client that started it.
 *
 * Every run here is bot against bot, because that is the only kind a test may
 * start: one model match is nineteen minutes and 4.59M tokens
 * (`docs/pi-harness-notes.md` §7), a bot match 1.3 s. What is played is real for
 * all that — `runCli` in this process, the logs on disk, the CLI's own pair
 * lines — so every test carries a timeout of its own.
 *
 * The two roots are always somewhere other than the current directory, because
 * the paths a UI-started run writes are the slot's to fix rather than the CLI's
 * to default: a run that landed under `matches/` beside the repo would be a run
 * the results page never lists.
 *
 * One test starts the console as a shell would, in a process of its own, and
 * kills it mid-run. That is the only way to show the other half of where a run
 * lives: it outlives the client that posted it, and it dies with
 * the server process, leaving its series on disk half played.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { parseArgs } from "@no-dice/runner/args";

import { runArgvOf } from "./runs.ts";
import type { PlayableKind, RunSnapshot } from "./runs.ts";
import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";

/** A response, read to the end. */
interface Answer {
  status: number;
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
          done({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", failed);
    req.end(payload);
  });

const get = (port: number, path: string): Promise<Answer> => send(port, path, "GET");
const post = (port: number, path: string, body: unknown, headers?: Record<string, string>): Promise<Answer> =>
  send(port, path, "POST", body, headers);

/** The snapshot at `/api/run`, parsed. */
const snapshotAt = async (port: number): Promise<RunSnapshot> =>
  JSON.parse((await get(port, "/api/run")).body) as RunSnapshot;

/**
 * Poll `/api/run` until the run has stopped running. The page polls the same way
 * and at the same granularity; a bot-versus-bot match is 1.3 s, so this is over
 * in a second or two.
 */
async function untilStopped(port: number, limitMs = 30_000): Promise<RunSnapshot> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const snapshot = await snapshotAt(port);
    if (snapshot.state !== "running") return snapshot;
    if (Date.now() > deadline) throw new Error(`the run was still running after ${String(limitMs)}ms`);
    await new Promise((later) => setTimeout(later, 100));
  }
}

/** A console's two roots, and the directory it runs in — none of them the cwd. */
function rootsAt(): { cwd: string; seriesRoot: string; matchesRoot: string } {
  const home = tempDir("nd-ui-run-");
  const cwd = join(home, "repo");
  // A directory that exists, because a console started as a shell
  // starts one has to be *in* a directory.
  mkdirSync(cwd, { recursive: true });
  return {
    cwd,
    seriesRoot: join(home, "elsewhere", "series"),
    matchesRoot: join(home, "elsewhere", "matches"),
  };
}

/** A console listening on a free port, with those roots. */
function consoleAt(): { port: Promise<number> } & ReturnType<typeof rootsAt> {
  const at = rootsAt();
  return { ...at, port: listen({ port: 0, ...at }) };
}

/** The match the tests start: two bots, one seed, nothing to type. */
const MATCH = { game: "salient", a: "bot:greedy", b: "bot:random", seed: 135 };

/** The series the tests start: two bots, one pair, so two matches. */
const SERIES = { game: "salient", a: "bot:greedy", b: "bot:random", maxPairs: 1 };

/**
 * The line `parseArgs` gives for this command line, so the assertion below is
 * that the console answers with the CLI's own wording rather than with a copy of
 * it that could drift.
 */
const cliErrorOf = (argv: readonly string[]): string => {
  const parsed = parseArgs(argv);
  if (parsed.ok) throw new Error(`${argv.join(" ")} was expected to be refused`);
  return parsed.error;
};

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

describe("POST /api/run/match", () => {
  it(
    "plays the match in this process and leaves a salient-log/1 at the path the snapshot names",
    async () => {
      const at = consoleAt();
      const port = await at.port;

      const started = await post(port, "/api/run/match", MATCH);
      expect(started.status).toBe(202);
      const first = JSON.parse(started.body) as RunSnapshot;
      expect(first.state).toBe("running");
      expect(first.dir).toBeNull();
      // Under the matches root the console was given, not under `matches/` beside
      // the directory the server happens to be running in.
      expect(first.out).toBe(join(at.matchesRoot, "135-greedy-random.json"));

      const done = await untilStopped(port);
      expect(done.state).toBe("done");
      expect(done.exitCode).toBe(0);
      expect(done.endedAt).not.toBeNull();
      // The lines are `runCli`'s own: the path it wrote, then how the match ended.
      expect(done.lines[0]).toBe(String(first.out));
      expect(done.lines.join("\n")).toMatch(/^(time|capture): (seat [AB] wins|draw), A \d+ - B \d+$/m);

      const log = JSON.parse(readFileSync(String(first.out), "utf8")) as {
        format: string;
        seed: number;
        players: unknown;
      };
      expect(log.format).toBe("salient-log/1");
      expect(log.seed).toBe(135);
      expect(log.players).toEqual({ A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "random" } });
      expect(existsSync(join(at.cwd, "matches"))).toBe(false);
    },
    60_000,
  );

  it("keeps a path the form gave of its own, taken from the console's current directory", async () => {
    const at = consoleAt();
    const port = await at.port;

    const started = await post(port, "/api/run/match", { ...MATCH, out: "picked/one.json" });
    expect(started.status).toBe(202);
    const out = String((JSON.parse(started.body) as RunSnapshot).out);
    expect(out).toBe(join(at.cwd, "picked", "one.json"));

    expect((await untilStopped(port)).state).toBe("done");
    expect(existsSync(out)).toBe(true);
  }, 60_000);
});

describe("POST /api/run/series", () => {
  it(
    "plays the series under <seriesRoot>/<name>, prints the CLI's pair lines and ends done",
    async () => {
      const at = consoleAt();
      const port = await at.port;

      const started = await post(port, "/api/run/series", { ...SERIES, name: "smoke" });
      expect(started.status).toBe(202);
      const first = JSON.parse(started.body) as RunSnapshot;
      expect(first.out).toBeNull();
      // An absolute path under the series root, whatever the CLI would have
      // defaulted to beside its current directory.
      expect(first.dir).toBe(join(at.seriesRoot, "smoke"));

      const done = await untilStopped(port);
      expect(done.state).toBe("done");
      expect(done.exitCode).toBe(0);

      // The pair line is the terminal's, `runCli`'s `onPair` and not a copy.
      expect(done.lines.some((line) => line.startsWith("seed "))).toBe(true);
      expect(done.lines).toContain(`series: ${String(first.dir)}`);
      expect(done.lines.at(-1)).toBe(`report.md: ${join(String(first.dir), "report.md")}`);

      const played = readdirSync(join(String(first.dir), "matches"));
      expect(played.length).toBe(2);
      expect(existsSync(join(String(first.dir), "series.json"))).toBe(true);
      expect(existsSync(join(String(first.dir), "report.md"))).toBe(true);
      expect(existsSync(join(at.cwd, "series"))).toBe(false);
    },
    60_000,
  );
});

describe("one run at a time", () => {
  it(
    "refuses a second start with a line naming the run in flight, and leaves that run alone",
    async () => {
      const at = consoleAt();
      const port = await at.port;

      // No name, so the series the refusal names is the pairing's own default.
      const started = await post(port, "/api/run/series", SERIES);
      expect(started.status).toBe(202);
      const dir = String((JSON.parse(started.body) as RunSnapshot).dir);
      expect(dir).toBe(join(at.seriesRoot, "greedy-vs-random"));

      const refused = await post(port, "/api/run/match", MATCH);
      expect(refused.status).toBe(409);
      const error = String((JSON.parse(refused.body) as { error: string }).error);
      expect(error).toContain("a run is already running");
      expect(error).toContain("a series of bot:greedy vs bot:random in " + dir);
      expect(error).toMatch(/, started \d{2}:\d{2}$/);

      // The run that was in flight is the one that was already playing: it
      // finishes, and it is the only thing that ran.
      const done = await untilStopped(port);
      expect(done.state).toBe("done");
      expect(done.exitCode).toBe(0);
      expect(readdirSync(join(dir, "matches")).length).toBe(2);
    },
    60_000,
  );
});

describe("a run the command line would refuse", () => {
  /** What is wrong, which route it is posted to, a fragment of the CLI's line, the payload. */
  const refused: Array<[string, PlayableKind, string, Record<string, unknown>]> = [
    [
      "a pair count that is not a whole number",
      "series",
      "whole number",
      { game: "salient", a: "bot:greedy", b: "bot:random", maxPairs: "75.5", name: "x" },
    ],
    [
      "a seat spec the CLI does not have",
      "series",
      "bot:sad",
      { game: "salient", a: "bot:sad", b: "bot:random", maxPairs: 1 },
    ],
    ["a missing seat", "series", "--b", { game: "salient", a: "bot:greedy" }],
    [
      "a series named and placed at once",
      "series",
      "give one, not both",
      { game: "salient", a: "bot:greedy", b: "bot:random", name: "x", dir: "/tmp/elsewhere" },
    ],
    ["a match with no seed", "match", "--seed", { game: "salient", a: "bot:greedy", b: "bot:random" }],
  ];

  it("answers with parseArgs's own line for each, and starts nothing", async () => {
    const at = consoleAt();
    const port = await at.port;

    for (const [what, kind, fragment, body] of refused) {
      const answer = await post(port, `/api/run/${kind}`, body);
      expect(answer.status, what).toBe(400);
      const error = String((JSON.parse(answer.body) as { error: string }).error);
      expect(error, what).toContain(fragment);
      // The exact line the terminal would have printed for the same command line,
      // not a paraphrase of it that could drift.
      expect(error, what).toBe(cliErrorOf(runArgvOf(kind, body)));
    }

    // Nothing was started by any of them.
    expect((await snapshotAt(port)).state).toBe("idle");
  });
});

describe("the client that asked", () => {
  it("does not stop the run when it hangs up while the run is still playing", async () => {
    const at = consoleAt();
    const port = await at.port;

    // A page closed the moment it posted: the request is answered and
    // then the socket is gone. The run is a promise in this process, and nothing
    // here is watching that socket.
    const req = request(
      {
        host: HOST,
        port,
        path: "/api/run/match",
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json" },
      },
      (response) => response.resume(),
    );
    req.on("error", () => undefined);
    req.end(JSON.stringify(MATCH));
    await new Promise((later) => setTimeout(later, 100));
    req.destroy();

    const done = await untilStopped(port);
    expect(done.state).toBe("done");
    expect(done.exitCode).toBe(0);
    expect(existsSync(join(at.matchesRoot, "135-greedy-random.json"))).toBe(true);
  }, 60_000);

  it("answers a page from another origin with a refusal, and starts nothing", async () => {
    const at = consoleAt();
    const port = await at.port;

    const answer = await post(port, "/api/run/match", MATCH, { origin: "http://attacker.example.com" });
    expect(answer.status).toBe(403);
    expect(JSON.parse(answer.body).error).toContain("attacker.example.com");

    // The page this console served is addressed the same way the request was, so
    // its `Origin` is its own address — and the run route takes it. The payload is
    // a bad one, so what comes back is the CLI's line rather than a 403.
    const own = await post(
      port,
      "/api/run/match",
      { game: "salient" },
      { origin: `http://${HOST}:${String(port)}` },
    );
    expect(own.status).toBe(400);
    expect(JSON.parse(own.body).error).toContain("--a");

    expect((await snapshotAt(port)).state).toBe("idle");
  });

  it("refuses a request body too big to be a form, and starts nothing", async () => {
    const at = consoleAt();
    const port = await at.port;

    const answer = await post(port, "/api/run/match", { ...MATCH, a: `bot:${"x".repeat(20_000)}` });
    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.body).error).toContain("fit in");
    expect((await snapshotAt(port)).state).toBe("idle");
  });

  it("sends a body that is not a run request, and is answered with one line", async () => {
    const at = consoleAt();
    const port = await at.port;

    const notJson = await send(port, "/api/run/match", "POST", undefined, {
      "content-type": "application/json",
    });
    expect(notJson.status).toBe(400);
    expect(JSON.parse(notJson.body).error).toContain("not JSON");

    const notObject = await post(port, "/api/run/series", [1, 2]);
    expect(notObject.status).toBe(400);
    expect(JSON.parse(notObject.body).error).toContain("JSON object");

    expect((await snapshotAt(port)).state).toBe("idle");
  });
});

describe("GET /api/run", () => {
  it("answers what a console that has run nothing has, and refuses a method that starts nothing", async () => {
    const at = consoleAt();
    const port = await at.port;

    expect(await snapshotAt(port)).toEqual({
      state: "idle",
      lines: [],
      dir: null,
      out: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      counters: null,
    });

    const posted = await send(port, "/api/run", "POST", {});
    expect(posted.status).toBe(405);

    const read = await get(port, "/api/run/match");
    expect(read.status).toBe(405);
  });
});

/** The console as a shell starts it: the file the README names, in a process of its own. */
const SERVER = fileURLToPath(new URL("./server.ts", import.meta.url));

/** The port a spawned console says it listens on, read out of its banner. */
const listeningOn = (child: ChildProcess): Promise<number> =>
  new Promise((listening, failed) => {
    let seen = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      seen += chunk.toString("utf8");
      const port = /no-dice-ui on http:\/\/127\.0\.0\.1:(\d+)/.exec(seen)?.[1];
      if (port !== undefined) listening(Number(port));
    });
    child.on("error", failed);
    child.once("close", (code) =>
      void failed(new Error(`the console stopped before listening, with ${String(code)}`)),
    );
  });

/** Until a spawned process has gone. */
const gone = (child: ChildProcess): Promise<void> =>
  new Promise((closed) => child.once("close", () => void closed()));

/** Whether a directory gets anything in it before the wait runs out. */
async function untilNotEmpty(dir: string, limitMs: number): Promise<boolean> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    if (existsSync(dir) && readdirSync(dir).length > 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((later) => setTimeout(later, 100));
  }
}

describe("the process a run lives in", () => {
  it(
    "ends the run when the console is killed, leaving the series on disk half played",
    async () => {
      const at = rootsAt();
      const child = spawn(
        process.execPath,
        [
          SERVER,
          "--port",
          "0",
          "--series-root",
          at.seriesRoot,
          "--matches-root",
          at.matchesRoot,
        ],
        { cwd: at.cwd, stdio: ["ignore", "pipe", "pipe"] },
      );

      try {
        const port = await listeningOn(child);
        // Forty pairs is eighty matches, minutes of bot play: far more than this
        // test waits for, and the reason the series ends half played.
        const started = await post(port, "/api/run/series", { ...SERIES, maxPairs: 40, name: "half" });
        expect(started.status).toBe(202);

        // Killed as soon as the first pair is on disk, so how much of the series
        // got played is not decided by how fast this machine is.
        expect(await untilNotEmpty(join(at.seriesRoot, "half", "matches"), 30_000)).toBe(true);
        child.kill("SIGKILL");
        await gone(child);

        const played = readdirSync(join(at.seriesRoot, "half", "matches"));
        expect(played.length).toBeGreaterThan(0);
        expect(played.length).toBeLessThan(80);

        // Half played rather than finished. `series.json` is rewritten after every
        // pair — that is what a resume reads — while `report.md` is only what a
        // series that ran to its end leaves behind.
        const record = JSON.parse(
          readFileSync(join(at.seriesRoot, "half", "series.json"), "utf8"),
        ) as { max_pairs: number; state: { pairs_played: number } };
        expect(record.max_pairs).toBe(40);
        expect(record.state.pairs_played).toBeLessThan(40);
        expect(existsSync(join(at.seriesRoot, "half", "report.md"))).toBe(false);
      } finally {
        child.kill("SIGKILL");
      }
    },
    60_000,
  );
});
