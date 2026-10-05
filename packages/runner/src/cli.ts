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
 * The `no-dice` bin of this package points here. What stops a shell running it
 * today is not the types — Node 22.18 and later strip those — but the imports:
 * the workspace imports each other without extensions (`./args`, `./match`) and
 * `./match` reads the engine's `package.json`, neither of which a bare Node ESM
 * loader resolves. Running the command from a shell therefore needs a
 * TypeScript-aware runner, which is what the milestone that builds a `dist/`
 * will give it; the tests drive `runCli` directly, which is the same code.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { defaultOutName, parseArgs } from "./args";
import type { SeatArg } from "./args";
import { runMatch } from "./match";
import type { SeatSpec } from "./match";
import type { LogResult } from "./log";

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
 * A seat the runner can play. Nothing drives a model until milestone 03 lands
 * the Pi harness, and a seat given a model says so and stops: a missing feature
 * has to read as itself, not as a crash.
 */
const seatSpec = (flag: string, seat: SeatArg): SeatSpec | string =>
  seat.kind === "bot"
    ? { kind: "bot", bot: seat.bot }
    : `${flag} ${seat.provider}/${seat.model} needs the Pi harness, which lands in milestone 03; ` +
      "only bot:random and bot:greedy can play a seat for now";

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
  const seatA = seatSpec("--a", command.a);
  if (typeof seatA === "string") {
    stderr(`error: ${seatA}`);
    return 1;
  }
  const seatB = seatSpec("--b", command.b);
  if (typeof seatB === "string") {
    stderr(`error: ${seatB}`);
    return 1;
  }
  const seats: Record<"A" | "B", SeatSpec> = { A: seatA, B: seatB };

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

// The bin: run the command line this process was started with, and leave the
// exit code for the shell. Only when executed — importing `runCli` must not.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
