// @vitest-environment happy-dom
/**
 * The viewer's loading screen, as `main.ts` wires it — the one place the page
 * decides what it offers a reader before it holds a log.
 *
 * Every test under the viewer's own `src/` checks a decision that file was
 * handed; this one checks the wiring, because the two decisions it makes are the
 * ones a person meets first:
 *
 * - A viewer the console opened with `?log=` was handed the match it is here
 *   for. It is never offered the file picker, and least of all when that log
 *   fails to read: the line then says what is wrong with the log it was given,
 *   and the way back sits beside it.
 * - A viewer opened on its own keeps the picker, which is the only way a log
 *   from somewhere else gets in, and shows no link back to a console that never
 *   opened it.
 *
 * The page is `index.html` read off disk, so an element id that goes missing is
 * a failure here rather than a `#log-pick is missing` thrown in a browser. The
 * entry is imported fresh per case, which is what lets each case open at a
 * different query; `fetch` stands in for the console, and nothing else is
 * reached — the viewer still reads a log and nothing more, which is what the
 * viewer's own `module-graph.test.ts` holds.
 *
 * This file sits in `scripts/` rather than under the viewer's `src/` for that
 * one reason: the viewer's source is held to no platform module at all, and
 * reading the page off disk needs `node:fs`.
 *
 * What is checked below is the page's decision — the `hidden` attribute. That the
 * attribute keeps a block out of the layout when its class sets a `display` is a
 * stylesheet question, and happy-dom has no box model to answer it; that is held
 * by the `[hidden]` guard in `console-design.test.mjs`, over `viewer.css`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// A DOM environment gives `import.meta.url` as an http URL, so the two files
// this opens are found from the repository root, which is where vitest runs.
const ROOT = process.cwd();
const PAGE = readFileSync(join(ROOT, "games/salient/viewer/index.html"), "utf8");
const FIXTURE = readFileSync(join(ROOT, "games/salient/viewer/fixtures/golden-01-time-win.json"), "utf8");
const ENTRY = "../games/salient/viewer/src/main.ts";

/** The frame `index.html` holds, in a document with nothing else in it. */
function freshPage() {
  const body = document.createElement("div");
  body.innerHTML = PAGE.slice(PAGE.indexOf('<div id="frame"'), PAGE.indexOf("</body>"));
  document.replaceChildren(body);
}

/** Open the page at `search`, with `answer` standing for the console's fetch. */
async function open(search, answer) {
  freshPage();
  window.happyDOM.setURL(`http://localhost:8765/viewer/${search}`);
  globalThis.fetch = () => Promise.resolve(answer());
  // The entry reads the query once, at import, so each case needs the module
  // again rather than the one the case before it imported.
  vi.resetModules();
  await import(ENTRY);
  // The load is not awaited by the entry — it is a `void` — so the page is read
  // after its own turns have run.
  await new Promise((later) => void setTimeout(later, 20));
}

/** One element's `hidden`, or `null` when the page has no such element. */
function hiddenOf(selector) {
  const el = document.querySelector(selector);
  return el === null ? null : el.hidden;
}

/** The way back shown inside one container, as an href — or `null` when it shows none. */
function backLinkIn(container) {
  const link = document.querySelector(`${container} a.back`);
  return link === null ? null : link.getAttribute("href");
}

describe("a viewer the console opened with ?log=", () => {
  it("is never offered the file picker, and offers the way back instead", async () => {
    await open("?log=/logs/alpha/matches/135.json&back=%23matches", () =>
      new Response("<!doctype html><html></html>"),
    );

    // The loading screen is still up, because there is nothing to draw, and it
    // says what is wrong with the log this page was handed rather than
    // asking for a file.
    expect(hiddenOf("#load")).toBe(false);
    expect(hiddenOf("#log-pick")).toBe(true);
    expect(hiddenOf("#log-hint")).toBe(true);
    const status = document.querySelector("#status");
    expect(status.textContent).toMatch(/not JSON/);
    expect(status.classList.contains("bad")).toBe(true);

    // The way back is beside that line, and goes to the view the link was
    // clicked in — the console's own root, one level up from the viewer it
    // serves. There is no header to hold one, because there is no match to draw
    // a header for.
    expect(backLinkIn("#load")).toBe("../#matches");
    expect(backLinkIn("#header")).toBeNull();
  });

  it("and once the log is on screen, the header holds the way back too", async () => {
    await open("?log=/logs/alpha/matches/135.json&back=%23leaderboard", () => new Response(FIXTURE));

    expect(hiddenOf("#load")).toBe(true);
    expect(hiddenOf("#log-pick")).toBe(true);
    expect(document.querySelector("#board")).not.toBeNull();
    // The loading screen is out of the way but still in the document, and so is
    // its link; the header the match drew holds one of its own.
    expect(backLinkIn("#load")).toBe("../#leaderboard");
    expect(backLinkIn("#header")).toBe("../#leaderboard");

    // Stepping a frame replaces the header whole, and the way back is mounted
    // again after that — not left behind, and not doubled.
    const counter = () => document.querySelector("#header .counter")?.textContent;
    const before = counter();
    document.querySelector('button[data-step="back"]').click();
    await new Promise((later) => void setTimeout(later, 10));
    expect(counter()).not.toBe(before);
    expect(document.querySelectorAll("#header a.back")).toHaveLength(1);
  });

  it("names the log it is reading while it reads it", async () => {
    // A fetch that never answers leaves the page on its first line.
    freshPage();
    window.happyDOM.setURL("http://localhost:8765/viewer/?log=/logs/alpha/matches/135.json&back=%23matches");
    globalThis.fetch = () => new Promise(() => undefined);
    vi.resetModules();
    await import(ENTRY);

    expect(document.querySelector("#status").textContent).toBe("Reading /logs/alpha/matches/135.json…");
    expect(hiddenOf("#log-pick")).toBe(true);
  });
});

describe("a viewer opened on its own", () => {
  it("keeps the picker and the hint, and shows no link back", async () => {
    await open("", () => new Response("<!doctype html><html></html>"));

    expect(hiddenOf("#log-pick")).toBe(false);
    expect(hiddenOf("#log-hint")).toBe(false);
    expect(backLinkIn("#load")).toBeNull();
    expect(backLinkIn("#header")).toBeNull();
    // The invitation is still the honest one: nothing has been handed over.
    expect(document.querySelector("#status").textContent).toMatch(/No log yet/);
  });
});
