/**
 * The `no-dice` command line's argument parsing, kept apart from what it starts
 * so the CLI can grow around it: milestone 03 adds a `series` subcommand beside
 * `match`, and milestone 04 adds the series flags beside these ones. Nothing
 * here runs a match or touches the filesystem — `argv` comes back either as what
 * was asked for or as one line naming exactly what is wrong with it, which is
 * what the CLI prints and exits non-zero on.
 *
 * A model seat parses here even though nothing can play one yet: `<provider>/
 * <model-id>` is well-formed, and it is the harness that is missing, so the CLI
 * says so rather than the parser pretending the shape is unknown.
 */
import { join } from "node:path";

import type { BotName } from "./match.ts";

/** The games v0 has. `--game` accepts only these until another game lands. */
export const GAMES = ["salient"] as const;
export type GameName = (typeof GAMES)[number];

/** The baseline bots a seat can be given, named as the log names them. */
export const BOTS = ["random", "greedy"] as const;

/** The flags `match` takes. Anything else on its command line is a mistake. */
const MATCH_FLAGS = ["--game", "--a", "--b", "--seed", "--out"] as const;

/** The flags `match` cannot do without. */
const REQUIRED = ["--game", "--a", "--b", "--seed"] as const;

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

/** A seat played by a model through Pi. Refused by the CLI until milestone 03. */
export interface ModelSeatArg {
  kind: "model";
  provider: string;
  model: string;
}

/** Who a seat was given. */
export type SeatArg = BotSeatArg | ModelSeatArg;

/** What `no-dice match` asks for. */
export interface MatchCommand {
  game: GameName;
  a: SeatArg;
  b: SeatArg;
  seed: number;
  /** Where the log goes, or `null` for the default under the current directory. */
  out: string | null;
}

/** The result of parsing: the command, or one line naming what is wrong. */
export type ParseResult =
  | { ok: true; command: MatchCommand }
  | { ok: false; error: string };

/** `a`, `a and b`, `a, b and c` — the way an error has to read. */
const andList = (items: readonly string[]): string =>
  items.length === 1
    ? items[0]
    : `${items.slice(0, -1).join(", ")} and ${String(items.at(-1))}`;

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

/** The seed: a whole number the engine can deal a map from. */
const seedArg = (raw: string): number | string => {
  if (!/^-?[0-9]+$/.test(raw)) return `--seed takes a whole number, not "${raw}"`;
  const seed = Number(raw);
  return seed < SEED_MIN || seed > SEED_MAX
    ? `--seed takes a whole number between ${String(SEED_MIN)} and ${String(SEED_MAX)}, not "${raw}"`
    : seed;
};

/**
 * Parse a `no-dice` command line. Flags each take one value; a value that looks
 * like another flag counts as missing, so a forgotten argument is reported as
 * missing rather than as a flag swallowed as a value.
 */
export function parseArgs(argv: readonly string[]): ParseResult {
  const [command, ...rest] = argv;
  if (command === undefined) {
    return { ok: false, error: 'no command given; the only command so far is "match"' };
  }
  if (command !== "match") {
    return { ok: false, error: `unknown command "${command}"; the only command so far is "match"` };
  }

  const given = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flag.startsWith("-")) {
      return { ok: false, error: `unexpected argument "${flag}"; "match" takes no arguments of its own` };
    }
    if (!(MATCH_FLAGS as readonly string[]).includes(flag)) {
      return { ok: false, error: `unknown flag "${flag}"; "match" takes ${MATCH_FLAGS.join(", ")}` };
    }
    if (given.has(flag)) return { ok: false, error: `${flag} given twice` };
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return { ok: false, error: `${flag} needs a value` };
    }
    given.set(flag, value);
    i++;
  }

  const missing = (REQUIRED as readonly string[]).filter((flag) => !given.has(flag));
  if (missing.length > 0) {
    return { ok: false, error: `${andList(missing)} ${missing.length === 1 ? "is" : "are"} required` };
  }

  const game = String(given.get("--game"));
  if (!(GAMES as readonly string[]).includes(game)) {
    return { ok: false, error: `--game accepts ${andList(GAMES)}, not "${game}"` };
  }

  const a = seatArg("--a", String(given.get("--a")));
  if (typeof a === "string") return { ok: false, error: a };
  const b = seatArg("--b", String(given.get("--b")));
  if (typeof b === "string") return { ok: false, error: b };
  const seed = seedArg(String(given.get("--seed")));
  if (typeof seed === "string") return { ok: false, error: seed };

  return {
    ok: true,
    command: { game: game as GameName, a, b, seed, out: given.get("--out") ?? null },
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
