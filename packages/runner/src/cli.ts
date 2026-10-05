#!/usr/bin/env node
/**
 * The `no-dice` command line: brief §1's `no-dice match`, from the flags to one
 * log file on disk.
 *
 * `runCli` is the whole command, and it returns its exit code rather than
 * calling `process.exit`, so a test can drive a real run and read what it
 * printed. The file is also the `no-dice` bin of this package, and runs itself
 * when it is executed rather than imported.
 *
 * Parsing lives in `./args`, and this file only starts the match and reports:
 * the path of the log, then one line saying how the match ended. Every failure
 * is one line that names what is wrong, because a run that took a minute to
 * reach its argument should not have to be guessed at.
 *
 * The `no-dice` bin of this package points here, and a shell can run it as it
 * stands: Node 22.18 and later strip the types themselves, and every import in
 * the workspace names its file (`./args.ts`, `./match.ts`, the engine's
 * `package.json` read with `with { type: "json" }`), which is what a bare Node
 * ESM loader resolves and an extensionless one does not. `tsconfig.base.json`
 * allows those specifiers through `allowImportingTsExtensions`, and nothing
 * builds a `dist/` in order to run a match.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import type { PiThinkingLevel } from "@no-dice/harness";
import type { LogResult } from "@no-dice/log";

import { defaultOutName, parseArgs } from "./args.ts";
import type { SeatArg } from "./args.ts";
import { runMatch } from "./match.ts";
import type { SeatSpec } from "./match.ts";

/** Where a run reports, injectable so a test can read it instead of a terminal. */
export interface CliIo {
  /** One line of normal output. Defaults to stdout. */
  stdout?: (line: string) => void;
  /** One line of the problem. Defaults to stderr. */
  stderr?: (line: string) => void;
  /** What a relative `--out`, and the default path, are taken relative to. */
  cwd?: string;
}

/** What a run prints when its command line did not parse. */
const USAGE = "usage: no-dice match --game salient --a <spec> --b <spec> --seed <n> [--out <path>]";

/** How the match ended, in the one line a run prints: type, winner, score. */
const resultLine = (result: LogResult): string =>
  `${result.type}: ${result.winner === null ? "draw" : `seat ${result.winner} wins`}, ` +
  `A ${String(result.score.A)} - B ${String(result.score.B)}`;

/**
 * The reasoning level a model seat is played at. It is a measured variable, and
 * no flag chooses it yet, so every model seat of a run plays at Pi's own default
 * startup level — and the log's header records which level that was.
 */
const DEFAULT_THINKING: PiThinkingLevel = "medium";

/**
 * A seat the runner can play: a baseline bot, or a model through the Pi harness.
 * A model seat needs a credential for its provider, and the run says so in one
 * line before a turn is played if it has none; the seat itself is built by the
 * runner, which is where a seat's home and its model's `models.json` are known.
 */
const seatSpec = (seat: SeatArg): SeatSpec =>
  seat.kind === "bot"
    ? { kind: "bot", bot: seat.bot }
    : { kind: "pi", model: `${seat.provider}/${seat.model}`, thinking: DEFAULT_THINKING };

/**
 * Run one `no-dice` command line and report on it. Zero for a match that was
 * played and written, one for anything else, with the reason on stderr.
 */
export async function runCli(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((line: string): void => void console.log(line));
  const stderr = io.stderr ?? ((line: string): void => void console.error(line));
  const cwd = io.cwd ?? process.cwd();

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr(`error: ${parsed.error}`);
    stderr(USAGE);
    return 1;
  }

  const { command } = parsed;
  const seats: Record<"A" | "B", SeatSpec> = { A: seatSpec(command.a), B: seatSpec(command.b) };

  const out = command.out === null ? resolve(cwd, defaultOutName(command)) : resolve(cwd, command.out);

  try {
    const { path, log } = await runMatch({ out, seed: command.seed, seats });
    stdout(path);
    stdout(resultLine(log.result));
    return 0;
  } catch (error) {
    stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** The real path of the file this process was started on, or `null` when it is not there. */
const realpathOf = (path: string | undefined): string | null => {
  if (path === undefined) return null;
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

// The bin: run the command line this process was started with, and leave the
// exit code for the shell. Only when executed — importing `runCli` must not.
//
// Both sides are compared after resolving symlinks. A package bin is started
// through the shim in `node_modules/.bin`, whose path to this file runs through
// a symlinked package directory, while Node loads the module it was given at its
// real path — so the two name one file by different routes, and comparing them
// as written leaves a run from a shell doing nothing at all.
const invoked = realpathOf(process.argv[1]);
if (invoked !== null && import.meta.url === pathToFileURL(invoked).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
