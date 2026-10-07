/**
 * The console's entry point: the frame, the state that fills it, the run it
 * watches while it plays, and the finished work it lists from disk.
 *
 * The page reads `/api/state` once when it opens and draws what it says. The run
 * in flight is a separate read on a separate clock: `/api/run` once a second while
 * `state` is `running`, and no further reads once it is not. Polling rather than a
 * live connection is deliberate — one operator on loopback, and the runner's own
 * granularity is a pair of matches — and it means a page that is closed, reloaded
 * or cut off changes nothing about the run, which lives in the server's process.
 *
 * The listings are a third read, and the least often of the three: `/api/series`
 * and `/api/matches` when the page opens, when a run it was watching ends, and when
 * a resume is asked for. They are not polled, because a series takes hours
 * and a page that re-read every match log once a second would be doing the stats
 * package's work for no one.
 *
 * The start form is built out of the state read, because its seat pickers are the
 * bots and providers `/api/state` names. It is built once: the frame replaces
 * everything under every heading, so the form and the run the poller is watching
 * both go straight back under the headings they own.
 *
 * The three reads draw into the same sections, so the order matters: `renderFrame`
 * replaces everything under every heading, and the run it cannot see is put back
 * from the last snapshot the poller took.
 */
import { getJson, postJson } from "./api.ts";
import type { FetchJson } from "./api.ts";
import { createRunPoller, renderProgress } from "./progress.ts";
import type { RunSnapshot } from "./progress.ts";
import { frameSections, renderFrame } from "./render-frame.ts";
import { renderStart } from "./render-start.ts";
import type { SeatChoices } from "./render-start.ts";
import { startRun } from "./start.ts";
import { fetchResults, renderResults } from "./results.ts";
import { parseState } from "./state.ts";

/** The one line the frame has, which `index.html` owns. */
const status = document.querySelector<HTMLElement>("#status");
if (status === null) throw new Error("#status is missing from index.html");

const sections = frameSections(document);

/** The line the page shows about itself: what it read, or why it could not. */
const say = (message: string, bad = false): void => {
  status.textContent = message;
  status.classList.toggle("bad", bad);
};

/** The console's own `fetch`, named once so every read goes through the same door. */
const fetchJson: FetchJson = (path, init) => fetch(path, init);

/**
 * Read what the console has on disk and redraw the results section from it.
 *
 * The figures are the console's — `seriesReport`, the same report `no-dice stats`
 * prints — and the page adds nothing to them but wording. A listing that could not
 * be read leaves the section standing and says why on the status line: half a
 * results section is worse than a whole one with a bad line under it.
 */
const refreshResults = async (): Promise<void> => {
  try {
    const results = await fetchResults(fetchJson);
    renderResults(sections.results, results, (dir) => void resumeSeries(dir));
    say(`${String(results.series.length)} series and ${String(results.matches.length)} matches listed.`);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }
};

/**
 * Ask the console to finish a series. The directory is all that is sent: the
 * pairing and the pair limit come from the series' own record, which is the only
 * thing that knows what the interrupted run was running.
 */
const resumeSeries = async (dir: string): Promise<void> => {
  try {
    await postJson("/api/run/resume", { dir }, fetchJson);
    say(`Resuming ${dir}.`);
    void poller.run();
    await refreshResults();
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }
};

/**
 * The run in flight, read once a second while it is running. The last
 * snapshot is kept so a redraw of the frame does not blank the progress section,
 * and a run that has finished keeps its lines on the page rather than losing them
 * to the next read.
 */
let watching = false;
const poller = createRunPoller({
  fetchJson,
  render: (run: RunSnapshot): void => {
    void renderProgress(sections.progress, run);
    // A run that has just stopped has left logs and a record on disk. The
    // listings are read again at that moment and at no other, so the finished
    // work appears without a reload and without polling the stats report.
    if (run.state === "running") {
      watching = true;
    } else if (watching) {
      watching = false;
      void refreshResults();
    }
  },
  say,
});

/**
 * The start form, built from the seats the console named. It is drawn once per
 * `/api/state` read — which is once per page load — because a form that rebuilt
 * itself under someone mid-way through typing a model id would lose it. A
 * console that named no seat gets the form anyway, saying that it has nothing to
 * seat a run with, rather than an empty section.
 */
const drawStart = (choices: SeatChoices): void => {
  renderStart(sections.start, {
    choices,
    onStart: (kind, body) => startRun(kind, body, fetchJson),
    // The run is the console's now, so the page starts reading it: closing this
    // page, or this read failing, changes nothing about the run itself.
    onStarted: (): void => void poller.run(),
  });
};

/**
 * Read the console's state and redraw the frame from it. A console that cannot
 * be reached leaves the frame standing with one bad line rather than half a
 * frame: the page is a view of the console, and a console that is not answering
 * is the fact worth showing.
 */
const refresh = async (): Promise<void> => {
  try {
    const state = parseState(await getJson<unknown>("/api/state", fetchJson));
    renderFrame(sections, state);
    // The frame took back everything under every heading, so the run the
    // poller is watching and the form the state was used to build both go
    // straight back under the one they belong to.
    renderProgress(sections.progress, poller.last());
    drawStart({ bots: state.bots, providers: state.providers });
  } catch (error) {
    drawStart({ bots: [], providers: [] });
    say(error instanceof Error ? error.message : String(error), true);
  }
};

void refresh();
void refreshResults();
void poller.run();
