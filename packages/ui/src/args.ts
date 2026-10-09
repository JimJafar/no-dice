/**
 * The console's own command line: `--port`, `--series-root`, `--matches-root`,
 * `--reports-root`, `--providers`.
 *
 * This is a separate parser from `@no-dice/runner/args` on purpose. That one
 * parses the command lines that play a match, and it stays the one authority on
 * what a run may ask for: a run started from the page is handed to `parseArgs`
 * there, so the console cannot start a run the terminal would refuse. What is
 * parsed here only says where a server listens and which directories it reads
 * and writes.
 *
 * **The host is not a flag.** The console is one user on one machine, with no
 * auth and no HTTPS, so `server.ts` binds `127.0.0.1` and nothing else. A
 * `--host` here would be an invitation to expose an unauthenticated run starter
 * on a network.
 *
 * Nothing here touches the filesystem: the roots and the registry come back as
 * they were given, and the server resolves them against its own current
 * directory, which is the repo root for anyone who starts it the way the
 * README says to. The one default that is not a relative path is the registry's,
 * which is taken from the runner — the same constant the runner reads, so the
 * file the page writes is the file a terminal run seats on by default.
 */
import { PROVIDERS_FILE } from "@no-dice/runner/providers";

/** The port the console listens on when the command line does not say. */
export const DEFAULT_PORT = 8765;

/** Where series go when the command line does not say — the runner's own default. */
export const DEFAULT_SERIES_ROOT = "series";

/** Where single match logs go when the command line does not say — also the runner's. */
export const DEFAULT_MATCHES_ROOT = "matches";

/**
 * Where the kept copies of a finished series' report and rules evidence go when
 * the command line does not say — the directory `docs/series-notes.md` §7
 * copies them into by hand, and the only place they outlive the gitignored
 * `series/` directory a run is played in.
 */
export const DEFAULT_REPORTS_ROOT = "reports/series";

/** The flags this command line takes, and no others. */
const FLAGS = ["--port", "--series-root", "--matches-root", "--reports-root", "--providers"] as const;

/** Where the console listens and what it reads, as the command line gave them. */
export interface UiFlags {
  /** The TCP port. `0` asks the operating system for a free one. */
  port: number;
  /** The series root, relative to the current directory unless it is absolute. */
  seriesRoot: string;
  /** The finished-match root, resolved the same way. */
  matchesRoot: string;
  /**
   * The root the kept report and rules evidence of every finished series are
   * served from, resolved the same way. A third root rather than a third look
   * at the first two: the copies live outside `series/` precisely so that a
   * workspace being deleted does not take them.
   */
  reportsRoot: string;
  /**
   * The provider registry the console lists, adds to and seats runs on, resolved
   * the same way. It defaults to the runner's own, because a console writing a
   * registry the runner never reads would be a console lying about what a run
   * was seated on.
   */
  providersFile: string;
}

/** Parsing the console's command line: the flags, or one line naming what is wrong. */
export type UiFlagsResult = { ok: true; flags: UiFlags } | { ok: false; error: string };

/** The line a mistake at the terminal is answered with. */
export const USAGE =
  "usage: no-dice-ui [--port <n>] [--series-root <dir>] [--matches-root <dir>] " +
  "[--reports-root <dir>] [--providers <file>]";

/** A port the operating system will hear: `0` means any free one. */
const portArg = (raw: string): number | string => {
  if (!/^-?[0-9]+$/.test(raw)) return `--port takes a whole number, not "${raw}"`;
  const port = Number(raw);
  return port < 0 || port > 65_535
    ? `--port takes a whole number between 0 and 65535, not "${raw}"`
    : port;
};

/** A directory to read: named, and not named as nothing. */
const dirArg = (flag: string, raw: string): string | null =>
  raw === "" ? `${flag} needs a directory` : null;

/** A file to read and write: named, and not named as nothing. */
const fileArg = (flag: string, raw: string): string | null =>
  raw === "" ? `${flag} needs a file` : null;

/**
 * Read the console's flags: one value each, none of them twice, and nothing
 * that is not one of them — the same discipline `args.ts` in the runner holds
 * its commands to, so a typo is named rather than listened for.
 */
export function parseUiFlags(argv: readonly string[]): UiFlagsResult {
  const given = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("-")) {
      return { ok: false, error: `unexpected argument "${flag}"; "no-dice-ui" takes no arguments of its own` };
    }
    if (!(FLAGS as readonly string[]).includes(flag)) {
      return { ok: false, error: `unknown flag "${flag}"; "no-dice-ui" takes ${FLAGS.join(", ")}` };
    }
    if (given.has(flag)) return { ok: false, error: `${flag} given twice` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value` };
    given.set(flag, value);
    i++;
  }

  const rawPort = given.get("--port") ?? String(DEFAULT_PORT);
  const port = portArg(rawPort);
  if (typeof port === "string") return { ok: false, error: port };

  const seriesRoot = given.get("--series-root") ?? DEFAULT_SERIES_ROOT;
  const matchesRoot = given.get("--matches-root") ?? DEFAULT_MATCHES_ROOT;
  const reportsRoot = given.get("--reports-root") ?? DEFAULT_REPORTS_ROOT;
  for (const [flag, value] of [
    ["--series-root", seriesRoot],
    ["--matches-root", matchesRoot],
    ["--reports-root", reportsRoot],
  ] as const) {
    const problem = dirArg(flag, value);
    if (problem !== null) return { ok: false, error: problem };
  }

  const providersFile = given.get("--providers") ?? PROVIDERS_FILE;
  const registryProblem = fileArg("--providers", providersFile);
  if (registryProblem !== null) return { ok: false, error: registryProblem };

  return { ok: true, flags: { port, seriesRoot, matchesRoot, reportsRoot, providersFile } };
}
