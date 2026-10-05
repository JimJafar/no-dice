/**
 * The match runner: brief §6.4's loop, from a seed to one log file.
 *
 * The MCP endpoint is started in-process on a free port of the loopback address,
 * the match is dealt from the seed, and each seat is started holding its own
 * token — the token is the whole of a seat's identity, so nothing here ever has
 * to tell a tool who is calling. A turn then opens on the server, both seats are
 * asked for it together, and it is resolved once neither of them has anything
 * left to do or the turn has run out of time. The log is written last, and
 * written atomically: brief §6.5 treats an existing log as a match that has
 * already been played, so a half-written file must never be the one a resume
 * finds.
 *
 * Only bots can be seated until milestone 03 lands the Pi harness. A bot is
 * seeded from the match seed and its seat, so the same match run twice plays the
 * same game at both ends, and `created` comes from an injected clock for the same
 * reason: two runs of one seed have to be comparable byte for byte.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { BotPlayer } from "@no-dice/harness";
import type { Player, PlayerContext, TurnOutcome } from "@no-dice/harness";
import { greedyBot, randomBot } from "@no-dice/salient-bots";
import type { Bot, BotOrder } from "@no-dice/salient-bots";
import { boardCells, DEFAULT_CONFIG, hexKey, score } from "@no-dice/salient-engine";
import type { Config, Hex, MatchState, Seat } from "@no-dice/salient-engine";
import engineManifest from "@no-dice/salient-engine/package.json";
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

import { cellsFor, matchLogSchema } from "./log";
import type {
  BoardAfter,
  LogResult,
  MapHex,
  MatchLog,
  PlayerHeader,
  TurnPlayerRecord,
  TurnRecord,
} from "./log";

/** The five minutes brief §6.3 gives a turn before the seat is taken to have passed. */
const TURN_TIMEOUT_MS = 300_000;

/** The resubmission brief §6.2 gives a seat whose first submission was refused. */
const RESUBMISSIONS = 1;

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

/** How a seat reaches the match, given the token it was dealt. */
export type SeatTransport = (matches: MatchServer, seat: Seat, token: string) => Transport;

/** What `runMatch` takes. */
export interface RunMatchOptions {
  /** Where the log is written. Its directory is created when it is not there. */
  out: string;
  /** The seed: the map it generates, and what the bots are seeded from. */
  seed: number;
  /** The rules' constants. Brief §6.1's defaults unless another match is asked for. */
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
const salientVerdict = (result: unknown, sent: BotOrder[]) => {
  const answer = (result ?? {}) as { accepted?: boolean; wasted?: { order: BotOrder; reason: string }[] };
  if (answer.accepted === true) return { accepted: true, rejected: null, retry: [] };
  if (answer.wasted === undefined) return { accepted: false, rejected: null, retry: [] };
  const edge = (order: BotOrder): string => `${order.from}>${order.to}:${String(order.troops)}`;
  const refused = new Set(answer.wasted.map((each) => edge(each.order)));
  return {
    accepted: false,
    rejected: { orders: sent, wasted: answer.wasted },
    retry: sent.filter((order) => !refused.has(edge(order))),
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

/**
 * One seat's turn, under brief §6.3's five minutes. A seat that settles hands
 * back what it did; one still playing when the clock runs out hands back nothing,
 * and the runner logs its turn as a pass.
 *
 * Brief §6.3 aborts a session that overruns. The `Player` interface has no abort
 * yet — milestone 03 gives `PiPlayer` one — so an unfinished turn is left to
 * finish on its own and its answer is dropped rather than left unhandled.
 */
const playSeat = async (player: Player, turn: number, timeoutMs: number): Promise<SeatTurn> => {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const played = player.playTurn(turn);
  const outcome = await Promise.race([played, deadline]);
  if (timer !== undefined) clearTimeout(timer);
  if (outcome === null) void played.catch(() => undefined);
  return {
    outcome,
    timedOut: outcome === null,
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
  // The server can only say a seat never submitted. Over a turn that ran out of
  // time, brief §6.3's reason is the timeout.
  passed: record.passed === null ? null : played.timedOut ? "timeout" : "no_submission",
  usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  cost_usd: 0,
  context_tokens: 0,
  compacted: false,
  wall_ms: played.wallMs,
});

/**
 * Write the log in one step: the bytes go to `<out>.tmp` and are renamed into
 * place, so the only file another run can ever find is a finished log.
 */
const writeAtomically = async (path: string, log: MatchLog): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  await rename(tmp, path);
};

/**
 * Play one match and write it. The loop is brief §6.4's: open the turn, ask both
 * seats together, resolve once they have both answered or the turn has run out,
 * and stop at a knockout. The log is checked against `salient-log/1` before it is
 * written, so a log that does not replay is never left on disk to be found later.
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

  const seats: Record<Seat, Player> = {
    A: playerFor(options.seats.A, "A", options.seed, connectFor(options, matches, "A", tokens.A)),
    B: playerFor(options.seats.B, "B", options.seed, connectFor(options, matches, "B", tokens.B)),
  };

  const turns: TurnRecord[] = [];
  let result: LogResult | null = null;
  try {
    await Promise.all([
      seats.A.start({ serverUrl, token: tokens.A }),
      seats.B.start({ serverUrl, token: tokens.B }),
    ]);

    for (let turn = 1; turn <= config.turns && result === null; turn++) {
      matches.openTurn(matchId);
      const [playedA, playedB] = await Promise.all([
        playSeat(seats.A, turn, turnTimeoutMs),
        playSeat(seats.B, turn, turnTimeoutMs),
      ]);
      // Both seats have answered, or the turn is over: the engine gets what each
      // of them handed in, and the record of the turn is read back afterwards so
      // it carries the orders the engine dropped and why.
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
  } finally {
    // Brief §6.4 stops both players before the log is written, so nothing a seat
    // does on its way out can land in a turn that has already been recorded.
    await Promise.all([seats.A.stop(), seats.B.stop()]);
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

/** How one seat reaches the server: the endpoint by default, a linked pair if given. */
function connectFor(
  options: RunMatchOptions,
  matches: MatchServer,
  seat: Seat,
  token: string,
): ((ctx: PlayerContext) => Transport) | undefined {
  const transport = options.transport;
  return transport === undefined ? undefined : () => transport(matches, seat, token);
}
