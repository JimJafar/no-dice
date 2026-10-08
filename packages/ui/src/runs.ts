/**
 * The run slot: the one run a console has in flight, played in this process.
 *
 * **One at a time, and no queue.** `--concurrency` already bounds *pairs* inside
 * a run, and no provider's rate limit has been measured
 * (`docs/pi-harness-notes.md` §7 measured one model match at nineteen minutes
 * and 4.59M tokens), so a second start while one is in flight is refused with
 * one line naming the run that is running. A queue would be a second feature
 * nobody asked for, and a run that waits silently behind a 48-hour series is
 * worse than one that is refused out loud.
 *
 * The run is played through the runner's own seams rather than by shelling out.
 * The form's payload becomes a `no-dice` argv, that argv goes to `parseArgs`
 * before anything is started, and then to `runCli`, whose `stdout` and `stderr`
 * push every line into the run's buffer. So the pair lines the page shows are
 * the very lines the terminal prints — `runCli` already drives `runSeries`'s
 * `onPair` callback, and nothing here re-implements `pairLine` — and there is no
 * child `no-dice` process to keep, kill or parse.
 *
 * Parsing is asked *before* the slot is. A payload the CLI would refuse is
 * therefore refused in the CLI's own wording even while another run is in
 * flight: whoever typed `--max-pairs 75.5` is told about their own typo rather
 * than about a run they were not asking about, and nothing is started either
 * way. That is also why there is no second validator here: every limit, seat
 * spec and name the form can send goes through `parseArgs`, and what the page
 * can ask for is what the terminal accepts.
 *
 * **The snapshot is asked for, not kept.** Its lines are what the run has
 * printed so far, and its counters are read out of the series' own `series.json`
 * at the moment the page asked (`./progress.ts`) rather than remembered from an
 * earlier one. That is what lets a page polling once a second watch the pair lines
 * move per pair and the counters move at the batch boundaries the runner writes
 * at, and it is why a run that has finished still answers with its last lines and
 * its final figures instead of being cleared.
 *
 * **Two paths are the slot's to fix, not the CLI's to default.** A run started
 * at the terminal puts its output under the current directory; a run
 * started from the page has to put it under the roots the server was given, or
 * the results page would list directories that run does not touch. So a series
 * is given `--dir <seriesRoot>/<name>` as an absolute path — the name the form
 * gave checked to be one path segment, and `<a>-vs-<b>` built with `seatSlug`
 * when it left the name blank — and a match with no path of its own is given
 * `--out` built from `defaultOutName` under the server's `--matches-root`. The
 * path the snapshot names is the path the run really wrote, because it is the
 * path the run was told to write.
 *
 * The run is a promise in this process, and that is its whole lifetime.
 * Nothing here watches the HTTP connection a start arrived on, so closing the
 * page — or the client that posted — changes nothing; closing the *server* ends
 * the process, and the run with it. A series left half played is left on disk
 * half played, which is what the resume half of this milestone starts from.
 *
 * **A resume names a directory, not a run.** `POST /api/run/resume` carries the
 * series directory and nothing else about the pairing: the seats and the pair
 * limit come back out of that directory's own `series.json`, and the run is
 * started with `--dir` pointed at the same place it was pointed at before. That
 * is the whole of resume — `planSeries` reads the recorded seed list instead
 * of drawing a new one, and skips every match whose log is already on disk — so
 * what the slot has to get right is that it does not *replace* the record's
 * pairing with something the page happens to have in a form field. The ceilings
 * are the one thing a resume takes from the operator rather than from the record:
 * the record's `stop` fields say what the last run was bounded by, the page shows
 * them, and a resumed run that gives no ceiling has no ceiling. A series whose
 * lock names a live process is refused before any of that is read:
 * `resumeRecordOf` names the pid that holds the directory, in one line, rather
 * than starting a run whose only output is the runner's own refusal.
 */
import { basename, join, resolve } from "node:path";

import { defaultOutName, parseArgs, seatSlug } from "@no-dice/runner/args";
import type { MatchCommand, SeatArg, SeriesCommand } from "@no-dice/runner/args";
import { runCli } from "@no-dice/runner/cli";

import { resumeRecordOf } from "./results.ts";
import { readRunCounters } from "./progress.ts";
import type { RunCounters } from "./progress.ts";
import type { UiRoots } from "./state.ts";

/** Which command a start asks for: the two the console can play, and a resume. */
export type RunKind = "match" | "series" | "resume";

/** The runs a slot plays. A resume is played as a series, against its own directory. */
export type PlayableKind = "match" | "series";

/**
 * Where the run in the snapshot is. `idle` means this console has never started
 * one, which is not the same as `done`: the page draws a different line for a
 * console that has not run anything than for one that finished running something.
 */
export type RunState = "idle" | "running" | "done" | "failed";

/** What `GET /api/run` answers: the run, and everything the page draws from it. */
export interface RunSnapshot {
  state: RunState;
  /** The run's own output, line by line, in the order it printed. */
  lines: string[];
  /** The series directory, for a series run; `null` for a match and for `idle`. */
  dir: string | null;
  /** The match log, for a match run; `null` for a series and for `idle`. */
  out: string | null;
  /** When the run started, and when it ended, as ISO timestamps. */
  startedAt: string | null;
  endedAt: string | null;
  /** `runCli`'s exit code: 0 for a run that played what it was asked to. */
  exitCode: number | null;
  /**
   * What the series' own `series.json` says about the run, read as the snapshot is
   * asked for — so the counters are the series' own figures rather than a reading
   * of its lines. `null` for a match, which has no record, and for a series that
   * has not written one yet.
   */
  counters: RunCounters | null;
}

/** Why a start was refused, so the route can answer with the right status. */
export type Refusal = "payload" | "parse" | "busy";

/** A start, answered: the run that is now in flight, or one line saying why not. */
export type StartResult =
  | { ok: true; snapshot: RunSnapshot }
  | { ok: false; problem: Refusal; error: string };

/** The slot: one run in flight, and what the page reads about it. */
export interface RunSlot {
  /**
   * Start a run from the form's payload. Returns as soon as it is playing — the
   * run itself is awaited here and not by whoever asked.
   */
  start: (kind: RunKind, payload: unknown) => StartResult;
  /** The run in flight, or the last one, or nothing. */
  snapshot: () => RunSnapshot;
  /**
   * The series directory a run is in right now, or `null`. Not the same question
   * as `snapshot().dir`, which names the last run's directory long after that run
   * has ended: a series is offered as resumable precisely once its run has
   * stopped, and a listing that read the snapshot would keep refusing it.
   */
  inFlightSeries: () => string | null;
}

/** What a slot needs: the two roots a run writes under, and where it runs. */
export interface RunSlotOptions {
  /** The roots the console was given, as absolute paths. */
  roots: UiRoots;
  /** What a relative `--out` or `--dir` in the payload is taken relative to. */
  cwd?: string;
  /** The clock the timestamps and the refusal line read. */
  now?: () => Date;
}

/** One flag and its value, kept in pairs so the pair can be replaced wholesale. */
type Flag = readonly [flag: string, value: string];

/**
 * The form's fields, and the flag each one is the equivalent of. A field the
 * form left out contributes no flag at all, so a missing seat or a missing seed
 * comes back as `parseArgs`'s "`--b` is required" rather than as something this
 * file invented.
 *
 * `--name` and `--dir` are both passed through as the form gave them, which
 * is what makes a payload that gives both come back as the CLI's own "`--name`
 * and `--dir` name the same series".
 */
const FLAGS_OF: Record<PlayableKind, readonly Flag[]> = {
  match: [
    ["game", "--game"],
    ["a", "--a"],
    ["b", "--b"],
    ["seed", "--seed"],
    ["out", "--out"],
  ],
  series: [
    ["game", "--game"],
    ["a", "--a"],
    ["b", "--b"],
    ["maxPairs", "--max-pairs"],
    ["maxCost", "--max-cost"],
    ["maxTokens", "--max-tokens"],
    ["concurrency", "--concurrency"],
    ["seedBase", "--seed-base"],
    ["name", "--name"],
    ["dir", "--dir"],
  ],
};

/** The flags a run's own path replaces: `--name`/`--dir` for a series, `--out` for a match. */
const PATH_FLAGS: Record<PlayableKind, readonly string[]> = {
  match: ["--out"],
  series: ["--name", "--dir"],
};

/**
 * The fields a resume body may carry. Everything about the run itself — the
 * pairing, the pair limit, the seed list — is the record's to say; these are
 * the ceilings the operator restates after reading what the last run had.
 */
const CEILING_FIELDS = ["maxCost", "maxTokens", "concurrency"] as const;

/** The snapshot of a console that has never started a run. */
const IDLE: RunSnapshot = {
  state: "idle",
  lines: [],
  dir: null,
  out: null,
  startedAt: null,
  endedAt: null,
  exitCode: null,
  counters: null,
};

/** A value the form sent for a field, as the flag's value, or `null` for "not given". */
const fieldOf = (body: Readonly<Record<string, unknown>>, field: string): string | null => {
  const raw = body[field];
  // An object or an array is not a flag value. Left out rather than stringified,
  // so the command line reports it as the missing flag it effectively is.
  if (raw === undefined || raw === null || typeof raw === "object") return null;
  const text = String(raw);
  return text === "" ? null : text;
};

/** The command line the payload asks for, in the order `parseArgs` reads it. */
const argvOf = (kind: PlayableKind, flags: readonly Flag[]): string[] => [
  kind,
  ...flags.flatMap(([flag, value]) => [flag, value]),
];

/** The flags a payload carries: one per field it gave, none for a field it left out. */
const flagsOf = (kind: PlayableKind, body: Readonly<Record<string, unknown>>): Flag[] =>
  FLAGS_OF[kind].flatMap(([field, flag]) => {
    const value = fieldOf(body, field);
    return value === null ? [] : [[flag, value] as Flag];
  });

/**
 * The `no-dice` command line a form payload stands for, before the slot fixes its
 * path. Exported because that translation is the whole of "the form cannot ask
 * for a run the CLI would reject": hand this to `parseArgs` and what comes
 * back is the terminal's own line.
 */
export const runArgvOf = (kind: PlayableKind, payload: Readonly<Record<string, unknown>>): string[] =>
  argvOf(kind, flagsOf(kind, payload));

/** A seat as the operator named it, which is what a refusal has to name back. */
const seatWord = (seat: SeatArg): string =>
  seat.kind === "bot" ? `bot:${seat.bot}` : `${seat.provider}/${seat.model}`;

/** A start time as the refusal says it: `12:03`, on the console's own clock. */
const hhmm = (iso: string): string => {
  const at = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
};

/** A run, as the line that refuses a second one names it. */
const describeRun = (run: ActiveRun): string => {
  const seats = `${seatWord(run.command.a)} vs ${seatWord(run.command.b)}`;
  const where = run.kind === "series" ? `in ${String(run.dir)}` : `in ${String(run.out)}`;
  return `a ${run.kind} of ${seats} ${where}, started ${hhmm(run.startedAt)}`;
};

/** The run a slot holds: what it was asked for, what it has printed, how it ended. */
interface ActiveRun {
  kind: RunKind;
  command: MatchCommand | SeriesCommand;
  argv: string[];
  dir: string | null;
  out: string | null;
  lines: string[];
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  state: Exclude<RunState, "idle">;
}

/**
 * The run slot of one console. Every console gets its own — a test that starts
 * two servers in one process must not have them refuse each other — and the slot
 * is the only thing that knows a run is in flight.
 */
export function createRunSlot(options: RunSlotOptions): RunSlot {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? ((): Date => new Date());

  let current: ActiveRun | null = null;

  /**
   * The run as the page reads it. The counters are read here rather than kept:
   * `series.json` is the series' own account of how far it has got, rewritten
   * atomically at every batch boundary, and a snapshot that quoted a copy of it
   * taken at the start would be a snapshot that never moved.
   */
  const snapshotOf = (run: ActiveRun | null): RunSnapshot =>
    run === null
      ? { ...IDLE, lines: [] }
      : {
          state: run.state,
          lines: [...run.lines],
          dir: run.dir,
          out: run.out,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          exitCode: run.exitCode,
          counters: run.kind === "series" && run.dir !== null ? readRunCounters(run.dir) : null,
        };

  /**
   * Play the run, and keep its lines. The promise is not returned to
   * whoever started it: a run outlives the request that asked for it, and the
   * only thing waiting on it is this closure. `runCli` reports a failed run as
   * exit code 1 rather than by throwing, but a throw is caught too — a run
   * that died with no exit code is a `failed` run, not a slot stuck on
   * `running` forever.
   */
  const play = (run: ActiveRun): void => {
    const io = {
      stdout: (line: string): void => void run.lines.push(line),
      stderr: (line: string): void => void run.lines.push(line),
      cwd,
    };
    void runCli(run.argv, io).then(
      (exitCode) => {
        run.exitCode = exitCode;
        run.state = exitCode === 0 ? "done" : "failed";
        run.endedAt = now().toISOString();
      },
      (error: unknown) => {
        run.lines.push(`error: ${error instanceof Error ? error.message : String(error)}`);
        run.exitCode = 1;
        run.state = "failed";
        run.endedAt = now().toISOString();
      },
    );
  };

  /** Where a series goes: the directory the form named, or `<seriesRoot>/<name>`. */
  const seriesRun = (
    command: SeriesCommand,
    body: Readonly<Record<string, unknown>>,
    flags: readonly Flag[],
  ): ActiveRun => {
    const given = fieldOf(body, "dir");
    // A name the form gave is already checked: `parseArgs` has its own `isName`
    // for `--name`. A blank one becomes `<a>-vs-<b>` out of `seatSlug`, which
    // cannot produce a path, a dot segment or an empty name.
    const name = fieldOf(body, "name") ?? `${seatSlug(command.a)}-vs-${seatSlug(command.b)}`;
    const dir = given === null ? join(options.roots.seriesRoot, name) : resolve(cwd, given);
    const path: Flag[] = flags
      .filter(([flag]) => !PATH_FLAGS.series.includes(flag))
      .concat([["--dir", dir]]);

    return {
      kind: "series",
      command,
      argv: argvOf("series", path),
      dir,
      out: null,
      lines: [],
      startedAt: now().toISOString(),
      endedAt: null,
      exitCode: null,
      state: "running",
    };
  };

  /** Where a match goes: the path the form named, or `<matchesRoot>/<seed>-<a>-<b>.json`. */
  const matchRun = (command: MatchCommand, flags: readonly Flag[]): ActiveRun => {
    const out =
      command.out === null
        ? join(options.roots.matchesRoot, basename(defaultOutName(command)))
        : resolve(cwd, command.out);
    const path: Flag[] = flags
      .filter(([flag]) => !PATH_FLAGS.match.includes(flag))
      .concat([["--out", out]]);

    return {
      kind: "match",
      command,
      argv: argvOf("match", path),
      dir: null,
      out,
      lines: [],
      startedAt: now().toISOString(),
      endedAt: null,
      exitCode: null,
      state: "running",
    };
  };

  /**
   * The fields a resume is started with: the series directory the body named,
   * that directory's own pairing and pair limit, and the ceilings the operator
   * chose to restate. The game is the one this console runs — `series.json`
   * does not record it, and `GAMES` has one entry.
   */
  const resumeFieldsOf = (
    body: Readonly<Record<string, unknown>>,
  ): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } => {
    const given = fieldOf(body, "dir");
    if (given === null) {
      return { ok: false, error: "resuming a series needs the series directory in the body" };
    }
    const dir = resolve(cwd, given);

    let record;
    try {
      record = resumeRecordOf(dir);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const ceilings: Record<string, unknown> = {};
    for (const field of CEILING_FIELDS) ceilings[field] = body[field] ?? null;
    return {
      ok: true,
      fields: {
        game: "salient",
        a: record.a,
        b: record.b,
        maxPairs: record.maxPairs,
        dir,
        ...ceilings,
      },
    };
  };

  const startRun = (kind: PlayableKind, body: Readonly<Record<string, unknown>>): StartResult => {
    const flags = flagsOf(kind, body);

    // The CLI's own answer, asked before the slot is: the wording is `parseArgs`'s
    // and a run the terminal would refuse is refused here too, for free.
    const parsed = parseArgs(argvOf(kind, flags));
    if (!parsed.ok) return { ok: false, problem: "parse", error: parsed.error };
    const command = parsed.command;
    if (command.name !== kind) {
      return { ok: false, problem: "payload", error: `"${kind}" is not a run this console starts` };
    }

    if (current !== null && current.state === "running") {
      return { ok: false, problem: "busy", error: `a run is already running: ${describeRun(current)}` };
    }

    const run =
      command.name === "series"
        ? seriesRun(command, body, flags)
        : matchRun(command, flags);
    current = run;
    play(run);
    return { ok: true, snapshot: snapshotOf(run) };
  };

  /**
   * Start a run, or a resumed one. A resume is a series run whose fields the
   * record writes rather than the form, so from here it is indistinguishable
   * from one started from the form: same slot, same lines, same counters, the
   * same `--dir` on disk.
   */
  const start = (kind: RunKind, payload: unknown): StartResult => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, problem: "payload", error: "a run needs a JSON object of fields to start from" };
    }
    const body = payload as Readonly<Record<string, unknown>>;
    if (kind === "resume") {
      const resumed = resumeFieldsOf(body);
      if (!resumed.ok) return { ok: false, problem: "payload", error: resumed.error };
      return startRun("series", resumed.fields);
    }
    return startRun(kind, body);
  };

  return {
    start,
    snapshot: (): RunSnapshot => snapshotOf(current),
    inFlightSeries: (): string | null =>
      current !== null && current.state === "running" ? current.dir : null,
  };
}
