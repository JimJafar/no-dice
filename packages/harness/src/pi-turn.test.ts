/**
 * Brief §6.3's turn outcomes, played out by a real Pi seat against a scripted
 * model.
 *
 * A turn ends one of four ways for a seat, and the difference is only visible
 * from inside the seat: whether it settled with orders, settled without them,
 * ran out of its time, or was stopped for spending its output-token budget; and
 * whether the provider answered at all after Pi's own retries. Each of those is
 * produced here by `StubModel` and read back off the turn the seat reports. The
 * two match-level failures are different in kind — a tool outside the seven, and
 * the Pi process gone from under the turn — and are reported by throwing
 * `MatchVoided` rather than by a turn record, because there is no turn to give a
 * reason to.
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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/salient-engine";
import { MatchServer, startServer, type RunningServer } from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PiPlayer } from "./pi-player.ts";
import type { PiPlayerOptions } from "./pi-player.ts";
import { MatchVoided } from "./player.ts";
import type { PlayerContext, TurnOutcome } from "./player.ts";
import {
  StubModel,
  callsToolOutsideTheSeven,
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

/** How long a turn is given before these tests abort it, against a 20s stub. */
const TURN_DEADLINE_MS = 3_000;

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
 * process — and by the session directory only that seat was started with, since
 * a match file may have several seats alive at once.
 */
const piChildPid = (sessionDir: string): number | null => {
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
      // The arguments are separated by NUL, which no path can appear across.
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf-8");
      if (cmdline.includes("--mode") && cmdline.includes(sessionDir)) return Number(entry);
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
      const stub = await startStub(sleepsPastDeadline(20_000));
      const { player, ctx } = await startSeat("B", stub);
      const firstTurn = turn;

      const started = performance.now();
      const { outcome, timedOut } = await playWithDeadline(player, ctx, firstTurn, TURN_DEADLINE_MS);
      const took = performance.now() - started;

      expect(timedOut).toBe(true);
      // The abort ended the turn rather than leaving it to run for its 20 seconds.
      expect(took).toBeLessThan(15_000);
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
    SEAT_TIMEOUT_MS,
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
    "voids the match when the seat calls a tool outside the seven",
    async () => {
      const stub = await startStub(callsToolOutsideTheSeven());
      const { player } = await startSeat("B", stub);

      // Not a pass: a seat that reached a tool it was never given has left the
      // game, and the match it played cannot be reported as one that was played.
      const voided = await player.playTurn(turn).then(
        () => null,
        (error: unknown) => error,
      );
      expect(voided).toBeInstanceOf(MatchVoided);
      expect((voided as MatchVoided).reason).toBe("tool_surface");
    },
    SEAT_TIMEOUT_MS,
  );

  it.skipIf(!existsSync("/proc"))(
    "voids the match when the seat's Pi process is killed during a turn",
    async () => {
      const stub = await startStub(sleepsPastDeadline(20_000));
      const { player, ctx } = await startSeat("A", stub);
      const pid = piChildPid(player.seatHome.sessionDir);
      if (pid === null) throw new Error(`no Pi process was found for ${player.seatHome.sessionDir}`);

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
});

/** The session files Pi has saved in a seat's session directory. */
const sessionsIn = (sessionDir: string): string[] =>
  readdirSync(sessionDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .sort();
