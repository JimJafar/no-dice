#!/usr/bin/env node
/**
 * The `no-dice` command line: brief §1's `no-dice match`, its `no-dice series`
 * beside that, `no-dice stats` for a series that has already been run,
 * `no-dice evidence`, which counts the rules' open questions over the same
 * series directory, and `no-dice showcase`, which names the one match of that
 * series worth rendering and writes the sidecar the viewer is pointed at.
 *
 * `runCli` is the whole command, and it returns its exit code rather than
 * calling `process.exit`, so a test can drive a real run and read what it
 * printed. The file is also the `no-dice` bin of this package, and runs itself
 * when it is executed rather than imported.
 *
 * Parsing lives in `./args`, and this file only starts the work and reports: the
 * path of the log, then one line saying how the match ended. Every failure is
 * one line that names what is wrong, because a run that took a minute to reach
 * its argument should not have to be guessed at.
 *
 * A series reports as it goes rather than at the end. Brief §6.5's default is
 * 150 matches and `docs/pi-harness-notes.md` §7 measured one model match at
 * nineteen minutes, so an operator watching a two-day run needs one line per
 * pair — the seed, the seats, how that pair went, and the win rate and its 95%
 * interval so far — and then the stop reason, the final figures, and where
 * `series.json` and `report.md` are. Those last figures come out of the same
 * `seriesReport` the `stats` command prints, so the terminal and the markdown
 * cannot disagree.
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

import { checkPiAuth } from "@no-dice/harness";
import type { LogResult, Seat } from "@no-dice/log";
import { renderSeriesReport } from "@no-dice/stats/series-report";
import { renderSeriesEvidence } from "@no-dice/stats/rules-evidence";
import { writeSeriesShowcase } from "@no-dice/stats/showcase";
import { outcomeOf, wilsonInterval, winRateOf, zOf } from "@no-dice/stats/wilson";
import type { Outcome, WilsonInterval, WinRate } from "@no-dice/stats/wilson";

import { defaultOutName, parseArgs } from "./args.ts";
import type { EvidenceCommand, MatchCommand, SeatArg, SeriesCommand, ShowcaseCommand, StatsCommand } from "./args.ts";
import { runMatch, seatSpec } from "./match.ts";
import type { SeatSpec } from "./match.ts";
import { seatModelsJson } from "./providers.ts";
import { runSeries } from "./series.ts";
import type { SeriesMatchRecord, SeriesPairRecord } from "./series.ts";

/** Where a run reports, injectable so a test can read it instead of a terminal. */
export interface CliIo {
  /** One line of normal output. Defaults to stdout. */
  stdout?: (line: string) => void;
  /** One line of the problem. Defaults to stderr. */
  stderr?: (line: string) => void;
  /** What a relative `--out`, `--dir` or `--series` is taken relative to. */
  cwd?: string;
}

/** One line per command, so a mistake at the terminal is told how to be right. */
const USAGE = [
  "usage: no-dice match --game salient --a <spec> --b <spec> --seed <n> [--out <path>]",
  "usage: no-dice series --game salient --a <spec> --b <spec> [--max-pairs <n>] [--max-cost <usd>]" +
    " [--max-tokens <n>] [--concurrency <n>] [--seed-base <n>] [--name <name> | --dir <path>]",
  "usage: no-dice stats --series <dir>",
  "usage: no-dice evidence --series <dir>",
  "usage: no-dice showcase --series <dir>",
];

/** How the match ended, in the one line a run prints: type, winner, score. */
const resultLine = (result: LogResult): string =>
  `${result.type}: ${result.winner === null ? "draw" : `seat ${result.winner} wins`}, ` +
  `A ${String(result.score.A)} - B ${String(result.score.B)}`;

/** A rate as a report writes it. */
const percent = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A seat as the command line named it, which is what the operator typed. */
const seatLabel = (seat: SeatArg): string =>
  seat.kind === "bot" ? `bot:${seat.bot}` : `${seat.provider}/${seat.model}`;

/**
 * Run one `no-dice` command line and report on it. Zero for a match or a series
 * that was played and written, one for anything else, with the reason on stderr.
 */
export async function runCli(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? ((line: string): void => void console.log(line));
  const stderr = io.stderr ?? ((line: string): void => void console.error(line));
  const cwd = io.cwd ?? process.cwd();

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr(`error: ${parsed.error}`);
    for (const line of USAGE) stderr(line);
    return 1;
  }

  const { command } = parsed;
  if (command.name === "match") return runMatchCommand(command, cwd, stdout, stderr);
  if (command.name === "series") return runSeriesCommand(command, cwd, stdout, stderr);
  if (command.name === "stats") return runStatsCommand(command, cwd, stdout, stderr);
  if (command.name === "evidence") return runEvidenceCommand(command, cwd, stdout, stderr);
  return runShowcaseCommand(command, cwd, stdout, stderr);
}

/** One `no-dice match`: the match, then where its log is and how it ended. */
const runMatchCommand = async (
  command: MatchCommand,
  cwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> => {
  const seats: Record<"A" | "B", SeatSpec> = { A: seatSpec(command.a), B: seatSpec(command.b) };
  const out =
    command.out === null ? resolve(cwd, defaultOutName(command)) : resolve(cwd, command.out);

  try {
    const { path, log } = await runMatch({ out, seed: command.seed, seats });
    stdout(path);
    stdout(resultLine(log.result));
    return 0;
  } catch (error) {
    stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

/**
 * Whether every model seat of a pairing has a credential, asked before the first
 * match is played — as `match` reports one, and asked here rather than left to
 * the first match: a series is up to 150 of them, and each would fail the same
 * way and be recorded as a failed match instead of a run that never started.
 */
const seatsHaveCredentials = async (
  command: SeriesCommand,
  stderr: (line: string) => void,
): Promise<boolean> => {
  for (const [seat, given] of [
    ["A", command.a],
    ["B", command.b],
  ] as const) {
    if (given.kind !== "model") continue;
    const model = `${given.provider}/${given.model}`;
    // A provider the registry names is checked with the `models.json` its seat
    // will be given, since the seat home that would otherwise hold it is made per
    // match and a series is asked before its first one exists. A provider the
    // registry does not name is checked against the operator's own Pi config,
    // which is how a built-in provider's exported key has always been found.
    const auth = await checkPiAuth({ model, modelsJson: seatModelsJson(model) ?? undefined });
    if (!auth.ok) {
      stderr(`error: seat ${seat}: ${auth.message}`);
      return false;
    }
  }
  return true;
};

/** One match of a pair, as it ended: who won, by how much, and how it ended. */
const matchWord = (match: SeriesMatchRecord): string => {
  if (match.status === "failed") return `failed: ${match.error}`;
  const { type, winner, margin } = match.result;
  return winner === null
    ? `draw (${type})`
    : `seat ${winner} wins by ${String(margin)} (${type})`;
};

/**
 * The two seats of one match of a pair, as the board saw them. A mirrored
 * pairing — one bot in both seats — reads the same in both seat
 * orders, so its matches are told apart by the seat the pairing's first seat
 * plays, which is the letter its log name ends in (`matchOf` in `./series-plan.ts`).
 */
const seatMapWord = (x: string, opponent: string, seat: Seat): string =>
  x === opponent
    ? `${x} in A, ${opponent} in B (${x} in seat ${seat})`
    : seat === "A"
      ? `${x} in A, ${opponent} in B`
      : `${opponent} in A, ${x} in B`;

/**
 * One pair as it finished: the seed, both seat orders, both results, and the
 * win rate and 95% interval the series has reached so far. That last part is
 * what makes a two-day run watchable — the point of watching is knowing where
 * the series stands, not that it is still alive.
 */
const pairLine = (
  pair: SeriesPairRecord,
  x: string,
  opponent: string,
  rate: WinRate,
  interval: WilsonInterval | null,
): string => {
  const matches = pair.matches
    .map((match) => `${seatMapWord(x, opponent, match.seat)} — ${matchWord(match)}`)
    .join(" | ");
  const standing =
    rate.rate === null || interval === null
      ? "no match counted yet"
      : `${x} win rate ${percent(rate.rate)} (95% ${percent(interval.low)} – ${percent(interval.high)}) ` +
        `over ${String(rate.n)} matches`;
  return `seed ${String(pair.seed)}: ${matches} | ${standing}`;
};

/**
 * One `no-dice series`: plan it, play what is missing, report every pair as it
 * goes, and finish with the stop reason, the win rate and its 95% interval, and
 * the paths of `series.json` and `report.md`.
 */
const runSeriesCommand = async (
  command: SeriesCommand,
  cwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> => {
  const dir = resolve(cwd, command.dir);
  if (!(await seatsHaveCredentials(command, stderr))) return 1;

  const x = seatLabel(command.a);
  const opponent = seatLabel(command.b);

  // The outcomes this run has seen, which is what the progress line's running
  // rate is taken over. A resumed series starts this list again from nothing,
  // and the final figures below do not: they come from the report, which counts
  // every match on disk.
  const outcomes: Outcome[] = [];
  const onPair = (pair: SeriesPairRecord): void => {
    for (const match of pair.matches) {
      if (match.status === "played") outcomes.push(outcomeOf(match.result, match.seat));
    }
    const rate = winRateOf(outcomes);
    const interval =
      rate.n === 0
        ? null
        : wilsonInterval({ successes: rate.successes, n: rate.n, z: zOf(0.95) });
    stdout(pairLine(pair, x, opponent, rate, interval));
  };

  try {
    stdout(`series: ${dir}`);
    const run = await runSeries({
      dir,
      a: command.a,
      b: command.b,
      onPair,
      ...(command.maxPairs === null ? {} : { maxPairs: command.maxPairs }),
      ...(command.maxCostUsd === null ? {} : { maxCostUsd: command.maxCostUsd }),
      ...(command.maxTokens === null ? {} : { maxTokens: command.maxTokens }),
      ...(command.concurrency === null ? {} : { concurrency: command.concurrency }),
      ...(command.seedBase === null ? {} : { seedBase: command.seedBase }),
    });

    // The report is written here as well as printed by `stats`, so a finished
    // series leaves its markdown beside its record whether or not anyone asks
    // for it again — and the figures on this terminal are the ones in that file.
    const { report, path } = await renderSeriesReport(dir);

    const state = run.record.state;
    stdout(
      `stopped on ${report.stop.reason} — ` +
        `${report.stop.stoppedEarly ? "short of its pair limit" : "its full length"}: ` +
        `${String(state.pairs_played)} pairs, ${String(state.matches_played)} matches played, ` +
        `${String(state.matches_failed)} failed (this run played ${String(run.played)}, ` +
        `skipped ${String(run.skipped)}, failed ${String(run.failed)})`,
    );

    const rate = report.result.winRate;
    const interval = report.result.interval;
    stdout(
      `${report.xLabel} win rate ` +
        `${rate.rate === null || interval === null ? "—" : `${percent(rate.rate)} (95% ${percent(interval.low)} – ${percent(interval.high)})`} ` +
        `over ${String(rate.n)} matches — ${String(rate.wins)} wins, ${String(rate.losses)} losses, ` +
        `${String(rate.draws)} draws, ${String(report.missing.total)} missing`,
    );
    stdout(`series.json: ${run.recordPath}`);
    stdout(`report.md: ${path}`);
    return 0;
  } catch (error) {
    stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

/** One `no-dice stats`: the report for a series directory, on the terminal. */
const runStatsCommand = async (
  command: StatsCommand,
  cwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> => {
  try {
    const { markdown, path } = await renderSeriesReport(resolve(cwd, command.series));
    stdout(`report: ${path}`);
    for (const line of markdown.replace(/\n+$/, "").split("\n")) stdout(line);
    return 0;
  } catch (error) {
    stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

/**
 * One `no-dice evidence`: the rules' open questions counted over a series, on the
 * terminal and in `<dir>/evidence.md`. It reads the same `series.json` `stats`
 * reads and leaves out the same missing matches, so the two files cannot report
 * different sets of matches.
 */
const runEvidenceCommand = async (
  command: EvidenceCommand,
  cwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> => {
  try {
    const { markdown, path } = await renderSeriesEvidence(resolve(cwd, command.series));
    stdout(`evidence: ${path}`);
    for (const line of markdown.replace(/\n+$/, "").split("\n")) stdout(line);
    return 0;
  } catch (error) {
    stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

/**
 * One `no-dice showcase`: the match of a series worth rendering, printed and
 * written to `<dir>/showcase.json`.
 *
 * The file carries the path of the log rather than a copy of it, which is what
 * lets the viewer be pointed straight at the series' own match, and the series
 * line the header shows beside it. It is written from the series alone — no
 * clock, no random draw — so running the command twice on an unchanged series
 * leaves the same bytes, and an operator can re-run it after a resumed series
 * without wondering what moved.
 */
const runShowcaseCommand = async (
  command: ShowcaseCommand,
  cwd: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> => {
  try {
    const { showcase, path } = await writeSeriesShowcase(resolve(cwd, command.series));
    stdout(`showcase: ${path}`);
    stdout(showcase.seriesLine);
    stdout(showcase.selection.note);
    if (showcase.match === null) {
      stdout("no match to render: the series counted none");
      return 0;
    }
    const { excitement } = showcase.match;
    stdout(`chosen: ${showcase.match.path}`);
    stdout(
      `excitement ${String(excitement.score)} — ${String(excitement.leadChanges)} lead changes, ` +
        `largest swing ${String(excitement.largestSwing)}, final lead change ` +
        `${excitement.finalChangeTurn === 0 ? "none" : `turn ${String(excitement.finalChangeTurn)}`}` +
        ` (margin ${String(showcase.match.margin)})`,
    );
    return 0;
  } catch (error) {
    stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

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
