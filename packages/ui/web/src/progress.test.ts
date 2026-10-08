// @vitest-environment happy-dom
/**
 * The run in flight, on the page: the shape the page accepts from `/api/run`, the
 * loop that asks for it once a second while a run is playing, and what the
 * progress section says from it.
 *
 * The two things the page must get right are that the lines are the CLI's own and
 * that the counters are the series' own. So the tests here check that the
 * lines are drawn verbatim rather than re-flowed, that every figure the snapshot
 * carries reaches the page, that the page says the counters move at batch
 * boundaries while the lines move per pair, and that a run that has finished keeps
 * its last lines instead of losing them. The other thing it checks is the split
 * between those two voices: the run's own output block keeps its paths, and the
 * page's own sentences have none.
 *
 * The poller is driven with a stubbed `fetch` and a `wait` that returns at once:
 * what is under test is which answers the page acts on and when it stops asking,
 * not how long a second is.
 *
 * The counters are read by an exported parser, because the Matches view reads the
 * same shape off `/api/series` for a series somebody else is playing. The test
 * for that parser on its own is here, since it is the one place the shape is
 * written down.
 */
import { describe, expect, it } from "vitest";

import { expectPlainWords, wordsOf } from "./plain-words.ts";
import { createRunPoller, parseRun, parseRunCounters, renderProgress } from "./progress.ts";
import type { RunSnapshot } from "./progress.ts";

/** A series run, mid-flight, with the counters its record carries. */
const RUNNING: RunSnapshot = {
  state: "running",
  lines: [
    "series: /repo/series/watched",
    "seed 1234: bot:greedy in A, bot:random in B — seat A wins by 66 (time) | " +
      "bot:random in A, bot:greedy in B — seat B wins by 71 (time) | " +
      "bot:greedy win rate 100.0% (95% 71.6% – 100.0%) over 2 matches",
  ],
  dir: "/repo/series/watched",
  out: null,
  startedAt: "2025-03-01T12:03:00.000Z",
  endedAt: null,
  exitCode: null,
  counters: {
    maxPairs: 12,
    pairsPlayed: 5,
    pairsRemaining: 7,
    matchesPlayed: 10,
    matchesFailed: 1,
    costUsd: 1.5,
    tokens: 4_500_000,
    stopReason: null,
    stoppedEarly: null,
  },
};

/** The same run, ended short of its pair limit by the interval rule. */
const DONE: RunSnapshot = {
  ...RUNNING,
  state: "done",
  lines: [
    ...RUNNING.lines,
    "stopped on wilson_interval — short of its pair limit: 10 pairs, 20 matches played, 0 failed " +
      "(this run played 20, skipped 0, failed 0)",
    "series.json: /repo/series/watched/series.json",
    "report.md: /repo/series/watched/report.md",
  ],
  endedAt: "2025-03-01T12:11:00.000Z",
  exitCode: 0,
  counters: {
    ...RUNNING.counters!,
    pairsPlayed: 10,
    pairsRemaining: 2,
    matchesPlayed: 20,
    matchesFailed: 0,
    costUsd: 3,
    tokens: 9_000_000,
    stopReason: "wilson_interval",
    stoppedEarly: true,
  },
};

/** A single match: no record, so no counters. */
const MATCH: RunSnapshot = {
  state: "running",
  lines: ["/repo/matches/135-greedy-random.json"],
  dir: null,
  out: "/repo/matches/135-greedy-random.json",
  startedAt: "2025-03-01T12:03:00.000Z",
  endedAt: null,
  exitCode: null,
  counters: null,
};

describe("parseRun", () => {
  it("takes the snapshot as the console answers it, counters and all", () => {
    expect(parseRun(DONE)).toEqual(DONE);
  });

  it("takes a run with no counters, which is what a match and an idle console answer", () => {
    const idle = {
      state: "idle",
      lines: [],
      dir: null,
      out: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      counters: null,
    };
    expect(parseRun(idle)).toEqual(idle);
    expect(parseRun(MATCH).counters).toBeNull();
  });

  it("refuses an answer that is not a run, naming what is wrong with it", () => {
    expect(() => parseRun(null)).toThrow("the answer from /api/run is not an object");
    expect(() => parseRun({ ...RUNNING, state: "nearly" })).toThrow('"nearly" is not a state a run can be in');
    expect(() => parseRun({ ...RUNNING, lines: "one long line" })).toThrow("lines is not a list of strings");
    expect(() => parseRun({ ...RUNNING, counters: { ...RUNNING.counters, tokens: "4.5M" } })).toThrow(
      "counters.tokens is neither a number nor null",
    );
    // A counters object missing one figure is a console whose `/api/run` and
    // `series.json` have come apart, which is not something to draw.
    const { pairsRemaining: _gone, ...missing } = RUNNING.counters!;
    expect(() => parseRun({ ...RUNNING, counters: missing })).toThrow(
      "counters.pairsRemaining is missing",
    );
  });
});

describe("parseRunCounters", () => {
  it("reads the same figures for whoever asks, under the name the caller gives", () => {
    // The Matches view holds this shape as a playing series' `progress`, and
    // reads it with this parser rather than a second one beside it: one set
    // of figures, one set of rules about what a missing or malformed one means.
    expect(parseRunCounters(RUNNING.counters)).toEqual(RUNNING.counters);
    // A run whose record has not written its counters answers `null`, and both
    // callers have to say so rather than draw zeroes.
    expect(parseRunCounters(null)).toBeNull();
    expect(() => parseRunCounters({ ...RUNNING.counters, costUsd: "free" }, "series[0].progress")).toThrow(
      "series[0].progress.costUsd is neither a number nor null",
    );
    expect(() => parseRunCounters("1.2M", "playing[0].progress")).toThrow("playing[0].progress is not an object");
  });
});

describe("createRunPoller", () => {
  /**
   * A `fetch` that answers the queued answers in order, and counts the reads.
   * Once the queue is empty it answers `finished`, so a poller that kept asking
   * when it should have stopped fails its own read count rather than spinning.
   */
  const answering = (
    answers: Array<{ status: number; body: string }>,
    reads: string[],
    finished: { status: number; body: string },
  ) =>
    async (path: string): Promise<Response> => {
      reads.push(path);
      const answer = answers.shift() ?? finished;
      return new Response(answer.body, { status: answer.status });
    };

  const json = (value: unknown): { status: number; body: string } => ({
    status: 200,
    body: JSON.stringify(value),
  });

  it("reads while a run is running, draws every answer, and stops at the one that says it is not", async () => {
    const reads: string[] = [];
    const drawn: RunSnapshot[] = [];
    const poller = createRunPoller({
      fetchJson: answering([{ status: 500, body: "" }, json(RUNNING), json(RUNNING)], reads, json(DONE)),
      render: (run): void => void drawn.push(run),
      say: () => undefined,
      wait: async () => undefined,
    });

    await poller.run();

    // Four reads: the two in-flight ones, the finished one, and the bad one
    // it kept going after. Then it stops asking, because nothing is running.
    expect(reads).toEqual(["/api/run", "/api/run", "/api/run", "/api/run"]);
    expect(drawn.map((run) => run.state)).toEqual(["running", "running", "done"]);
    // The last thing drawn is the finished run, with its lines still on it.
    expect(drawn.at(-1)?.lines.at(-1)).toBe("report.md: /repo/series/watched/report.md");
    expect(poller.last()?.state).toBe("done");
  });

  it("says the line for a console that did not answer, and keeps asking while the run may be playing", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    const drawn: string[] = [];
    const poller = createRunPoller({
      fetchJson: answering(
        [{ status: 500, body: '{"error":"no route"}' }, json(RUNNING)],
        reads,
        json(DONE),
      ),
      render: (run): void => void drawn.push(run.state),
      say: (message): void => void said.push(message),
      wait: async () => undefined,
    });

    await poller.run();

    // Three reads, not one: the bad answer did not make the page give up on a run
    // that was still playing.
    expect(said).toEqual(["no route"]);
    expect(reads).toHaveLength(3);
    expect(drawn).toEqual(["running", "done"]);
  });

  it("stops before the next read when the page stops watching", async () => {
    const reads: string[] = [];
    const poller = createRunPoller({
      fetchJson: answering([json(RUNNING)], reads, json(RUNNING)),
      render: () => undefined,
      say: () => undefined,
      wait: async () => void poller.stop(),
    });

    await poller.run();

    expect(reads).toHaveLength(1);
  });
});

describe("renderProgress", () => {
  /** A progress section in the shape `index.html` gives it. */
  const section = (): HTMLElement => {
    const el = document.createElement("section");
    el.id = "progress";
    const heading = document.createElement("h2");
    heading.textContent = "Progress";
    el.append(heading);
    document.body.append(el);
    return el;
  };

  /** The items of one list, by the class the section gives it. */
  const itemsOf = (el: HTMLElement, listClass: string): string[] =>
    [...el.querySelectorAll<HTMLElement>(`.${listClass} li`)].map((li) => li.textContent ?? "");

  /**
   * What the page says in its own voice: every element's words and hints, with
   * the run's own output block left out of it. That block is the CLI's, kept
   * verbatim, and it is full of paths and file names on purpose; the rule under
   * test is about the words the page chooses for itself.
   */
  const pageWords = (el: HTMLElement): string =>
    [...el.children]
      .filter((child) => !child.classList.contains("run-lines"))
      .map((child) => wordsOf(child as HTMLElement))
      .join("\n");

  it("says that nothing is in flight, for a console that has never started a run", () => {
    const el = section();
    renderProgress(el, null);
    expect(el.querySelector(".run")?.textContent).toBe("No run in flight.");
    expect(el.querySelector(".run-lines")).toBeNull();
  });

  it("shows the run's own lines verbatim, in the order they printed", () => {
    const el = section();
    renderProgress(el, RUNNING);

    const pre = el.querySelector("pre.run-lines");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(RUNNING.lines.join("\n"));
  });

  it("shows every counter the series' record carries, and says when they move", () => {
    const el = section();
    renderProgress(el, RUNNING);

    expect(itemsOf(el, "counters")).toEqual([
      "pairs 5 of 12 played, 7 remaining",
      "matches 10 played, 1 failed",
      "4,500,000 tokens so far",
      "$1.50 so far",
    ]);
    expect(el.querySelector(".granularity")?.textContent).toContain("batch boundaries");
    expect(el.querySelector(".granularity")?.textContent).toContain("every 5 pairs");
    expect(el.querySelector(".granularity")?.textContent).toContain("every pair");
  });

  it("names the stop reason and whether the series stopped short, once the rules have decided", () => {
    const el = section();
    renderProgress(el, DONE);

    expect(itemsOf(el, "counters").at(-1)).toBe("stopped on wilson_interval — short of its pair limit");
    // The lines the run finished with stay on the page rather than being cleared.
    expect(el.querySelector("pre.run-lines")?.textContent).toContain(
      "stopped on wilson_interval — short of its pair limit",
    );
    expect(el.querySelector(".run")?.textContent).toContain("finished");
  });

  it("says what a failed run cost, rather than calling it finished", () => {
    const el = section();
    renderProgress(el, { ...DONE, state: "failed", exitCode: 1 });
    expect(el.querySelector(".run")?.textContent).toContain("failed with exit code 1");
  });

  it("says that a single match has no record, and names the log it is writing", () => {
    const el = section();
    renderProgress(el, MATCH);

    expect(el.querySelector(".counters")).toBeNull();
    expect(el.querySelector(".no-record")?.textContent).toContain("no series record");
    // The log it is writing is in the run's own lines, and in the Matches view as
    // soon as it lands. The page does not put the path in its own voice.
    expect(el.querySelector(".run code")).toBeNull();
  });

  it("says that a series has not written its record yet, rather than counting it as played nothing", () => {
    const el = section();
    renderProgress(el, { ...RUNNING, counters: null });

    expect(el.querySelector(".counters")).toBeNull();
    expect(el.querySelector(".no-record")?.textContent).toContain("has not written its record yet");
  });

  it("says what is running without saying which directory it writes into", () => {
    const el = section();
    renderProgress(el, RUNNING);

    expect(el.querySelector(".run")?.textContent).toContain("A series is running");
    expect(el.querySelector(".run")?.textContent).toContain("started");
    expect(el.querySelector(".run")?.textContent).not.toContain("/repo/series/watched");
  });

  it("replaces what it drew last, so a figure the record no longer carries goes away", () => {
    const el = section();
    renderProgress(el, RUNNING);
    renderProgress(el, { ...RUNNING, counters: { ...RUNNING.counters!, pairsPlayed: 10 } });

    expect(itemsOf(el, "counters")[0]).toBe("pairs 10 of 12 played, 7 remaining");
    expect(el.querySelectorAll("pre.run-lines")).toHaveLength(1);
  });

  it("says what a running series is, in plain words", () => {
    const el = section();
    renderProgress(el, RUNNING);

    expectPlainWords("runs", pageWords(el));
  });

  it("says what a finished series and a single match are, in plain words", () => {
    const series = section();
    renderProgress(series, DONE);
    expectPlainWords("runs", pageWords(series));

    const match = section();
    renderProgress(match, MATCH);
    expectPlainWords("runs", pageWords(match));
  });

  it("keeps the run's own lines exactly as they printed, paths and all", () => {
    // The other half of the rule: the block is the CLI's account of itself, and
    // the page does not tidy it. These are the lines that would fail the check
    // above, and they are drawn anyway, verbatim.
    const el = section();
    renderProgress(el, DONE);

    expect(el.querySelector("pre.run-lines")?.textContent).toContain("series.json: /repo/series/watched/series.json");
  });
});
