// @vitest-environment happy-dom
/**
 * The detail a leaderboard row opens: one read, one panel, and no figure that the
 * console did not answer.
 *
 * The weight here is on three things the panel can each get wrong in a different
 * way. **That it reads once:** `GET /api/model-detail` walks the series root and then
 * reads every log of every series that model played in, so a page that asked for it on
 * load, or polled it, or asked for it twice for one click would be doing the most
 * expensive thing on the page for nothing — and a panel that never appears because the
 * read is slow is a panel a reader assumes is broken. **That it adds nothing:** every
 * count, rate, interval and cost is the console's, and the only things said here
 * that are not in the answer are units and wording, which is why the win rate the panel
 * says is checked against the win rate the leaderboard table says for the same record.
 * **That it says who it is about:** the rules' five counters belong to the pairing
 * rather than to this model, the seat split says which seat played which match, and a
 * series that could not be read is named as one rather than going missing from a detail
 * that would then read as a model that never played there.
 */
import { describe, expect, it } from "vitest";

import { expectPlainWords, wordsOf } from "./plain-words.ts";
import { renderLeaderboard } from "./render-leaderboard.ts";
import {
  fetchModelDetail,
  modelDetailPathFor,
  openModelDetail,
  parseModelDetail,
  renderModelDetail,
} from "./render-model-detail.ts";
import type { Leaderboard } from "./leaderboard.ts";
import type { FetchJson } from "./api.ts";
import type { ModelDetailView } from "./render-model-detail.ts";

/** One result, as the console answers it: the counts, the rate, and the interval. */
const result = (n: number, wins: number, losses: number, draws: number, rate: number, low: number, high: number) => ({
  winRate: { n, wins, losses, draws, rate },
  interval: { low, high },
  confidence: 0.95,
});

/** The label the row asked for, spelled as its log headers spell it. */
const LABEL = "bot:greedy";

/**
 * The same result as the page holds it once parsed: the counts under the names the
 * page calls them. `POOLED` is a leaderboard row and so takes this shape, while the
 * detail answer above takes the wire shape `result` builds.
 */
const parsed = (n: number, won: number, lost: number, drawn: number, rate: number, low: number, high: number) => ({
  n,
  won,
  lost,
  drawn,
  rate,
  interval: { low, high },
  confidence: 0.95,
});

/** What one series' evidence read answered for this model, and where it links. */
const ALPHA = {
  name: "alpha",
  dir: "/repo/series/alpha",
  error: null,
  result: result(7, 5, 1, 1, 0.7142857142857143, 0.4, 0.9),
  seatSplit: { A: result(4, 3, 1, 0, 0.75, 0.319, 0.945), B: result(3, 2, 0, 1, 0.6666666666666666, 0.25, 0.94) },
  figures: {
    turnCount: 412,
    wallMs: 3584000,
    wallMsPerMatch: 512000,
    perTurn: { wallMs: 8699, costUsd: 0.03, tokens: 893000 },
    tokens: { input: 147000000, output: 19000000, cache_read: 55000000, cache_write: 1200000 },
    costUsd: 12.34,
    passedTurns: 3,
    passes: {
      no_submission: 1,
      timeout: 2,
      prompt_timeout: 0,
      token_budget: 0,
      provider_error: 0,
      harness_crash: 0,
      tool_surface: 0,
    },
    compactions: 4,
  },
  rules: { leadChanges: 12, flipsPerTurn: 6.5, nodeHandChanges: 3, neutralCaptures: 2, reScouts: 4 },
  matches: [
    {
      name: "12-greedy-subagent.json",
      path: "/repo/series/alpha/matches/12-greedy-subagent.json",
      url: "/logs/alpha/matches/12-greedy-subagent.json",
      viewerUrl: "/viewer/?log=/logs/alpha/matches/12-greedy-subagent.json&back=%23leaderboard",
      seed: 12,
    },
    {
      name: "15-greedy-subagent.json",
      path: "/repo/series/alpha/matches/15-greedy-subagent.json",
      url: "/logs/alpha/matches/15-greedy-subagent.json",
      viewerUrl: "/viewer/?log=/logs/alpha/matches/15-greedy-subagent.json&back=%23matches",
      seed: 15,
    },
  ],
  links: {
    reportUrl: "/logs/alpha/report.md",
    keptReportUrl: "/reports/alpha.md",
    keptEvidenceUrl: "/reports/alpha-evidence.md",
    keptReport: true,
    keptEvidence: false,
  },
};

/** A series whose record would not parse: no figures at all, and the line it failed on. */
const BROKEN = {
  name: "broken",
  dir: "/repo/series/broken",
  error: "the record's second line is not JSON",
  result: null,
  seatSplit: null,
  figures: null,
  rules: { error: "the record's second line is not JSON" },
  matches: [],
  links: {
    reportUrl: "/logs/broken/report.md",
    keptReportUrl: "/reports/broken.md",
    keptEvidenceUrl: "/reports/broken-evidence.md",
    keptReport: false,
    keptEvidence: false,
  },
};

/**
 * A series whose *evidence* read failed — the other failure the console answers, and
 * the one a block gets wrong if it reads its own shape off `error` alone. The figures
 * the report gave still stand, the rules' counters are gone, the block's line and the
 * rules' line are the same words, and the replay links come out of the read that
 * failed, so there are none.
 */
const EVIDENCE_FAILED = {
  ...ALPHA,
  error: "the evidence beside the record is not JSON",
  rules: { error: "the evidence beside the record is not JSON" },
  matches: [],
};

/** What `GET /api/model-detail` answers for that label: ten pooled matches, two series. */
const ANSWER = {
  label: LABEL,
  matches: 10,
  seats: { A: 5, B: 5 },
  result: result(10, 6, 3, 1, 0.6, 0.351, 0.872),
  seatSplit: { A: result(5, 3, 2, 0, 0.6, 0.231, 0.855), B: result(5, 3, 1, 1, 0.6, 0.231, 0.855) },
  missing: 1,
  missingNote:
    "1 missing match attributed to the pairing rather than to this model: " +
    "a match that never produced a log was denied to both of its seats, and is not a loss.",
  series: [ALPHA, BROKEN],
};

/** The same model's headline row: the pooled record this panel is about. */
const POOLED = {
  label: LABEL,
  matches: 10,
  result: parsed(10, 6, 3, 1, 0.6, 0.351, 0.872),
  seatSplit: { A: parsed(5, 3, 2, 0, 0.6, 0.231, 0.855), B: parsed(5, 3, 1, 1, 0.6, 0.231, 0.855) },
  missing: 1,
  missingNote:
    "1 missing match attributed to the pairing rather than to this model: " +
    "a match that never produced a log was denied to both of its seats, and is not a loss.",
  series: ["/repo/series/alpha"],
};

/** The leaderboard's own rows: the pairing rows name who played in `alpha`. */
const BOARD: Leaderboard = {
  seriesRoot: "/repo/series",
  series: [
    {
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
      winRate: 0.7142857142857143,
      interval: { low: 0.4, high: 0.9 },
      confidence: 0.95,
      reportUrl: "/logs/alpha/report.md",
    },
  ],
  models: [POOLED],
  unreadable: [],
};

/** A fetch that answers one detail and records every address it was asked for. */
const answering = (answer: unknown, asked: string[]): FetchJson => (path: string) => {
  asked.push(path);
  return Promise.resolve(Response.json(answer));
};

/** A panel, drawn on its own: what `renderModelDetail` puts on the page. */
const drawn = (view: ModelDetailView): { el: HTMLElement; text: string } => {
  const el = document.createElement("div");
  document.body.append(el);
  renderModelDetail(el, view);
  return { el, text: el.textContent ?? "" };
};

/** The ready state of a panel about `LABEL`, over the board's pairing rows. */
const ready = (detail: unknown = ANSWER): ModelDetailView => ({
  label: LABEL,
  read: { state: "ready", detail: parseModelDetail(detail) },
  series: BOARD.series,
  onClose: () => undefined,
});

/** The view wrapper and the row's control, as `index.html` and a click hold them. */
const mounted = (): { host: HTMLElement; opener: HTMLButtonElement } => {
  const host = document.createElement("div");
  host.id = "view-leaderboard";
  const opener = document.createElement("button");
  host.append(opener);
  document.body.append(host);
  opener.focus();
  return { host, opener };
};

describe("the model detail read", () => {
  it("asks for one label, spelled as the headers spell it", () => {
    expect(modelDetailPathFor("bot:greedy")).toBe("/api/model-detail?label=bot%3Agreedy");
    // A label with a slash in it is one model and not a path: the query is where it
    // has to survive.
    expect(modelDetailPathFor("marvin/subagent")).toBe("/api/model-detail?label=marvin%2Fsubagent");
  });

  it("reads the pooled figures, and the seat counts beside them", () => {
    const detail = parseModelDetail(ANSWER);
    expect(detail.matches).toBe(10);
    expect(detail.seats).toEqual({ A: 5, B: 5 });
    expect(detail.result).toEqual({
      n: 10,
      won: 6,
      lost: 3,
      drawn: 1,
      rate: 0.6,
      interval: { low: 0.351, high: 0.872 },
      confidence: 0.95,
    });
    expect(detail.missingNote).toContain("not a loss");
  });

  it("reads one series' own figures, seat split and rules", () => {
    const block = parseModelDetail(ANSWER).series[0]!;
    expect(block.name).toBe("alpha");
    expect(block.error).toBeNull();
    expect(block.result!.n).toBe(7);
    expect(block.seatSplit!.B.drawn).toBe(1);
    expect(block.figures!).toEqual({
      turnCount: 412,
      wallMsPerMatch: 512000,
      wallMsPerTurn: 8699,
      tokens: { input: 147000000, output: 19000000, cacheRead: 55000000 },
      costUsd: 12.34,
      passedTurns: 3,
      // The one reason the panel asks for by name: a timeout is a pass counted
      // under its own reason, and the other reasons are in the report it links.
      timeouts: 2,
      compactions: 4,
    });
    expect(block.rules).toEqual({
      leadChanges: 12,
      flipsPerTurn: 6.5,
      nodeHandChanges: 3,
      neutralCaptures: 2,
      reScouts: 4,
    });
    expect(block.matches.map((each) => each.seed)).toEqual([12, 15]);
    expect(block.links.keptReport).toBe(true);
    expect(block.links.keptEvidence).toBe(false);
  });

  it("keeps the line a series failed on, and the links it could still answer", () => {
    const block = parseModelDetail(ANSWER).series[1]!;
    expect(block.error).toBe("the record's second line is not JSON");
    expect(block.result).toBeNull();
    expect(block.figures).toBeNull();
    expect(block.rules).toEqual({ error: "the record's second line is not JSON" });
    expect(block.links.reportUrl).toBe("/logs/broken/report.md");
  });

  it("reads rules that failed as a line rather than as five noughts", () => {
    const rules = parseModelDetail({ ...ANSWER, series: [EVIDENCE_FAILED] }).series[0]!;
    expect(rules.rules).toEqual({ error: "the evidence beside the record is not JSON" });
    expect(rules.error).toBe("the evidence beside the record is not JSON");
    // The read that failed is the evidence's, so the report's figures survive it.
    expect(rules.figures?.turnCount).toBe(412);
    expect(rules.matches).toEqual([]);
  });

  it("names the field an answer is missing, rather than drawing a nought for it", () => {
    const without = structuredClone(ANSWER) as Record<string, unknown>;
    const series = without["series"] as Record<string, unknown>[];
    delete (series[0]!["figures"] as Record<string, unknown>)["turnCount"];
    expect(() => parseModelDetail(without)).toThrow("series[0].figures.turnCount is not a count");
  });

  it("refuses an answer that is not an answer at all", async () => {
    const asked: string[] = [];
    await expect(fetchModelDetail(LABEL, answering("the console answered 500", asked))).rejects.toThrow(
      "the answer from /api/model-detail is not an object",
    );
    expect(asked).toEqual(["/api/model-detail?label=bot%3Agreedy"]);
  });
});

describe("the model detail panel", () => {
  it("says the pooled record, the seat counts and what a missing match means", () => {
    const { text } = drawn(ready());
    expect(text).toContain("10 counted matches — 6 won, 3 lost, 1 drawn");
    expect(text).toContain("60.0% (95% CI 35.1% – 87.2%)");
    expect(text).toContain("It played 5 of them from seat A and 5 from seat B.");
    expect(text).toContain("1 missing match attributed to the pairing rather than to this model");
  });

  it("says a win rate the way the leaderboard table says the same one", () => {
    // The two views read the same record — `pooledModelRows`' row — and a rate that
    // reads one way in the table and another way in the panel is two accounts of one
    // match, which is the thing this page is built to avoid.
    const section = document.createElement("section");
    document.body.append(section);
    renderLeaderboard(section, { board: BOARD, matches: [] });
    const cell = [...section.querySelectorAll<HTMLTableCellElement>("table.leaderboard-models td")].at(-1)!;
    expect(cell.textContent).toBe("60.0% (95% CI 35.1% – 87.2%)");
    expect(drawn(ready()).text).toContain(String(cell.textContent));
  });

  it("draws one block per series, named with the pairing that played it", () => {
    const { el, text } = drawn(ready());
    expect(el.querySelectorAll("li.model-detail-block").length).toBe(2);
    // The detail answer names its series and no row of figures says who played it;
    // the pairing comes from the leaderboard's own per-pairing rows.
    expect(text).toContain("alpha — bot:greedy vs marvin/subagent");
    expect(text).toContain("broken");
  });

  it("draws each series' own interval, seat split and figures", () => {
    const { el, text } = drawn(ready());
    const alpha = el.querySelectorAll("li.model-detail-block")[0]!;
    const said = alpha.textContent ?? "";
    expect(said).toContain("71.4% (95% CI 40.0% – 90.0%) over 7 counted matches of that series");
    expect(said).toContain("from seat A: 3 won, 1 lost, 0 drawn — 75.0% (95% CI 31.9% – 94.5%)");
    expect(said).toContain("from seat B: 2 won, 0 lost, 1 drawn — 66.7% (95% CI 25.0% – 94.0%)");
    expect(said).toContain("412 turns");
    // The clock is one seat's own, and the line says so: the two seats of a match
    // play in turn, and "a match took 8 minutes" alone reads as the match's.
    expect(said).toContain("its own clock over the matches it played: a match took 8 minutes, a turn 9 seconds");
    expect(said).toContain("147M tokens in, 19M out, 55M read from cache");
    expect(said).toContain("cost $12.34");
    expect(said).toContain("3 turns passed, 2 of them out of time");
    expect(said).toContain("4 turns compacted their context");
    expect(text).toContain("broken");
  });

  it("says the rules' counters are the pairing's figures and not this model's", () => {
    const said = drawn(ready()).el.querySelectorAll("li.model-detail-block")[0]!.textContent ?? "";
    expect(said).toContain(
      "Across both seats of that pairing, which is what a board belongs to: " +
        "12 lead changes, about 6.5 hex flips a turn, 3 Node hand changes, 2 neutral captures, 4 re-scouts.",
    );
  });

  it("says which read failed, and keeps the figures that stand beside it", () => {
    const { el, text } = drawn(ready({ ...ANSWER, series: [EVIDENCE_FAILED] }));
    const block = el.querySelectorAll("li.model-detail-block")[0]!;

    // The console answers this case with the block's line and the rules' line set to
    // the same words, over figures it read from the report. So the block names the
    // read that failed where the five counters would have been...
    expect(text).toContain(
      "Its rules counters came from a read that failed: the evidence beside the record is not JSON",
    );
    // ...and does not say the series could not be read while printing the win rate,
    // the seat split and the clock it has just read from that same series.
    expect(text).not.toContain("This console could not read that series");
    expect(text).toContain("71.4% (95% CI 40.0% – 90.0%) over 7 counted matches of that series.");
    expect(text).toContain("412 turns");
    expect(text).toContain("cost $12.34");
    // The empty replay list is that read's absence, not a series with no matches in
    // it, and the block says which of the two it is.
    expect(text).toContain("Its replays come out of that same failed read, so none of them is linked here.");
    // The failed edge belongs to a block with nothing to read, not to one whose
    // figures stand.
    expect(block.className).toBe("model-detail-block");
    // And the line is said once, not twice over.
    expect(text.split("the evidence beside the record is not JSON").length).toBe(2);
  });

  it("puts one of a unit in the singular, and never calls a cost under a cent nothing", () => {
    const { text } = drawn(
      ready({
        ...ANSWER,
        series: [
          {
            ...ALPHA,
            figures: {
              ...ALPHA.figures,
              wallMsPerMatch: 60_000,
              perTurn: { ...ALPHA.figures.perTurn, wallMs: 1 },
              costUsd: 0.004,
            },
          },
        ],
      }),
    );
    expect(text).toContain("a match took 1 minute, a turn 1 millisecond");
    // `$0.00` for a cost that is not nought reads as a match that was free, which is
    // the opposite of what the console knows.
    expect(text).toContain("cost <$0.01");
    expect(text).not.toContain("cost $0.00");
  });

  it("links each counted match to its replay, back to this view", () => {
    const { el } = drawn(ready());
    const links = [...el.querySelectorAll<HTMLAnchorElement>("a.match-viewer")];
    expect(links.map((each) => each.textContent)).toEqual(["its replay on seed 12", "its replay on seed 15"]);
    // The second link arrives naming the Matches view as the way back; the panel is
    // in the Leaderboard view, so it restates that one.
    expect(links.map((each) => each.getAttribute("href"))).toEqual([
      "/viewer/?log=/logs/alpha/matches/12-greedy-subagent.json&back=%23leaderboard",
      "/viewer/?log=/logs/alpha/matches/15-greedy-subagent.json&back=%23leaderboard",
    ]);
  });

  it("links its report and the kept copies it says are there, and no others", () => {
    const { el, text } = drawn(ready());
    const alpha = el.querySelectorAll("li.model-detail-block")[0]!;
    const links = [...alpha.querySelectorAll<HTMLAnchorElement>("ul.model-detail-links a")];
    expect(links.map((each) => each.getAttribute("href"))).toEqual([
      "/logs/alpha/report.md",
      "/reports/alpha.md",
    ]);
    expect(links.map((each) => each.textContent)).toEqual([
      "its report",
      "the copy of its report this console keeps",
    ]);
    // The evidence copy was never carried out of the series directory, so the panel
    // offers no link to it.
    expect(text).not.toContain("broken-evidence.md");
    expect(el.querySelectorAll("li.model-detail-block")[1]!.querySelectorAll("a").length).toBe(1);
  });

  it("names a series it could not read, and still links what it has of it", () => {
    const { el, text } = drawn(ready());
    const broken = el.querySelectorAll("li.model-detail-block")[1]!;
    expect(broken.className).toContain("model-detail-block-failed");
    expect(text).toContain("This console could not read that series: the record's second line is not JSON");
    expect(broken.querySelectorAll("a").length).toBe(1);
    // The line is the console's own, repeated as it was written: whoever can fix
    // a record that will not parse is whoever can see what it failed on.
    expect(broken.textContent).not.toContain("71.4%");
    // And the same line is not said twice in one block, where the rules would be.
    expect((broken.textContent ?? "").split("the record's second line is not JSON").length).toBe(2);
    // The empty replay list is that same read's absence.
    expect(broken.textContent).toContain("Its replays come out of that same failed read");
  });

  it("says it is reading, before the answer has landed", () => {
    const { text, el } = drawn({ ...ready(), read: { state: "reading" } });
    expect(el.querySelectorAll(".model-detail-reading").length).toBe(1);
    expect(text).toContain("Reading that model's detail");
    expect(text).toContain("can take a moment");
  });

  it("says a failed read without pretending the leaderboard went with it", () => {
    const { text, el } = drawn({
      ...ready(),
      read: { state: "failed", error: "the console answered 500: the series root could not be read" },
    });
    expect(text).toContain("the console answered 500: the series root could not be read");
    expect(text).toContain("The leaderboard above is untouched");
    expect(el.querySelectorAll("li.model-detail-block").length).toBe(0);
  });

  it("closes on its own control, and is a dialog a reader is told the name of", () => {
    let closed = 0;
    const el = document.createElement("div");
    document.body.append(el);
    renderModelDetail(el, { ...ready(), onClose: () => (closed += 1) });
    const close = el.querySelector<HTMLButtonElement>(".model-detail-close")!;
    expect(close.getAttribute("aria-label")).toBe(`Close the detail of ${LABEL}`);
    close.click();
    expect(closed).toBe(1);
  });

  it("keeps the keyboard on the panel when the answer replaces what it was reading", () => {
    const el = document.createElement("div");
    el.tabIndex = -1;
    document.body.append(el);
    renderModelDetail(el, { ...ready(), read: { state: "reading" } });
    el.focus();
    el.querySelector<HTMLButtonElement>(".model-detail-close")!.focus();
    renderModelDetail(el, ready());
    // The close control the keyboard was on is gone with the reading state; the focus
    // stays inside the panel rather than falling back to the top of the page.
    expect(el.contains(document.activeElement)).toBe(true);
    expect(el.querySelector(".model-detail-close")).not.toBeNull();
  });

  it("speaks in plain words, apart from the lines it repeats about what failed", () => {
    const { el } = drawn(ready({ ...ANSWER, series: [ALPHA, EVIDENCE_FAILED] }));
    expectPlainWords("model detail", wordsOf(el));
  });
});

describe("opening a model detail", () => {
  it("reads once, at the moment the row is opened", async () => {
    const asked: string[] = [];
    const { host, opener } = mounted();
    const opened = openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: answering(ANSWER, asked),
      say: () => undefined,
    });
    // The panel is on the page, and says what it is doing, before the answer lands.
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(1);
    expect(host.querySelectorAll(".model-detail-reading").length).toBe(1);
    expect(asked).toEqual(["/api/model-detail?label=bot%3Agreedy"]);
    await opened;
    expect(host.textContent).toContain("10 counted matches");
    expect(asked.length).toBe(1);
  });

  it("takes focus when it opens and gives it back to the row when it closes", async () => {
    const { host, opener } = mounted();
    await openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: answering(ANSWER, []),
      say: () => undefined,
    });
    const panel = host.querySelector<HTMLElement>(".model-detail-panel")!;
    expect(document.activeElement === panel).toBe(true);
    expect(panel.getAttribute("role")).toBe("dialog");
    // Not `aria-modal`: nothing here makes the page behind it unreachable, and a
    // dialog that says it has when it has not is a dialog that lies.
    expect(panel.getAttribute("aria-modal")).toBeNull();

    panel.querySelector<HTMLButtonElement>(".model-detail-close")!.click();
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(0);
    expect(document.activeElement === opener).toBe(true);
  });

  it("closes on Escape, wherever in the page the keyboard is", async () => {
    const { host, opener } = mounted();
    await openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: answering(ANSWER, []),
      say: () => undefined,
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(0);
    expect(document.activeElement === opener).toBe(true);
  });

  it("leaves the panel standing when Escape is pressed in another view", async () => {
    const { host, opener } = mounted();
    await openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: answering(ANSWER, []),
      say: () => undefined,
    });
    // The panel is hidden with the Leaderboard view. A reader who has gone to another
    // view cannot see it, so Escape there is that view's own Escape: closing the
    // panel then would take away something nobody asked to take away, and put focus
    // on a control they cannot reach.
    host.hidden = true;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(1);
    // Back at the leaderboard, Escape is the panel's again.
    host.hidden = false;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(0);
  });

  it("opens one panel at a time, for the row that was opened last", async () => {
    const { host, opener } = mounted();
    const first = openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: answering(ANSWER, []),
      say: () => undefined,
    });
    await openModelDetail({
      host,
      opener,
      label: "marvin/subagent",
      series: BOARD.series,
      fetchJson: answering({ ...ANSWER, label: "marvin/subagent" }, []),
      say: () => undefined,
    });
    await first;
    const panels = host.querySelectorAll<HTMLElement>(".model-detail-panel");
    expect(panels.length).toBe(1);
    expect(panels[0]!.textContent).toContain("Detail of marvin/subagent");
  });

  it("is not reopened by a read that landed after it was closed", async () => {
    const { host, opener } = mounted();
    let land: (answer: unknown) => void = () => undefined;
    const opened = openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: () =>
        new Promise<Response>((resolve) => {
          land = (answer: unknown): void => resolve(Response.json(answer));
        }),
      say: () => undefined,
    });
    host.querySelector<HTMLElement>(".model-detail-panel")!.querySelector<HTMLButtonElement>(".model-detail-close")!.click();
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(0);
    land(ANSWER);
    await opened;
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(0);
  });

  it("says a failed read on the page's status line and leaves the tables standing", async () => {
    const section = document.createElement("section");
    document.body.append(section);
    renderLeaderboard(section, { board: BOARD, matches: [] });
    expect(section.querySelectorAll("table").length).toBe(2);

    const { host, opener } = mounted();
    const said: string[] = [];
    await openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: async () => {
        throw new Error("the console answered 500: the series root could not be read");
      },
      say: (message: string, bad?: boolean) => said.push(`${bad ? "bad" : "said"} ${message}`),
    });
    expect(said).toEqual(["bad the console answered 500: the series root could not be read"]);
    expect(host.textContent).toContain("The leaderboard above is untouched");
    expect(section.querySelectorAll("table").length).toBe(2);
  });

  it("leaves focus where it is when the row it came from is gone", async () => {
    const { host, opener } = mounted();
    await openModelDetail({
      host,
      opener,
      label: LABEL,
      series: BOARD.series,
      fetchJson: answering(ANSWER, []),
      say: () => undefined,
    });
    // The listings were read again and the table was replaced under the panel: the
    // control that opened it is no longer part of the page.
    opener.remove();
    host.querySelector<HTMLElement>(".model-detail-panel")!.querySelector<HTMLButtonElement>(".model-detail-close")!.click();
    expect(host.querySelectorAll(".model-detail-panel").length).toBe(0);
    expect(document.activeElement === opener).toBe(false);
  });
});
