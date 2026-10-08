// @vitest-environment happy-dom
/**
 * The Leaderboard section, on the page: what both tables draw from
 * one `/api/leaderboard` answer, and what they must never do.
 *
 * The figures are the stats package's — `packages/ui/src/leaderboard.test.ts`
 * proves the console's answer equals `no-dice stats` figure for figure — so the
 * weight here is on the page adding nothing: no rate divided out of the counts
 * beside it, no pooled rate averaged out of the per-series rows, a series
 * with nothing counted shown as having no rate rather than a rate of nought, and a
 * missing match drawn as a match that never happened rather than as a loss. The
 * links are the other half: a row that cannot be followed to its
 * `report.md` and to each of its matches in the replay viewer is a row that cannot
 * be checked.
 */
import { describe, expect, it } from "vitest";

import { renderLeaderboard } from "./render-leaderboard.ts";
import type { Leaderboard } from "./leaderboard.ts";
import type { MatchRow } from "./results.ts";

/** One series row, as the leaderboard answers it: seven counted matches, one missing. */
const SERIES = {
  name: "alpha",
  a: "bot:greedy",
  b: "marvin/subagent",
  maxPairs: 4,
  pairs: 4,
  matches: 8,
  counted: 7,
  missing: 1,
  stopReason: "max_pairs",
  stoppedEarly: false,
  winRate: 0.6428571428571429,
  interval: { low: 0.38712960064025523, high: 0.836883786832949 },
  confidence: 0.95,
  reportUrl: "/logs/alpha/report.md",
};

/** A second series, stopped short of its pair limit. */
const BETA = {
  ...SERIES,
  name: "beta",
  a: "bot:greedy",
  b: "bot:random",
  maxPairs: 10,
  pairs: 3,
  matches: 6,
  counted: 6,
  missing: 0,
  stopReason: "max_cost",
  stoppedEarly: true,
  winRate: 0.5,
  interval: { low: 0.224, high: 0.776 },
  reportUrl: "/logs/beta/report.md",
};

/** One result as the console answers it. */
const result = (n: number, rate: number | null, low: number, high: number) => ({
  n,
  rate,
  interval: rate === null ? null : { low, high },
  confidence: 0.95,
});

/** One pooled model: ten counted matches, two missing, and a seat split worth seeing. */
const GREEDY = {
  label: "bot:greedy",
  matches: 10,
  result: result(10, 0.65, 0.354, 0.872),
  seatSplit: { A: result(5, 0.9, 0.4, 0.99), B: result(5, 0.4, 0.12, 0.73) },
  missing: 2,
  missingNote:
    "2 missing matches attributed to the pairing rather than to this model: a match that never " +
    "produced a log was denied to both of its seats, and is not a loss.",
  series: ["/repo/series/alpha", "/repo/series/beta"],
};

/** A model that only ever played from one seat. */
const RANDOM = {
  label: "bot:random",
  matches: 3,
  result: result(3, 0.5, 0.15, 0.85),
  seatSplit: { A: result(0, null, 0, 0), B: result(3, 0.5, 0.15, 0.85) },
  missing: 0,
  missingNote: "No match of the series this pairing names went missing.",
  series: ["/repo/series/beta"],
};

/** A finished log of one series, as `/api/matches` answers it. */
const MATCH: MatchRow = {
  name: "1234-greedy-subagent.json",
  path: "/repo/series/alpha/matches/1234-greedy-subagent.json",
  url: "/logs/alpha/matches/1234-greedy-subagent.json",
  viewerUrl: "/viewer/?log=/logs/alpha/matches/1234-greedy-subagent.json",
  series: "alpha",
};

/** A finished log of the other series, and one played on its own. */
const BETA_MATCH: MatchRow = {
  name: "77-greedy-random.json",
  path: "/repo/series/beta/matches/77-greedy-random.json",
  url: "/logs/beta/matches/77-greedy-random.json",
  viewerUrl: "/viewer/?log=/logs/beta/matches/77-greedy-random.json",
  series: "beta",
};

const ALONE: MatchRow = {
  name: "9-solo.json",
  path: "/repo/matches/9-solo.json",
  url: "/logs/9-solo.json",
  viewerUrl: "/viewer/?log=/logs/9-solo.json",
  series: null,
};

/** Both tables, as the page holds them. */
const BOARD: Leaderboard = {
  seriesRoot: "/repo/series",
  series: [SERIES, BETA],
  models: [GREEDY, RANDOM],
  unreadable: [],
};

/** A section, as `index.html` has one. */
const section = (): HTMLElement => {
  const el = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = "Leaderboard";
  el.append(heading);
  document.body.append(el);
  return el;
};

/** Draw the section and read it back as text and elements. */
const drawn = (board: Leaderboard, matches: readonly MatchRow[] = [MATCH, BETA_MATCH, ALONE]) => {
  const el = section();
  renderLeaderboard(el, { board, matches });
  return { el, text: el.textContent ?? "" };
};

/** One row per `tr` of one table, as its cells' text. */
const rowsOf = (el: HTMLElement, tableClass: string): string[][] =>
  [...el.querySelectorAll<HTMLTableRowElement>(`table.${tableClass} tbody tr`)].map((tr) =>
    [...tr.querySelectorAll<HTMLTableCellElement>("td")].map((td) => td.textContent ?? ""),
  );

/** Every link in the section, as `class href text`. */
const linksOf = (el: HTMLElement, selector: string): string[] =>
  [...el.querySelectorAll<HTMLAnchorElement>(selector)].map(
    (a) => `${a.getAttribute("href")} ${a.textContent ?? ""}`,
  );

describe("renderLeaderboard", () => {
  it("states the root both tables were read from, and that a series outside it is not counted", () => {
    const { text } = drawn(BOARD);

    expect(text).toContain("/repo/series");
    expect(text).toContain("outside");
    expect(text).toContain("--dir");
    // The reason the caveat is on the page rather than in a comment: an omitted
    // series reads as a model that never played it.
    expect(text).toContain("a model that never played it");
  });

  it("draws one row per series, with the console's figures and no others", () => {
    const { el, text } = drawn(BOARD);
    const [row] = rowsOf(el, "leaderboard-series");

    expect(rowsOf(el, "leaderboard-series")).toHaveLength(2);
    expect(row![0]).toBe("alpha");
    // The pairing spelled as `--a` and `--b` spell it.
    expect(row![1]).toBe("bot:greedy vs marvin/subagent");
    expect(row![2]).toBe("4 of 4 pairs");
    expect(row![3]).toBe("8 matches");
    expect(row![4]).toBe("7 counted, 1 missing");
    expect(row![5]).toBe("64.3% (95% CI 38.7% – 83.7%)");
    expect(row![6]).toBe("stopped on max_pairs — its full length");
    expect(rowsOf(el, "leaderboard-series")[1]![6]).toBe("stopped on max_cost — short of its pair limit");

    // Nothing here is worked out: a rate over the record's eight matches,
    // or a counted share of them, would be a second account of the series.
    expect(text).not.toContain("57.1%");
    expect(text).not.toContain("87.5%");
  });

  it("links each series to the report.md this console serves for it", () => {
    const { el } = drawn(BOARD);

    expect(linksOf(el, "a.series-report")).toEqual([
      "/logs/alpha/report.md report.md",
      "/logs/beta/report.md report.md",
    ]);
  });

  it("links each series to its own matches in the replay viewer, and no one else's", () => {
    const el = section();
    renderLeaderboard(el, { board: BOARD, matches: [MATCH, BETA_MATCH, ALONE] });

    /** The match links of one row, as `href text`. */
    const linksIn = (tr: Element): string[] =>
      [...tr.querySelectorAll<HTMLAnchorElement>("a.match-viewer")].map(
        (a) => `${a.getAttribute("href")} ${a.textContent ?? ""}`,
      );

    const rows = [...el.querySelectorAll<HTMLTableRowElement>("table.leaderboard-series tbody tr")];
    // The `viewerUrl` is what opens a log in the viewer, and which series a log
    // belongs to comes from the `/api/matches` rows the page already holds.
    expect(linksIn(rows[0]!)).toEqual([`${MATCH.viewerUrl} ${MATCH.name}`]);
    expect(linksIn(rows[1]!)).toEqual([`${BETA_MATCH.viewerUrl} ${BETA_MATCH.name}`]);

    // A match played on its own belongs to no series row, and a series with no
    // log listed says so rather than showing a blank cell.
    const bare = section();
    renderLeaderboard(bare, { board: BOARD, matches: [ALONE] });
    expect(bare.textContent).toContain("no finished match listed for this series");
    expect(bare.querySelectorAll("a.match-viewer")).toHaveLength(0);
  });

  it("says a series with nothing counted has no win rate, rather than showing one", () => {
    const nothing = { ...SERIES, counted: 0, missing: 8, winRate: null, interval: null };
    const { el, text } = drawn({ ...BOARD, series: [nothing] });

    const [row] = rowsOf(el, "leaderboard-series");
    expect(row![5]).toBe("nothing counted, so no win rate");
    expect(row![5]).not.toContain("%");
    expect(text).not.toContain("NaN");
  });

  it("draws one row per model with its pooled rate, its counts, and the seat split beside it", () => {
    const { el, text } = drawn(BOARD);
    const [row] = rowsOf(el, "leaderboard-models");

    expect(rowsOf(el, "leaderboard-models")).toHaveLength(2);
    expect(row![0]).toBe("bot:greedy");
    expect(row![1]).toBe("10");
    expect(row![2]).toBe("2");
    expect(row![3]).toBe("65.0% (95% CI 35.4% – 87.2%)");
    // The split is the point of the row: a model that only wins from one seat is
    // visible as that, not as a good model.
    expect(row![4]).toBe("seat A: 5 matches — 90.0% (95% CI 40.0% – 99.0%)");
    expect(row![5]).toBe("seat B: 5 matches — 40.0% (95% CI 12.0% – 73.0%)");
    expect(row![6]).toContain("/repo/series/alpha");
    expect(row![6]).toContain("/repo/series/beta");

    // The pooled rate is the console's over the pooled ten: not the mean of the
    // two series' rates, and not one taken over the matches that went missing.
    expect(text).not.toContain("57.1%");
    expect(text).not.toContain("54.2%");
  });

  it("draws a missing match as a match that never happened, in the stats package's own words", () => {
    const { el, text } = drawn(BOARD);
    const [row] = rowsOf(el, "leaderboard-models");

    expect(row![7]).toBe(GREEDY.missingNote);
    expect(text).toContain("attributed to the pairing rather than to this model");
    expect(text).toContain("is not a loss");
    // A model that never played a seat says so, rather than showing a rate over nothing.
    expect(rowsOf(el, "leaderboard-models")[1]![4]).toBe("no match from seat A");
  });

  it("names a series whose record could not be read, with the line it failed on", () => {
    const { text } = drawn({
      ...BOARD,
      unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "series.json is not JSON" }],
    });

    expect(text).toContain("broken");
    expect(text).toContain("series.json is not JSON");
    expect(text).toContain("counts in neither table");
  });

  it("says when there is nothing to rank, in both tables", () => {
    const { text } = drawn({ seriesRoot: "/repo/series", series: [], models: [], unreadable: [] });

    expect(text).toContain("No series under /repo/series yet.");
    expect(text).toContain("No model has a counted match under /repo/series yet");
    // A series whose every match went missing has no counted match to pool, and
    // the stats package gives such a model no row at all — the page says why.
    expect(text).toContain("says nothing about the models its pairing names");
  });

  it("replaces the whole section, so a series that went away does not keep its row", () => {
    const el = section();
    renderLeaderboard(el, { board: BOARD, matches: [MATCH, BETA_MATCH] });
    renderLeaderboard(el, { board: { ...BOARD, series: [BETA], models: [] }, matches: [BETA_MATCH] });

    expect(rowsOf(el, "leaderboard-series")).toHaveLength(1);
    expect(rowsOf(el, "leaderboard-series")[0]![0]).toBe("beta");
    expect(rowsOf(el, "leaderboard-models")).toEqual([]);
    expect(el.querySelectorAll("a.series-report")).toHaveLength(1);
    expect(el.querySelectorAll("a.match-viewer")).toHaveLength(1);
  });

  it("puts each table in a box that scrolls on its own", () => {
    // The pairing table is nine columns of figures and the pooled one is eight,
    // and a table cannot be squeezed below the width of its own words. Loose in
    // the section, either would push the page itself sideways at a phone's width
    // and take the nav bar off the top of the screen with it; in a box of its own
    // it scrolls under its own header (`console.css`, `.table-scroll`).
    const { el } = drawn(BOARD);
    const tables = [...el.querySelectorAll("table")];
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.parentElement?.className, `${table.className} is not in a scroll box`).toBe("table-scroll");
    }
  });

  it("sets a cell that holds nothing but a count in the numeral face", () => {
    // The two counts of the pooled table are figures, not sentences, and the
    // viewer sets its figures in Barlow Semi Condensed so a column of them
    // lines up (`console.css`, `.num`).
    const { el } = drawn(BOARD);
    const counts = [...el.querySelectorAll<HTMLTableCellElement>("td.num")].map((td) => td.textContent);
    expect(counts).toEqual(["10", "2", "3", "0"]);
  });
});
