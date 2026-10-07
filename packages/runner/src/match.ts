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
 * A seat is played either by one of the baseline bots or by a model through the
 * Pi harness, and the loop does not care which: both are a `Player` asked for a
 * turn and read back through the same tools. A bot is seeded from the match seed
 * and its seat, so the same match run twice plays the same game at both ends,
 * and `created` and every logged duration come from an injectable clock and timer
 * for the same reason: two runs of one seed have to be comparable byte for byte.
 */
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BotPlayer, MatchVoided, PiPlayer, piCli } from "@no-dice/harness";
import type {
  PassReason,
  PiThinkingLevel,
  Player,
  PlayerContext,
  TurnOutcome,
} from "@no-dice/harness";
import { cellsFor, matchLogSchema } from "@no-dice/log";
import type {
  BoardAfter,
  LogResult,
  MapHex,
  MatchLog,
  PlayerHeader,
  TurnPlayerRecord,
  TurnRecord,
} from "@no-dice/log";
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

import type { SeatArg } from "./args.ts";
import { seatModelsJson } from "./providers.ts";

/** The five minutes brief §6.3 gives a turn before the seat is taken to have passed. */
const TURN_TIMEOUT_MS = 300_000;

/** The resubmission brief §6.2 gives a seat whose first submission was refused. */
const RESUBMISSIONS = 1;

/** How long an aborted seat is given to hand back the turn it was aborted out of. */
const ABORT_GRACE_MS = 10_000;

/** The URL recorded for a seat that was handed its transport instead of an endpoint. */
const LINKED_URL = "in-memory";

/**
 * How long a seat that is still running after its submission lands gets before
 * the runner aborts it: brief §6.3's "the server has an accepted submission but
 * the agent is still running: wait 10 seconds, then send `abort()`".
 */
const AFTER_SUBMISSION_MS = 10_000;

/** How often the runner asks the server whether a seat is in with its turn. */
const SUBMISSION_POLL_MS = 50;

/** The prompt brief §6.3 plays both seats with, kept with the game that owns it. */
const PLAYER_SYSTEM_PROMPT = fileURLToPath(
  new URL("../../../games/salient/prompts/player-system.md", import.meta.url),
);

/** The baseline bots a seat may be given, named as the log names them. */
export type BotName = "random" | "greedy";

/** A seat played by one of the baseline bots. */
export interface BotSeat {
  kind: "bot";
  bot: BotName;
}

/**
 * A seat played by a model: brief §6.3's seat, one Pi session for the whole
 * match, prompted once a turn and given only the game's seven tools.
 */
export interface PiSeat {
  kind: "pi";
  /** The model under test, as Pi's `--model` takes it: `<provider>/<id>`. */
  model: string;
  /** The reasoning level, as `--thinking` names it. The log's header records it. */
  thinking: PiThinkingLevel;
  /**
   * The seat's `models.json`, which is how it reaches the model under test. This
   * is what lets a test seat a model on a stub endpoint on loopback and play a
   * whole match with no credential anywhere on the machine, and what lets a real
   * run seat a model on a provider Pi does not know — the entry comes out of
   * `providers.json`, see `./providers.ts`.
   */
  modelsJson?: unknown;
  /**
   * Extra variables for the seat's Pi process, merged over the ones its isolated
   * home is built with: a provider's key for a real run, `PI_OFFLINE` for a stub
   * endpoint. They are also the environment its credential is checked in.
   */
  env?: Record<string, string>;
  /**
   * The player system prompt: a path to a file, or the prompt itself. Defaults to
   * the game's own prompt, which is the one brief §6.3 says both seats are played
   * with.
   */
  systemPrompt?: string;
  /**
   * The output tokens one turn may cost before the seat is aborted and the turn
   * passes with `token_budget`. Brief §6.3 leaves the number to the experiment, so
   * by default a turn is bounded by its time alone.
   */
  outputTokenBudget?: number | null;
}

/** Who plays a seat: a baseline bot, or a model through the Pi harness. */
export type SeatSpec = BotSeat | PiSeat;

/**
 * The reasoning level a model seat is played at when nothing chooses one. It is a
 * measured variable rather than a default a seat carries, so the runner picks it
 * and the log's header records which level the match was played at.
 */
const DEFAULT_THINKING: PiThinkingLevel = "medium";

/**
 * A seat the command line named as a seat the runner plays. Both the `match`
 * command and a series get their seats this way, so a pairing is seated the same
 * way however it was asked for; whether a model seat has a credential at all is
 * reported by the run in one line before a turn is played.
 *
 * A model seat whose provider is in the committed registry is given that
 * provider's `models.json`, which is how it reaches an endpoint Pi has never
 * heard of. A seat whose provider is not listed is given none at all, and Pi's
 * built-in lookup — and the operator's exported key — is left in charge.
 */
export const seatSpec = (seat: SeatArg): SeatSpec => {
  if (seat.kind === "bot") return { kind: "bot", bot: seat.bot };
  const model = `${seat.provider}/${seat.model}`;
  const modelsJson = seatModelsJson(model);
  return {
    kind: "pi",
    model,
    thinking: DEFAULT_THINKING,
    ...(modelsJson === null ? {} : { modelsJson }),
  };
};

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
  /**
   * Who plays each seat. A Pi seat's header records the context window Pi
   * reported for its model, which the seat names as soon as its session is up;
   * a Pi seat whose session never reported one — no model resolved, a model
   * entry with no window in it — fails the run at the header rather than
   * writing a window no seat ran with.
   */
  seats: Record<Seat, SeatSpec>;
  /** The clock `created` is taken from. Injectable so two runs can be compared. */
  clock?: () => Date;
  /**
   * The monotonic timer durations are measured off, in milliseconds: the log's
   * per-turn `wall_ms`, and the per-call `ms` the server records. Injectable for
   * the same reason as `clock`, and for the same good — a rerun on one seed has to
   * write the same bytes, and a measured duration is the one number in a log no
   * two runs would otherwise agree on. A timer that advances a fixed step per call
   * makes two runs of one match say the same thing about how long each call took.
   */
  timer?: () => number;
  /** How long a seat may take over a turn before it is taken to have passed. */
  turnTimeoutMs?: number;
  /**
   * How a seat reaches the server. By default the runner starts the MCP endpoint
   * in-process and each seat connects to it over Streamable HTTP, which is how a
   * real match runs. A caller can hand a seat its end of a linked transport
   * instead — the same tools and the same limits, with no socket between them.
   */
  transport?: SeatTransport;
  /**
   * The directory a Pi seat's config home, working directory and session
   * transcripts are made in. Defaults to a directory with the log's name and its
   * extension taken off: `matches/135.json` gets `matches/135/`, and a log named
   * without an extension gets `matches/run1-match/`.
   */
  matchDir?: string;
  /**
   * How long a seat that has submitted but is still running gets before the runner
   * aborts it. Brief §6.3 says ten seconds; it is a knob so a test can watch the
   * rule work inside its own timeout.
   */
  afterSubmissionMs?: number;
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

/** Where a seat is seated: which seat it is, and what the match gives it. */
interface SeatPlacement {
  seat: Seat;
  /** The match seed, which a bot is seeded from along with its seat. */
  seed: number;
  /** Turns in the match, which a Pi seat names in its per-turn prompt. */
  turns: number;
  /** The directory a Pi seat's home, working directory and transcripts go in. */
  matchDir: string;
  /** How the seat reaches the server, for a runner that started no endpoint. */
  connect?: (ctx: PlayerContext) => Transport;
}

/**
 * The seat's player. A bot is seeded from the match seed and its seat, and is
 * handed the seat's token at `start`, so it reaches the match over the same
 * endpoint and by the same tools a model uses. A Pi seat is brief §6.3's seat:
 * one session for the whole match, in a home of its own under the match's
 * directory, played with the game's prompt and the model the run is measuring.
 */
const playerFor = (spec: SeatSpec, at: SeatPlacement): Player => {
  if (spec.kind === "pi") {
    return new PiPlayer({
      seat: at.seat,
      matchDir: at.matchDir,
      model: spec.model,
      thinking: spec.thinking,
      systemPrompt: spec.systemPrompt ?? PLAYER_SYSTEM_PROMPT,
      turns: at.turns,
      ...(spec.modelsJson === undefined ? {} : { modelsJson: spec.modelsJson }),
      ...(spec.env === undefined ? {} : { env: spec.env }),
      ...(spec.outputTokenBudget === undefined
        ? {}
        : { outputTokenBudget: spec.outputTokenBudget }),
    });
  }
  const decide: Bot =
    spec.bot === "random" ? randomBot(botSeed(at.seed, at.seat)) : greedyBot();
  return new BotPlayer<RulesView, StateView, BotOrder>({
    tools: { rules: "get_rules", state: "get_state", submit: "submit_orders" },
    decide: (rules, state) => decide(rules, state),
    verdict: salientVerdict,
    ...(at.connect === undefined ? {} : { transport: at.connect }),
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
 * One seat's turn. A seat that settles hands back what it did; one still playing
 * when brief §6.3's five minutes run out is aborted and hands back what it had
 * done by then, and the runner logs its turn as a pass.
 *
 * The other rule the runner holds over a seat is the one only it can see: when
 * the server has the seat's submission but the seat is still running, brief §6.3
 * gives it ten seconds and then aborts it. A seat that submitted through the
 * tools has said everything it has to say about the turn, and what it does after
 * that is a model talking to itself. The server says nothing when a submission
 * lands, so the runner asks it, and stops asking the moment the turn is over.
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
  abort: () => Promise<void>,
  limits: {
    /** How long the turn may take before the seat is taken to have passed. */
    timeoutMs: number;
    /** How long a seat that has submitted but is running gets before its abort. */
    afterSubmissionMs: number;
    /** Whether the server holds this seat's submission for the turn. */
    hasSubmission: () => boolean;
    /** The monotonic clock the turn's wall time is measured off. */
    timer: () => number;
  },
): Promise<SeatTurn> => {
  const started = limits.timer();
  const played = player.playTurn(turn);
  // The turn's failure is picked up by the races below, or by the caller's; this
  // only keeps Node from calling an unhandled rejection fatal in between.
  played.catch(() => undefined);
  const stopWatching = watchSubmission(limits.hasSubmission, limits.afterSubmissionMs, abort);
  let outcome: TurnOutcome | null = null;
  try {
    outcome = await within(played, limits.timeoutMs);
  } finally {
    // Stopped whatever the turn did, including rejecting. A match voided by a
    // seat that reached a tool outside the seven throws past here, and a watcher
    // left polling holds the event loop open for ever — the operator reads the
    // error and then a `no-dice` that never exits — while going on to abort a
    // seat that has already been taken down.
    stopWatching();
  }
  const timedOut = outcome === null;
  if (timedOut) {
    await abort();
    outcome = await within(played, ABORT_GRACE_MS);
  }
  return {
    outcome,
    timedOut,
    wallMs: Math.max(0, Math.round(limits.timer() - started)),
  };
};

/**
 * Abort the seat once `graceMs` has gone by since the server took its
 * submission, and say nothing if the turn ended first.
 *
 * The asking is a poll because the server gives no notice: `MatchSession.status`
 * is a read of an in-memory record, and it stops as soon as the turn does. A
 * watcher that cannot ask, or cannot abort, says nothing and stops: the turn is
 * still bounded by its own timeout, and the abort that answers a timeout is the
 * one that reports. Nothing in here may reject unawaited, which Node treats as
 * fatal.
 */
const watchSubmission = (
  hasSubmission: () => boolean,
  graceMs: number,
  abort: () => Promise<void>,
): (() => void) => {
  let stopped = false;
  /** The wait the watcher is sitting in, so `stop` can take it away. */
  let sleep: (() => void) | null = null;
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      sleep = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  void (async () => {
    try {
      while (!stopped && !hasSubmission()) await wait(SUBMISSION_POLL_MS);
      if (stopped) return;
      await wait(graceMs);
      if (stopped) return;
      await abort();
    } catch {
      // The seat is bounded by the turn's own timeout either way.
    }
  })();
  return () => {
    stopped = true;
    sleep?.();
    sleep = null;
  };
};

/**
 * Why a seat played no orders this turn, or `null` when it played some.
 *
 * The server can only say a seat never submitted. Brief §6.3's table names
 * reasons the server cannot see, and the seat reports the ones it can: a provider
 * that refused after Pi's own retries, a turn over its output budget, a turn that
 * settled with nothing in it. A turn that ran out of its time is the one the
 * runner caused, and it says `timeout` whatever the seat says, because the seat
 * was stopped in the middle of playing.
 */
const passReasonOf = (record: TurnPlayerRecord, played: SeatTurn): PassReason | null => {
  if (record.passed === null) return null;
  if (played.timedOut) return "timeout";
  return played.outcome?.passed ?? "no_submission";
};

/**
 * The server's record of a seat's turn, with what only the runner knows added:
 * why the seat passed, and what the turn cost it. A bot runs no provider, so its
 * usage, cost and context stay at nought and nothing of its conversation is ever
 * compacted; a Pi seat's come from Pi's own session stats, read over the turn.
 */
const withHarness = (record: TurnPlayerRecord, played: SeatTurn): TurnPlayerRecord => {
  const provider = played.outcome?.provider ?? null;
  return {
    ...record,
    passed: passReasonOf(record, played),
    usage: provider?.usage ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    cost_usd: provider?.costUsd ?? 0,
    // Pi reports no size for a context a compaction has just reshaped, and the
    // frozen format has no way to say unknown; the `compacted` flag beside this
    // is what tells a reader to expect a nought here.
    context_tokens: provider?.contextTokens ?? 0,
    compacted: provider?.compacted ?? false,
    wall_ms: played.wallMs,
  };
};

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
 * The directory a match's own files go in: the log, and beside it a directory
 * holding each Pi seat's home, working directory and session transcripts. A
 * rerun on the same `out` overwrites both.
 *
 * The directory is never the log path itself: `--out` takes any name, and a
 * `matches/run1` whose seat homes were made under `matches/run1/` would leave
 * the log a directory to rename over. A name that does not say `.json` gets its
 * homes in a directory of their own with `-match` on the end.
 */
const matchDirOf = (out: string): string => {
  const stripped = out.replace(/\.json$/i, "");
  return stripped === out ? `${out}-match` : stripped;
};

/** The seats a run plays through the Pi harness. */
const piSeats = (options: RunMatchOptions): PiSeat[] =>
  (["A", "B"] as const)
    .map((seat) => options.seats[seat])
    .flatMap((spec) => (spec.kind === "pi" ? [spec] : []));

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
  const timer = options.timer ?? ((): number => performance.now());
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const afterSubmissionMs = options.afterSubmissionMs ?? AFTER_SUBMISSION_MS;
  const matchDir = options.matchDir ?? matchDirOf(options.out);
  // The seats this run plays through the Pi harness: what decides whether the log
  // names a Pi build at all, and which budget its turns were played under.
  const pi = piSeats(options);

  const matches = new MatchServer(timer);
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
      player: playerFor(options.seats.A, {
        seat: "A",
        seed: options.seed,
        turns: config.turns,
        matchDir,
        connect: connectFor(options, matches, "A"),
      }),
      token: tokens.A,
      replacesConnection: options.seats.A.kind === "bot",
    },
    B: {
      player: playerFor(options.seats.B, {
        seat: "B",
        seed: options.seed,
        turns: config.turns,
        matchDir,
        connect: connectFor(options, matches, "B"),
      }),
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

  /**
   * One seat's turn, with the two rules only the runner can hold over it: the
   * turn's time limit, and the ten seconds a seat that has submitted but is still
   * running gets before it is aborted through its own `Player.abort`.
   */
  const playSeatOf = (seat: Seat, turn: number): Promise<SeatTurn> =>
    playSeat(seated[seat].player, turn, () => abortSeat(seat), {
      timeoutMs: turnTimeoutMs,
      afterSubmissionMs,
      hasSubmission: () => matches.status(matchId).submitted[seat],
      timer,
    });

  /**
   * The context window each seat's model was given, from Pi's own
   * `contextUsage`. The log's header records it for a Pi seat. A seat names its
   * own window as soon as it has started, and the turns below are the fallback
   * for a seat that could not say then, so a match in which no seat ever
   * settled a turn is still loggable.
   */
  const windows: Record<Seat, number | null> = { A: null, B: null };

  /** The seat as the log's header records it. */
  const headerFor = (seat: Seat): PlayerHeader => {
    const spec = options.seats[seat];
    if (spec.kind === "bot") return { kind: "bot", bot: spec.bot };
    const contextWindow = windows[seat];
    if (contextWindow === null) {
      // The format has no way to leave the window out, and guessing one would
      // put a number in a log that no seat ever ran with.
      throw new Error(
        `match ${matchId} cannot be logged: seat ${seat} played ${spec.model} without Pi ever reporting a context window`,
      );
    }
    return {
      kind: "pi",
      model: spec.model,
      thinking: spec.thinking,
      context_window: contextWindow,
    };
  };

  const turns: TurnRecord[] = [];
  let result: LogResult | null = null;
  try {
    await Promise.all([
      seated.A.player.start({ serverUrl, token: seated.A.token }),
      seated.B.player.start({ serverUrl, token: seated.B.token }),
    ]);

    // Each seat names the window its model is played with, which a Pi seat knows
    // from the moment its session is up and before a turn has been asked for it.
    // A bot runs no provider and names nothing; its header carries no window.
    for (const seat of ["A", "B"] as const) {
      windows[seat] = seated[seat].player.contextWindow?.() ?? null;
    }

    for (let turn = 1; turn <= config.turns && result === null; turn++) {
      matches.openTurn(matchId);
      const [playedA, playedB] = await Promise.all([playSeatOf("A", turn), playSeatOf("B", turn)]);
      for (const [seat, played] of [
        ["A", playedA],
        ["B", playedB],
      ] as const) {
        windows[seat] ??= played.outcome?.provider?.contextWindow ?? null;
      }
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
      // The Pi build the seats ran on, which is the one this repo pins and
      // `PiPlayer` spawns. A match of bots alone has no Pi in it.
      pi_version: pi.length === 0 ? null : piCli().version,
      context: "continuous",
      compaction: true,
      tool_call_cap: TOOL_CALL_LIMIT,
      simulate_cap: SIMULATE_LIMIT,
      resubmissions: RESUBMISSIONS,
      turn_timeout_s: Math.round(turnTimeoutMs / 1000),
      // The budget the seats were played with. Both seats of a measured match are
      // given the same one; the header has one field for it either way.
      output_token_budget: pi
        .map((spec) => spec.outputTokenBudget ?? null)
        .find((budget) => budget !== null) ?? null,
    },
    players: { A: headerFor("A"), B: headerFor("B") },
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
