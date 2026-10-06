/**
 * The `no-dice` command line's argument parsing, kept apart from what it starts
 * so the CLI can grow around it: `match`, milestone 04's `series` beside it,
 * `stats`, which reports a series that has already been run, `evidence`, which
 * counts the rules' open questions over the same directory, and `showcase`,
 * which names the one match of that series worth rendering. Nothing here runs a
 * match or touches the filesystem — `argv` comes back either as what was asked
 * for or as one line naming exactly what is wrong with it, which is what the CLI
 * prints and exits non-zero on.
 *
 * A model seat parses here and is played by the Pi harness: `<provider>/
 * <model-id>` is the shape the runner seats a model with, and a provider with no
 * credential is reported by the runner in one line, not by the parser pretending
 * the shape is unknown.
 *
 * The three commands share one flag discipline, so it is written once: every
 * flag takes one value, a value that looks like another flag counts as missing,
 * a flag twice is a mistake, and a flag the command does not have is named. The
 * numbers are checked here rather than left for the runner, because a series is
 * a 48-hour commitment and `--max-pairs 75.5` has to fail before a match is
 * played, not in the middle of one.
 */
import { join } from "node:path";

import type { BotName } from "./match.ts";

/** The games v0 has. `--game` accepts only these until another game lands. */
export const GAMES = ["salient"] as const;
export type GameName = (typeof GAMES)[number];

/** The baseline bots a seat can be given, named as the log names them. */
export const BOTS = ["random", "greedy"] as const;

/** The commands v0 has. */
export const COMMANDS = ["match", "series", "stats", "evidence", "showcase"] as const;
export type CommandName = (typeof COMMANDS)[number];

/** The flags `match` takes. Anything else on its command line is a mistake. */
const MATCH_FLAGS = ["--game", "--a", "--b", "--seed", "--out"] as const;

/** The flags `match` cannot do without. */
const MATCH_REQUIRED = ["--game", "--a", "--b", "--seed"] as const;

/**
 * The flags `series` takes: `match`'s seats, brief §6.5's limits, and where the
 * series goes. `--name` and `--dir` are two ways of saying the same thing, so a
 * run that gives both is asked which one it meant.
 */
const SERIES_FLAGS = [
  "--game",
  "--a",
  "--b",
  "--max-pairs",
  "--max-cost",
  "--max-tokens",
  "--concurrency",
  "--seed-base",
  "--name",
  "--dir",
] as const;

/** The flags `series` cannot do without. Its limits all have defaults. */
const SERIES_REQUIRED = ["--game", "--a", "--b"] as const;

/** The flags `stats`, `evidence` and `showcase` take, and the one none can do without. */
const SERIES_DIR_FLAGS = ["--series"] as const;

/** One command: the flags it accepts and the ones it needs. */
interface CommandSpec {
  name: CommandName;
  flags: readonly string[];
  required: readonly string[];
}

/** The five commands, with their flags, so the flag rules are written once. */
const SPECS: readonly CommandSpec[] = [
  { name: "match", flags: MATCH_FLAGS, required: MATCH_REQUIRED },
  { name: "series", flags: SERIES_FLAGS, required: SERIES_REQUIRED },
  { name: "stats", flags: SERIES_DIR_FLAGS, required: SERIES_DIR_FLAGS },
  { name: "evidence", flags: SERIES_DIR_FLAGS, required: SERIES_DIR_FLAGS },
  { name: "showcase", flags: SERIES_DIR_FLAGS, required: SERIES_DIR_FLAGS },
];

/**
 * The seeds the engine can deal a map from: `mulberry32` takes its seed as `n |
 * 0`, so a number outside 32 bits would silently deal some other match than the
 * one that was asked for.
 */
const SEED_MIN = -2_147_483_648;
const SEED_MAX = 2_147_483_647;

/** A seat played by one of the baseline bots. */
export interface BotSeatArg {
  kind: "bot";
  bot: BotName;
}

/** A seat played by a model through Pi, named `<provider>/<id>` on the command line. */
export interface ModelSeatArg {
  kind: "model";
  provider: string;
  model: string;
}

/** Who a seat was given. */
export type SeatArg = BotSeatArg | ModelSeatArg;

/** What `no-dice match` asks for. */
export interface MatchCommand {
  name: "match";
  game: GameName;
  a: SeatArg;
  b: SeatArg;
  seed: number;
  /** Where the log goes, or `null` for the default under the current directory. */
  out: string | null;
}

/**
 * What `no-dice series` asks for. Every limit is `null` when the command line
 * left it out, and the runner's own default applies: brief §6.5's 75 pairs, its
 * concurrency of 1, and the seed base `planSeries` draws from. Naming the
 * defaults there rather than here keeps one number per limit — a CLI that
 * defaulted `--max-pairs` to something else would report a series that was never
 * asked for.
 */
export interface SeriesCommand {
  name: "series";
  game: GameName;
  a: SeatArg;
  b: SeatArg;
  /** `--max-pairs`: brief §6.5's pair limit, default 75. */
  maxPairs: number | null;
  /** `--max-cost <usd>`: the cost guard, and no ceiling by default. */
  maxCostUsd: number | null;
  /** `--max-tokens <n>`: the ceiling that binds on unpriced hardware. */
  maxTokens: number | null;
  /** `--concurrency <n>`: pairs in flight at once, default 1. */
  concurrency: number | null;
  /** `--seed-base <n>`: what the seed list is drawn from on its first run. */
  seedBase: number | null;
  /**
   * Where the series goes, relative to the current directory unless it was given
   * as an absolute path: `--dir`, or `series/<name>`, or the pairing's own
   * default.
   */
  dir: string;
}

/** What `no-dice stats` asks for: the series directory to report. */
export interface StatsCommand {
  name: "stats";
  series: string;
}

/**
 * What `no-dice evidence` asks for: the series directory whose rules evidence is
 * counted. The same directory `stats` reports, because the evidence is counted
 * out of the same match logs and has to leave out the same missing matches.
 */
export interface EvidenceCommand {
  name: "evidence";
  series: string;
}

/**
 * What `no-dice showcase` asks for: the series directory to pick a match from.
 * The same directory again — the choice is made from the matches `stats` counted
 * and `evidence` totalled, so all three name one set of matches.
 */
export interface ShowcaseCommand {
  name: "showcase";
  series: string;
}

/** Any command the parser recognised. */
export type AnyCommand =
  | MatchCommand
  | SeriesCommand
  | StatsCommand
  | EvidenceCommand
  | ShowcaseCommand;

/** The result of parsing: the command, or one line naming what is wrong. */
export type ParseResult = { ok: true; command: AnyCommand } | { ok: false; error: string };

/** `a`, `a and b`, `a, b and c` — the way an error has to read. */
const andList = (items: readonly string[]): string =>
  items.length === 1
    ? items[0]
    : `${items.slice(0, -1).join(", ")} and ${String(items.at(-1))}`;

/** The commands, named the way an error names them. */
const commandList = (): string => andList(COMMANDS.map((each) => `"${each}"`));

/** One seat spec: `bot:random`, `bot:greedy` or `<provider>/<model-id>`. */
const seatArg = (flag: string, spec: string): SeatArg | string => {
  if (spec.startsWith("bot:")) {
    const bot = spec.slice("bot:".length);
    return (BOTS as readonly string[]).includes(bot)
      ? { kind: "bot", bot: bot as BotName }
      : `${flag} names "${spec}", which is not one of ${andList(BOTS.map((each) => `bot:${each}`))}`;
  }
  const at = spec.indexOf("/");
  const provider = at === -1 ? "" : spec.slice(0, at);
  const model = at === -1 ? "" : spec.slice(at + 1);
  return provider === "" || model === ""
    ? `${flag} takes ${andList([`bot:${BOTS[0]}`, `bot:${BOTS[1]}`, "<provider>/<model-id>"])}, not "${spec}"`
    : { kind: "model", provider, model };
};

/** The game, which v0 only has one of. `null` for a game v0 does not have. */
const gameArg = (given: ReadonlyMap<string, string>): GameName | null => {
  const game = String(given.get("--game"));
  return (GAMES as readonly string[]).includes(game) ? (game as GameName) : null;
};

/** The line a game v0 does not have is reported with. */
const gameError = (given: ReadonlyMap<string, string>): string =>
  `--game accepts ${andList(GAMES)}, not "${String(given.get("--game"))}"`;

/** The two seats, in the order the command named them. */
const seatsArg = (
  given: ReadonlyMap<string, string>,
): { a: SeatArg; b: SeatArg } | string => {
  const a = seatArg("--a", String(given.get("--a")));
  if (typeof a === "string") return a;
  const b = seatArg("--b", String(given.get("--b")));
  return typeof b === "string" ? b : { a, b };
};

/** The seed: a whole number the engine can deal a map from. */
const seedArg = (raw: string): number | string => {
  if (!/^-?[0-9]+$/.test(raw)) return `--seed takes a whole number, not "${raw}"`;
  const seed = Number(raw);
  return seed < SEED_MIN || seed > SEED_MAX
    ? `--seed takes a whole number between ${String(SEED_MIN)} and ${String(SEED_MAX)}, not "${raw}"`
    : seed;
};

/** `--seed-base`: the same range, since it is what the seeds are drawn from. */
const seedBaseArg = (raw: string): number | string => {
  if (!/^-?[0-9]+$/.test(raw)) {
    return `--seed-base takes a whole number the engine can mix, not "${raw}"`;
  }
  const base = Number(raw);
  return base < SEED_MIN || base > SEED_MAX
    ? `--seed-base takes a whole number the engine can mix, between ${String(SEED_MIN)} and ` +
        `${String(SEED_MAX)}, not "${raw}"`
    : base;
};

/** A count of things to play: whole, and at least `minimum` of them. */
const countArg = (flag: string, raw: string, minimum: number): number | string => {
  if (!/^-?[0-9]+$/.test(raw)) {
    return `${flag} takes a whole number of ${String(minimum)} or more, not "${raw}"`;
  }
  const count = Number(raw);
  return count < minimum
    ? `${flag} takes a whole number of ${String(minimum)} or more, not "${raw}"`
    : count;
};

/** `--max-cost <usd>`: a money amount, and no ceiling at all if it is left out. */
const costArg = (raw: string): number | string => {
  if (!/^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/.test(raw) || !Number.isFinite(Number(raw))) {
    return `--max-cost takes a number of 0 or more, not "${raw}"`;
  }
  const cost = Number(raw);
  return cost < 0 ? `--max-cost takes a number of 0 or more, not "${raw}"` : cost;
};

/** A series directory name: one name, with no path in it. */
const isName = (raw: string): boolean =>
  raw !== "" && raw !== "." && raw !== ".." && !raw.includes("/") && !raw.includes("\\");

/**
 * Parse a `no-dice` command line. Flags each take one value; a value that looks
 * like another flag counts as missing, so a forgotten argument is reported as
 * missing rather than as a flag swallowed as a value.
 */
export function parseArgs(argv: readonly string[]): ParseResult {
  const [command, ...rest] = argv;
  if (command === undefined) {
    return { ok: false, error: `no command given; the commands are ${commandList()}` };
  }
  const spec = SPECS.find((each) => each.name === command);
  if (spec === undefined) {
    return { ok: false, error: `unknown command "${command}"; the commands are ${commandList()}` };
  }

  const given = readFlags(rest, spec);
  if (typeof given === "string") return { ok: false, error: given };

  if (spec.name === "stats") {
    return { ok: true, command: { name: "stats", series: String(given.get("--series")) } };
  }
  if (spec.name === "evidence") {
    return { ok: true, command: { name: "evidence", series: String(given.get("--series")) } };
  }
  if (spec.name === "showcase") {
    return { ok: true, command: { name: "showcase", series: String(given.get("--series")) } };
  }

  const game = gameArg(given);
  if (game === null) return { ok: false, error: gameError(given) };
  const seats = seatsArg(given);
  if (typeof seats === "string") return { ok: false, error: seats };

  if (spec.name === "match") {
    const seed = seedArg(String(given.get("--seed")));
    if (typeof seed === "string") return { ok: false, error: seed };
    return {
      ok: true,
      command: {
        name: "match",
        game,
        a: seats.a,
        b: seats.b,
        seed,
        out: given.get("--out") ?? null,
      },
    };
  }

  return parseSeries(game, seats.a, seats.b, given);
}

/**
 * Read a command's flags: one value each, none of them twice, none of them
 * missing, and nothing that is not one of its flags.
 */
const readFlags = (rest: readonly string[], spec: CommandSpec): Map<string, string> | string => {
  const given = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flag.startsWith("-")) {
      return `unexpected argument "${flag}"; "${spec.name}" takes no arguments of its own`;
    }
    if (!spec.flags.includes(flag)) {
      return `unknown flag "${flag}"; "${spec.name}" takes ${spec.flags.join(", ")}`;
    }
    if (given.has(flag)) return `${flag} given twice`;
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return `${flag} needs a value`;
    }
    given.set(flag, value);
    i++;
  }

  const missing = spec.required.filter((flag) => !given.has(flag));
  if (missing.length > 0) {
    return `${andList(missing)} ${missing.length === 1 ? "is" : "are"} required`;
  }
  return given;
};

/** Where a series goes when the command line did not say. */
const defaultDirOf = (a: SeatArg, b: SeatArg): string =>
  join("series", `${seatSlug(a)}-vs-${seatSlug(b)}`);

/** `series`'s limits and its directory, once the seats and the game are known. */
const parseSeries = (
  game: GameName,
  a: SeatArg,
  b: SeatArg,
  given: ReadonlyMap<string, string>,
): ParseResult => {
  const maxPairs = given.has("--max-pairs")
    ? countArg("--max-pairs", String(given.get("--max-pairs")), 1)
    : null;
  if (typeof maxPairs === "string") return { ok: false, error: maxPairs };
  const maxCostUsd = given.has("--max-cost")
    ? costArg(String(given.get("--max-cost")))
    : null;
  if (typeof maxCostUsd === "string") return { ok: false, error: maxCostUsd };
  const maxTokens = given.has("--max-tokens")
    ? countArg("--max-tokens", String(given.get("--max-tokens")), 0)
    : null;
  if (typeof maxTokens === "string") return { ok: false, error: maxTokens };
  const concurrency = given.has("--concurrency")
    ? countArg("--concurrency", String(given.get("--concurrency")), 1)
    : null;
  if (typeof concurrency === "string") return { ok: false, error: concurrency };
  const seedBase = given.has("--seed-base")
    ? seedBaseArg(String(given.get("--seed-base")))
    : null;
  if (typeof seedBase === "string") return { ok: false, error: seedBase };

  const named = given.has("--name");
  const placed = given.has("--dir");
  if (named && placed) {
    return { ok: false, error: "--name and --dir name the same series; give one, not both" };
  }
  let dir = defaultDirOf(a, b);
  if (named) {
    const name = String(given.get("--name"));
    if (!isName(name)) {
      return { ok: false, error: `--name takes one directory name, not "${name}"` };
    }
    dir = join("series", name);
  } else if (placed) {
    dir = String(given.get("--dir"));
    if (dir === "") return { ok: false, error: "--dir needs a value" };
  }

  return {
    ok: true,
    command: {
      name: "series",
      game,
      a,
      b,
      maxPairs,
      maxCostUsd,
      maxTokens,
      concurrency,
      seedBase,
      dir,
    },
  };
}

/**
 * How one seat is spelled in the default log path. A model's `<provider>/
 * <model-id>` keeps its meaning with the slash gone, and anything else that
 * would not survive a filesystem is folded to a dash.
 */
export const seatSlug = (seat: SeatArg): string =>
  (seat.kind === "bot" ? seat.bot : `${seat.provider}-${seat.model}`).replace(
    /[^A-Za-z0-9._-]+/g,
    "-",
  );

/**
 * The default log path for a match, relative to the current directory: brief
 * §6.5's `<seed>-<seat-map>.json` naming, with the two seats in place of the map.
 */
export const defaultOutName = (command: MatchCommand): string =>
  join("matches", `${String(command.seed)}-${seatSlug(command.a)}-${seatSlug(command.b)}.json`);
