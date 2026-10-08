// @vitest-environment happy-dom
/**
 * The results section, on the page: the shape the page accepts from
 * `/api/series` and `/api/matches`, and what it draws from them.
 *
 * The section's whole purpose is that its figures are the CLI's, so the tests here
 * are mostly about the page not inventing anything: every number on the page is one
 * the console answered with, a series with nothing counted says there is no win
 * rate rather than showing 0%, and a resume sends a directory and nothing else —
 * the pairing is the record's business, not the page's.
 *
 * The listings are built here by hand rather than by importing the server's types,
 * which read the filesystem and pull in `@no-dice/stats`. The server's own
 * `results.test.ts` checks its answer against the stats report; this file checks
 * that the page draws whatever that answer says.
 *
 * The section speaks in words: no flag name, no absolute path and no log file
 * name in anything it draws. That is checked at the bottom of this file, over
 * the whole text of a section drawn from a listing that has a series, a broken
 * record and a match in it — the fixture is deliberately one of everything, so a
 * path or a name sneaking in through one row fails the check.
 */
import { describe, expect, it } from "vitest";

import { expectPlainWords } from "./plain-words.ts";
import {
  fetchResults,
  parseMatchListing,
  parseSeriesListing,
  readMatchHeader,
  renderResults,
} from "./results.ts";
import type { Results } from "./results.ts";

/** One series, as `/api/series` answers it: two counted matches, a full-length stop. */
const SERIES = {
  name: "alpha",
  dir: "/repo/series/alpha",
  a: "bot:greedy",
  b: "bot:random",
  maxPairs: 4,
  pairs: 4,
  matches: 8,
  counted: 7,
  missing: 1,
  stopReason: "max_pairs",
  stoppedEarly: false,
  wins: 4,
  losses: 2,
  draws: 1,
  winRate: 0.6428571428571429,
  interval: { low: 0.38712960064025523, high: 0.836883786832949 },
  confidence: 0.95,
  ceilingUsd: null,
  ceilingTokens: null,
  resumable: true,
};

/** One finished match, as `/api/matches` answers it. */
const MATCH = {
  name: "1234-greedy-random.json",
  path: "/repo/series/alpha/matches/1234-greedy-random.json",
  url: "/logs/alpha/matches/1234-greedy-random.json",
  viewerUrl: "/viewer/?log=/logs/alpha/matches/1234-greedy-random.json",
  series: "alpha",
};

/** What that log's own header says about the match, once the page has read it. */
const HEADER = {
  seats: ["bot:greedy", "bot:random"] as [string, string],
  seed: 1234,
  playedOn: "2026-10-07T20:19:32.132Z",
};

/** The match row as the page holds it: the listing, and the label read off the log. */
const LABELED = { ...MATCH, header: HEADER };

/** The head of a match log, as the log writes it — header first, then the match. */
const logHead = (players: unknown): string =>
  JSON.stringify(
    {
      format: "salient-log/1",
      ruleset: "v0",
      engine_version: "0.1.0",
      created: HEADER.playedOn,
      seed: HEADER.seed,
      config: { turns: 25, action_points: 6 },
      harness: { pi_version: null, context: "continuous" },
      players,
      map: [],
    },
    null,
    2,
  );

const LOG_HEAD = logHead({ A: { kind: "bot", bot: "greedy" }, B: { kind: "bot", bot: "random" } });

/** A log answer: the header, and a body long enough that reading it all would be the point. */
const logAnswer = (head: string): Response =>
  new Response(`${head}\n"turns": ${JSON.stringify(Array.from({ length: 400 }, () => ({ n: 1 })))}`);

/** Both listings, as the page holds them. */
const RESULTS: Results = {
  seriesRoot: "/repo/series",
  matchesRoot: "/repo/matches",
  series: [SERIES],
  unreadable: [],
  matches: [LABELED],
};

/** A section, as `index.html` has one. */
const section = (): HTMLElement => {
  const el = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = "Results";
  el.append(heading);
  document.body.append(el);
  return el;
};

/** Every item the section lists, under one class. */
const itemsOf = (el: HTMLElement, listClass: string): string[] =>
  [...el.querySelectorAll<HTMLElement>(`.${listClass} > li`)].map((li) => li.textContent ?? "");

/** Draw the section and read it back as text. */
const drawn = (results: Results): { el: HTMLElement; text: string } => {
  const el = section();
  renderResults(el, results, () => undefined);
  return { el, text: el.textContent ?? "" };
};

describe("parseSeriesListing", () => {
  it("keeps every figure the console answered with", () => {
    const listing = parseSeriesListing({
      seriesRoot: "/repo/series",
      series: [SERIES],
      unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "not a series record" }],
    });

    expect(listing.seriesRoot).toBe("/repo/series");
    expect(listing.series).toEqual([SERIES]);
    expect(listing.unreadable).toEqual([
      { name: "broken", dir: "/repo/series/broken", error: "not a series record" },
    ]);
  });

  it("names the field when the answer is missing one, rather than drawing undefined", () => {
    const { winRate, ...withoutRate } = SERIES;
    expect(winRate).toBeTypeOf("number");
    const without = { seriesRoot: "/repo/series", series: [withoutRate], unreadable: [] };
    expect(() => parseSeriesListing(without)).toThrow("series[0].winRate is not a number");
    expect(() => parseSeriesListing({ series: [SERIES], unreadable: [] })).toThrow("seriesRoot is not a string");
    expect(() => parseSeriesListing([])).toThrow("the answer from /api/series is not an object");
  });

  it("keeps a series with nothing counted as having no rate and no interval", () => {
    const listing = parseSeriesListing({
      seriesRoot: "/repo/series",
      series: [{ ...SERIES, counted: 0, missing: 8, winRate: null, interval: null }],
      unreadable: [],
    });
    expect([listing.series[0]!.winRate, listing.series[0]!.interval]).toEqual([null, null]);
  });
});

describe("parseMatchListing", () => {
  it("keeps both URLs of every log, and the series a log belongs to", () => {
    const listing = parseMatchListing({
      matchesRoot: "/repo/matches",
      matches: [MATCH, { ...MATCH, series: null }],
    });
    expect(listing.matchesRoot).toBe("/repo/matches");
    expect(listing.matches.map((each) => each.series)).toEqual(["alpha", null]);
    expect(listing.matches[0]!.viewerUrl).toBe(MATCH.viewerUrl);
    // The listing carries no label: what the match was comes from the log, and
    // a row straight off the answer has not read one yet.
    expect(listing.matches.map((each) => each.header)).toEqual([null, null]);
  });

  it("names the field when the answer is missing one", () => {
    const { viewerUrl, ...withoutViewer } = MATCH;
    expect(viewerUrl).toBeTypeOf("string");
    expect(() => parseMatchListing({ matchesRoot: "/repo/matches", matches: [withoutViewer] })).toThrow(
      "matches[0].viewerUrl is not a string",
    );
    expect(() => parseMatchListing({ matchesRoot: "/repo/matches" })).toThrow("matches is not a list");
  });
});

describe("fetchResults", () => {
  it("reads both listings and holds them as one section", async () => {
    const asked: string[] = [];
    const results = await fetchResults((path) => {
      asked.push(path);
      if (path === MATCH.url) return Promise.resolve(logAnswer(LOG_HEAD));
      return Promise.resolve(
        Response.json(
          path === "/api/series"
            ? { seriesRoot: RESULTS.seriesRoot, series: [SERIES], unreadable: [] }
            : { matchesRoot: RESULTS.matchesRoot, matches: [MATCH] },
        ),
      );
    });

    // The two listings, and then one read of each listed log for the label
    // its row is named by — at the URL the listing gave it, which is the same one
    // the row links its replay at.
    expect(asked).toEqual(["/api/series", "/api/matches", MATCH.url]);
    expect(results).toEqual(RESULTS);
  });

  it("fails with the console's own line when it refuses", async () => {
    const refuses = (): Promise<Response> =>
      Promise.resolve(Response.json({ error: "the series root is not there" }, { status: 500 }));

    await expect(fetchResults(refuses)).rejects.toThrow("the series root is not there");
  });
});

describe("readMatchHeader", () => {
  it("reads the two seats, the seed and the date out of the head of a log", async () => {
    const header = await readMatchHeader(MATCH.url, () => Promise.resolve(logAnswer(LOG_HEAD)));

    expect(header).toEqual(HEADER);
  });

  it("spells a model seat as its log names it, and a bot seat as the report spells it", async () => {
    const head = logHead({
      A: { kind: "bot", bot: "greedy" },
      B: { kind: "pi", model: "marvin/subagent", thinking: "medium", context_window: 131072 },
    });
    const header = await readMatchHeader(MATCH.url, () => Promise.resolve(logAnswer(head)));

    expect(header?.seats).toEqual(["bot:greedy", "marvin/subagent"]);
  });

  it("says nothing rather than the wrong thing about a log it cannot read", async () => {
    const missing = (): Promise<Response> =>
      Promise.resolve(Response.json({ error: "no match log at /logs/alpha/matches/x.json" }, { status: 404 }));
    // A log cut off inside its header has no seats to name and no date to give.
    const cutOff = (): Promise<Response> => Promise.resolve(new Response(LOG_HEAD.slice(0, 120)));

    expect(await readMatchHeader(MATCH.url, missing)).toBeNull();
    expect(await readMatchHeader(MATCH.url, cutOff)).toBeNull();
    expect(await readMatchHeader(MATCH.url, () => Promise.resolve(new Response("<!doctype html>not a log")))).toBeNull();
    expect(await readMatchHeader(MATCH.url, () => Promise.reject(new Error("the console is not there")))).toBeNull();
  });

  it("stops reading once the header is in hand, and does not take the match with it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(LOG_HEAD));
        // Everything the page must never ask for: the turns of a real match run
        // to the better part of a megabyte.
        for (let at = 0; at < 200; at += 1) {
          controller.enqueue(new TextEncoder().encode(`,"turn-${String(at)}":"${"x".repeat(2000)}"`));
        }
      },
      cancel() {
        cancelled = true;
      },
    });

    const header = await readMatchHeader(MATCH.url, () => Promise.resolve(new Response(body)));

    expect(header).toEqual(HEADER);
    expect(cancelled).toBe(true);
  });
});

describe("renderResults", () => {
  it("says which folders are in view, without naming them", () => {
    const { text } = drawn(RESULTS);

    expect(text).toContain(
      "This console lists the series and matches in the folders it was started with. " +
        "A series started somewhere else is not here.",
    );
    // The folders themselves are not on the page: a reader cannot do anything
    // with a path, and the caveat works without one.
    expect(text).not.toContain("/repo");
  });

  it("draws one row per series, with the console's figures and no others", () => {
    const { el, text } = drawn(RESULTS);

    expect(itemsOf(el, "series")).toHaveLength(1);
    expect(text).toContain("alpha");
    expect(text).toContain("bot:greedy vs bot:random");
    expect(text).toContain("4 of 4 pairs");
    expect(text).toContain("7 of 8 matches counted, 1 missing");
    // The rate the console answered with, as a percentage: the page does not
    // work out a win rate from the counts.
    expect(text).toContain("64.3%");
    expect(text).toContain("95% CI 38.7% – 83.7%");
    expect(text).toContain("stopped on max_pairs — its full length");
    // The counts are on the page only inside the row's own sentence, never as a
    // rate the page computed.
    expect(text).not.toContain("62.5%");
  });

  it("says a series with nothing counted has no win rate, rather than showing one", () => {
    const nothing = { ...SERIES, counted: 0, missing: 8, winRate: null, interval: null };
    const { text } = drawn({ ...RESULTS, series: [nothing] });

    expect(text).toContain("nothing counted, so no win rate");
    expect(text).not.toContain("NaN%");
    expect(text).not.toContain("0.0% (");
  });

  it("says when a series stopped short, and names the ceiling it stopped on", () => {
    const { text } = drawn({
      ...RESULTS,
      series: [{ ...SERIES, stopReason: "max_cost", stoppedEarly: true, ceilingUsd: 12.5, ceilingTokens: 900000 }],
    });

    expect(text).toContain("stopped on max_cost — short of its pair limit");
    expect(text).toContain("$12.50");
    expect(text).toContain("900,000 tokens");
  });

  it("offers a finished series for resume and sends its directory alone", () => {
    const el = section();
    const resumed: string[] = [];
    renderResults(el, RESULTS, (dir) => resumed.push(dir));

    const [button] = [...el.querySelectorAll<HTMLButtonElement>("button.resume")];
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(false);
    button!.click();

    // The pairing is the record's, not the page's: a resume that sent what the
    // page was displaying could resume a series under the wrong pairing.
    expect(resumed).toEqual(["/repo/series/alpha"]);
  });

  it("refuses a resume while the series' own run is in flight", () => {
    const el = section();
    const resumed: string[] = [];
    renderResults(el, { ...RESULTS, series: [{ ...SERIES, resumable: false }] }, (dir) => resumed.push(dir));

    const [button] = [...el.querySelectorAll<HTMLButtonElement>("button.resume")];
    expect(button!.disabled).toBe(true);
    expect(button!.title).toContain("still in flight");
    button!.click();
    expect(resumed).toEqual([]);
  });

  it("links every finished match at the viewer's URL for it, and says what the match was", () => {
    const el = section();
    const other = { ...LABELED, name: "1-x-y.json", series: null };
    renderResults(el, { ...RESULTS, matches: [LABELED, other] }, () => undefined);

    const links = [...el.querySelectorAll<HTMLAnchorElement>("a.match-viewer")];
    // The URLs are the console's, unchanged: only the words over them changed.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([MATCH.viewerUrl, MATCH.viewerUrl]);
    expect(links[0]!.textContent).toBe("bot:greedy vs bot:random — seed 1234, played 7 Oct 2026");
    expect(links[1]!.textContent).toBe("bot:greedy vs bot:random — seed 1234, played 7 Oct 2026");
    expect(itemsOf(el, "matches")).toEqual([
      "bot:greedy vs bot:random — seed 1234, played 7 Oct 2026 — from alpha",
      "bot:greedy vs bot:random — seed 1234, played 7 Oct 2026 — a match played on its own",
    ]);
  });

  it("says what a match was, and not what its log is called", () => {
    const { text } = drawn(RESULTS);

    expect(text).toContain("bot:greedy vs bot:random — seed 1234, played 7 Oct 2026");
    // A file name says those three things to whoever named the file, and nothing
    // to anyone reading the row.
    expect(text).not.toContain("1234-greedy-random");
  });

  it("says when a match log will not say what the match was", () => {
    const { text } = drawn({ ...RESULTS, matches: [{ ...LABELED, header: null }] });

    expect(text).toContain("a match whose log this console could not read");
    expect(text).not.toContain("1234-greedy-random");
  });

  it("keeps a record it cannot read on the page, with the line the console gave", () => {
    const { text } = drawn({
      ...RESULTS,
      unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "series.json is not a series record" }],
    });

    expect(text).toContain("broken");
    expect(text).toContain("series.json is not a series record");
  });

  it("says when there is nothing to list, in both folders", () => {
    const empty = { ...RESULTS, series: [], unreadable: [], matches: [] };
    const { text } = drawn(empty);

    expect(text).toContain("No series here yet.");
    expect(text).toContain("No finished match here yet.");
  });

  it("replaces the whole section, so a series that went away does not stay on the page", () => {
    const el = section();
    renderResults(el, RESULTS, () => undefined);
    renderResults(el, { ...RESULTS, series: [], matches: [] }, () => undefined);

    expect(itemsOf(el, "series")).toEqual([]);
    expect(itemsOf(el, "matches")).toEqual([]);
    expect(el.querySelectorAll("button.resume")).toHaveLength(0);
  });
});

describe("the words the results section speaks", () => {
  it("draws a section holding a series, a broken record and a match, in plain words", () => {
    // One of everything the section can draw, so a path or a file name sneaking
    // in through any one of the three kinds of row fails here.
    const { text } = drawn({
      ...RESULTS,
      unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "the record's second line is not JSON" }],
    });

    expectPlainWords("results", text);
  });

  it("passes the console's own line about a record it cannot read, path and all", () => {
    // The one row where a path belongs: the series is the record, and where it
    // lies is the fact the reader has to act on. The page adds no path of its
    // own; it repeats the line the console wrote.
    const { text } = drawn({
      ...RESULTS,
      unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "no series record under /repo/series/broken" }],
    });

    expect(text).toContain("no series record under /repo/series/broken");
  });
});
