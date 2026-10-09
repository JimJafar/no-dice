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
 * headline table is the other half of what this file owns: seven columns, in the
 * order the console gave, above the pairing table, each row carrying one control
 * that opens that model's detail. The links are the rest: a row that cannot be
 * followed to its `report.md` and to each of its matches in the replay viewer is a
 * row that cannot be checked.
 */
import { describe, expect, it } from "vitest";

import { expectPlainWords, wordsOf } from "./plain-words.ts";
import { renderLeaderboard } from "./render-leaderboard.ts";
import type { Leaderboard } from "./leaderboard.ts";
import type { MatchRow } from "./results.ts";

/** One series row, as the leaderboard answers it: seven counted matches, one missing. */
const SERIES = {
  name: "alpha",
  dir: "/repo/series/alpha",
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
  dir: "/repo/series/beta",
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

/** One result as the console answers it: the counts, and the rate over them. */
const result = (
  n: number,
  won: number,
  lost: number,
  drawn: number,
  rate: number | null,
  low: number,
  high: number,
) => ({
  n,
  won,
  lost,
  drawn,
  rate,
  interval: rate === null ? null : { low, high },
  confidence: 0.95,
});

/** One pooled model: ten counted matches, two missing, and a seat split worth seeing. */
const GREEDY = {
  label: "bot:greedy",
  matches: 10,
  result: result(10, 6, 3, 1, 0.65, 0.354, 0.872),
  seatSplit: { A: result(5, 4, 0, 1, 0.9, 0.4, 0.99), B: result(5, 2, 3, 0, 0.4, 0.12, 0.73) },
  missing: 2,
  missingNote:
    "2 missing matches attributed to the pairing rather than to this model: a match that never " +
    "produced a log was denied to both of its seats, and is not a loss.",
  series: ["/repo/series/alpha", "/repo/series/beta"],
};

/** A model that only ever played from one seat, and one no provider is priced under. */
const RANDOM = {
  label: "bot:random",
  matches: 3,
  result: result(3, 1, 1, 1, 0.5, 0.15, 0.85),
  seatSplit: { A: result(0, 0, 0, 0, null, 0, 0), B: result(3, 1, 1, 1, 0.5, 0.15, 0.85) },
  missing: 0,
  missingNote: "No match of the series this pairing names went missing.",
  series: ["/repo/series/beta"],
};

/** A model whose log header named no provider at all. */
const UNNAMED = {
  ...RANDOM,
  label: "subagent",
  matches: 4,
  result: result(4, 2, 2, 0, 0.5, 0.16, 0.84),
};

/** A finished log of one series, and what its own header says about the match. */
const MATCH: MatchRow = {
  name: "1234-greedy-subagent.json",
  path: "/repo/series/alpha/matches/1234-greedy-subagent.json",
  url: "/logs/alpha/matches/1234-greedy-subagent.json",
  viewerUrl: "/viewer/?log=/logs/alpha/matches/1234-greedy-subagent.json&back=%23matches",
  series: "alpha",
  header: {
    seats: ["bot:greedy", "marvin/subagent"] as [string, string],
    seed: 1234,
    playedOn: "2026-10-07T12:19:32.132Z",
  },
};

/** A finished log of the other series, and one played on its own. */
const BETA_MATCH: MatchRow = {
  name: "77-greedy-random.json",
  path: "/repo/series/beta/matches/77-greedy-random.json",
  url: "/logs/beta/matches/77-greedy-random.json",
  viewerUrl: "/viewer/?log=/logs/beta/matches/77-greedy-random.json&back=%23matches",
  series: "beta",
  header: {
    seats: ["bot:greedy", "bot:random"] as [string, string],
    seed: 77,
    playedOn: "2026-10-08T13:14:00.000Z",
  },
};

const ALONE: MatchRow = {
  name: "9-solo.json",
  path: "/repo/matches/9-solo.json",
  url: "/logs/9-solo.json",
  viewerUrl: "/viewer/?log=/logs/9-solo.json&back=%23matches",
  series: null,
  header: {
    seats: ["bot:greedy", "bot:random"] as [string, string],
    seed: 9,
    playedOn: "2026-10-09T12:00:00.000Z",
  },
};

/**
 * The link this view draws for a log: the same log the listing named, and this
 * table as the view the viewer goes back to — not the Matches view the listing's
 * own `viewerUrl` names.
 */
const MATCH_LINK = "/viewer/?log=/logs/alpha/matches/1234-greedy-subagent.json&back=%23leaderboard";
const BETA_LINK = "/viewer/?log=/logs/beta/matches/77-greedy-random.json&back=%23leaderboard";

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
const drawn = (
  board: Leaderboard,
  matches: readonly MatchRow[] = [MATCH, BETA_MATCH, ALONE],
  openModelDetail?: (label: string) => void,
) => {
  const el = section();
  renderLeaderboard(el, { board, matches, openModelDetail });
  return { el, text: el.textContent ?? "" };
};

/** One row per `tr` of one table, as its cells' text. */
const rowsOf = (el: HTMLElement, tableClass: string): string[][] =>
  [...el.querySelectorAll<HTMLTableRowElement>(`table.${tableClass} tbody tr`)].map((tr) =>
    [...tr.querySelectorAll<HTMLTableCellElement>("td")].map((td) => td.textContent ?? ""),
  );

/** One table's header row, as its column names. */
const headersOf = (el: HTMLElement, tableClass: string): string[] =>
  [...el.querySelectorAll<HTMLTableHeaderCellElement>(`table.${tableClass} thead th`)].map(
    (th) => th.textContent ?? "",
  );

/** Everything one table says, and nothing the rest of the section says. */
const tableText = (el: HTMLElement, tableClass: string): string =>
  el.querySelector(`table.${tableClass}`)?.textContent ?? "";

/** Every link in the section, as `class href text`. */
const linksOf = (el: HTMLElement, selector: string): string[] =>
  [...el.querySelectorAll<HTMLAnchorElement>(selector)].map(
    (a) => `${a.getAttribute("href")} ${a.textContent ?? ""}`,
  );

describe("renderLeaderboard", () => {
  it("states the folders both tables were read from, and that a series outside them is not counted", () => {
    const { text } = drawn(BOARD);

    expect(text).toContain(
      "Both tables are read from the series this console lists. A series started in some other " +
        "folder is not on this page",
    );
    // The reason the caveat is on the page rather than in a comment: an omitted
    // series reads as a model that never played it.
    expect(text).toContain("a model that never played it");
    // And it says so without naming the folder, which nobody reading a browser
    // can do anything with.
    expect(text).not.toContain("/repo");
  });

  it("draws one row per series, with the console's figures and no others", () => {
    const { el, text } = drawn(BOARD);
    const [row] = rowsOf(el, "leaderboard-series");

    expect(rowsOf(el, "leaderboard-series")).toHaveLength(2);
    expect(row![0]).toBe("alpha");
    // The pairing spelled the way the console spells a seat.
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

  it("links each series to the report this console serves for it", () => {
    const { el } = drawn(BOARD);

    expect(linksOf(el, "a.series-report")).toEqual([
      "/logs/alpha/report.md its report",
      "/logs/beta/report.md its report",
    ]);
  });

  it("fills a replay link's words in when the log's header arrives, without moving the link", async () => {
    const el = section();
    renderLeaderboard(el, {
      board: BOARD,
      matches: [{ ...MATCH, header: null }],
      headers: () => Promise.resolve(MATCH.header!),
    });

    const [link] = [...el.querySelectorAll<HTMLAnchorElement>("a.match-viewer")];
    expect(link.textContent).toBe("a match on seed 1234, whose log this console has not read");

    await new Promise((later) => void setTimeout(later, 0));

    expect(link.textContent).toBe("bot:greedy vs marvin/subagent — seed 1234, played 7 Oct 2026");
    expect(link.getAttribute("href")).toBe(MATCH_LINK);
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
    // belongs to comes from the `/api/matches` rows the page already holds. The
    // words over the link say what the match was, not what its log is called, and
    // the link goes back to this table rather than to the Matches view the listing
    // names for itself.
    expect(linksIn(rows[0]!)).toEqual([`${MATCH_LINK} bot:greedy vs marvin/subagent — seed 1234, played 7 Oct 2026`]);
    expect(linksIn(rows[1]!)).toEqual([`${BETA_LINK} bot:greedy vs bot:random — seed 77, played 8 Oct 2026`]);

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

  it("leads with one row per model: model, provider, matches, won, lost, drawn, win rate", () => {
    const { el, text } = drawn(BOARD);

    expect(headersOf(el, "leaderboard-models")).toEqual([
      "Model",
      "Provider",
      "Matches",
      "Won",
      "Lost",
      "Drawn",
      "Win rate",
    ]);
    const rows = rowsOf(el, "leaderboard-models");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["greedy", "bot", "10", "6", "3", "1", "65.0% (95% CI 35.4% – 87.2%)"]);
    expect(rows[1]).toEqual(["random", "bot", "3", "1", "1", "1", "50.0% (95% CI 15.0% – 85.0%)"]);

    // The four counts and the rate beside them are four readings of the answer's
    // one `winRate`. Nothing here subtracts the losses from `n`, averages the two
    // series' rates, takes a rate over the matches that went missing, or drops the
    // drawn match from the denominator.
    expect(text).not.toContain("57.1%");
    expect(text).not.toContain("54.2%");
    expect(text).not.toContain("60.0%");
  });

  it("puts that table above the per-pairing one, and keeps the order the console gave", () => {
    // `pooledModelRows` sorts best record first, label to settle a tie, and the
    // page draws them in that order rather than re-sorting them: a table that
    // reordered itself between two reads of one disk would read as the models
    // having moved. The headline goes first because it is the one a reader comes
    // for, and the pairing table stays below it.
    const { el } = drawn({ ...BOARD, models: [RANDOM, GREEDY] });

    expect([...el.querySelectorAll("table")].map((each) => each.className)).toEqual([
      "leaderboard-models",
      "leaderboard-series",
    ]);
    expect([...el.querySelectorAll("h3")].map((each) => each.textContent)).toEqual([
      "Per model, pooled over every series this console lists",
      "Per pairing — one row per series",
    ]);
    expect(rowsOf(el, "leaderboard-models").map((row) => row[0])).toEqual(["random", "greedy"]);
  });

  it("says who offers each model, and says so out loud when the log never named one", () => {
    const { el } = drawn({ ...BOARD, models: [{ ...GREEDY, label: "deepseek/deepseek-flash" }, UNNAMED] });
    const rows = rowsOf(el, "leaderboard-models");

    // The provider is the part before the first slash, and the model is the rest
    // of the label — which is how a seat is addressed everywhere else here.
    expect(rows[0]!.slice(0, 2)).toEqual(["deepseek-flash", "deepseek"]);
    // A model nobody prices still gets its row; what it does not get is a
    // provider this page made up.
    expect(rows[1]!.slice(0, 2)).toEqual(["subagent", "the log never named a provider"]);
  });

  it("gives each model row one control that opens that model's detail, by click and by keyboard", () => {
    const opened: string[] = [];
    const { el } = drawn(BOARD, [MATCH, BETA_MATCH, ALONE], (label) => void opened.push(label));

    const buttons = [...el.querySelectorAll<HTMLButtonElement>("button.model-detail")];
    // One control per row, in the row's own model cell, and no second way in.
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent)).toEqual(["greedy", "random"]);

    // A `<button>` is what makes it reachable without a pointer: it is in the tab
    // order on its own and the browser fires it on Enter and on Space, which
    // is more than a click handler on the `<tr>` can say. It is `type="button"`
    // because it is on a page with forms and must not submit one.
    expect(buttons.map((button) => button.type)).toEqual(["button", "button"]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, 0]);
    buttons[0]!.focus();
    expect(document.activeElement).toBe(buttons[0]);

    // And it names the model it opens in full, so a reader who cannot see the
    // table is not left with the word "greedy" and no idea which model it is.
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open the detail of bot:greedy",
      "Open the detail of bot:random",
    ]);

    buttons[0]!.click();
    buttons[1]!.click();
    expect(opened).toEqual(["bot:greedy", "bot:random"]);
  });

  it("draws no way in when the page has no detail to open", () => {
    // `openModelDetail` is optional, and a page that has no panel to open draws a
    // name rather than a control that does nothing when used.
    const { el } = drawn(BOARD);

    expect(el.querySelectorAll("button.model-detail")).toHaveLength(0);
    expect(rowsOf(el, "leaderboard-models")[0]![0]).toBe("greedy");
  });

  it("leaves the seat split, the series it pooled from and the missing note to the detail", () => {
    // They are the room the headline table bought with provider and
    // won/lost/drawn, and they come back in the panel a row opens. The
    // per-pairing table below is untouched.
    const { el } = drawn(BOARD);
    const models = tableText(el, "leaderboard-models");

    expect(models).not.toContain("seat");
    expect(models).not.toContain("missing");
    expect(models).not.toContain("alpha");
    expect(models).not.toContain("/repo");
    expect(headersOf(el, "leaderboard-series")).toEqual([
      "Series",
      "Pairing",
      "Pairs",
      "Matches",
      "Counted / missing",
      "Win rate",
      "Stopped",
      "Report",
      "Replays",
    ]);
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

    expect(text).toContain("No series here yet.");
    expect(text).toContain("No model has a counted match here yet");
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
    // The pairing table is nine columns of figures and the headline one is seven,
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

    // And the box is a control rather than just a box. Firefox and Safari leave an
    // unfocusable scroll container out of the tab order, so without this the
    // figures past the window's edge — the win rate of the headline table, and the
    // match logs at the end of the pairing one — would be unreachable without a
    // pointer.
    const boxes = [...el.querySelectorAll<HTMLDivElement>(".table-scroll")];
    expect(boxes.map((box) => box.tabIndex)).toEqual([0, 0]);
    expect(boxes.map((box) => box.getAttribute("role"))).toEqual(["region", "region"]);
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Leaderboard by model",
      "Leaderboard by pairing",
    ]);
  });

  it("sets a cell that holds nothing but a count in the numeral face", () => {
    // The four counts of the headline table are figures, not sentences, and the
    // viewer sets its figures in Barlow Semi Condensed so a column of them
    // lines up (`console.css`, `.num`).
    const { el } = drawn(BOARD);
    const counts = [...el.querySelectorAll<HTMLTableCellElement>("td.num")].map((td) => td.textContent);
    expect(counts).toEqual(["10", "6", "3", "1", "3", "1", "1", "1"]);
  });
});

describe("the words the leaderboard speaks", () => {
  it("draws both tables, a broken record and a match link, in plain words", () => {
    // Both tables and one of everything: a series row, a pooled row of each label
    // shape, a log of each series, and a record the console cannot read.
    const { el } = drawn({
      ...BOARD,
      models: [GREEDY, RANDOM, UNNAMED],
      unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "the record's second line is not JSON" }],
    });

    expectPlainWords("leaderboard", wordsOf(el));
  });

  it("keeps every directory out of the headline table", () => {
    // A pooled row names the series it pooled from by directory, and that column
    // is gone; the only way a path could reach this table is by the page printing
    // a directory it was handed, and it does not.
    const { el } = drawn({ ...BOARD, models: [{ ...GREEDY, series: ["/repo/series/gone"] }] });

    expect(tableText(el, "leaderboard-models")).not.toContain("/repo");
  });

  it("passes the console's own line about a record it cannot read, path and all", () => {
    // The exception, on the table where it matters most: the series is its
    // record, the console said where that record is, and a reader who wants the
    // matches back has to know which folder to look in.
    const { text } = drawn({
      ...BOARD,
      unreadable: [{ name: "broken", dir: "/repo/series/broken", error: "no series record under /repo/series/broken" }],
    });

    expect(text).toContain("no series record under /repo/series/broken");
  });
});
