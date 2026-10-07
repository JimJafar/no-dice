/**
 * The run in flight: what the page reads about it, and what it draws.
 *
 * The page asks once a second while a run is `running`, and stops asking when it
 * is not. Polling rather than a socket or a server-sent stream is the honest
 * shape here: this is one operator on loopback, and the runner's own granularity
 * is a pair of matches — a model match is nineteen minutes
 * (`docs/pi-harness-notes.md` §7) — so there is nothing finer to be told about
 * more often.
 *
 * Two things arrive, and they move at different speeds. The **lines** are
 * `runCli`'s own, printed verbatim: the seed, both seat orders, both results,
 * the running win rate and its 95% interval, and at the end the stop reason, the
 * final figures and the paths of `series.json` and `report.md`. The **counters**
 * come from the series' own `series.json`, which the runner rewrites at every
 * batch of 5 pairs, so they move in steps of five while the lines move in steps
 * of one. The page says so: a bar that pretended to finer granularity would be a
 * lie about what the runner writes.
 *
 * A single match has no record, so it has no counters: its progress is its lines,
 * and its end is the log path and the result line.
 *
 * When a run ends the last lines stay on the page. The snapshot keeps them, and
 * nothing here clears a section that has something to show, because the figures a
 * finished run left behind are the reason for looking at it.
 *
 * The shape below is declared here rather than imported from
 * `packages/ui/src/runs.ts`: that module reads `providers.json` and the registry
 * off disk through `@no-dice/runner`, and a browser bundle may not. It is the same
 * arrangement the viewer uses for the showcase sidecar. `parseRun` is what keeps
 * the two from drifting quietly — a snapshot missing a counter is one readable
 * line, not a `undefined` drawn into the counters.
 */
import { getJson } from "./api.ts";
import { clear } from "./render-frame.ts";
import type { FetchJson } from "./api.ts";

/** How often the page asks. The runner's own granularity is a pair, its batch five. */
export const POLL_MS = 1000;

/** Where the run the page is reading is. */
export type RunState = "idle" | "running" | "done" | "failed";

/** What the series' own record says about how far it has got. */
export interface RunCounters {
  maxPairs: number;
  pairsPlayed: number;
  pairsRemaining: number;
  matchesPlayed: number;
  matchesFailed: number;
  costUsd: number;
  tokens: number;
  /** Which rule ended the series, once the stopping rules have decided. */
  stopReason: string | null;
  /** Whether it stopped short of its pair limit, once they have decided. */
  stoppedEarly: boolean | null;
}

/** What `GET /api/run` answers. */
export interface RunSnapshot {
  state: RunState;
  /** The run's own output, line by line, in the order it printed. */
  lines: string[];
  dir: string | null;
  out: string | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  /** The series' counters, or `null` for a match and for a series with no record yet. */
  counters: RunCounters | null;
}

/** Anything that should have been an object, as the line that says it was not. */
const recordOf = (value: unknown, what: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
};

/** A list of strings, or the line that says it is not one. */
const stringList = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value) || !value.every((each) => typeof each === "string")) {
    throw new Error(`${what} is not a list of strings`);
  }
  return value as string[];
};

/** A path, or `null`, or the line that says the answer is neither. */
const pathOrNull = (value: unknown, what: string): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || value === "") throw new Error(`${what} is neither a path nor null`);
  return value;
};

/** A timestamp, or `null`, or the line that says the answer is neither. */
const timeOrNull = (value: unknown, what: string): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || value === "") throw new Error(`${what} is neither a time nor null`);
  return value;
};

/** A count, or `null`, or the line that says the answer is neither. */
const numberOrNull = (value: unknown, what: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${what} is neither a number nor null`);
  }
  return value;
};

/** A whole count, or the line that says the answer is not one. */
const countOf = (value: unknown, what: string): number => {
  if (value === undefined) throw new Error(`${what} is missing`);
  const n = numberOrNull(value, what);
  if (n === null) throw new Error(`${what} is not a count`);
  return n;
};

/** The counters, or `null` for a run that has no record. */
const countersOf = (value: unknown): RunCounters | null => {
  if (value === null) return null;
  const counters = recordOf(value, "counters");
  const stopReason = counters["stopReason"];
  if (typeof stopReason !== "string" && stopReason !== null) {
    throw new Error("counters.stopReason is neither a reason nor null");
  }
  const stoppedEarly = counters["stoppedEarly"];
  if (typeof stoppedEarly !== "boolean" && stoppedEarly !== null) {
    throw new Error("counters.stoppedEarly is neither a yes or no nor null");
  }
  return {
    maxPairs: countOf(counters["maxPairs"], "counters.maxPairs"),
    pairsPlayed: countOf(counters["pairsPlayed"], "counters.pairsPlayed"),
    pairsRemaining: countOf(counters["pairsRemaining"], "counters.pairsRemaining"),
    matchesPlayed: countOf(counters["matchesPlayed"], "counters.matchesPlayed"),
    matchesFailed: countOf(counters["matchesFailed"], "counters.matchesFailed"),
    costUsd: countOf(counters["costUsd"], "counters.costUsd"),
    tokens: countOf(counters["tokens"], "counters.tokens"),
    stopReason,
    stoppedEarly,
  };
};

const STATES: readonly RunState[] = ["idle", "running", "done", "failed"];

/**
 * The answer from `/api/run`, or the reason it is not one. Every field is named in
 * its failure, because the page shows that line and the person reading it is the
 * one who can go and look at the console.
 */
export const parseRun = (value: unknown): RunSnapshot => {
  const run = recordOf(value, "the answer from /api/run");
  const state = run["state"];
  if (typeof state !== "string" || !STATES.includes(state as RunState)) {
    throw new Error(`"${String(state)}" is not a state a run can be in`);
  }
  return {
    state: state as RunState,
    lines: stringList(run["lines"], "lines"),
    dir: pathOrNull(run["dir"], "dir"),
    out: pathOrNull(run["out"], "out"),
    startedAt: timeOrNull(run["startedAt"], "startedAt"),
    endedAt: timeOrNull(run["endedAt"], "endedAt"),
    exitCode: numberOrNull(run["exitCode"], "exitCode"),
    counters: countersOf(run["counters"]),
  };
};

/** What the page does with one snapshot, and with the console that did not answer. */
export interface RunPollerOptions {
  /** The console's own `fetch`. */
  fetchJson: FetchJson;
  /** What to draw every time a snapshot arrives. */
  render: (run: RunSnapshot) => void;
  /** What to say when the console did not answer at all. */
  say: (message: string, bad: boolean) => void;
  /** How long to leave between reads. */
  everyMs?: number;
  /** The wait itself, so a test can drive the loop without a clock. */
  wait?: (ms: number) => Promise<void>;
}

/** The page's read of the run in flight. */
export interface RunPoller {
  /** Read once and draw, or say why it could not. */
  read: () => Promise<RunSnapshot | null>;
  /** Read, and keep reading while a run is in flight. */
  run: () => Promise<void>;
  /** Stop before the next read. The run itself goes on whatever the page does. */
  stop: () => void;
  /** The last snapshot drawn, which is what a redraw of the frame puts back. */
  last: () => RunSnapshot | null;
}

/**
 * The poller: one read, then another a second later, until the run is not
 * `running`.
 *
 * A console that does not answer is not a run that has stopped. The run lives in
 * the server's own process, not in the request that asked about it, so a failed
 * read says the line and the loop keeps asking — a page that gave up on the first
 * hiccup would be a page that told its reader a 48-hour series had ended.
 */
export const createRunPoller = (options: RunPollerOptions): RunPoller => {
  const everyMs = options.everyMs ?? POLL_MS;
  const wait = options.wait ?? ((ms: number): Promise<void> => new Promise((later) => setTimeout(later, ms)));
  let stopped = false;
  let last: RunSnapshot | null = null;

  const read = async (): Promise<RunSnapshot | null> => {
    try {
      last = parseRun(await getJson<unknown>("/api/run", options.fetchJson));
      options.render(last);
      return last;
    } catch (error) {
      options.say(error instanceof Error ? error.message : String(error), true);
      return null;
    }
  };

  const run = async (): Promise<void> => {
    for (;;) {
      const snapshot = await read();
      if (stopped) return;
      if (snapshot !== null && snapshot.state !== "running") return;
      await wait(everyMs);
      if (stopped) return;
    }
  };

  return { read, run, stop: (): void => void (stopped = true), last: (): RunSnapshot | null => last };
};

/** A short element with a class and a sentence. */
const paragraph = (className: string, text: string): HTMLElement => {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
};

/** A list of one-line items, in the order given. */
const list = (className: string, items: readonly string[]): HTMLElement => {
  const ul = document.createElement("ul");
  ul.className = className;
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.append(li);
  }
  return ul;
};

/** A path, as a path. */
const code = (text: string): HTMLElement => {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
};

/** A time as the page says it: the clock's own hours, minutes and seconds. */
const clockOf = (iso: string): string => {
  const at = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
};

/** Money as the report writes it. */
const usd = (n: number): string => `$${n.toFixed(2)}`;

/** How the run is described, in one line: what it is, where it is, and how it went. */
const stateParagraph = (run: RunSnapshot): HTMLElement => {
  const what = run.dir !== null ? "series" : "match";
  const el = document.createElement("p");
  el.className = `run run-${run.state}`;
  if (run.state === "running") {
    el.append(
      document.createTextNode(`A ${what} is running in `),
      code(String(run.dir ?? run.out)),
      document.createTextNode(run.startedAt === null ? "." : `, started ${clockOf(run.startedAt)}.`),
    );
    return el;
  }
  const word = run.state === "done" ? "finished" : `failed with exit code ${String(run.exitCode)}`;
  const ended = run.endedAt === null ? "" : `, ended ${clockOf(run.endedAt)}`;
  el.append(document.createTextNode(`The ${what} ${word}${ended}.`));
  return el;
};

/**
 * How the series ended, in the CLI's own words: which rule fired, and whether it
 * fired short of the pair limit or at it. Only once the stopping rules have
 * decided — while they have not, there is no reason to name.
 */
const stopLine = (counters: RunCounters): string | null =>
  counters.stopReason === null
    ? null
    : `stopped on ${counters.stopReason} — ` +
      `${counters.stoppedEarly === true ? "short of its pair limit" : "its full length"}`;

/** What the series' own record says, as one item per figure. */
const counterItems = (counters: RunCounters): string[] => {
  const items = [
    `pairs ${String(counters.pairsPlayed)} of ${String(counters.maxPairs)} played, ` +
      `${String(counters.pairsRemaining)} remaining`,
    `matches ${String(counters.matchesPlayed)} played, ${String(counters.matchesFailed)} failed`,
    `${counters.tokens.toLocaleString("en-US")} tokens so far`,
    `${usd(counters.costUsd)} so far`,
  ];
  const stop = stopLine(counters);
  if (stop !== null) items.push(stop);
  return items;
};

/**
 * The progress section, as the console's snapshot describes it.
 *
 * The lines go in a `<pre>`, verbatim: they are the terminal's own output, and a
 * page that re-flowed them would be a page whose figures could disagree with the
 * ones in `report.md`.
 */
export const renderProgress = (el: HTMLElement, run: RunSnapshot | null): void => {
  clear(el);
  if (run === null || run.state === "idle") {
    el.append(paragraph("run", "No run in flight."));
    return;
  }

  el.append(stateParagraph(run));

  if (run.counters !== null) {
    el.append(list("counters", counterItems(run.counters)));
    el.append(
      paragraph(
        "granularity",
        "The counters come from the series' own record and move at batch boundaries — every 5 pairs — " +
          "while the lines below move for every pair.",
      ),
    );
  } else if (run.dir !== null) {
    el.append(paragraph("no-record", "The series has not written its record yet."));
  } else {
    el.append(
      paragraph(
        "no-record",
        "A single match has no series record: its progress is its lines, and it ends with the log path " +
          "and the result line.",
      ),
    );
  }

  if (run.lines.length === 0) {
    el.append(paragraph("run-lines-none", "Nothing printed yet."));
    return;
  }
  const pre = document.createElement("pre");
  pre.className = "run-lines";
  pre.textContent = run.lines.join("\n");
  el.append(pre);
};
