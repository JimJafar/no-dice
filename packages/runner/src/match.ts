/**
 * The match runner: brief §6.4's loop, from a seed to one log file.
 *
 * The MCP endpoint is started in-process on a free port of the loopback address,
 * the match is dealt from the seed, and each seat is started holding its own
 * token — the token is the whole of a seat's identity, so nothing here ever has
 * to tell a tool who is calling. A turn then opens on the server, both seats are
 * asked for it together, and it is resolved once neither of them has anything
 * left to do or the turn has run out of time; a seat that was still playing when
 * it ran out is aborted, and stays in the match for the turn after. The log is
 * written last, and written atomically: brief §6.5 treats an existing log as a
 * match that has already been played, so a half-written file must never be the
 * one a resume finds.
 *
 * A match is only written when it was played. A seat that reports a match-level
 * failure — its process died, or it reached a tool outside the seven — throws
 * `MatchVoided`, and the run ends with no log on disk for a resume to mistake
 * for a match.
 *
 * Only bots can be seated until milestone 03 lands the Pi harness. A bot is
 * seeded from the match seed and its seat, so the same match run twice plays the
 * same game at both ends, and `created` comes from an injected clock for the same
 * reason: two runs of one seed have to be comparable byte for byte.
 */
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { BotPlayer, MatchVoided } from "@no-dice/harness";
import type { Player, PlayerContext, TurnOutcome } from "@no-dice/harness";
import { greedyBot, randomBot } from "@no-dice/salient-bots";
import type { Bot, BotOrder } from "@no-dice/salient-bots";
import { boardCells, DEFAULT_CONFIG, hexKey, score } from "@no-dice/salient-engine";
import type { Config, Hex, MatchState, Seat } from "@no-dice/salient-engine";
import engineManifest from "@no-dice/salient-engine/package.json" with { type: "json" };
import {
  keyToLabel,
  matchConstants,
  MatchServer,
  SIMULATE_LIMIT,
  startServer,
  TOOL_CALL_LIMIT,
  type RulesView,
  type RunningServer,
  type StateView,
} from "@no-dice/salient-server";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { cellsFor, matchLogSchema } from "./log.ts";
import type {
  BoardAfter,
  LogResult,
  MapHex,
  MatchLog,
  PlayerHeader,
  TurnPlayerRecord,
  TurnRecord,
} from "./log.ts";

/** The five minutes brief §6.3 gives a turn before the seat is taken to have passed. */
const TURN_TIMEOUT_MS = 300_000;

/** The resubmission brief §6.2 gives a seat whose first submission was refused. */
const RESUBMISSIONS = 1;

/** How long an aborted seat is given to hand back the turn it was aborted out of. */
const ABORT_GRACE_MS = 10_000;

/** The URL recorded for a seat that was handed its transport instead of an endpoint. */
const LINKED_URL = "in-memory";

/** The baseline bots a seat may be given, named as the log names them. */
export type BotName = "random" | "greedy";

/** A seat played by one of the baseline bots. */
export interface BotSeat {
  kind: "bot";
  bot: BotName;
}

/** Who plays a seat. Milestone 03 adds a Pi seat beside this one. */
export type SeatSpec = BotSeat;

/** How a seat reaches the match, given the token it is playing with. */
export type SeatTransport = (matches: MatchServer, seat: Seat, token: string) => Transport;

/** What `runMatch` takes. */
export interface RunMatchOptions {
  /** Where the log is written. Its directory is created when it is not there. */
  out: string;
  /** The seed: the map it generates, and what the bots are seeded from. */
  seed: number;
  /**
   * The rules' constants. Brief §6.1's defaults unless another match is asked
   * for. Only the constants the log's header can carry outlive the run: the
   * frozen header records turns, action points, troops, production, garrison,
   * home bonus and points, and nothing else. A config that also moves `radius`,
   * `supply` or `blockedPairs` therefore writes a log whose map is that board
   * while the log says nothing about how it was dealt, and the viewer and the
   * stats package would replay it as a different game.
   */
  config?: Config;
  /** Who plays each seat. */
  seats: Record<Seat, SeatSpec>;
  /** The clock `created` is taken from. Injectable so two runs can be compared. */
  clock?: () => Date;
  /** How long a seat may take over a turn before it is taken to have passed. */
  turnTimeoutMs?: number;
  /**
   * How a seat reaches the server. By default the runner starts the MCP endpoint
   * in-process and each seat connects to it over Streamable HTTP, which is how a
   * real match runs. A caller can hand a seat its end of a linked transport
   * instead — the same tools and the same limits, with no socket between them.
   */
  transport?: SeatTransport;
}

/** What `runMatch` hands back: the log, and the file it was written to. */
export interface MatchOutcome {
  path: string;
  log: MatchLog;
}

/**
 * The seed a bot plays from: the match seed mixed with its seat. A rerun of the
 * same match therefore draws the same moves, and the two seats of a match do not
 * play one draw after another at both ends of the board.
 */
const botSeed = (seed: number, seat: Seat): number => {
  let mixed = (seed >>> 0) ^ (seat === "A" ? 0x9e3779b9 : 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
};

/**
 * How a Salient `submit_orders` answer reads to the harness: `{ accepted: true }`
 * when the orders stand, `{ accepted: false, wasted }` when the first attempt was
 * refused. The one resubmission carries the same orders with the refused ones
 * taken out, which is the deal brief §6.2 gives any seat.
 */
export const salientVerdict = (result: unknown, sent: BotOrder[]) => {
  const answer = (result ?? {}) as { accepted?: boolean; wasted?: { order: BotOrder; reason: string }[] };
  if (answer.accepted === true) return { accepted: true, rejected: null, retry: [] };
  if (answer.wasted === undefined) return { accepted: false, rejected: null, retry: [] };
  const sameOrder = (a: BotOrder, b: BotOrder): boolean =>
    a.from === b.from && a.to === b.to && a.troops === b.troops;
  // The refused orders come out one occurrence at a time rather than by value: a
  // submission can carry the same order twice and have only one of them refused,
  // and the other still stands on the resubmission.
  const refused = answer.wasted.map((each) => each.order);
  const retry = sent.filter((order) => {
    const at = refused.findIndex((each) => sameOrder(each, order));
    if (at === -1) return true;
    refused.splice(at, 1);
    return false;
  });
  return {
    accepted: false,
    rejected: { orders: sent, wasted: answer.wasted },
    retry,
  };
};

/** Every hex on the board, in the order the log's `map` lists them: row, then column. */
const boardHexes = (state: MatchState, radius: number): Hex[] =>
  boardCells(radius).map((at) => state.hexes[hexKey(at.q, at.r)]);

/**
 * The board in the log's shape: one cell per hex, the points each seat scores,
 * and the troops each seat has on the board. Supply is the engine's answer —
 * `cellsFor` only marks the hexes its `score()` left out as cut off.
 */
const boardOf = (state: MatchState, config: Config): BoardAfter => {
  const hexes = boardHexes(state, config.radius);
  const supply = { A: score(state, "A", config), B: score(state, "B", config) };
  const troops = (seat: Seat): number =>
    hexes.reduce((total, hex) => (hex.owner === seat ? total + hex.troops : total), 0);
  return {
    cells: cellsFor(hexes, supply.A.supplied, supply.B.supplied),
    score: { A: supply.A.points, B: supply.B.points },
    troops: { A: troops("A"), B: troops("B") },
  };
};

/** The parts of the log that a turn cannot change: the map, the Bases, the opening board. */
interface MatchFrame {
  map: MapHex[];
  bases: { A: string; B: string };
  start: { cells: BoardAfter["cells"]; score: BoardAfter["score"] };
}

const frameOf = (state: MatchState, config: Config): MatchFrame => {
  const opened = boardOf(state, config);
  return {
    map: boardHexes(state, config.radius).map((hex) => ({
      id: hex.id,
      q: hex.q,
      r: hex.r,
      terrain: hex.terrain,
    })),
    bases: {
      A: keyToLabel(state.base.A, config.radius),
      B: keyToLabel(state.base.B, config.radius),
    },
    start: { cells: opened.cells, score: opened.score },
  };
};

/** The seat as the log's header records it. */
const headerOf = (spec: SeatSpec): PlayerHeader => ({ kind: "bot", bot: spec.bot });

/**
 * The seat's player. A bot is seeded from the match seed and its seat, and is
 * handed the seat's token at `start`, so it reaches the match over the same
 * endpoint and by the same tools a model will use.
 */
const playerFor = (
  spec: SeatSpec,
  seat: Seat,
  seed: number,
  connect?: (ctx: PlayerContext) => Transport,
): Player => {
  const decide: Bot = spec.bot === "random" ? randomBot(botSeed(seed, seat)) : greedyBot();
  return new BotPlayer<RulesView, StateView, BotOrder>({
    tools: { rules: "get_rules", state: "get_state", submit: "submit_orders" },
    decide: (rules, state) => decide(rules, state),
    verdict: salientVerdict,
    ...(connect === undefined ? {} : { transport: connect }),
  });
};

/** What one seat got through over a turn, and how long it took. */
interface SeatTurn {
  /** What the seat reported doing, or `null` when it never finished. */
  outcome: TurnOutcome | null;
  /** Whether the turn ran out of time with the seat still playing. */
  timedOut: boolean;
  wallMs: number;
}

/** The same promise, answered `null` if it has not arrived within `ms`. */
const within = async <T>(promise: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * One seat's turn, under brief §6.3's five minutes. A seat that settles hands
 * back what it did; one still playing when the clock runs out is aborted and
 * hands back what it had done by then, and the runner logs its turn as a pass.
 *
 * Aborting is the seat's own affair, and is asked for by the caller so it can
 * put a new token under a seat whose connection it replaces: `Player.abort`
 * ends the turn and leaves the seat in the match, with the aborted turn still
 * in its history, and the runner never restarts a player to get out of a turn.
 * The aborted turn is still waited for, briefly, because it carries the calls
 * the seat did make; a seat that cannot answer for itself, its process gone, is
 * what makes that wait end empty-handed.
 */
const playSeat = async (
  player: Player,
  turn: number,
  timeoutMs: number,
  abort: () => Promise<void>,
): Promise<SeatTurn> => {
  const started = performance.now();
  const played = player.playTurn(turn);
  // The turn's failure is picked up by the races below, or by the caller's; this
  // only keeps Node from calling an unhandled rejection fatal in between.
  played.catch(() => undefined);
  let outcome = await within(played, timeoutMs);
  const timedOut = outcome === null;
  if (timedOut) {
    await abort();
    outcome = await within(played, ABORT_GRACE_MS);
  }
  return {
    outcome,
    timedOut,
    wallMs: Math.max(0, Math.round(performance.now() - started)),
  };
};

/**
 * The server's record of a seat's turn, with what only the runner knows added:
 * why the seat passed when it never answered, and what the turn cost it. A bot
 * runs no provider, so its usage, cost and context stay at nought and nothing of
 * its conversation is ever compacted; milestone 03 fills those from Pi's session
 * stats.
 */
const withHarness = (record: TurnPlayerRecord, played: SeatTurn): TurnPlayerRecord => ({
  ...record,
  // The server can only say a seat never submitted. Brief §6.3's table names the
  // reason, and the seat is the one that can tell most of them; a turn that ran
  // out of its time is the one the runner caused, and it says so here.
  passed:
    record.passed === null ? null : played.timedOut ? "timeout" : played.outcome?.passed ?? "no_submission",
  usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  cost_usd: 0,
  context_tokens: 0,
  compacted: false,
  wall_ms: played.wallMs,
});

/**
 * Write the log in one step: the bytes go to `<out>.tmp` and are renamed into
 * place, so the only file another run can ever find is a finished log. They are
 * synced before the name appears, because brief §6.5 treats a log that exists as
 * a match that has been played, and if the rename itself fails the half file is
 * taken away rather than left for a resume to mistake for one.
 */
const writeAtomically = async (path: string, log: MatchLog): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(log, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
};

/** A seat as the loop holds it: who plays it, and how far the runner may go. */
interface Seated {
  player: Player;
  /** The token it was started on, and plays with until its connection moves. */
  token: string;
  /**
   * Whether the seat reaches the match over a connection the runner may replace.
   * It is true of a bot, whose abort reconnects it, and false of a Pi session,
   * which holds one connection for the whole match. A connection that is
   * replaced is given a new token with it, which is what keeps a call the
   * abandoned turn had already sent from being counted against the turn after
   * it; a seat whose connection cannot be replaced has that call cut off by its
   * own abort instead, and keeps the token it was dealt.
   */
  replacesConnection: boolean;
}

/**
 * Play one match and write it. The loop is brief §6.4's: open the turn, ask both
 * seats together, abort any seat still running once the turn has had its time,
 * record and resolve it, and stop at a knockout. The log is checked against
 * `salient-log/1` before it is written, so a log that does not replay is never
 * left on disk to be found later.
 */
export async function runMatch(options: RunMatchOptions): Promise<MatchOutcome> {
  const config = options.config ?? DEFAULT_CONFIG;
  const clock = options.clock ?? ((): Date => new Date());
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;

  const matches = new MatchServer();
  const { matchId, tokens } = matches.createMatch(options.seed, config);
  const session = matches.match(matchId);
  const frame = frameOf(session.state, config);

  // A caller that hands each seat its own transport has its own server on the
  // other end of it, so there is no endpoint to start.
  const running: RunningServer | null =
    options.transport === undefined ? await startServer({ matches, port: 0 }) : null;
  const serverUrl = running === null ? LINKED_URL : running.url;

  const seated: Record<Seat, Seated> = {
    A: {
      player: playerFor(options.seats.A, "A", options.seed, connectFor(options, matches, "A")),
      token: tokens.A,
      replacesConnection: options.seats.A.kind === "bot",
    },
    B: {
      player: playerFor(options.seats.B, "B", options.seed, connectFor(options, matches, "B")),
      token: tokens.B,
      replacesConnection: options.seats.B.kind === "bot",
    },
  };

  /**
   * Brief §6.4's "abort any player still running", done without taking the seat
   * out of the match. The seat keeps its session, and with it the aborted turn:
   * brief §6.3 prompts it again next turn over the conversation that turn is
   * part of. Only a seat whose connection the runner replaces is re-tokened, and
   * it is handed the new token by its own abort.
   */
  const abortSeat = async (seat: Seat): Promise<void> => {
    const at = seated[seat];
    if (at.replacesConnection) at.token = matches.rotateToken(matchId, seat);
    await at.player.abort({ serverUrl, token: at.token });
  };

  const turns: TurnRecord[] = [];
  let result: LogResult | null = null;
  try {
    await Promise.all([
      seated.A.player.start({ serverUrl, token: seated.A.token }),
      seated.B.player.start({ serverUrl, token: seated.B.token }),
    ]);

    for (let turn = 1; turn <= config.turns && result === null; turn++) {
      matches.openTurn(matchId);
      const [playedA, playedB] = await Promise.all([
        playSeat(seated.A.player, turn, turnTimeoutMs, () => abortSeat("A")),
        playSeat(seated.B.player, turn, turnTimeoutMs, () => abortSeat("B")),
      ]);
      // Both seats have answered, or the turn has had its time; a seat still
      // playing was aborted by `playSeat` on the way here, which is brief §6.4's
      // "abort any player still running", and it stays in the match.
      // The engine gets what each seat handed in, and the record of the turn is
      // read back afterwards so it carries the orders the engine dropped and why.
      const resolved = matches.resolveTurn(matchId);
      const record = matches.turnRecord(matchId, turn);
      result = resolved.result;
      turns.push({
        n: turn,
        players: {
          A: withHarness(record.A, playedA),
          B: withHarness(record.B, playedB),
        },
        events: resolved.events,
        after: boardOf(session.state, config),
      });
    }
  } catch (error) {
    // Brief §6.3's two match-level failures end the match rather than a turn, and
    // they end it before the log is written: a voided match must never be
    // presented as one that was played, and a match voided is replayed from turn
    // 1 on the same seed rather than resumed from a log.
    if (error instanceof MatchVoided) {
      throw new MatchVoided(error.reason, `match ${matchId} is voided: ${error.message}`);
    }
    throw error;
  } finally {
    // Brief §6.4 stops both players before the log is written, so nothing a seat
    // does on its way out can land in a turn that has already been recorded.
    await Promise.all([seated.A.player.stop(), seated.B.player.stop()]);
    if (running !== null) await running.close();
  }

  if (result === null) {
    throw new Error(`match ${matchId} ended after ${String(turns.length)} turns with no result`);
  }

  const log = matchLogSchema.parse({
    format: "salient-log/1",
    ruleset: "v0",
    engine_version: engineManifest.version,
    created: clock().toISOString(),
    seed: options.seed,
    config: matchConstants(config),
    harness: {
      // Neither seat ran through Pi, so there is no version to record.
      pi_version: null,
      context: "continuous",
      compaction: true,
      tool_call_cap: TOOL_CALL_LIMIT,
      simulate_cap: SIMULATE_LIMIT,
      resubmissions: RESUBMISSIONS,
      turn_timeout_s: Math.round(turnTimeoutMs / 1000),
      output_token_budget: null,
    },
    players: { A: headerOf(options.seats.A), B: headerOf(options.seats.B) },
    map: frame.map,
    bases: frame.bases,
    start: frame.start,
    turns,
    result,
  });

  await writeAtomically(options.out, log);
  return { path: options.out, log };
}

/**
 * How one seat reaches the server: the endpoint by default, a linked pair if
 * given. The token comes from the context the seat was started with, which is the
 * only one it is ever given: a seat that is aborted over a turn keeps its
 * connection and its identity.
 */
function connectFor(
  options: RunMatchOptions,
  matches: MatchServer,
  seat: Seat,
): ((ctx: PlayerContext) => Transport) | undefined {
  const transport = options.transport;
  return transport === undefined ? undefined : (ctx) => transport(matches, seat, ctx.token);
}
