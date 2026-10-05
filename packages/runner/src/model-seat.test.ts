/**
 * A model in a seat: `runMatch` with a Pi seat, and the log that comes out.
 *
 * The runner's loop is meant not to care who plays a seat, so these tests play a
 * real Pi process against the Greedy bot and read the result back from the log
 * rather than from the player. What they hold the runner to is what only the
 * runner can produce: the header that says which Pi build and which model played
 * (`harness.pi_version`, `players.<seat>` with its model, thinking level and
 * context window), the per-turn figures that come out of the seat's own session
 * stats instead of standing at nought, a pass reason taken from the seat when the
 * seat knows one, and the two rules the runner holds over a seat — a turn that
 * runs out of its time, and a seat that is still running ten seconds after its
 * submission landed.
 *
 * The model is `StubModel` on loopback, named in the seat's own `models.json`, so
 * a whole 25-turn match runs with no credential and no cost. One pair of tests
 * does the opposite on purpose: it seats a model the run cannot play — a provider
 * with no credential, a name with no provider in it — and checks the run stops
 * there, in one line, instead of playing 25 turns of provider errors.
 *
 * Two more play a turn that passes for a reason only the seat can see — a
 * provider that kept refusing, a turn over its output budget — because the runner
 * carries the seat's reason to the log rather than guessing `no_submission`. One
 * plays a match voided by a seat that reached a tool outside the seven, in a
 * process of its own: the runner has to let go of everything it started when a
 * turn rejects, not only when it ends, and only a process can show that.
 *
 * A Pi seat is seconds to start and seconds to prompt, so every test here carries
 * a timeout of its own.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  StubModel,
  callsToolThenSubmits,
  piCli,
  providerError,
  salientToolName,
  stubModelsJson,
} from "@no-dice/harness";
import type { StubReply, StubRequest, StubScript, StubUsage } from "@no-dice/harness";
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMatch } from "./match.ts";
import type { PiSeat, RunMatchOptions, SeatSpec } from "./match.ts";
import { matchLogSchema } from "./log.ts";
import type { MatchLog, TurnPlayerRecord } from "./log.ts";
import { withoutAnthropicCredentials } from "./test-credentials.ts";

/** A seat played by a Pi process: seconds to start, seconds per turn. */
const SEAT_TIMEOUT_MS = 180_000;

/** The window the stub's model entry declares, and the one the header must carry. */
const CONTEXT_WINDOW = 65_536;

/** What the stub's model entry charges, in US dollars per million tokens. */
const COST = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

/** A submission the server accepts: no orders, and the two notes with them. */
const SUBMISSION = {
  orders: [],
  intent: "The stub is holding still.",
  prediction: "The other seat moves east.",
};

/** A reply whose output tokens are over the budget one test below gives its seat. */
const OVER_BUDGET: StubUsage = { input: 100, output: 5_000, cacheRead: 0, cacheWrite: 0 };

/** Where each test's match lives: its log, and the directory of seat homes. */
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "no-dice-model-seat-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The tools the seat called after the prompt it is now answering. */
const toolsSincePrompt = (request: StubRequest): string[] => {
  const roles = request.messages.map((message) => message.role);
  const since = request.messages.slice(roles.lastIndexOf("user") + 1);
  return since.flatMap((message) => {
    const calls = message.tool_calls;
    if (!Array.isArray(calls)) return [];
    return calls.flatMap((call) => {
      const name = (call as { function?: { name?: unknown } })?.function?.name;
      return typeof name === "string" ? [name] : [];
    });
  });
};

/**
 * A seat that plays every turn the same way: read the board, submit, settle.
 *
 * The phase is read from the request rather than counted from the first, because
 * a match is a hundred requests long and a count that slips by one leaves every
 * later turn scripted wrong.
 */
const playsEveryTurn = (request: StubRequest): StubReply => {
  const called = toolsSincePrompt(request);
  if (called.includes(salientToolName("submit_orders"))) {
    return { text: "I have submitted. I will hold this line." };
  }
  if (called.includes(salientToolName("get_state"))) {
    return { toolCalls: [{ name: salientToolName("submit_orders"), args: SUBMISSION }] };
  }
  return { toolCalls: [{ name: salientToolName("get_state"), args: {} }] };
};

/** Start a stub whose model entry costs something, so a turn has a price to read. */
const startStub = async (script: StubScript): Promise<StubModel> =>
  StubModel.start(script, { contextWindow: CONTEXT_WINDOW, cost: COST });

/** The seat spec that plays a stub through the Pi harness. */
const stubSeat = (stub: StubModel): PiSeat => ({
  kind: "pi",
  model: stub.modelRef,
  // The stub is not a reasoning model, and the level the seat is played at is one
  // the header has to name exactly.
  thinking: "off",
  modelsJson: stubModelsJson(stub.baseUrl, { contextWindow: CONTEXT_WINDOW, cost: COST }),
  // The seat must not reach for the internet: the stub on loopback is its model.
  env: { PI_OFFLINE: "1" },
});

/** The Greedy seat these tests' matches are played against. */
const GREEDY: SeatSpec = { kind: "bot", bot: "greedy" };

/** A match's log path and the directory of its seat homes. */
const pathsFor = (name: string): { out: string; matchDir: string } => ({
  out: join(dir, `${name}.json`),
  matchDir: join(dir, name),
});

/** The session files Pi has saved in a seat's session directory. */
const sessionsIn = (sessionDir: string): string[] =>
  readdirSync(sessionDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort();

describe("a match with a model in seat A", () => {
  let stub: StubModel;
  let onDisk: MatchLog;
  let out: string;
  let matchDir: string;

  beforeAll(async () => {
    stub = await startStub(playsEveryTurn);
    const paths = pathsFor("match");
    out = paths.out;
    matchDir = paths.matchDir;
    await runMatch({
      out,
      seed: 135,
      seats: { A: stubSeat(stub), B: GREEDY },
      clock: () => new Date("2026-02-01T00:00:00.000Z"),
      matchDir,
    });
    // Read the file back rather than trust what the run handed to memory: the
    // frozen format is a promise about the bytes on disk.
    onDisk = matchLogSchema.parse(JSON.parse(readFileSync(out, "utf8")) as unknown);
  }, SEAT_TIMEOUT_MS);

  afterAll(async () => {
    await stub.stop();
  });

  it("plays all 25 turns and writes a log that validates against salient-log/1", () => {
    expect(onDisk.turns.map((turn) => turn.n)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    // The model seat held still and Greedy took the board. What matters here is
    // that the match was played to its last turn rather than voided or cut short.
    expect(onDisk.result.type).toBe("time");
    expect(onDisk.result.winner).toBe("B");
    expect(onDisk.result.turn).toBe(25);
    // Each seat got a home of its own under the match's directory.
    expect(existsSync(join(matchDir, "pi-home-A"))).toBe(true);
    expect(existsSync(join(matchDir, "pi-home-B"))).toBe(false);
  });

  it("names the Pi build, the model, the thinking level and the context window", () => {
    // The build the seats actually ran on, which is the one this repo pins.
    expect(onDisk.harness.pi_version).toBe(piCli().version);
    expect(onDisk.players.A).toEqual({
      kind: "pi",
      model: stub.modelRef,
      thinking: "off",
      // Pi's own `contextUsage.contextWindow`, not a number the runner guessed:
      // this is the window the seat's `models.json` declared.
      context_window: CONTEXT_WINDOW,
    });
    expect(onDisk.players.B).toEqual({ kind: "bot", bot: "greedy" });
  });

  it("carries the seat's usage, cost and context size in every turn", () => {
    for (const turn of onDisk.turns) {
      const seat = turn.players.A;
      expect(seat.usage.input).toBeGreaterThan(0);
      expect(seat.usage.output).toBeGreaterThan(0);
      expect(seat.cost_usd).toBeGreaterThan(0);
      expect(seat.context_tokens).toBeGreaterThan(0);
      expect(seat.compacted).toBe(false);
      // The submission was accepted, so the turn was played: the server's own
      // record says so, and the runner did not overwrite it with a pass.
      expect(seat.passed).toBeNull();
      expect(seat.tool_calls.map((call) => call.tool)).toEqual(["get_state", "submit_orders"]);
      expect(seat.wall_ms).toBeGreaterThan(0);
    }
    // The conversation is kept between turns, so the context the seat carries
    // grows over the match rather than starting again each turn.
    const first = onDisk.turns[0].players.A.context_tokens;
    const last = onDisk.turns[24].players.A.context_tokens;
    expect(last).toBeGreaterThan(first);
    // A bot runs no provider, and its turn still costs nothing.
    const bot: TurnPlayerRecord = onDisk.turns[0].players.B;
    expect(bot.usage).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
    expect(bot.cost_usd).toBe(0);
    expect(bot.context_tokens).toBe(0);
    expect(bot.compacted).toBe(false);
  });
});

describe("a seat that has submitted and is still running", () => {
  let stub: StubModel;
  let log: MatchLog;
  let matchDir: string;

  beforeAll(async () => {
    stub = await startStub((request): StubReply => {
      if (toolsSincePrompt(request).includes(salientToolName("submit_orders"))) {
        // The server has the orders and the seat is still talking. Brief §6.3
        // gives it ten seconds; this match gives it a quarter of one, and the
        // reply outlasts both by a mile.
        return { delayMs: 60_000, text: "Still thinking about the next move." };
      }
      return { toolCalls: [{ name: salientToolName("submit_orders"), args: SUBMISSION }] };
    });
    const paths = pathsFor("lingering");
    matchDir = paths.matchDir;
    const played = await runMatch({
      out: paths.out,
      seed: 135,
      // Two turns is enough to show the seat was still in the match afterwards.
      config: { ...DEFAULT_CONFIG, turns: 2 },
      seats: { A: stubSeat(stub), B: GREEDY },
      afterSubmissionMs: 250,
      // Far longer than the grace, so a turn that ended on its deadline would be
      // obvious in the wall times below.
      turnTimeoutMs: 60_000,
      matchDir,
    });
    log = played.log;
  }, SEAT_TIMEOUT_MS);

  afterAll(async () => {
    // The 60-second replies are still in flight; stopping the stub cancels them.
    await stub.stop();
  });

  it("is aborted through its own Player, and its turn is recorded as played", () => {
    expect(log.turns).toHaveLength(2);
    for (const turn of log.turns) {
      const seat = turn.players.A;
      // Not a pass: the server holds the submission, and the runner's abort came
      // after it, so the turn stands as played.
      expect(seat.passed).toBeNull();
      expect(seat.tool_calls.map((call) => call.tool)).toEqual(["submit_orders"]);
      // The abort landed on the grace, not on the reply or the turn's deadline.
      expect(seat.wall_ms).toBeGreaterThanOrEqual(250);
      expect(seat.wall_ms).toBeLessThan(20_000);
    }
    // The seat was aborted, not restarted: one Pi session played both turns, and
    // the second turn was prompted with the first still in front of it.
    expect(sessionsIn(join(matchDir, "session-A"))).toHaveLength(1);
    const secondTurn = stub.recorded.filter((request) =>
      JSON.stringify(request.messages).includes("Turn 1 of 2. Play your turn."),
    );
    expect(secondTurn.length).toBeGreaterThan(0);
  }, SEAT_TIMEOUT_MS);
});

/**
 * A match's first turn, played by a seat that passes it for a reason only the
 * seat can see. The server knows no submission arrived; brief §6.3's table names
 * why, and the runner is meant to carry the seat's answer rather than guess.
 */
describe("a Pi seat's own reason for passing a turn", () => {
  it("records provider_error, which the server cannot see", async () => {
    const stub = await startStub(providerError());
    const paths = pathsFor("provider-error");
    try {
      const { log } = await runMatch({
        out: paths.out,
        seed: 135,
        config: { ...DEFAULT_CONFIG, turns: 1 },
        seats: { A: stubSeat(stub), B: GREEDY },
        matchDir: paths.matchDir,
      });
      const seat = log.turns[0].players.A;
      // Pi retried the provider and its retries ran out. `no_submission` would
      // read as a model that chose to sit the turn out.
      expect(seat.passed).toBe("provider_error");
      expect(seat.tool_calls).toEqual([]);
      expect(stub.requestCount).toBeGreaterThan(1);
    } finally {
      await stub.stop();
    }
  }, SEAT_TIMEOUT_MS);

  it("records token_budget when the turn went over its output budget", async () => {
    // The script would have submitted; the budget is what stops it.
    const stub = await startStub(
      callsToolThenSubmits("get_state").map((reply) => ({ ...reply, usage: OVER_BUDGET })),
    );
    const paths = pathsFor("token-budget");
    try {
      const { log } = await runMatch({
        out: paths.out,
        seed: 135,
        config: { ...DEFAULT_CONFIG, turns: 1 },
        seats: { A: { ...stubSeat(stub), outputTokenBudget: 1_000 }, B: GREEDY },
        matchDir: paths.matchDir,
      });
      const seat = log.turns[0].players.A;
      // Neither `no_submission` nor the runner's own `timeout`: the seat stopped
      // its turn over its output budget, and that is what the log says.
      expect(seat.passed).toBe("token_budget");
      expect(seat.tool_calls.map((call) => call.tool)).not.toContain("submit_orders");
      expect(seat.usage.output).toBeGreaterThan(1_000);
    } finally {
      await stub.stop();
    }
  }, SEAT_TIMEOUT_MS);
});

describe("a model seat the run cannot play", () => {
  it("stops the run in one line, before a turn is played", async () => {
    const restore = withoutAnthropicCredentials();
    const paths = pathsFor("no-credential");
    try {
      const options: RunMatchOptions = {
        out: paths.out,
        seed: 135,
        seats: {
          A: { kind: "pi", model: "anthropic/claude-x", thinking: "off" },
          B: GREEDY,
        },
        matchDir: paths.matchDir,
      };
      await expect(runMatch(options)).rejects.toThrow(
        /seat A: provider "anthropic" has no credential for model anthropic\/claude-x/,
      );
      // Nothing was played, so nothing was written for a resume to find.
      expect(existsSync(paths.out)).toBe(false);
    } finally {
      restore();
    }
  }, SEAT_TIMEOUT_MS);

  it("says what is wrong with a model that names no provider", async () => {
    const paths = pathsFor("no-provider");
    const options: RunMatchOptions = {
      out: paths.out,
      seed: 135,
      seats: { A: { kind: "pi", model: "claude-x", thinking: "off" }, B: GREEDY },
      matchDir: paths.matchDir,
    };
    // Pi's `--model` takes `<provider>/<id>`, and a seat given anything else has
    // no provider to look a credential up under.
    await expect(runMatch(options)).rejects.toThrow(
      'a Pi seat\'s model is "<provider>/<id>", not "claude-x"',
    );
    expect(existsSync(paths.out)).toBe(false);
  }, SEAT_TIMEOUT_MS);
});

describe("a log named without an extension", () => {
  it("writes the log, and keeps a Pi seat's homes out of its way", async () => {
    const stub = await startStub(playsEveryTurn);
    // `--out` takes any name, and the seat homes default to a directory beside
    // it: homes under the log's own path would leave the log a directory to
    // rename over, after the whole match had been played.
    const out = join(dir, "no-extension");
    try {
      await runMatch({
        out,
        seed: 135,
        config: { ...DEFAULT_CONFIG, turns: 1 },
        seats: { A: stubSeat(stub), B: GREEDY },
      });
      const written = matchLogSchema.parse(JSON.parse(readFileSync(out, "utf8")) as unknown);
      expect(written.turns).toHaveLength(1);
      expect(existsSync(join(`${out}-match`, "pi-home-A"))).toBe(true);
    } finally {
      await stub.stop();
    }
  }, SEAT_TIMEOUT_MS);
});

describe("a match voided by a seat that reached a tool outside the seven", () => {
  it("rejects, writes no log, and lets its own process go", async () => {
    const paths = pathsFor("voided");
    const scenario = fileURLToPath(new URL("./voided-match-scenario.ts", import.meta.url));

    const ran = await new Promise<{ code: number; out: string; err: string }>((done) => {
      execFile(
        process.execPath,
        [scenario, paths.out, paths.matchDir],
        // The timeout is the assertion: a submission watcher still polling after
        // the turn rejected would hold the child's event loop open for ever, and
        // the child would be killed here instead of exiting.
        { timeout: 60_000 },
        (error, stdout, stderr) => {
          done({
            code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
            out: stdout,
            err: stderr,
          });
        },
      );
    });

    expect(ran.out).toContain("rejected:");
    expect(ran.out).toContain("voided");
    // The child finished by itself. The runner stops watching a seat for its
    // submission when the turn ends, and it has to stop when the turn rejects
    // too — otherwise the operator reads the error and waits for a `no-dice`
    // that never exits.
    expect(ran.code).toBe(0);
    expect(existsSync(paths.out)).toBe(false);
  }, 90_000);
});
