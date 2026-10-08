/**
 * Brief §6.3's turn outcomes, played out by a real Pi seat against a scripted
 * model.
 *
 * A turn ends one of four ways for a seat, and the difference is only visible
 * from inside the seat: whether it settled with orders, settled without them,
 * ran out of its time, or was stopped for spending its output-token budget; and
 * whether the provider answered at all after Pi's own retries. Each of those is
 * produced here by `StubModel` and read back off the turn the seat reports. The
 * match-level failure is different in kind — the Pi process gone from under the
 * turn — and is reported by throwing `MatchVoided` rather than by a turn record,
 * because there is no turn to give a reason to.
 *
 * A seat that stops answering its next command is a third thing, and the last
 * test here reproduces it: the seat is alive and still working, and all the
 * harness has is a bare rejection from its own client. That turn is passed, with
 * `prompt_timeout` — a reason of its own, so a reader cannot mistake it for the
 * runner's `timeout`. Section 8 of docs/pi-harness-notes.md says why the seat
 * gets into that state, and what the passed turn leaves for the one after it.
 *
 * What a seat reports and what the log says are not quite the same, and the
 * split is deliberate: a turn that ran out of its time is aborted by the runner,
 * which is the one that knows the clock ran out, so the seat calls it
 * `no_submission` and `runMatch` writes `timeout`. The runner's own tests
 * (`packages/runner/src/match.test.ts`) hold that half of the table, over the
 * same `Player.abort` these tests call by hand.
 *
 * Every test here starts a Pi process, so every test carries a timeout of its
 * own; the model is a stub on loopback, so no credential is needed.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { MatchServer, startServer, type RunningServer } from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PiPlayer } from "./pi-player.ts";
import type { PiPlayerOptions } from "./pi-player.ts";
import type { PlayerContext, TurnOutcome } from "./player.ts";
import {
  StubModel,
  callsToolThenSubmits,
  neverSubmits,
  outgrowsTheWindow,
  providerError,
  sleepsPastDeadline,
  stubModelsJson,
} from "./stub-model.ts";
import type { StubScript, StubUsage } from "./stub-model.ts";

/** The prompt a seat is played with, which is the one the match gives it. */
const PLAYER_SYSTEM = join(import.meta.dirname, "../../../games/salient/prompts/player-system.md");

/** A seat's turn means a Pi process: seconds to start, seconds to answer. */
const SEAT_TIMEOUT_MS = 120_000;

/**
 * How long a turn is given before these tests abort it, against a stub that
 * holds its reply far past that.
 */
const TURN_DEADLINE_MS = 3_000;

/**
 * How long an aborted turn is allowed to take to come back.
 *
 * The assertion that says the abort ended the turn is not this bound but the one
 * below it on `stub.repliesInFlight`: the stub holds the reply this turn waits
 * on for 120 s, and the turn came back with that reply still unwritten. The
 * bound is the backstop that says the turn came back at all, and 60 s is a
 * measurement of how long a starved Pi takes to answer for a turn it was
 * aborted out of: 24.5 s, 25.1 s and 24.5 s at load average ~24–35, against the
 * 15 s this test used to carry. What it is not is a substitute for the in-flight
 * check: on a box held at load average ~50 by 48 cpu hogs a run of this test
 * with the same 120 s reply came back at 124.1 s, and at load ~38 with 32 cpu
 * hogs the reply had already been written when the turn came back — a Pi
 * starved that far settles an aborted turn when the provider request settles,
 * not when the abort lands. That failure is the point of the assertion; the
 * whole suite passes on this box up to load ~23 (16 cpu hogs) and this is where
 * it stops being able to.
 */
const ABORT_BOUND_MS = 60_000;

/** What the seat's model entry charges, so a turn's cost is a known figure. */
const COST = { input: 1, output: 2, cacheRead: 4, cacheWrite: 8 };

/** Output tokens a reply reports, well over the budget any budget test sets. */
const OVER_BUDGET: StubUsage = { input: 100, output: 5_000, cacheRead: 0, cacheWrite: 0 };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The pid of the Pi process a seat is running, or `null` where this platform
 * keeps no `/proc` to read it from.
 *
 * Killing the child is the only honest way to test a seat whose process dies
 * mid-match, and a child is found from the outside by its parent — this test
 * process — and by the working directory only that seat's child runs in, since
 * a match may have several seats alive at once.
 *
 * The working directory, and not the command line: the Pi CLI rewrites its
 * process title shortly after it starts, which erases the arguments the child
 * was spawned with, and a seat that has answered one command since starting is
 * past that point. The directory it was started in does not change.
 */
const piChildPid = (seatCwd: string): number | null => {
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // The fields after the second, which is the command name in brackets and
      // can hold anything at all; the second of those is the parent pid.
      const stat = readFileSync(`/proc/${entry}/stat`, "utf-8");
      const afterName = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(afterName[1]) !== process.pid) continue;
      if (readlinkSync(`/proc/${entry}/cwd`) === seatCwd) return Number(entry);
    } catch {
      // The process went away between the directory listing and the read.
    }
  }
  return null;
};

/** A turn that has not finished within `ms`, aborted the way the runner aborts it. */
const playWithDeadline = async (
  player: PiPlayer,
  ctx: PlayerContext,
  turn: number,
  ms: number,
): Promise<{ outcome: TurnOutcome; timedOut: boolean }> => {
  const played = player.playTurn(turn);
  const timedOut = await Promise.race([
    played.then(() => false),
    sleep(ms).then(() => true),
  ]);
  if (timedOut) {
    await player.abort(ctx);
    return { outcome: await played, timedOut };
  }
  return { outcome: await played, timedOut };
};

describe("a seat's turn outcomes", () => {
  const matches = new MatchServer();
  let running: RunningServer;
  let matchId: string;
  let tokens: Record<Seat, string>;
  /** The turn the match is on, so a test can ask for the next one. */
  let turn = 0;
  const stubs: StubModel[] = [];
  const players: PiPlayer[] = [];
  const matchDirs: string[] = [];

  beforeAll(async () => {
    running = await startServer({ matches, port: 0 });
    const created = matches.createMatch(135, DEFAULT_CONFIG);
    matchId = created.matchId;
    tokens = created.tokens;
    matches.openTurn(matchId);
    turn = 1;
  }, SEAT_TIMEOUT_MS);

  afterAll(async () => {
    // A Pi child left running keeps the test process alive, and a match server
    // left listening keeps its port.
    for (const player of players) await player.stop().catch(() => undefined);
    for (const stub of stubs) await stub.stop();
    await running.close();
    for (const dir of matchDirs) rmSync(dir, { recursive: true, force: true });
  }, SEAT_TIMEOUT_MS);

  /** Resolve the turn in play and open the one after it, and say which that is. */
  const nextTurn = (): number => {
    matches.resolveTurn(matchId);
    matches.openTurn(matchId);
    turn += 1;
    return turn;
  };

  /** The scripted model one seat plays, stopped when the test is over. */
  const startStub = async (script: StubScript): Promise<StubModel> => {
    const stub = await StubModel.start(script, { cost: COST });
    stubs.push(stub);
    return stub;
  };

  /**
   * Seat `seat` at the table, with the model it plays and the context it plays
   * with, which is what an aborted seat is handed back.
   */
  const startSeat = async (
    seat: Seat,
    stub: StubModel,
    options: Partial<PiPlayerOptions> = {},
  ): Promise<{ player: PiPlayer; ctx: PlayerContext }> => {
    const matchDir = mkdtempSync(join(tmpdir(), "no-dice-pi-turn-"));
    matchDirs.push(matchDir);
    const player = new PiPlayer({
      seat,
      matchDir,
      model: stub.modelRef,
      thinking: "off",
      systemPrompt: PLAYER_SYSTEM,
      modelsJson: stubModelsJson(stub.baseUrl, { cost: COST }),
      // The seat reaches `StubModel` over loopback and nothing else.
      env: { PI_OFFLINE: "1" },
      ...options,
    });
    players.push(player);
    const ctx = { serverUrl: running.url, token: tokens[seat] };
    await player.start(ctx);
    return { player, ctx };
  };

  it(
    "passes a turn that settled with no submission, and is prompted again next turn with it in the history",
    async () => {
      const stub = await startStub(neverSubmits());
      const { player } = await startSeat("A", stub);
      const firstTurn = turn;

      const first = await player.playTurn(firstTurn);

      // The session settled, and it settled with no orders: brief §6.3's plain
      // pass. The seat is not retried, and the match moves on.
      expect(first.submitted).toBe(false);
      expect(first.passed).toBe("no_submission");
      expect(first.orders).toEqual([]);
      expect(stub.requestCount).toBe(1);

      nextTurn();
      const second = await player.playTurn(turn);
      expect(second.passed).toBe("no_submission");

      // The same session plays the next turn, with the failed turn in front of
      // it: one transcript, and the first turn's prompt inside the second's
      // request. Brief §6.3 keeps the conversation because the match is one
      // game, and a pass is a turn the model is expected to remember.
      expect(sessionsIn(player.seatHome.sessionDir)).toHaveLength(1);
      expect(JSON.stringify(stub.lastRequest?.body)).toContain(
        `Turn ${String(firstTurn)} of 25. Play your turn.`,
      );
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "ends a turn that ran past its time with abort, and keeps the aborted turn in the seat's history",
    async () => {
      // The reply this turn waits on is held for 120 s, far past the bound
      // below, so the turn cannot have been answered inside it; the second entry
      // answers at once, so the turn after the aborted one is asserted rather
      // than waited on.
      const stub = await startStub([
        ...sleepsPastDeadline(120_000),
        { text: "Still working on it." },
      ]);
      const { player, ctx } = await startSeat("B", stub);
      const firstTurn = turn;

      const started = performance.now();
      const { outcome, timedOut } = await playWithDeadline(player, ctx, firstTurn, TURN_DEADLINE_MS);
      const took = performance.now() - started;

      expect(timedOut).toBe(true);
      // The turn came back while the model's answer was still unwritten, which is
      // what says the abort ended it. A clock cannot say this: the seconds
      // a starved Pi takes to answer for an aborted turn run from 3 s to 25 s
      // depending on the load, and the reply it is racing is scripted to land at
      // 120 s.
      expect(stub.repliesInFlight).toBeGreaterThan(0);
      // And it came back rather than hanging, inside the bound `ABORT_BOUND_MS`
      // measures.
      expect(took).toBeLessThan(ABORT_BOUND_MS);
      // The seat reports a pass; the runner is the one that knows it was the
      // clock, and writes `timeout` on the way to the log.
      expect(outcome.passed).toBe("no_submission");
      expect(outcome.submitted).toBe(false);

      nextTurn();
      const second = await player.playTurn(turn);

      // Aborted, not restarted: the seat is prompted again on the session the
      // aborted turn is part of, and it overruns the same way it did before.
      expect(sessionsIn(player.seatHome.sessionDir)).toHaveLength(1);
      expect(JSON.stringify(stub.recorded[0]?.body)).toContain(
        `Turn ${String(firstTurn)} of 25. Play your turn.`,
      );
      expect(JSON.stringify(stub.lastRequest?.body)).toContain(
        `Turn ${String(firstTurn)} of 25. Play your turn.`,
      );
      expect(JSON.stringify(stub.lastRequest?.body)).toContain(`Turn ${String(turn)} of 25.`);
      expect(second.passed).toBe("no_submission");
    },
    // Past the 120 s the stub holds its first reply for, so a settle that missed
    // it fails the assertion above rather than this timeout.
    SEAT_TIMEOUT_MS + 60_000,
  );

  it(
    "aborts a seat that went over its output-token budget, and passes the turn with token_budget",
    async () => {
      // The script would have submitted; the budget is what stops it.
      const stub = await startStub(
        callsToolThenSubmits("get_state").map((reply) => ({ ...reply, usage: OVER_BUDGET })),
      );
      const { player } = await startSeat("A", stub, { outputTokenBudget: 1_000 });

      const outcome = await player.playTurn(turn);

      expect(outcome.passed).toBe("token_budget");
      expect(outcome.submitted).toBe(false);
      expect(outcome.toolCalls.map((call) => call.tool)).not.toContain("submit_orders");
      // The turn is bounded by the budget, not by the time: it came back well
      // inside the deadline a seat is normally given.
      expect(outcome.provider?.usage.output).toBeGreaterThan(1_000);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "leaves a turn alone when there is no budget, however many tokens it spends",
    async () => {
      const stub = await startStub(
        callsToolThenSubmits("get_state").map((reply) => ({ ...reply, usage: OVER_BUDGET })),
      );
      const { player } = await startSeat("B", stub);

      const outcome = await player.playTurn(turn);

      // The budget is an option and defaults to off: the same seat, the same
      // spend, and the turn is played out to its submission.
      expect(outcome.passed).toBeNull();
      expect(outcome.submitted).toBe(true);
      expect(outcome.provider?.usage.output).toBeGreaterThan(1_000);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "passes a turn the provider kept refusing, after Pi's own retries, with provider_error",
    async () => {
      const stub = await startStub(providerError());
      const { player } = await startSeat("A", stub);

      const outcome = await player.playTurn(turn);

      // Pi retried the provider and the retries ran out; `auto_retry_end` said
      // so, and the turn is passed rather than retried from here. A turn the
      // harness retried itself would show the model the same position twice.
      expect(outcome.passed).toBe("provider_error");
      expect(outcome.submitted).toBe(false);
      expect(outcome.toolCalls).toEqual([]);
      expect(stub.requestCount).toBeGreaterThan(1);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "refuses a tool the seat was not given, by any name, and lets the turn go on",
    async () => {
      const submit = { orders: [], intent: "The stub is holding still.", prediction: "The other seat moves east." };
      const stub = await startStub([
        { toolCalls: [{ name: "mcp__salient__submit_orders", args: submit }] },
        { toolCalls: [{ name: "mcpsalient_write_notes", args: { notes: "x" } }] },
        { toolCalls: [{ name: "bash", args: { command: "cat /etc/passwd" } }] },
        ...callsToolThenSubmits("get_state"),
      ]);
      const { player } = await startSeat("A", stub);

      const outcome = await player.playTurn(turn);

      // Pi's lock-down answers each "not found" and nothing outside the game ran;
      // the calls are logged as refused, and a refused submit is not a submission.
      expect(outcome.submitted).toBe(true);
      expect(outcome.toolCalls.slice(0, 3)).toMatchObject([
        { tool: "mcp__salient__submit_orders", error: true },
        { tool: "mcpsalient_write_notes", error: true },
        { tool: "bash", error: true },
      ]);
      expect(outcome.toolCalls.slice(3).map((call) => call.tool)).toEqual(["get_state", "submit_orders"]);

      nextTurn();
    },
    SEAT_TIMEOUT_MS,
  );

  it.skipIf(!existsSync("/proc"))(
    "voids the match when the seat's Pi process is killed during a turn",
    async () => {
      const stub = await startStub(sleepsPastDeadline(20_000));
      const { player, ctx } = await startSeat("A", stub);
      const pid = piChildPid(player.seatHome.cwd);
      if (pid === null)
        throw new Error(`no Pi process was found running in ${player.seatHome.cwd}`);

      const playing = player.playTurn(turn);
      // Let the turn get under way, then take the process away under it.
      await sleep(1_500);
      process.kill(pid, "SIGKILL");

      // The runner's abort is what notices: a dead child refuses every command,
      // and the turn that can never settle is ended by that rather than left to
      // hang the match.
      await player.abort(ctx);
      await expect(playing).rejects.toMatchObject({
        name: "MatchVoided",
        reason: "harness_crash",
      });
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "marks the turn whose conversation Pi compacted, and plays the match on through it",
    async () => {
      // Pi compacts when the conversation passes the window less its reserve, and
      // that reserve defaults to 16k tokens: a 40k window and a reply with real
      // bulk in it is the cheapest way to see it without a 200k-token match.
      const stub = await startStub(outgrowsTheWindow());
      const { player } = await startSeat("A", stub, {
        modelsJson: stubModelsJson(stub.baseUrl, { cost: COST, contextWindow: 40_000 }),
      });

      const first = await player.playTurn(turn);

      // The turn says so, and it says so from what Pi reported rather than from
      // a guess at the size of the conversation.
      expect(first.provider?.compacted).toBe(true);

      // Compaction is neither a pass nor a void: the seat is prompted again next
      // turn and answers on the session the summary is part of.
      nextTurn();
      stub.setScript(outgrowsTheWindow());
      const second = await player.playTurn(turn);
      expect(second.provider).toBeDefined();
      expect(stub.requestCount).toBeGreaterThan(2);
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "passes the turn whose prompt Pi never answers, on a seat that is alive and still working",
    async () => {
      // What the first attempt at seed 479473028 did, played against a stub, and
      // what the harness makes of it. Section 8 of docs/pi-harness-notes.md
      // states the mechanism; this test is the reproduction of it.
      //
      // Pi answers a `prompt` command from one place — the `preflightResult`
      // callback `rpc-mode.js` hands `AgentSession.prompt()` — and `prompt()`
      // reaches it only after `_checkCompaction(lastAssistant, false)`. When the
      // conversation is over the compaction line and the last answer reports no
      // usage, that check compacts first, and a compaction is a provider
      // request of its own. A summary that does not come back inside the 30 s
      // `RpcClient.send()` waits for a response leaves the command unanswered
      // with the child alive and working.
      //
      // The window is 40,000 tokens, so Pi's threshold is 40,000 - 16,384 =
      // 23,616. The turn below reports 4,000 tokens and carries the bulk a cut
      // point needs; the turn after it reports 30,200 — over the line — and is
      // aborted while its next provider request is in flight, which is how the
      // real seat ended turn 18: an aborted answer that reports no
      // usage, over a context that is over the line.
      const stub = await startStub([
        {
          text: "the map is a hex grid and the map is the territory ".repeat(3_000),
          toolCalls: [{ name: "get_state", args: {} }],
          usage: { input: 1_000, output: 3_000, cacheRead: 0, cacheWrite: 0 },
        },
        { text: "I will hold this line." },
      ]);
      const { player, ctx } = await startSeat("A", stub, {
        modelsJson: stubModelsJson(stub.baseUrl, { cost: COST, contextWindow: 40_000 }),
      });

      const first = await player.playTurn(turn);
      expect(first.passed).toBe("no_submission");
      expect(first.provider?.compacted).toBe(false);

      // The turn that crosses the line and is then aborted. Pi notices the line
      // crossing between its own turns — `_compactBeforeNextAssistantResponse`
      // runs before each next assistant response — so a summarisation request is
      // already out when the deadline aborts the seat. `session.abort()` calls
      // `abortCompaction()`, so that compaction ends as aborted and appends
      // nothing: the seat is left over the line, with an answer that reports
      // nothing, and a turn record that says it compacted.
      nextTurn();
      const abortedTurn = turn;
      stub.setScript([
        {
          toolCalls: [{ name: "get_state", args: {} }],
          usage: { input: 30_000, output: 200, cacheRead: 0, cacheWrite: 0 },
        },
        ...sleepsPastDeadline(120_000),
      ]);
      const { outcome, timedOut } = await playWithDeadline(player, ctx, abortedTurn, TURN_DEADLINE_MS);
      expect(timedOut).toBe(true);
      expect(outcome.passed).toBe("no_submission");
      expect(outcome.provider?.compacted).toBe(true);
      expect(sessionEntries(player.seatHome.sessionDir).some((entry) => entry.type === "compaction")).toBe(
        false,
      );

      // The prompt after it. Its preflight wants a summary, and the stub holds
      // that summary for 45 s — past the 30 s the client waits for a response.
      // What follows it in the script is the run Pi starts for the prompt once
      // the abort cancels that summary: a `get_state` call, and a second leg that
      // streams for longer than the harness is willing to wait for a settle. That
      // run is therefore stopped rather than settled — the case where one wait is
      // not enough and the seat has to be aborted again before the pass returns.
      nextTurn();
      stub.setScript([
        { delayMs: 45_000, text: "A summary nobody is left waiting for." },
        { text: "the late run answers", toolCalls: [{ name: "get_state", args: {} }] },
        { delayMs: 40_000, text: "the late run is stopped mid-stream" },
      ]);
      const requestsBefore = stub.requestCount;
      // The turn comes back rather than throwing: a seat that is alive and did
      // not answer is a turn the harness passes, not a match it gives up on.
      const wedgedFrom = Date.now();
      const wedged = await player.playTurn(turn);

      // Brief §6.3's row for this case, under a reason that is not the runner's
      // `timeout`: that one is the runner stopping a seat that was playing, and
      // this seat never took the question at all. `no_submission` would read as
      // a model that was asked and chose to sit the turn out.
      expect(wedged.turn).toBe(abortedTurn + 1);
      expect(wedged.passed).toBe("prompt_timeout");
      expect(wedged.submitted).toBe(false);
      // The turn is a record with the calls it made. The prompt did not reach the
      // session as a run, but cancelling its summary lets Pi start one anyway, and
      // the harness stops that run before handing the turn back rather than
      // leaving it for the next turn's listener — so its calls belong
      // to the turn that asked for them.
      expect(wedged.toolCalls.map((call) => call.tool)).toEqual(["get_state"]);
      // And the turn outlives both of the harness's waits: the client's 30 s on
      // the command, and the 30 s it then spends waiting for a run that will not
      // settle before stopping the seat again. A harness that gave up after the
      // first bound would be back here in half the time — with the run still
      // going, for the next turn to absorb.
      expect(Date.now() - wedgedFrom, "the wedged turn was handed back too soon").toBeGreaterThanOrEqual(
        60_000,
      );
      // The seat's process is alive, and was working: it made a provider request
      // after the command was given up on. A dead child makes none, and a dead
      // child is a void instead.
      expect(stub.requestCount).toBeGreaterThan(requestsBefore);
      if (existsSync("/proc")) {
        expect(piChildPid(player.seatHome.cwd), "the Pi child is gone from under a live seat").not.toBeNull();
      }
      // And the request the turn was stuck on is Pi's compaction summary, not the
      // turn: no tools offered, and the summarising system prompt in front (§5).
      const stuck = stub.recorded[requestsBefore];
      expect(stuck?.toolNames).toEqual([]);
      expect(stuck?.systemPrompts.join("\n")).toContain("context summarization assistant");
      // The wedge is before Pi accepts the prompt — no response, and the summary
      // requested after the rejection with the child still running — and the
      // compaction that has it has appended nothing, which is what the Marvin
      // transcript shows too.
      expect(sessionEntries(player.seatHome.sessionDir).some((entry) => entry.type === "compaction")).toBe(
        false,
      );

      // The turn after the wedge, played by the same seat. This is what stopping
      // the seat before the pass is returned buys: the late run is over by now,
      // so nothing is left to be answered into this turn. It is asked normally —
      // its own prompt, its own tools, its own calls — and it is not itself a
      // `prompt_timeout`: the wedge does not cascade. No summary is wanted here,
      // because the late run's own answer is the last thing the session holds and
      // it reports usage under the line.
      nextTurn();
      stub.setScript([
        { text: "turn four answers", toolCalls: [{ name: "read_notes", args: {} }] },
        { text: "turn four settles" },
      ]);
      const after = await player.playTurn(turn);
      expect(after.turn).toBe(turn);
      expect(after.passed).toBe("no_submission");
      expect(after.toolCalls.map((call) => call.tool)).toEqual(["read_notes"]);
      const asked = stub.recorded
        .slice(requestsBefore)
        .filter((request) => JSON.stringify(request.body).includes(`Turn ${String(turn)} of 25.`));
      expect(asked.length, "the turn after the wedge was never asked").toBeGreaterThan(0);
      // The transcript does say the wedged turn was played: the run Pi started
      // late put its prompt in the session. The log says so too now, with that
      // run's calls on it, and that agreement is the point of the stop.
      expect(JSON.stringify(sessionEntries(player.seatHome.sessionDir))).toContain(
        `Turn ${String(abortedTurn + 1)} of 25.`,
      );
    },
    // The 30 s the client waits for the prompt, the 30 s the harness waits for a
    // run it then has to stop, and the turn played after them, on top of an
    // aborted turn that a starved box can hold until the 120 s reply it is
    // sitting in lands — the shape `vitest.config.ts` records for this file.
    SEAT_TIMEOUT_MS + 240_000,
  );
});

/**
 * The entries of the one session file a seat has written, parsed.
 *
 * Pi appends whole lines, so a line that does not parse is one still being
 * written and is skipped rather than failed on.
 */
const sessionEntries = (sessionDir: string): Record<string, unknown>[] => {
  const [file] = sessionsIn(sessionDir);
  if (file === undefined) return [];
  return readFileSync(join(sessionDir, file), "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
};

/** The session files Pi has saved in a seat's session directory. */
const sessionsIn = (sessionDir: string): string[] =>
  readdirSync(sessionDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort();
