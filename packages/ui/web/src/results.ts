/**
 * The results section: the series and matches the console has on disk, and how to
 * reach or resume each.
 *
 * **The page does no arithmetic.** Every figure in this section comes from
 * `GET /api/series`, which answers out of `seriesReport` — the same report
 * `no-dice stats` prints and the same one `report.md` holds. A win rate
 * worked out here from the counts would be a second account of the same series,
 * and the whole point of the section is that there is only one. The only
 * arithmetic left is turning a rate into a percentage for reading.
 *
 * **A resume sends a directory and nothing else.** The pairing and the pair limit
 * come from the series' own record, which is the only thing that knows what the
 * interrupted run was actually running; the console reads them back off disk. A
 * page that sent the pairing it had rendered would be offering to resume a series
 * under the pairing it happened to be displaying.
 *
 * **A series outside the two roots is not listed, and the page says so.**
 * `--dir` is the operator's escape hatch, and a run started with it is real work
 * that this page will never show. The alternative — a section that quietly omits
 * it — reads as though the run had never happened.
 *
 * The shapes below are declared here rather than imported from
 * `packages/ui/src/results.ts`, which reads the filesystem and pulls in
 * `@no-dice/stats`; a browser bundle may not. `parseSeriesListing` and
 * `parseMatchListing` are what keep the two from drifting quietly: a listing
 * missing a field is one readable line, not an `undefined` drawn into the
 * page.
 */
import { getJson } from "./api.ts";
import { clear } from "./render-frame.ts";
import type { FetchJson } from "./api.ts";

/** One series, with the figures the CLI's own report gives it. */
export interface SeriesRow {
  name: string;
  dir: string;
  a: string;
  b: string;
  maxPairs: number;
  pairs: number;
  matches: number;
  counted: number;
  missing: number;
  stopReason: string;
  stoppedEarly: boolean;
  wins: number;
  losses: number;
  draws: number;
  /** `null` when nothing was counted, which is when there is no rate. */
  winRate: number | null;
  interval: { low: number; high: number } | null;
  confidence: number;
  ceilingUsd: number | null;
  ceilingTokens: number | null;
  resumable: boolean;
}

/** A directory that holds a `series.json` this console cannot make a series of. */
export interface UnreadableRow {
  name: string;
  dir: string;
  error: string;
}

/** A finished match log, and the two URLs it is reachable at. */
export interface MatchRow {
  name: string;
  path: string;
  url: string;
  viewerUrl: string;
  series: string | null;
}

/** Everything the section draws, from the console's two listings. */
export interface Results {
  seriesRoot: string;
  matchesRoot: string;
  series: SeriesRow[];
  unreadable: UnreadableRow[];
  matches: MatchRow[];
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

/** A number that may be absent, or the line that says it is neither. */
const numberOrNull = (value: unknown, what: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a number`);
  return value;
};

/** A word that may be absent, or the line that says it is neither. */
const stringOrNull = (value: unknown, what: string): string | null => {
  if (value === null) return null;
  return stringOf(value, what);
};

/** The 95% interval, or `null` for a series with nothing counted. */
const intervalOf = (value: unknown, what: string): { low: number; high: number } | null => {
  if (value === null) return null;
  const interval = recordOf(value, what);
  return { low: countOf(interval["low"], `${what}.low`), high: countOf(interval["high"], `${what}.high`) };
};

/** One row of `/api/series`. */
const seriesRowOf = (value: unknown, what: string): SeriesRow => {
  const row = recordOf(value, what);
  return {
    name: stringOf(row["name"], `${what}.name`),
    dir: stringOf(row["dir"], `${what}.dir`),
    a: stringOf(row["a"], `${what}.a`),
    b: stringOf(row["b"], `${what}.b`),
    maxPairs: countOf(row["maxPairs"], `${what}.maxPairs`),
    pairs: countOf(row["pairs"], `${what}.pairs`),
    matches: countOf(row["matches"], `${what}.matches`),
    counted: countOf(row["counted"], `${what}.counted`),
    missing: countOf(row["missing"], `${what}.missing`),
    stopReason: stringOf(row["stopReason"], `${what}.stopReason`),
    stoppedEarly: boolOf(row["stoppedEarly"], `${what}.stoppedEarly`),
    wins: countOf(row["wins"], `${what}.wins`),
    losses: countOf(row["losses"], `${what}.losses`),
    draws: countOf(row["draws"], `${what}.draws`),
    winRate: numberOrNull(row["winRate"], `${what}.winRate`),
    interval: intervalOf(row["interval"], `${what}.interval`),
    confidence: countOf(row["confidence"], `${what}.confidence`),
    ceilingUsd: numberOrNull(row["ceilingUsd"], `${what}.ceilingUsd`),
    ceilingTokens: numberOrNull(row["ceilingTokens"], `${what}.ceilingTokens`),
    resumable: boolOf(row["resumable"], `${what}.resumable`),
  };
};

/** The answer from `/api/series`. */
export const parseSeriesListing = (value: unknown): {
  seriesRoot: string;
  series: SeriesRow[];
  unreadable: UnreadableRow[];
} => {
  const listing = recordOf(value, "the answer from /api/series");
  const series = listing["series"];
  const unreadable = listing["unreadable"];
  if (!Array.isArray(series)) throw new Error("series is not a list");
  if (!Array.isArray(unreadable)) throw new Error("unreadable is not a list");
  return {
    seriesRoot: stringOf(listing["seriesRoot"], "seriesRoot"),
    series: series.map((each, at) => seriesRowOf(each, `series[${String(at)}]`)),
    unreadable: unreadable.map((each, at) => {
      const row = recordOf(each, `unreadable[${String(at)}]`);
      return {
        name: stringOf(row["name"], `unreadable[${String(at)}].name`),
        dir: stringOf(row["dir"], `unreadable[${String(at)}].dir`),
        error: stringOf(row["error"], `unreadable[${String(at)}].error`),
      };
    }),
  };
};

/** The answer from `/api/matches`. */
export const parseMatchListing = (value: unknown): { matchesRoot: string; matches: MatchRow[] } => {
  const listing = recordOf(value, "the answer from /api/matches");
  const matches = listing["matches"];
  if (!Array.isArray(matches)) throw new Error("matches is not a list");
  return {
    matchesRoot: stringOf(listing["matchesRoot"], "matchesRoot"),
    matches: matches.map((each, at) => {
      const row = recordOf(each, `matches[${String(at)}]`);
      return {
        name: stringOf(row["name"], `matches[${String(at)}].name`),
        path: stringOf(row["path"], `matches[${String(at)}].path`),
        url: stringOf(row["url"], `matches[${String(at)}].url`),
        viewerUrl: stringOf(row["viewerUrl"], `matches[${String(at)}].viewerUrl`),
        series: stringOrNull(row["series"], `matches[${String(at)}].series`),
      };
    }),
  };
};

/** Both listings, read together. The section is one thing, so it arrives as one. */
export const fetchResults = async (fetchJson: FetchJson = fetch): Promise<Results> => {
  const series = parseSeriesListing(await getJson<unknown>("/api/series", fetchJson));
  const matches = parseMatchListing(await getJson<unknown>("/api/matches", fetchJson));
  return {
    seriesRoot: series.seriesRoot,
    matchesRoot: matches.matchesRoot,
    series: series.series,
    unreadable: series.unreadable,
    matches: matches.matches,
  };
};

/** A short element with a class and a sentence. */
const paragraph = (className: string, text: string): HTMLElement => {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
};

/** A path or a name, as a path. */
const code = (text: string): HTMLElement => {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
};

/** A list with a class, filled by whoever knows what its items are. */
const list = (className: string, items: readonly HTMLElement[]): HTMLElement => {
  const ul = document.createElement("ul");
  ul.className = className;
  ul.append(...items);
  return ul;
};

/** A rate as the report writes it. */
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** A confidence level as the report writes it: whole percent, no decimals. */
const level = (n: number): string => `${String(Math.round(n * 100))}%`;

/** Money as the report writes it. */
const usd = (n: number): string => `$${n.toFixed(2)}`;

/**
 * What the series is and how far it got: its name, its pairing, and the pair
 * and match counts. The pairing is spelled the way `--a` and `--b` spell it, so
 * the line can be read against the terminal's own.
 */
const seriesHead = (row: SeriesRow): Node => {
  const el = document.createElement("span");
  el.className = "series-head";
  el.append(
    code(row.name),
    document.createTextNode(` — ${row.a} vs ${row.b}, ${String(row.pairs)} of ${String(row.maxPairs)} pairs`),
  );
  return el;
};

/**
 * The figures, in the report's own order and wording: counted and missing out of
 * the matches the record names, then the win rate with its interval, then how the
 * series stopped. Nothing here is worked out — every number is the report's.
 */
const seriesFigures = (row: SeriesRow): string => {
  const parts = [
    `${String(row.counted)} of ${String(row.matches)} matches counted, ${String(row.missing)} missing`,
    row.winRate === null
      ? "nothing counted, so no win rate"
      : `win rate ${pct(row.winRate)} (${level(row.confidence)} CI ` +
        `${pct(row.interval!.low)} – ${pct(row.interval!.high)})`,
    `stopped on ${row.stopReason} — ${row.stoppedEarly ? "short of its pair limit" : "its full length"}`,
  ];
  if (row.ceilingUsd !== null || row.ceilingTokens !== null) {
    parts.push(
      `ceiling ${row.ceilingUsd === null ? "none" : usd(row.ceilingUsd)} / ` +
        `${row.ceilingTokens === null ? "none" : row.ceilingTokens.toLocaleString("en-US")} tokens`,
    );
  }
  return `${parts.join(", ")}.`;
};

/**
 * The resume, as a button. It is disabled while the series' own run is in flight
 * — a second run into the same directory would be a second run of the same
 * matches — and it sends the directory alone, because the record is what knows
 * what to run.
 */
const resumeButton = (row: SeriesRow, onResume: (dir: string) => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.className = "resume";
  button.type = "button";
  button.textContent = "Resume";
  button.dataset["dir"] = row.dir;
  button.disabled = !row.resumable;
  button.title = row.resumable
    ? `Play the matches of ${row.name} that have no log, with the pairing its record holds`
    : "This series' run is still in flight";
  button.addEventListener("click", () => onResume(row.dir));
  return button;
};

/** One series: its figures, and the way to finish it. */
const seriesItem = (row: SeriesRow, onResume: (dir: string) => void): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = "series-row";
  li.append(seriesHead(row), document.createTextNode(`: ${seriesFigures(row)} `), resumeButton(row, onResume));
  return li;
};

/** One finished match, linked at the viewer's own URL for it. */
const matchItem = (row: MatchRow): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = "match-row";
  const link = document.createElement("a");
  link.className = "match-viewer";
  link.href = row.viewerUrl;
  link.textContent = row.series === null ? row.name : `${row.series}/${row.name}`;
  li.append(link, document.createTextNode(" "), code(row.url));
  return li;
};

/**
 * The section, as the console's two listings describe it.
 *
 * The roots go first, with the caveat that only what is under them is listed: a
 * series started with `--dir` somewhere else is not here, and a page that said
 * "no series" without saying that would be a page that contradicted what its
 * reader watched start.
 */
export const renderResults = (el: HTMLElement, results: Results, onResume: (dir: string) => void): void => {
  clear(el);

  const roots = paragraph("roots", "");
  roots.append(
    document.createTextNode("Series under "),
    code(results.seriesRoot),
    document.createTextNode(", matches under "),
    code(results.matchesRoot),
    document.createTextNode(". Only what is under those two roots is listed here."),
  );
  el.append(roots);

  if (results.series.length === 0) {
    el.append(paragraph("series-none", `No series under ${results.seriesRoot} yet.`));
  } else {
    el.append(list("series", results.series.map((row) => seriesItem(row, onResume))));
  }

  if (results.unreadable.length > 0) {
    el.append(
      list(
        "series-unreadable",
        results.unreadable.map((row) => {
          const li = document.createElement("li");
          li.className = "series-unreadable-row";
          li.append(
            code(row.name),
            document.createTextNode(` holds a series record this console cannot read: ${row.error}`),
          );
          return li;
        }),
      ),
    );
  }

  if (results.matches.length === 0) {
    el.append(paragraph("matches-none", `No finished match under ${results.matchesRoot} yet.`));
  } else {
    el.append(list("matches", results.matches.map(matchItem)));
  }
};
