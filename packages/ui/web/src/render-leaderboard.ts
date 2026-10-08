/**
 * Drawing the Leaderboard section, and nothing else.
 *
 * What the page reads is `leaderboard.ts`'s business; this file turns one answer
 * into two tables. Three rules shape the drawing.
 *
 * **The page adds no arithmetic.** Every count, rate and interval on both tables
 * is the console's, which is the stats package's: the per-pairing row is
 * `seriesReport`'s headline row and the pooled row is `pooledModelRows`' result
 * and seat split. What is added here is wording and the shape of a percentage —
 * `64.3%` for `0.6428…` — and nothing else. A win rate divided out of the counts
 * beside it would be a second account of the same matches, and the two tables
 * would drift; a pooled rate averaged out of the per-series rates would be wrong
 * anyway, since a series of two matches and a series of two hundred would count
 * the same.
 *
 * **A missing match is drawn as missing.** The counts come in as `counted` and
 * `missing`, and the pooled row carries the stats package's own sentence about
 * what its `missing` means — that a match with no log was denied to both seats of
 * its pairing and is not a loss — which is drawn as it arrived rather than
 * reworded, because the number beside a win rate reads as a lost match otherwise.
 * A series with nothing counted says there is no win rate; it does not show one
 * of nought.
 *
 * **What is not in either table says so on the page.** A series started with
 * `--dir` outside the console's series root is not listed, and a directory under
 * the root whose record this console could not read is named with the line it
 * failed on. Both matter more here than in the results section: a leaderboard
 * that quietly omits a series reads as a model that never played it.
 *
 * The match links are drawn from the `/api/matches` rows the page already holds,
 * which carry the series each log belongs to and the `viewerUrl` that opens it in
 * the replay viewer. The report link is the row's own `reportUrl`, which is where
 * this console serves the report the runner wrote beside the record.
 *
 * **The tables are named in words, the way the rest of the page is.** A series row
 * says its name, not the directory it lives in; a match link says who played, on
 * what seed, on what day, not what its log is called; the pooled table says which
 * series a model's record was pooled from by the names those series answer with.
 * The console answers with directories, and the same answer carries a row per
 * series with its name against its directory, so the page has the mapping in hand
 * and no reason to put a path in front of a reader. The one line that keeps a path
 * is a series record that will not parse, where the console's own line about it is
 * repeated as it was written.
 */
import { clear } from "./render-frame.ts";
import { matchLabel, unreadMatchLabel } from "./results.ts";
import type { Interval, Leaderboard, ModelRow, ResultCell, SeriesRow } from "./leaderboard.ts";
import type { MatchHeaderReader, MatchRow } from "./results.ts";

/** What the section draws: both views, and the match logs to link them by. */
export interface LeaderboardView {
  /** What `GET /api/leaderboard` answered — one walk of the series root, both tables. */
  board: Leaderboard;
  /** The finished logs `/api/matches` listed, which the per-pairing rows link their matches from. */
  matches: readonly MatchRow[];
  /**
   * Where a match log's header comes from, for the words over each replay link.
   * Optional, and never waited for: without it the links say the seed the listing
   * carries, and with it they say who played, on what seed, on what day.
   */
  headers?: MatchHeaderReader;
}

/** A short element with a class and a sentence. */
const paragraph = (className: string, text: string): HTMLElement => {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
};

/** A heading under the section's own, for a table that needs one. */
const subheading = (text: string): HTMLHeadingElement => {
  const el = document.createElement("h3");
  el.textContent = text;
  return el;
};

/** A path, a name or a URL, as a path. */
const code = (text: string): HTMLElement => {
  const el = document.createElement("code");
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

/** One table cell, filled by whoever knows what goes in it. */
const cell = (...content: readonly (string | Node)[]): HTMLTableCellElement => {
  const td = document.createElement("td");
  td.append(...content);
  return td;
};

/** A cell that holds nothing but a count. It is set in the viewer's numeral face
 * (`console.css`, `.num`) rather than in the face its sentences are set in, so a
 * column of counts lines up the way the viewer's scores do. */
const numCell = (n: number): HTMLTableCellElement => {
  const td = cell(String(n));
  td.className = "num";
  return td;
};

/**
 * A table with one header row and the body rows whoever built them handed over,
 * inside a box of its own.
 *
 * The box is not decoration. The pairing table is nine columns of figures and the
 * pooled one is eight, and a table cannot be squeezed below the width of its own
 * words: loose in the section, either of them would push the page itself sideways
 * on a phone, and the nav bar and the rest of the view would slide out from under
 * whoever was reading them. In a box that takes the overflow, the table scrolls
 * under its own header and the page keeps the window's width (`console.css`,
 * `.table-scroll`).
 *
 * The box is therefore the only way to reach the columns past the window's edge,
 * which makes it a control, and a plain `<div>` is not one: Firefox and Safari
 * leave an unfocusable scroll container out of the tab order, so a keyboard or
 * switch user has nothing to scroll and the right-hand figures of the table are
 * unreachable without a pointer. It takes focus and is named by the table it
 * scrolls, which is what a scroll region is called.
 */
const table = (
  className: string,
  label: string,
  headers: readonly string[],
  rows: readonly (readonly Node[])[],
): HTMLElement => {
  const el = document.createElement("table");
  el.className = className;

  const head = document.createElement("tr");
  for (const text of headers) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    head.append(th);
  }
  const thead = document.createElement("thead");
  thead.append(head);

  const body = document.createElement("tbody");
  for (const cells of rows) {
    const tr = document.createElement("tr");
    tr.append(...cells);
    body.append(tr);
  }

  el.append(thead, body);

  const box = document.createElement("div");
  box.className = "table-scroll";
  box.tabIndex = 0;
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", label);
  box.append(el);
  return box;
};

/** A rate as the report writes it. */
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A confidence level as the report writes it: whole percent, no decimals. */
const level = (n: number): string => `${String(Math.round(n * 100))}%`;

/** An interval as the report writes it, in the report's own order. */
const span = (interval: Interval): string => `${pct(interval.low)} – ${pct(interval.high)}`;

/**
 * A win rate with the interval over the same matches, in the report's wording.
 * Nothing counted is said as having no rate: a `0.0%` over no matches would read
 * as a model or a pairing that lost, which is the opposite of what happened.
 */
const rateWith = (rate: number | null, interval: Interval | null, confidence: number): string =>
  rate === null || interval === null
    ? "nothing counted, so no win rate"
    : `${pct(rate)} (${level(confidence)} CI ${span(interval)})`;

/** A result as the console answers it — a pooled row's, or one seat's — in that wording. */
const rateOf = (result: ResultCell): string => rateWith(result.rate, result.interval, result.confidence);

/** One seat's half of the split: how many of the counted matches it held, and what they did. */
const seatCell = (seat: "A" | "B", result: ResultCell): string =>
  result.n === 0
    ? `no match from seat ${seat}`
    : `seat ${seat}: ${String(result.n)} ${result.n === 1 ? "match" : "matches"} — ${rateOf(result)}`;

/**
 * The matches of one series, as links into the replay viewer.
 *
 * They come from the `/api/matches` listing rather than from the leaderboard
 * answer, because that listing is what knows a log's URL: the leaderboard row
 * names the series, and a log says which series it belongs to. A series with no
 * log listed says so, rather than showing an empty cell that could
 * be a series that never played.
 *
 * The link says what the match was — the two seats, the seed, the day — and not
 * what its log is called. The URL it points at is the console's and is untouched:
 * the rule is about the words a reader sees, not the address a browser follows.
 *
 * The fuller words arrive after the table is on the page, from the same one
 * read per log the Matches view asks for.
 */
const matchLinks = (row: SeriesRow, matches: readonly MatchRow[], headers?: MatchHeaderReader): Node => {
  const ofSeries = matches.filter((each) => each.series === row.name);
  if (ofSeries.length === 0) return document.createTextNode("no finished match listed for this series");

  const ul = document.createElement("ul");
  ul.className = "series-matches";
  for (const each of ofSeries) {
    const li = document.createElement("li");
    const anchor = link("match-viewer", each.viewerUrl, matchLabel(each));
    if (headers !== undefined) {
      void headers(each.url).then((header) => {
        anchor.textContent = header === null ? unreadMatchLabel(each) : matchLabel({ ...each, header });
      });
    }
    li.append(anchor);
    ul.append(li);
  }
  return ul;
};

/** One series: its name, its pairing as the console spells a seat, and the report's figures for it. */
const seriesCells = (row: SeriesRow, matches: readonly MatchRow[], headers?: MatchHeaderReader): Node[] => [
  cell(row.name),
  cell(`${row.a} vs ${row.b}`),
  cell(`${String(row.pairs)} of ${String(row.maxPairs)} pairs`),
  cell(`${String(row.matches)} matches`),
  cell(`${String(row.counted)} counted, ${String(row.missing)} missing`),
  cell(rateWith(row.winRate, row.interval, row.confidence)),
  cell(`stopped on ${row.stopReason} — ${row.stoppedEarly ? "short of its pair limit" : "its full length"}`),
  cell(link("series-report", row.reportUrl, "its report")),
  cell(matchLinks(row, matches, headers)),
];

/**
 * Which series a pooled row was pooled from, said by name.
 *
 * A directory with no series row beside it in the same answer is said as what it
 * is: a series this table does not list. That is the honest line, and it is the
 * only way a path could otherwise reach this column.
 */
const namesOf = (dirs: readonly string[], byDir: ReadonlyMap<string, string>): string[] =>
  dirs.map((dir) => byDir.get(dir) ?? "a series this table does not list");

/** One model: its pooled record, its record from each seat, and what it was pooled from. */
const modelCells = (row: ModelRow, byDir: ReadonlyMap<string, string>): Node[] => {
  const from = document.createElement("ul");
  from.className = "model-series";
  for (const name of namesOf(row.series, byDir)) {
    const li = document.createElement("li");
    li.append(document.createTextNode(name));
    from.append(li);
  }

  return [
    cell(code(row.label)),
    numCell(row.matches),
    numCell(row.missing),
    cell(rateOf(row.result)),
    cell(seatCell("A", row.seatSplit.A)),
    cell(seatCell("B", row.seatSplit.B)),
    row.series.length === 0 ? cell("no series with a counted match") : cell(from),
    cell(row.missingNote),
  ];
};

/**
 * The section: the per-pairing table, the pooled per-model table, and the two
 * lines about what neither of them counted.
 *
 * The whole section is replaced on every render, the way every other section
 * is — a series that has left the root must not keep its row, and a pooled row
 * from a disk that has since changed must not keep its rate. Both tables come
 * from one answer, so they always say the same thing about the same matches.
 */
export const renderLeaderboard = (el: HTMLElement, view: LeaderboardView): void => {
  clear(el);
  const { board, matches, headers } = view;

  const roots = paragraph("leaderboard-roots", "");
  roots.append(
    document.createTextNode(
      "Both tables are read from the series this console lists. A series started in some other " +
        "folder is not on this page, and a leaderboard that left one out without saying so would " +
        "read as a model that never played it.",
    ),
  );
  el.append(roots);

  // The pooled table names the series it pooled from, and the per-series rows are
  // where those names are: the pooled rows themselves only carry directories.
  const byDir = new Map(board.series.map((row) => [row.dir, row.name]));

  el.append(subheading("Per pairing — one row per series"));
  if (board.series.length === 0) {
    el.append(paragraph("leaderboard-series-none", "No series here yet."));
  } else {
    el.append(
      table(
        "leaderboard-series",
        "Leaderboard by pairing",
        [
          "Series",
          "Pairing",
          "Pairs",
          "Matches",
          "Counted / missing",
          "Win rate",
          "Stopped",
          "Report",
          "Replays",
        ],
        board.series.map((row) => seriesCells(row, matches, headers)),
      ),
    );
  }

  el.append(subheading("Per model, pooled over every series this console lists"));
  if (board.models.length === 0) {
    el.append(
      paragraph(
        "leaderboard-models-none",
        "No model has a counted match here yet — a series whose every match " +
          "went missing says nothing about the models its pairing names.",
      ),
    );
  } else {
    el.append(
      table(
        "leaderboard-models",
        "Leaderboard by model",
        [
          "Model",
          "Matches counted",
          "Matches missing",
          "Win rate, pooled",
          "Seat A",
          "Seat B",
          "Pooled from",
          "What “missing” means",
        ],
        board.models.map((row) => modelCells(row, byDir)),
      ),
    );
  }

  if (board.unreadable.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "leaderboard-unreadable";
    for (const row of board.unreadable) {
      const li = document.createElement("li");
      li.className = "leaderboard-unreadable-row";
      li.append(
        code(row.name),
        document.createTextNode(
          ` holds a series record this console cannot read: ${row.error}. It counts in neither table, ` +
            "so a model that played it has no row here for the matches it never got to play.",
        ),
      );
      ul.append(li);
    }
    el.append(ul);
  }
};
