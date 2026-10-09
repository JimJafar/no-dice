/**
 * The detail a leaderboard row opens: that model's pooled figures said in words,
 * and one block per series that counted a match for it.
 *
 * **The read belongs to the click.** `GET /api/model-detail` walks the series root
 * and then reads every log of every series that model played in, because the
 * rules' five counters come off the two boards each log carries and no report keeps
 * them (`packages/ui/src/model-detail.ts` says what one opening costs). So nothing
 * here runs on a page load and nothing is polled: the panel asks once, at the
 * moment a row is opened, and a reader who opens nothing pays nothing. That is also
 * why the panel says it is reading before it says what it found — the answer can
 * take seconds, and a control that appears to do nothing for seconds reads as a
 * control that did not work.
 *
 * **The page adds no arithmetic.** Every count, rate, interval, token total and
 * cost on the panel is the console's, which is the stats package's: the pooled
 * figures are `pooledModelRows`' row and each block is that series' own `ModelRow`
 * and `seriesEvidence` answer. What is added here is wording and units — `64.3%`
 * for `0.6428…`, `$12.34`, `8 minutes` for a number of milliseconds, `1.2M` for a
 * token count — and the same four units the rest of the page already uses, so a
 * figure does not change shape between the table and the panel. A win rate divided
 * out of the counts beside it, or a per-match time divided out of a total here,
 * would be a second account of the same matches, and the two would drift.
 *
 * **The rules' five counters are the series' figures, not this model's.** A lead,
 * a board and a Node hand belong to the match rather than to one of its seats, so
 * the route answers them for the pairing and the panel says so in the sentence that
 * draws them. A reader who is shown "12 lead changes" inside a block about one
 * model would otherwise read it as that model's own twelve.
 *
 * **The pairing is looked up, not re-read.** A detail block names its series, and a
 * `ModelRow` names no pairing — a row of figures does not say who played it —
 * so the two seats come from the leaderboard's own per-pairing rows, which the page
 * already holds. Asking the route for them as well would be a second answer about
 * one `series.json`, and the two could disagree on the page that shows both.
 *
 * **What cannot be read, and where the line goes.** A read that fails leaves the
 * leaderboard standing — the panel is not in the section, so it cannot take the
 * tables with it — and says the console's own line on the page's status line, as
 * every other failed read does, and again inside the panel, because the reader
 * clicked one row and needs to know that it is that row's read that failed. A
 * series whose record or evidence failed stays a block carrying the line it failed
 * on, with the links the console could still answer for it; a series that has
 * quietly gone missing from a model's detail would read as a series that model
 * never played. Those lines are repeated as the console wrote them, which is the
 * one place the panel keeps a path or a file name — the same rule the leaderboard's
 * unreadable rows hold, and for the same reason: whoever can fix it is the one who
 * has to see what it failed on.
 *
 * **The panel is drawn over the Leaderboard view, not inside the section.**
 * `render-leaderboard.ts` replaces everything under its heading on every listings
 * read, and a panel inside it would be a panel that closes itself because a run
 * ended in another view. So it goes into the view's own wrapper, which is what
 * hides it when the reader goes to another view and shows it again when they come
 * back.
 *
 * **It is a dialog, and not a modal one.** It takes focus when it opens, gives it
 * back to the row's control when it closes, and closes on Escape and on its own
 * control. It does not claim `aria-modal`, because nothing here makes the page
 * behind it inert or traps the tab order inside it, and a dialog that tells a
 * screen reader the rest of the page is gone while it is still reachable is a
 * dialog that lies.
 */
import { getJson } from "./api.ts";
import type { FetchJson } from "./api.ts";
import { clear } from "./render-frame.ts";
import type { Interval, ResultCell, SeriesRow } from "./leaderboard.ts";
import { viewerUrlFor } from "./results.ts";

/** Where the page reads one model's detail. */
export const MODEL_DETAIL_PATH = "/api/model-detail";

/** The view a block's replay links go back to, as the console's own URL spells it. */
const LEADERBOARD_VIEW = "leaderboard" as const;

/** The line the page says about itself, as `main.ts` owns it. */
type Say = (message: string, bad?: boolean) => void;

/** One model's figures for one series, as the panel draws them. */
export interface DetailFigures {
  turnCount: number;
  /** That model's own clock over the matches it played there, divided out by the route. */
  wallMsPerMatch: number;
  wallMsPerTurn: number;
  tokens: { input: number; output: number; cacheRead: number };
  costUsd: number;
  /** Turns that ended in a pass, whatever the reason, and the ones that ran out of time. */
  passedTurns: number;
  timeouts: number;
  /** How many of this model's turns compacted their context. */
  compactions: number;
}

/**
 * The rules' five counters for one series. They count both seats of its pairing,
 * which is why the sentence that draws them says whose figures they are.
 */
export interface DetailRules {
  leadChanges: number;
  flipsPerTurn: number;
  nodeHandChanges: number;
  neutralCaptures: number;
  reScouts: number;
}

/** Those five, or the one line the evidence read failed on. */
export type RulesAnswer = DetailRules | { error: string };

/** One match this block counts, linked to its replay. */
export interface DetailMatchLink {
  /** The seed it was played on: a seed names a pair, so it names two matches. */
  seed: number;
  /** The viewer's address for it, with the Leaderboard view as the way back. */
  viewerUrl: string;
}

/** What a block links to, and which of its kept copies the console says are there. */
export interface DetailLinks {
  reportUrl: string;
  keptReportUrl: string;
  keptEvidenceUrl: string;
  keptReport: boolean;
  keptEvidence: boolean;
}

/** One series that counted a match for this model, or one this console could not read. */
export interface DetailBlock {
  name: string;
  /** The line the record or the evidence failed on, or `null` when it was read. */
  error: string | null;
  result: ResultCell | null;
  seatSplit: { A: ResultCell; B: ResultCell } | null;
  figures: DetailFigures | null;
  rules: RulesAnswer;
  matches: DetailMatchLink[];
  links: DetailLinks;
}

/** What `GET /api/model-detail` answers, in the shapes this page draws. */
export interface ModelDetail {
  label: string;
  matches: number;
  /** How many of those matches this model played from each seat. */
  seats: { A: number; B: number };
  /** The pooled record, with the interval over the pooled `n`. */
  result: ResultCell;
  /** The stats package's own words for what `missing` is: drawn as they came. */
  missingNote: string;
  series: DetailBlock[];
}

/** The read, in the three states the panel draws it in. */
export type DetailRead =
  | { state: "reading" }
  | { state: "failed"; error: string }
  | { state: "ready"; detail: ModelDetail };

/** What the panel draws, and who closes it. */
export interface ModelDetailView {
  /** The label the row asked for, which the panel titles itself with. */
  label: string;
  read: DetailRead;
  /**
   * The leaderboard's per-pairing rows: a block names its series, and this is the
   * answer the page already holds that says who played in it.
   */
  series: readonly SeriesRow[];
  onClose: () => void;
}

/** Anything that should have been an object, as the line that says it was not. */
const recordOf = (value: unknown, what: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
};

/** A word, or the line that says the answer is not one. */
const stringOf = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw new Error(`${what} is not a string`);
  return value;
};

/** A count, or the line that says the answer is not one. */
const countOf = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a count`);
  return value;
};

/** A yes or no, or the line that says the answer is neither. */
const boolOf = (value: unknown, what: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${what} is not a yes or no`);
  return value;
};

/** A rate that may be absent, or the line that says it is neither. */
const rateOf = (value: unknown, what: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a rate`);
  return value;
};

/** The interval a result quotes, or `null` for a result over nothing counted. */
const intervalOf = (value: unknown, what: string): Interval | null => {
  if (value === null) return null;
  const interval = recordOf(value, what);
  return { low: countOf(interval["low"], `${what}.low`), high: countOf(interval["high"], `${what}.high`) };
};

/** A list, or the line that says the answer is not one. */
const listOf = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list`);
  return value;
};

/**
 * One result as the console answers it — the pooled one, or one series' own, or one
 * seat's. The won, lost and drawn counts are the answer's own, kept under the
 * words the panel calls them, and are never subtracted out of `n` here.
 */
const resultOf = (value: unknown, what: string): ResultCell => {
  const result = recordOf(value, what);
  const winRate = recordOf(result["winRate"], `${what}.winRate`);
  return {
    n: countOf(winRate["n"], `${what}.winRate.n`),
    won: countOf(winRate["wins"], `${what}.winRate.wins`),
    lost: countOf(winRate["losses"], `${what}.winRate.losses`),
    drawn: countOf(winRate["draws"], `${what}.winRate.draws`),
    rate: rateOf(winRate["rate"], `${what}.winRate.rate`),
    interval: intervalOf(result["interval"], `${what}.interval`),
    confidence: countOf(result["confidence"], `${what}.confidence`),
  };
};

/** The same counts over only the matches this model played from each seat. */
const seatSplitOf = (value: unknown, what: string): { A: ResultCell; B: ResultCell } => {
  const split = recordOf(value, what);
  return { A: resultOf(split["A"], `${what}.A`), B: resultOf(split["B"], `${what}.B`) };
};

/**
 * One series' figures for this model.
 *
 * `passes` arrives as a count by reason and only two of those figures are drawn:
 * the turns that ended in a pass, and the ones that ran out of time. The other
 * reasons are in the series' own report, which the block links; the panel asks for
 * the three figures the leaderboard's detail was asked for and not for a table of
 * seven it has no room for.
 */
const figuresOf = (value: unknown, what: string): DetailFigures => {
  const figures = recordOf(value, what);
  const perTurn = recordOf(figures["perTurn"], `${what}.perTurn`);
  const tokens = recordOf(figures["tokens"], `${what}.tokens`);
  const passes = recordOf(figures["passes"], `${what}.passes`);
  return {
    turnCount: countOf(figures["turnCount"], `${what}.turnCount`),
    wallMsPerMatch: countOf(figures["wallMsPerMatch"], `${what}.wallMsPerMatch`),
    wallMsPerTurn: countOf(perTurn["wallMs"], `${what}.perTurn.wallMs`),
    tokens: {
      input: countOf(tokens["input"], `${what}.tokens.input`),
      output: countOf(tokens["output"], `${what}.tokens.output`),
      cacheRead: countOf(tokens["cache_read"], `${what}.tokens.cache_read`),
    },
    costUsd: countOf(figures["costUsd"], `${what}.costUsd`),
    passedTurns: countOf(figures["passedTurns"], `${what}.passedTurns`),
    timeouts: countOf(passes["timeout"], `${what}.passes.timeout`),
    compactions: countOf(figures["compactions"], `${what}.compactions`),
  };
};

/**
 * The rules' five counters, or the line the evidence read failed on.
 *
 * The route answers a failed read as `{ error }` and a read one as the five counts,
 * so the shape decides which this is; a block with neither is named as the field
 * that is missing rather than drawn as five noughts.
 */
const rulesOf = (value: unknown, what: string): RulesAnswer => {
  const rules = recordOf(value, what);
  const error = rules["error"];
  if (typeof error === "string") return { error };
  return {
    leadChanges: countOf(rules["leadChanges"], `${what}.leadChanges`),
    flipsPerTurn: countOf(rules["flipsPerTurn"], `${what}.flipsPerTurn`),
    nodeHandChanges: countOf(rules["nodeHandChanges"], `${what}.nodeHandChanges`),
    neutralCaptures: countOf(rules["neutralCaptures"], `${what}.neutralCaptures`),
    reScouts: countOf(rules["reScouts"], `${what}.reScouts`),
  };
};

/** One counted match of one block, and the replay this console serves for it. */
const matchLinkOf = (value: unknown, what: string): DetailMatchLink => {
  const link = recordOf(value, what);
  return {
    seed: countOf(link["seed"], `${what}.seed`),
    viewerUrl: stringOf(link["viewerUrl"], `${what}.viewerUrl`),
  };
};

/**
 * What a block links to.
 *
 * The two kept copies carry whether the console says they are on disk, because
 * `docs/series-notes.md` §7 says they are copied out by hand and it has been
 * forgotten; the page offers no link to a report nobody copied.
 */
const linksOf = (value: unknown, what: string): DetailLinks => {
  const links = recordOf(value, what);
  return {
    reportUrl: stringOf(links["reportUrl"], `${what}.reportUrl`),
    keptReportUrl: stringOf(links["keptReportUrl"], `${what}.keptReportUrl`),
    keptEvidenceUrl: stringOf(links["keptEvidenceUrl"], `${what}.keptEvidenceUrl`),
    keptReport: boolOf(links["keptReport"], `${what}.keptReport`),
    keptEvidence: boolOf(links["keptEvidence"], `${what}.keptEvidence`),
  };
};

/** One series this model played in, or one this console could not read. */
const blockOf = (value: unknown, what: string): DetailBlock => {
  const block = recordOf(value, what);
  const error = block["error"];
  if (error !== null && typeof error !== "string") throw new Error(`${what}.error is not a line`);
  const result = block["result"];
  const seatSplit = block["seatSplit"];
  const figures = block["figures"];
  return {
    name: stringOf(block["name"], `${what}.name`),
    error,
    result: result === null ? null : resultOf(result, `${what}.result`),
    seatSplit: seatSplit === null ? null : seatSplitOf(seatSplit, `${what}.seatSplit`),
    figures: figures === null ? null : figuresOf(figures, `${what}.figures`),
    rules: rulesOf(block["rules"], `${what}.rules`),
    matches: listOf(block["matches"], `${what}.matches`).map((each, at) =>
      matchLinkOf(each, `${what}.matches[${String(at)}]`),
    ),
    links: linksOf(block["links"], `${what}.links`),
  };
};

/**
 * The answer from `GET /api/model-detail`. A field the panel draws is named in the
 * line when the answer is missing it, because whoever reads that line is the one who
 * can go and fix what the console read.
 */
export const parseModelDetail = (value: unknown): ModelDetail => {
  const answer = recordOf(value, "the answer from /api/model-detail");
  const seats = recordOf(answer["seats"], "seats");
  return {
    label: stringOf(answer["label"], "label"),
    matches: countOf(answer["matches"], "matches"),
    seats: { A: countOf(seats["A"], "seats.A"), B: countOf(seats["B"], "seats.B") },
    result: resultOf(answer["result"], "result"),
    missingNote: stringOf(answer["missingNote"], "missingNote"),
    series: listOf(answer["series"], "series").map((each, at) => blockOf(each, `series[${String(at)}]`)),
  };
};

/** The route's address for one label, spelled as the log headers spell it. */
export const modelDetailPathFor = (label: string): string =>
  `${MODEL_DETAIL_PATH}?label=${encodeURIComponent(label)}`;

/**
 * One model's detail, in one read.
 *
 * The label goes in the query percent-encoded, because a model id may carry a slash,
 * a colon or a space, and the route takes the label as it is spelled.
 */
export const fetchModelDetail = async (label: string, fetchJson: FetchJson = fetch): Promise<ModelDetail> =>
  parseModelDetail(await getJson<unknown>(modelDetailPathFor(label), fetchJson));

/* ------------------------------------------------------------------ drawing */

/** A short element with a class and a sentence. */
const paragraph = (className: string, text: string): HTMLElement => {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
};

/** A link to something this console serves. */
const link = (className: string, href: string, text: string): HTMLAnchorElement => {
  const el = document.createElement("a");
  el.className = className;
  el.href = href;
  el.textContent = text;
  return el;
};

/** A list with a class, filled by whoever knows what its items are. */
const list = (className: string, items: readonly Node[]): HTMLElement => {
  const el = document.createElement("ul");
  el.className = className;
  el.append(...items);
  return el;
};

/** One item of one of the panel's lists. */
const item = (text: string): HTMLLIElement => {
  const li = document.createElement("li");
  li.textContent = text;
  return li;
};

/** A rate as the report writes it, and as the leaderboard's own table writes it. */
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A confidence level as the report writes it: whole percent, no decimals. */
const level = (n: number): string => `${String(Math.round(n * 100))}%`;

/** An interval as the report writes it, in the report's own order. */
const span = (interval: Interval): string => `${pct(interval.low)} – ${pct(interval.high)}`;

/**
 * A win rate with the interval over the same matches, in the leaderboard table's
 * own words. Nothing counted is said as having no rate: a `0.0%` over no matches
 * would read as a model that lost, which is the opposite of what happened.
 */
const rateWith = (result: ResultCell): string =>
  result.rate === null || result.interval === null
    ? "nothing counted, so no win rate"
    : `${pct(result.rate)} (${level(result.confidence)} CI ${span(result.interval)})`;

/** Tokens as the page reads them: three significant figures, and `M` for millions. */
const tokensAs = (tokens: number): string =>
  tokens < 1_000_000 ? String(tokens) : `${String(Number((tokens / 1_000_000).toPrecision(3)))}M`;

/** What a seat cost, or the truth about hardware nobody prices. */
const costAs = (costUsd: number): string => (costUsd === 0 ? "no cost on record" : `$${costUsd.toFixed(2)}`);

/**
 * A wall clock in the units a person reads a duration in.
 *
 * It is a seat's own clock and not the match's, and the sentence that draws it says
 * so: the two seats of a match play in turn, so the page has no licence to add
 * the two into one. The milliseconds are put into units here and nothing else — the
 * per-match figure is the route's division, made over the same matches the block
 * counts. Unlike the start section's estimate, this one goes below a second: a bot's
 * turn takes milliseconds, and `0 seconds` for one would read as a turn that took no
 * time at all.
 */
const durationAs = (ms: number): string => {
  if (ms < 1000) return `${String(Math.round(ms))} milliseconds`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  return rest === 0 ? `${String(hours)} hours` : `${String(hours)} hours ${String(rest)} minutes`;
};

/**
 * A mean the stats package already divided per turn, put to one decimal place.
 *
 * The division is not done here: `flipsPerTurn` is the evidence read's own mean, and
 * this only decides how many digits of it a sentence carries.
 */
const perTurnAs = (n: number): string => n.toFixed(1);

/** The panel's heading, and the one control that closes it. */
const head = (label: string, onClose: () => void): HTMLElement => {
  const box = document.createElement("div");
  box.className = "model-detail-head";

  const title = document.createElement("h3");
  title.className = "model-detail-title";
  title.textContent = `Detail of ${label}`;

  const button = document.createElement("button");
  button.className = "model-detail-close";
  button.type = "button";
  button.textContent = "Close";
  // The control says what it closes, because a panel that covers the table is
  // the only thing telling the reader which model they were looking at.
  button.setAttribute("aria-label", `Close the detail of ${label}`);
  button.addEventListener("click", onClose);

  box.append(title, button);
  return box;
};

/** The pooled figures, in the order a reader asks for them. */
const pooledWords = (detail: ModelDetail): Node[] => {
  const plural = detail.matches === 1 ? "match" : "matches";
  const record = paragraph(
    "model-detail-pool",
    `${String(detail.matches)} counted ${plural} — ${String(detail.result.won)} won, ` +
      `${String(detail.result.lost)} lost, ${String(detail.result.drawn)} drawn — ` +
      `and ${rateWith(detail.result)}.`,
  );
  const seats = paragraph(
    "model-detail-seats",
    `It played ${String(detail.seats.A)} of them from seat A and ${String(detail.seats.B)} from seat B.`,
  );
  // The stats package's own sentence about what its `missing` is, drawn as it
  // arrived: a number beside a win rate reads as a lost match otherwise.
  return [record, seats, paragraph("model-detail-missing", detail.missingNote)];
};

/** One seat's own record, in the same words the pooled record is said in. */
const seatWords = (seat: "A" | "B", result: ResultCell): HTMLLIElement =>
  item(
    `from seat ${seat}: ${String(result.won)} won, ${String(result.lost)} lost, ` +
      `${String(result.drawn)} drawn — ${rateWith(result)}`,
  );

/** One series' figures for this model, one figure to a line. */
const figureWords = (figures: DetailFigures): HTMLElement =>
  list("model-detail-figures", [
    item(`${String(figures.turnCount)} turns`),
    item(`a match took ${durationAs(figures.wallMsPerMatch)}, a turn ${durationAs(figures.wallMsPerTurn)}`),
    item(
      `${tokensAs(figures.tokens.input)} tokens in, ${tokensAs(figures.tokens.output)} out, ` +
        `${tokensAs(figures.tokens.cacheRead)} read from cache`,
    ),
    item(`cost ${costAs(figures.costUsd)}`),
    item(`${String(figures.passedTurns)} turns passed, ${String(figures.timeouts)} of them out of time`),
    item(`${String(figures.compactions)} turns compacted their context`),
  ]);

/** The rules' five counters, said as that series' own figures. */
const rulesWords = (rules: RulesAnswer): HTMLElement => {
  if ("error" in rules) {
    return paragraph("model-detail-rules-failed", `Its rules counters came from a read that failed: ${rules.error}`);
  }
  return paragraph(
    "model-detail-rules",
    `Across both seats of that pairing, which is what a board belongs to: ` +
      `${String(rules.leadChanges)} lead changes, about ${perTurnAs(rules.flipsPerTurn)} hex flips a turn, ` +
      `${String(rules.nodeHandChanges)} Node hand changes, ${String(rules.neutralCaptures)} neutral captures, ` +
      `${String(rules.reScouts)} re-scouts.`,
  );
};

/** The matches this block counts, each linked to its replay in the console's viewer. */
const replayWords = (matches: readonly DetailMatchLink[]): Node => {
  if (matches.length === 0) {
    return paragraph("model-detail-replays-none", "No replay of that series is linked from this detail.");
  }
  const items = matches.map((each) => {
    const li = document.createElement("li");
    // The route already names the Leaderboard view as the way back, and this says it
    // again for the view doing the drawing — the same call the per-pairing table's
    // links make, so a replay opened from either lands the reader where they came from.
    li.append(
      link("match-viewer", viewerUrlFor(each.viewerUrl, LEADERBOARD_VIEW), `its replay on seed ${String(each.seed)}`),
    );
    return li;
  });
  return list("model-detail-replays", items);
};

/** What a block links to — and no link to a kept copy the console says is not there. */
const reportWords = (links: DetailLinks): HTMLElement => {
  const items = [link("series-report", links.reportUrl, "its report")];
  if (links.keptReport) {
    items.push(link("kept-report", links.keptReportUrl, "the copy of its report this console keeps"));
  }
  if (links.keptEvidence) {
    items.push(link("kept-evidence", links.keptEvidenceUrl, "the copy of its rules evidence this console keeps"));
  }
  return list("model-detail-links", items);
};

/** The pairing a block's series was played by, from the leaderboard's own rows. */
const pairingOf = (name: string, series: readonly SeriesRow[]): string | null => {
  const row = series.find((each) => each.name === name);
  return row === undefined ? null : `${row.a} vs ${row.b}`;
};

/** One series: its name and pairing, its own figures, its rules, and what it links. */
const blockWords = (block: DetailBlock, series: readonly SeriesRow[]): HTMLElement => {
  const el = document.createElement("li");
  el.className = block.error === null ? "model-detail-block" : "model-detail-block model-detail-block-failed";

  const pairing = pairingOf(block.name, series);
  const heading = document.createElement("h4");
  heading.className = "model-detail-series-name";
  heading.textContent = pairing === null ? block.name : `${block.name} — ${pairing}`;
  el.append(heading);

  // A block that failed is drawn the same way as one that did not, with the
  // line it failed on under its name: the console answers a series whose *record*
  // could not be read with no figures at all, and a series whose *evidence*
  // could not be read with figures that stand and rules that do not. Which of the
  // two it was is the line's business, and the block draws whatever it was given.
  if (block.error !== null) {
    el.append(paragraph("model-detail-error", `This console could not read that series: ${block.error}`));
  }

  if (block.result !== null) {
    el.append(
      paragraph(
        "model-detail-rate",
        `${rateWith(block.result)} over ${String(block.result.n)} counted matches of that series.`,
      ),
    );
  }
  if (block.seatSplit !== null) {
    el.append(list("model-detail-seat-split", [seatWords("A", block.seatSplit.A), seatWords("B", block.seatSplit.B)]));
  }
  if (block.figures !== null) el.append(figureWords(block.figures));
  // The rules' counters failed on the same read that the replay links came from, so
  // a block that has already said that line under its name does not say it again
  // where the five counters would have been: the same line twice in one block says
  // no more than it does once.
  if (!("error" in block.rules && block.rules.error === block.error)) {
    el.append(rulesWords(block.rules));
  }
  el.append(replayWords(block.matches));
  el.append(reportWords(block.links));
  return el;
};

/**
 * The panel: its heading and close control, and one of three bodies — the read on
 * its way, the line it failed on, or the detail itself.
 *
 * The whole panel is replaced on every draw, the way every other section is: a
 * panel that kept its old figures under a new read would be a panel saying two
 * things about one model.
 */
export const renderModelDetail = (el: HTMLElement, view: ModelDetailView): void => {
  // The whole panel is replaced on every draw, and a reader whose keyboard was on the
  // close control when the answer landed must not be dropped at the top of the page by
  // the redraw — so the panel takes back the focus it held.
  const held = document.activeElement !== null && el.contains(document.activeElement);
  clear(el);
  el.append(head(view.label, view.onClose));

  if (view.read.state === "reading") {
    el.append(
      paragraph(
        "model-detail-reading",
        "Reading that model's detail. It is read from the series logs, so it can take a moment.",
      ),
    );
  } else if (view.read.state === "failed") {
    el.append(
      paragraph(
        "model-detail-failed",
        `This console could not read that model's detail: ${view.read.error}. ` +
          "The leaderboard above is untouched, and says what it said before.",
      ),
    );
  } else {
    el.append(...pooledWords(view.read.detail));
    const blocks = view.read.detail.series;
    if (blocks.length === 0) {
      el.append(paragraph("model-detail-series-none", "No series this console lists counted a match for it."));
    } else {
      el.append(list("model-detail-series", blocks.map((block) => blockWords(block, view.series))));
    }
  }
  if (held) el.focus();
};

/* ------------------------------------------------------------------- opening */

/** The panel that is open, if one is. */
interface Panel {
  readonly el: HTMLElement;
  open: boolean;
  close: (restoreFocus: boolean) => void;
}

let current: Panel | null = null;

/** What opening a panel needs: where it goes, who opened it, and how it is read. */
export interface ModelDetailAsk {
  /** The Leaderboard view: the panel is drawn over it, and hidden with it. */
  host: HTMLElement;
  /** The row's own control, which gets focus back when the panel closes. */
  opener: HTMLElement;
  label: string;
  series: readonly SeriesRow[];
  fetchJson: FetchJson;
  say: Say;
}

/**
 * Put a panel on the page: one at a time, focused, closed by its control, by
 * Escape, or by another row being opened.
 *
 * Escape is heard on the document rather than on the panel, because
 * focus can be on any control inside it and a reader who has tabbed away and pressed
 * Escape still means the panel. Focus goes back to the control that opened the panel
 * — unless the leaderboard has been redrawn under it, in which case that control is
 * gone from the page and focus is left where it is rather than sent to a detached
 * element, which would leave it on the page's body with nothing to read.
 */
const openPanel = (ask: ModelDetailAsk): Panel => {
  if (current !== null) current.close(false);

  const el = document.createElement("div");
  el.className = "model-detail-panel";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `The detail of ${ask.label}`);
  // Focusable so the panel can take focus when it opens and a reader who cannot see
  // it is told what opened rather than left where they were.
  el.tabIndex = -1;

  const panel: Panel = {
    el,
    open: true,
    close: (restoreFocus: boolean): void => {
      if (!panel.open) return;
      panel.open = false;
      if (current === panel) current = null;
      document.removeEventListener("keydown", onEscape);
      el.remove();
      if (restoreFocus && ask.opener.isConnected) ask.opener.focus();
    },
  };

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    panel.close(true);
  };

  ask.host.append(el);
  current = panel;
  document.addEventListener("keydown", onEscape);
  el.focus();
  return panel;
};

/**
 * Open one model's detail: the panel goes up at once, saying it is reading, and the
 * read — one request, at the click, and never anywhere else — replaces it.
 *
 * A read that fails says the console's own line on the page's status line, as every
 * other failed read does, and leaves the leaderboard standing: the panel is
 * not in that section, so nothing here can take the tables with it. A panel closed
 * while its read was on its way is not reopened by it, and a second row opened while
 * the first is still reading replaces the first rather than drawing two panels.
 */
export const openModelDetail = async (ask: ModelDetailAsk): Promise<void> => {
  const panel = openPanel(ask);
  const view = (read: DetailRead): ModelDetailView => ({
    label: ask.label,
    read,
    series: ask.series,
    onClose: (): void => panel.close(true),
  });

  renderModelDetail(panel.el, view({ state: "reading" }));
  try {
    const detail = await fetchModelDetail(ask.label, ask.fetchJson);
    if (!panel.open) return;
    renderModelDetail(panel.el, view({ state: "ready", detail }));
  } catch (error) {
    const line = error instanceof Error ? error.message : String(error);
    ask.say(line, true);
    if (!panel.open) return;
    renderModelDetail(panel.el, view({ state: "failed", error: line }));
  }
};
