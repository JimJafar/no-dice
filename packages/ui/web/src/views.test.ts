// @vitest-environment happy-dom
/**
 * The four views the console opens on, mounted on the real `index.html`.
 *
 * What is under test is the rule the page is built on: the URL hash names the
 * view, exactly one view is showing, and the other three are hidden rather than
 * taken away. The second of those three is the one that matters at 3 a.m. — a
 * series plays for hours, the operator reads the leaderboard while it does, and
 * the page's one-second read of `/api/run` has to keep drawing into a Runs
 * view nobody is looking at, so that switching back shows the run where it got
 * to rather than an empty section.
 *
 * The page is the one `index.html` describes, parsed rather than re-typed
 * here: a fixture that named its own four views would pass beside a page that had
 * three.
 */
import { beforeEach, describe, expect, it } from "vitest";

import INDEX_HTML from "../index.html?raw";
import { createRunPoller, renderProgress } from "./progress.ts";
import type { FetchJson } from "./api.ts";
import type { RunSnapshot } from "./progress.ts";
import { DEFAULT_VIEW, VIEW_LABELS, VIEW_NAMES, mountViews, viewOfHash, wrapperId } from "./views.ts";
import type { ViewName } from "./views.ts";

/** The run mid-flight, and the same run a few pairs later. */
const RUNNING: RunSnapshot = {
  state: "running",
  lines: ["series: /repo/series/watched", "seed 1234: bot:greedy in A, bot:random in B — seat A wins by 66 (time)"],
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
    matchesFailed: 0,
    costUsd: 1.5,
    tokens: 4_500_000,
    stopReason: null,
    stoppedEarly: null,
  },
};

const FURTHER: RunSnapshot = {
  ...RUNNING,
  lines: [...RUNNING.lines, "seed 1239: bot:random in A, bot:greedy in B — seat B wins by 71 (time)"],
  counters: { ...RUNNING.counters!, pairsPlayed: 10, pairsRemaining: 2, matchesPlayed: 20, costUsd: 3 },
};

/** The page `index.html` describes, in this test's document. */
const page = (): void => {
  const parsed = new DOMParser().parseFromString(INDEX_HTML, "text/html");
  document.body.replaceChildren();
  for (const child of [...parsed.body.children]) {
    // The page's own module script is the thing this test is not running.
    if (child.tagName === "SCRIPT") continue;
    document.body.append(document.importNode(child, true));
  }
};

/** One view's wrapper, or the reason the page is not the page it should be. */
const wrapper = (view: ViewName): HTMLElement => {
  const found = document.getElementById(wrapperId(view));
  if (found === null) throw new Error(`#${wrapperId(view)} is not on the page`);
  return found;
};

/** The views on screen, in the order the nav bar lists them. */
const visibleViews = (): ViewName[] => VIEW_NAMES.filter((view) => wrapper(view).hidden === false);

/** The nav bar's links, in the order it holds them. */
const navLinks = (): HTMLAnchorElement[] => [...document.querySelectorAll<HTMLAnchorElement>("#nav a")];

/** The link that asks for one view. */
const linkTo = (view: ViewName): HTMLAnchorElement => {
  const found = document.querySelector<HTMLAnchorElement>(`#nav a[href="#${view}"]`);
  if (found === null) throw new Error(`the nav bar has no link to #${view}`);
  return found;
};

/**
 * Let the hashchange land. A browser fires it after the click that moved
 * the hash, not during it, and happy-dom keeps that order.
 */
const settled = async (): Promise<void> => new Promise((later) => void setTimeout(later, 0));

/** A `fetch` that answers `/api/run` with the snapshots in order. */
const answering = (runs: RunSnapshot[]): FetchJson => {
  return async (): Promise<Response> => new Response(JSON.stringify(runs.shift()));
};

beforeEach(() => {
  window.location.hash = "";
  document.body.replaceChildren();
});

describe("viewOfHash", () => {
  it("names each of the four views by the hash that names it", () => {
    for (const view of VIEW_NAMES) expect(viewOfHash(`#${view}`)).toBe(view);
  });

  it("opens on Matches for a hash that names no view", () => {
    // No hash at all is how the console is opened most often.
    expect(viewOfHash("")).toBe(DEFAULT_VIEW);
    expect(viewOfHash("#")).toBe(DEFAULT_VIEW);
    // An anchor into the old one-long-page is a link to a section, not to a
    // view; the reader wanted the console, so they get its front page.
    expect(viewOfHash("#start")).toBe(DEFAULT_VIEW);
    expect(viewOfHash("#matches-and-everything")).toBe(DEFAULT_VIEW);
  });
});

describe("mountViews", () => {
  it("shows Matches and no other view when the URL names none", () => {
    page();
    const views = mountViews(document);

    expect(visibleViews()).toEqual(["matches"]);
    expect(views.current()).toBe("matches");
  });

  it("shows the view the URL names, which is what a reload and a link from another machine carry", () => {
    window.location.hash = "#leaderboard";
    page();

    expect(mountViews(document).current()).toBe("leaderboard");
    expect(visibleViews()).toEqual(["leaderboard"]);
  });

  it("falls back to Matches for a hash that names no view", () => {
    window.location.hash = "#providers-and-models";
    page();
    mountViews(document);

    expect(visibleViews()).toEqual(["matches"]);
  });

  it("draws one nav link per view and marks the one showing", () => {
    page();
    mountViews(document);

    expect(navLinks().map((link) => link.getAttribute("href"))).toEqual(VIEW_NAMES.map((view) => `#${view}`));
    expect(navLinks().map((link) => link.textContent)).toEqual(VIEW_NAMES.map((view) => VIEW_LABELS[view]));
    expect(navLinks().map((link) => link.getAttribute("aria-current"))).toEqual([
      "true",
      null,
      null,
      null,
    ]);
  });

  it("shows the view a clicked nav link asks for, and hides the rest", async () => {
    page();
    mountViews(document);

    linkTo("runs").click();
    await settled();

    expect(visibleViews()).toEqual(["runs"]);
    expect(linkTo("runs").getAttribute("aria-current")).toBe("true");
    expect(linkTo("matches").hasAttribute("aria-current")).toBe(false);
  });

  it("keeps a hidden view's sections in the document, so the module that owns each still has it", () => {
    page();
    mountViews(document);

    const runs = wrapper("runs");
    expect(runs.hidden).toBe(true);
    // Hidden, not removed: the sections and their headings are still there, with
    // the ids every renderer module looks its section up by.
    expect(document.querySelectorAll("#view-runs section")).toHaveLength(2);
    expect(document.querySelector("#view-runs #start > h2")?.textContent).toBe("Start a run");
    expect(document.querySelector("#view-runs #progress > h2")?.textContent).toBe("Progress");
    expect(document.querySelector("#view-matches #results > h2")?.textContent).toBe("Results");
    expect(document.querySelector("#view-leaderboard #leaderboard > h2")?.textContent).toBe("Leaderboard");
    expect(document.querySelector("#view-providers #providers > h2")?.textContent).toBe("Providers");
  });

  it("keeps a running series' lines and pair counters current while another view is showing", async () => {
    page();
    mountViews(document);
    const progress = document.getElementById("progress");
    if (progress === null) throw new Error("#progress is not on the page");

    const runs = answering([RUNNING, FURTHER]);
    const poller = createRunPoller({
      fetchJson: runs,
      render: (run): void => void renderProgress(progress, run),
      say: () => undefined,
    });

    // The operator is on Matches while the series plays.
    await poller.read();
    expect(visibleViews()).toEqual(["matches"]);
    expect(wrapper("runs").hidden).toBe(true);
    expect(progress.querySelector("pre.run-lines")?.textContent).toBe(RUNNING.lines.join("\n"));
    expect(progress.querySelector(".counters li")?.textContent).toContain("pairs 5 of 12 played");

    // Switching back to Runs shows where the run got to, with no reload.
    linkTo("runs").click();
    await settled();
    await poller.read();

    expect(visibleViews()).toEqual(["runs"]);
    expect(progress.querySelector("pre.run-lines")?.textContent).toBe(FURTHER.lines.join("\n"));
    expect(progress.querySelector(".counters li")?.textContent).toContain("pairs 10 of 12 played");
  });

  it("says which view wrapper a page is missing", () => {
    page();
    wrapper("providers").remove();

    expect(() => mountViews(document)).toThrow("#view-providers is missing from index.html");
  });
});
