/**
 * The console's entry point: the frame, the state that fills it, and the run it
 * watches while it plays.
 *
 * The page reads `/api/state` once when it opens and draws what it says. The run
 * in flight is a separate read on a separate clock: `/api/run` once a second while
 * `state` is `running`, and no further reads once it is not. Polling rather than a
 * live connection is deliberate — one operator on loopback, and the runner's own
 * granularity is a pair of matches — and it means a page that is closed, reloaded
 * or cut off changes nothing about the run, which lives in the server's process.
 *
 * The two reads draw into the same sections, so the order matters: `renderFrame`
 * replaces everything under every heading, and the run it cannot see is put back
 * from the last snapshot the poller took.
 */
import { getJson } from "./api.ts";
import { createRunPoller, renderProgress } from "./progress.ts";
import type { RunSnapshot } from "./progress.ts";
import { frameSections, renderFrame } from "./render-frame.ts";
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

/**
 * The run in flight, read once a second while it is running. The last
 * snapshot is kept so a redraw of the frame does not blank the progress section,
 * and a run that has finished keeps its lines on the page rather than losing them
 * to the next read.
 */
const poller = createRunPoller({
  fetchJson: (path, init) => fetch(path, init),
  render: (run: RunSnapshot): void => void renderProgress(sections.progress, run),
  say,
});

/**
 * Read the console's state and redraw the frame from it. A console that cannot
 * be reached leaves the frame standing with one bad line rather than half a
 * frame: the page is a view of the console, and a console that is not answering
 * is the fact worth showing.
 */
const refresh = async (): Promise<void> => {
  try {
    const state = parseState(await getJson<unknown>("/api/state"));
    renderFrame(sections, state);
    // The frame took back everything under every heading, so the run the
    // poller is watching goes straight back under the one it belongs to.
    renderProgress(sections.progress, poller.last());
    say(`Series under ${state.seriesRoot}, matches under ${state.matchesRoot}.`);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }
};

void refresh();
void poller.run();
