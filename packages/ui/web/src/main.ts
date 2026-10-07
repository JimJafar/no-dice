/**
 * The console's entry point: the frame, and the one answer that fills it.
 *
 * The page reads `/api/state` once when it opens and draws what it says. There
 * is no polling and no live connection yet: the progress task adds the run's own
 * lines, and until then the frame states the seats, the providers, the two roots
 * and the fact that nothing is running.
 */
import { getJson } from "./api.ts";
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
 * Read the console's state and redraw the frame from it. A console that cannot
 * be reached leaves the frame standing with one bad line rather than half a
 * frame: the page is a view of the console, and a console that is not answering
 * is the fact worth showing.
 */
const refresh = async (): Promise<void> => {
  try {
    const state = parseState(await getJson<unknown>("/api/state"));
    renderFrame(sections, state);
    say(`Series under ${state.seriesRoot}, matches under ${state.matchesRoot}.`);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }
};

void refresh();
