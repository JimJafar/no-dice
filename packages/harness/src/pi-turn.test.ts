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
 * A seat that stops answering its next command is a third thing, and the
 * last two tests here reproduce it: the seat is alive and still working, and all
 * the harness has is a bare rejection from its own client. That turn is passed,
 * with `prompt_timeout` — a reason of its own, so a reader cannot mistake it for
 * the runner's `timeout` — and the turn after it first puts the seat back in
 * order, which is what makes "prompted again next turn" a turn that is played
 * rather than a turn that is refused. Section 8 of docs/pi-harness-notes.md says
 * why the seat gets into that state, what the passed turn leaves for the one
 * after it, and what the recovery between them sends. The wedge does not always
 * clear itself, so one of those tests plays it twice in a row and shows the match
 * still being played; the describe after them holds the recovery's own bounds
 * against a seat that answers late, wrongly, or not at all.
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
import type { PiPlayerOptions, SeatRecovery, SeatRecoveryClient } from "./pi-player.ts";
import { passReasonFor, recoverSeat } from "./pi-player.ts";
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
import type { StubReply, StubScript, StubUsage } from "./stub-model.ts";

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

/**
 * What a reply reports to put a 40,000-token window over Pi's compaction line:
 * the threshold is 40,000 - 16,384 = 23,616 tokens.
 */
const OVER_THE_LINE: StubUsage = { input: 30_000, output: 200, cacheRead: 0, cacheWrite: 0 };

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
      // the seat before the pass is returned, and putting it back in order before
      // this prompt is sent, buys: the late run is over by now, so nothing is left
      // to be answered into this turn. It is asked normally — its own prompt, its
      // own tools, its own calls — and it is not itself a `prompt_timeout`: the
      // wedge does not cascade. No summary is wanted here, because the late run's
      // own answer is the last thing the session holds and it reports usage
      // under the line.
      nextTurn();
      stub.setScript([
        { text: "turn four answers", toolCalls: [{ name: "read_notes", args: {} }] },
        {
          toolCalls: [
            {
              name: "submit_orders",
              args: {
                orders: [],
                intent: "The seat is back on its feet.",
                prediction: "The other seat moves east.",
              },
            },
          ],
        },
        { text: "turn four settles" },
      ]);
      const requestsForTurn = stub.requestCount;
      const afterFrom = Date.now();
      const after = await player.playTurn(turn);
      // The turn after a wedge carries the recovery as well as its own prompt, so
      // the runner's cap is pinned on this turn too: the recovery's worst case
      // (three passes, two commands, five seconds each) has to fit inside the
      // 5-minute turn cap (`TURN_TIMEOUT_MS`, packages/runner/src/match.ts)
      // along with everything else a turn spends, not sit on top of it.
      expect(
        Date.now() - afterFrom,
        "the turn after the wedge outlived the runner's turn cap",
      ).toBeLessThan(300_000);
      // And the recovery it began with is readable, with its verdict: the seat
      // was quiet by the time this turn asked, and one ask said so. The log has
      // no field for a recovery, so this is where a match shows that one ran,
      // what it found and what it cost.
      const recovery = player.lastRecovery;
      expect(recovery, "the turn after a passed one ran no recovery").not.toBeNull();
      expect(recovery?.quiet, "the seat was handed to this turn still busy").toBe(true);
      expect(recovery?.asks).toBeGreaterThanOrEqual(1);
      expect(after.turn).toBe(turn);
      // Played, not passed: it settles with a submission the server accepted.
      expect(after.passed).toBeNull();
      expect(after.submitted).toBe(true);
      // Only this turn's calls, and only the orders this turn's prompt produced.
      // The wedged run's `get_state` is on the wedged turn's record above, not
      // here, and nothing that run was still doing when the turn was handed back
      // is counted as this turn's submission.
      expect(after.toolCalls.map((call) => call.tool)).toEqual(["read_notes", "submit_orders"]);
      // Asked once for this turn and no more: the three requests are the turn's
      // three scripted legs, so no second attempt at the prompt went out and no
      // summarisation was wanted in front of it.
      expect(stub.requestCount - requestsForTurn).toBe(3);
      const asked = stub.recorded
        .slice(requestsBefore)
        .filter((request) => JSON.stringify(request.body).includes(`Turn ${String(turn)} of 25.`));
      expect(asked.length, "the turn after the wedge was never asked").toBeGreaterThan(0);
      // And neither turn's prompt is ever in front of the model twice: a turn the
      // harness passed is never retried, however late the seat's answer to it is,
      // which is what brief §6.3's "never retry a single turn" means.
      expect(promptCopies(stub, `Turn ${String(abortedTurn + 1)} of 25. Play your turn.`)).toBe(1);
      expect(promptCopies(stub, `Turn ${String(turn)} of 25. Play your turn.`)).toBe(1);
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

  it(
    "passes turn after turn on a seat that never takes a prompt, and plays the match on",
    async () => {
      // A wedge that does not clear itself. The harness's abort cancels the
      // summary the next prompt is waiting behind without appending one, so a
      // seat left over the compaction line — an answer with real usage in it,
      // and an aborted answer reporting nothing after it — is left over it for
      // the turn after that too, and the one after that. Brief §6.3's "the
      // player stays in the match" then has to mean the turns keep coming back:
      // each is passed with `prompt_timeout`, well inside the runner's own turn
      // cap, and the match is still played on.
      //
      // The window is 40,000 tokens, so the line is at 23,616, and the first
      // turn carries the bulk a cut point needs: without it there is nothing for
      // a summary to summarise, and no wedge to reproduce.
      const stub = await startStub([
        {
          text: "the map is a hex grid and the map is the territory ".repeat(3_000),
          toolCalls: [{ name: "get_state", args: {} }],
          usage: { input: 1_000, output: 3_000, cacheRead: 0, cacheWrite: 0 },
        },
        { text: "I will hold this line." },
      ]);
      const { player, ctx } = await startSeat("B", stub, {
        modelsJson: stubModelsJson(stub.baseUrl, { cost: COST, contextWindow: 40_000 }),
      });

      const first = await player.playTurn(turn);
      expect(first.passed).toBe("no_submission");
      expect(first.provider?.compacted).toBe(false);

      // The turn that crosses the line and is aborted out of it by the runner's
      // clock: what seed 479473028's turn 18 left, and the state that puts a
      // provider request in front of the next prompt's answer.
      nextTurn();
      stub.setScript([
        { toolCalls: [{ name: "get_state", args: {} }], usage: OVER_THE_LINE },
        ...sleepsPastDeadline(120_000),
      ]);
      const { timedOut } = await playWithDeadline(player, ctx, turn, TURN_DEADLINE_MS);
      expect(timedOut).toBe(true);
      expect(
        sessionEntries(player.seatHome.sessionDir).some((entry) => entry.type === "compaction"),
      ).toBe(false);

      // Two turns in a row that never take their prompt, each scripted the same
      // way: a summary that arrives after the client has given up on the
      // command, then a run that crosses the line again and is stopped before it
      // can settle — which leaves the same state for the turn after it.
      nextTurn();
      const wedges: StubReply[] = [
        { delayMs: 45_000, text: "a summary nobody is left waiting for" },
        {
          text: "the late run answers",
          toolCalls: [{ name: "get_state", args: {} }],
          usage: OVER_THE_LINE,
        },
        { delayMs: 40_000, text: "the late run is stopped mid-stream" },
      ];
      for (let wedge = 0; wedge < 2; wedge += 1) {
        stub.setScript(wedges);
        const requestsBefore = stub.requestCount;
        const started = performance.now();
        const outcome = await player.playTurn(turn);
        const took = performance.now() - started;

        expect(outcome.turn).toBe(turn);
        expect(outcome.passed).toBe("prompt_timeout");
        expect(outcome.submitted).toBe(false);
        // The turn comes back rather than hanging, and comes back inside the
        // runner's own turn cap (`TURN_TIMEOUT_MS`, packages/runner/src/match.ts),
        // which is what keeps a seat that never answers from hanging a match.
        expect(took, "a wedged turn outlived the runner's turn cap").toBeLessThan(300_000);
        // Alive and working rather than dead: it made provider requests after the
        // command was given up on, and the run they belong to is recorded on the
        // turn that asked for them, both times.
        expect(stub.requestCount).toBeGreaterThan(requestsBefore);
        expect(outcome.toolCalls.map((call) => call.tool)).toEqual(["get_state"]);
        // And it is left in the same state, because the summary that would
        // have cleared it was cancelled rather than written.
        expect(
          sessionEntries(player.seatHome.sessionDir).some((entry) => entry.type === "compaction"),
        ).toBe(false);
        if (existsSync("/proc")) {
          expect(piChildPid(player.seatHome.cwd), "the Pi child is gone from under a live seat").not.toBeNull();
        }

        // The match takes the turn and goes on. What the server saw of it is the
        // late run's call and no orders; the pass reason is the runner's to
        // write, and the outcome above is where it reads it from.
        const wedgedTurn = turn;
        nextTurn();
        const logged = matches.turnRecord(matchId, wedgedTurn);
        expect(logged.B.tool_calls.map((call) => call.tool)).toEqual(["get_state"]);
        expect(logged.B.orders).toEqual([]);
      }

      // The seat is still in the match, and takes a prompt as soon as the
      // summary it waits behind is one that arrives: the turn after the wedges
      // is played, with its own calls and a submission of its own.
      stub.setScript([{ text: "a summary that arrives" }, ...callsToolThenSubmits("get_state")]);
      const playedFrom = Date.now();
      const played = await player.playTurn(turn);
      // The turn after two wedges is inside the runner's cap as well, and the
      // recovery that began it found the seat quiet at last.
      expect(
        Date.now() - playedFrom,
        "the turn after the wedges outlived the runner's turn cap",
      ).toBeLessThan(300_000);
      expect(player.lastRecovery?.quiet, "the seat was handed to this turn still busy").toBe(true);
      expect(played.turn).toBe(turn);
      expect(played.passed).toBeNull();
      expect(played.submitted).toBe(true);
      expect(played.toolCalls.map((call) => call.tool)).toEqual(["get_state", "submit_orders"]);
      // And the match ends on it: the turn resolves, and the record the server
      // keeps of it is this turn's calls alone — neither wedged run
      // reaches a turn that was not its own.
      const playedTurn = turn;
      nextTurn();
      expect(matches.turnRecord(matchId, playedTurn).B.tool_calls.map((call) => call.tool)).toEqual([
        "get_state",
        "submit_orders",
      ]);
    },
    // Two wedged turns — each the 30 s the client waits for the prompt plus the
    // two 30 s waits the harness spends on a run it has to stop twice — and the
    // turns played around them.
    SEAT_TIMEOUT_MS + 420_000,
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

/**
 * How many times one turn's prompt sits in the conversation the model was
 * shown, taking the largest count over every request the stub answered.
 *
 * A turn the harness passed and then asked again would put the same position in
 * front of the model twice, which is what brief §6.3's "never retry a single
 * turn" forbids, and the conversation is where that would show. Counting the
 * prompt as its own `user` message, rather than as a substring, is what keeps
 * the later turns — which carry the whole conversation — out of the total.
 */
const promptCopies = (stub: StubModel, prompt: string): number =>
  Math.max(
    0,
    ...stub.recorded.map(
      (request) =>
        request.messages.filter(
          (message) =>
            message.role === "user" &&
            (message.content === prompt ||
              (Array.isArray(message.content) &&
                (message.content as Record<string, unknown>[]).some((part) => part.text === prompt))),
        ).length,
    ),
  );

/**
 * The between-turns recovery on its own, driven by a seat that answers — or
 * does not — on a schedule no live Pi child can be made to keep.
 *
 * `recoverSeat` is the part of the harness that runs against a seat which has
 * just failed to answer a `prompt`, so what has to be proven about it is that it
 * survives every way that seat can fail to answer again: late, with an error,
 * or not at all. Every one of its commands goes through the client that just
 * timed out, so each is waited on for the recovery's own budget rather than the
 * client's 30 s, and that budget is passed in and measured here. The fake has no
 * `prompt` to send, which is the shape of the rule it works to: the recovery
 * puts a seat back in order for the next turn and never asks for the last one
 * again. What the recovery decides is used twice — the pass reason of the turn it
 * hands over, and `PiPlayer.lastRecovery` — so both are held here as well.
 */
describe("the recovery between a passed turn and the next one", () => {
  /** What a fake seat reports about itself. */
  const IDLE = { isStreaming: false, isCompacting: false, pendingMessageCount: 0 };

  /**
   * How one command answers: with a value, by never answering, by rejecting the
   * way a live seat does, or by rejecting the way a seat whose process has gone
   * does — the client remembers an exit and rejects every later command with it.
   */
  type Fake<T> = T | "hang" | "error" | "dead";

  /** The rejection texts `RpcClient` answers with, both of them its own. */
  const REJECTION: Record<"error" | "dead", string> = {
    error: "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
    dead: "Pi process exited with code 1",
  };

  /** Which of the two rejections an answer carries, or `null` when it answers. */
  const rejectionOf = <T>(what: Fake<T>): "error" | "dead" | null =>
    what === "error" ? "error" : what === "dead" ? "dead" : null;

  /**
   * A seat that answers `get_state`, `abort` and `clear_queue` as a test says,
   * and counts how many times each was asked.
   */
  const fakeSeat = (options: {
    /** What each `get_state` reports, in order, held on the last entry. */
    states: Fake<Partial<typeof IDLE>>[];
    abort?: Fake<undefined>;
    clearQueue?: Fake<unknown>;
  }): {
    client: SeatRecoveryClient;
    calls: { getState: number; abort: number; clearQueue: number };
  } => {
    const calls = { getState: 0, abort: 0, clearQueue: 0 };
    const answer = <T>(what: Fake<T>, value: T): Promise<T> => {
      if (what === "hang") return new Promise<T>(() => undefined);
      const rejection = rejectionOf(what);
      if (rejection !== null) return Promise.reject(new Error(REJECTION[rejection]));
      return Promise.resolve((what ?? value) as T);
    };
    const client: SeatRecoveryClient = {
      getState: () => {
        const state = options.states[Math.min(calls.getState, options.states.length - 1)];
        calls.getState += 1;
        if (state === "hang") return new Promise(() => undefined);
        if (state === "error" || state === "dead") return Promise.reject(new Error(REJECTION[state]));
        return Promise.resolve({ ...IDLE, ...state });
      },
      abort: () => {
        calls.abort += 1;
        return answer(options.abort, undefined);
      },
      clearQueue: () => {
        calls.clearQueue += 1;
        return answer(options.clearQueue, []);
      },
    };
    return { client, calls };
  };

  /** The budget and pass count the tests below measure against. */
  const BUDGET_MS = 250;
  const PASSES = 3;

  it("stops a seat that is still working, and asks again until it says it is quiet", async () => {
    const seat = fakeSeat({ states: [{ isStreaming: true }, { isCompacting: true }, IDLE] });

    const recovery = await recoverSeat(seat.client, BUDGET_MS, PASSES);

    expect(recovery).toEqual({ quiet: true, asks: 3, stops: 2, clears: 0 });
    expect(seat.calls).toEqual({ getState: 3, abort: 2, clearQueue: 0 });
  });

  it("takes away what is queued, and leaves a seat that is idle alone", async () => {
    const seat = fakeSeat({ states: [{ pendingMessageCount: 2 }, IDLE] });

    const recovery = await recoverSeat(seat.client, BUDGET_MS, PASSES);

    // Queued messages are answered inside a run nobody asked for, so they are
    // taken away; a seat that is neither running nor queued is not stopped.
    expect(recovery).toEqual({ quiet: true, asks: 2, stops: 0, clears: 1 });
    expect(seat.calls).toEqual({ getState: 2, abort: 0, clearQueue: 1 });
  });

  it("gives up on a command that never answers, inside its own budget, and says nothing", async () => {
    const seat = fakeSeat({ states: ["hang"] });

    const started = performance.now();
    const recovery = await recoverSeat(seat.client, BUDGET_MS, PASSES);

    // One unanswered command ends the recovery rather than spending the whole
    // budget on a seat that is not answering: at the client's 30 s this would be
    // a recovery longer than the turn it is preparing.
    expect(performance.now() - started, "the recovery outlasted its budget").toBeLessThan(2_000);
    expect(recovery).toEqual({ quiet: null, asks: 1, stops: 0, clears: 0 });
  });

  it("survives a command that rejects, including a seat whose process is gone", async () => {
    // The exit text is what `seatIsGone` matches on, and the recovery is not
    // the place that reports it: a seat that dies between the two turns is
    // noticed by the next `prompt`, which is a command whose failure means
    // something. Here it is only another command that will not answer.
    const gone = fakeSeat({ states: [{ isStreaming: true }, "dead"], abort: "dead", clearQueue: "dead" });
    await expect(recoverSeat(gone.client, BUDGET_MS, PASSES)).resolves.toEqual({
      quiet: null,
      asks: 2,
      stops: 1,
      clears: 0,
    });

    // A stop that a live seat refuses does not end the recovery either: the seat
    // is asked again, and the turn is asked whatever the last answer was.
    const refusing = fakeSeat({ states: [{ isStreaming: true }, IDLE], abort: "error" });
    await expect(recoverSeat(refusing.client, BUDGET_MS, PASSES)).resolves.toEqual({
      quiet: true,
      asks: 2,
      stops: 1,
      clears: 0,
    });
  });

  it("asks a bounded number of times, and hands a seat that will not settle to the turn anyway", async () => {
    const seat = fakeSeat({ states: [{ isStreaming: true }], abort: "hang" });

    const started = performance.now();
    const recovery = await recoverSeat(seat.client, BUDGET_MS, PASSES);

    // Busy, stopped, busy, stopped, busy: and then the turn is asked anyway,
    // because a seat that will not take a prompt passes its turn, and only a
    // process that is gone ends the match. The verdict below is what makes that
    // pass `prompt_timeout` rather than a plain one — the test after this says
    // how the two are told apart.
    expect(recovery).toEqual({ quiet: false, asks: PASSES, stops: PASSES, clears: 0 });
    expect(performance.now() - started, "the recovery outlasted its budget").toBeLessThan(
      2_000,
    );
  });

  it("tells a seat that was refused from a seat that never answered", () => {
    // The two rejections a failed `prompt` can carry, in the client's own words.
    const refusal = new Error(
      "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
    );
    const timeout = new Error("Timeout waiting for response to prompt. Stderr: ");
    const QUIET: SeatRecovery = { quiet: true, asks: 1, stops: 0, clears: 0 };
    const BUSY: SeatRecovery = { quiet: false, asks: PASSES, stops: PASSES, clears: 0 };
    const SILENT: SeatRecovery = { quiet: null, asks: 1, stops: 0, clears: 0 };

    // A seat that answered the command to refuse it, with nothing outstanding
    // from the turn before, is brief §6.3's plain pass.
    expect(passReasonFor(refusal, null)).toBe("no_submission");
    expect(passReasonFor(refusal, QUIET)).toBe("no_submission");
    // The same refusal after a recovery that could not make the seat quiet is a
    // seat this end has measured as never taking the question, and `no_submission`
    // would read it as a seat that was asked and chose to sit the turn out.
    expect(passReasonFor(refusal, BUSY)).toBe("prompt_timeout");
    expect(passReasonFor(refusal, SILENT)).toBe("prompt_timeout");
    // And the client's own wait is `prompt_timeout` whatever the recovery said.
    expect(passReasonFor(timeout, null)).toBe("prompt_timeout");
    expect(passReasonFor(timeout, QUIET)).toBe("prompt_timeout");
  });
});
