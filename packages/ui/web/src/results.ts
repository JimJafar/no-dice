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
 * **A series outside the two roots is not listed, and the page says so.** A run
 * started into some other folder is real work that this page will never show.
 * The alternative — a section that quietly omits it — reads as though the run
 * had never happened. What the page says is that the console lists the folders
 * it was started with; it does not print those folders, because a path is not
 * something a reader does anything with, and the one row that does carry a path
 * is a series record that will not parse, where the path is the fact.
 *
 * **A match is named by what it was, not by what its log is called.** The row
 * says the two seats, the seed and the day it was played. Those three are not in
 * `/api/matches`, whose rows carry a log's name and its two URLs; they are in the
 * log's own header, which is the one place that says who played, on what seed,
 * when. So the page reads the header — the first few kilobytes of the log, and no
 * more of it than that.
 *
 * **That read never stands between the listing and the page.** The rows go up with
 * what the listing alone supports — the seed its file name carries — and each
 * label is replaced when its header arrives. And the reads are one per log and
 * a few at a time, because the console answers a log request by streaming the
 * whole file: `sendFile` pipes a `createReadStream` and does not stop when the
 * reader stops reading, so a read costs the server the log's full size however
 * little of it the page looks at. A full series is around 150 logs of about a
 * megabyte; fanned out at once that is a hundred and fifty megabytes of disk and
 * socket work for a page of labels, and a front view that stayed blank until the
 * last of them landed.
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

/** What a match log's own header says about the match it is the log of. */
export interface MatchHeader {
  /** The two seats, spelled as the log's header spells them: `bot:greedy`, `marvin/subagent`. */
  seats: [string, string];
  /** The seed the match was played on. */
  seed: number;
  /** The date the header carries, as the ISO timestamp it carries it in. */
  playedOn: string;
}

/** A finished match log, and the two URLs it is reachable at. */
export interface MatchRow {
  name: string;
  path: string;
  url: string;
  viewerUrl: string;
  series: string | null;
  /**
   * The row's label: what the match was, read out of the log itself.
   * `null` when the log would not read, and for a row that came straight from
   * `/api/matches` before the page had read anything.
   */
  header: MatchHeader | null;
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

/** The answer from `/api/matches`. Its rows carry no header: that is a second read. */
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
        header: null,
      };
    }),
  };
};

/** How much of a log the page reads to label a row: its header, and nothing after it. */
const HEADER_LIMIT = 4096;

/**
 * The first `limit` characters of an answer, with the rest of it left unread.
 *
 * This is what stops the *page* holding and decoding a megabyte per row. It does
 * not stop the console reading the file: `sendFile` in `packages/ui/src/server.ts`
 * pipes a `createReadStream` and Node does not destroy the source when the
 * destination goes away, so the whole log is read and written whatever the client
 * does. That is why the reads are one per log and a few at a time — see
 * `createMatchHeaderSource` — and not because cancelling is cheap for the
 * server, which it is not.
 */
const prefixOf = async (response: Response, limit: number): Promise<string> => {
  const reader = response.body?.getReader();
  if (reader === undefined) return (await response.text()).slice(0, limit);

  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const next = await reader.read();
    if (next.done === true) break;
    text += decoder.decode(next.value, { stream: true });
    if (text.length >= limit) break;
  }
  // The page asks for no more of the body, and keeps none of it. Everything past
  // the header is the match — turns, orders, tool calls — and the replay is what
  // asks for that, when someone opens the replay.
  await reader.cancel().catch(() => undefined);
  return text.slice(0, limit);
};

/**
 * The `{...}` that follows `"key"` in a JSON prefix, strings skipped so a brace
 * inside a value is not counted as one of the object's. `null` when the prefix
 * stops short of closing it — which is what a truncated read looks like.
 */
const objectOf = (text: string, key: string): unknown => {
  const named = text.indexOf(`"${key}"`);
  const open = named === -1 ? -1 : text.indexOf("{", named);
  if (open === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && (depth -= 1) === 0) {
      try {
        return JSON.parse(text.slice(open, at + 1)) as unknown;
      } catch {
        return null;
      }
    }
  }
  return null;
};

/** One seat as the log's header spells it — the same spelling the report uses. */
const playerOf = (player: unknown): string | null => {
  if (player === null || typeof player !== "object") return null;
  const { kind, bot, model } = player as { kind?: unknown; bot?: unknown; model?: unknown };
  if (kind === "bot" && typeof bot === "string") return `bot:${bot}`;
  if (kind === "pi" && typeof model === "string") return model;
  return null;
};

/** The three facts a row is labelled from, out of the log's first kilobyte. */
const headerOf = (prefix: string): MatchHeader | null => {
  const created = /"created"\s*:\s*"([^"]*)"/.exec(prefix)?.[1];
  const seed = /"seed"\s*:\s*(-?\d+)/.exec(prefix)?.[1];
  const players = objectOf(prefix, "players");
  if (created === undefined || seed === undefined || players === null || typeof players !== "object") {
    return null;
  }
  const seatA = playerOf((players as Record<string, unknown>)["A"]);
  const seatB = playerOf((players as Record<string, unknown>)["B"]);
  if (seatA === null || seatB === null || Number.isNaN(Date.parse(created))) return null;
  return { seats: [seatA, seatB], seed: Number(seed), playedOn: created };
};

/**
 * What one match log says about itself, or `null` when it will not say.
 *
 * The read is of the log the console already serves at `url` — the same URL the
 * row links its replay at — and the page stops looking as soon as the header
 * is in hand. A log that is not there, is not JSON, or has a header this page
 * cannot read is one row that says so rather than a listing that failed: the
 * listing came from the console, and this is only the wording over a link.
 */
export const readMatchHeader = async (
  url: string,
  fetchJson: FetchJson = fetch,
): Promise<MatchHeader | null> => {
  try {
    const response = await fetchJson(url);
    if (!response.ok) return null;
    return headerOf(await prefixOf(response, HEADER_LIMIT));
  } catch {
    return null;
  }
};

/** One log's header, asked for by URL. */
export type MatchHeaderReader = (url: string) => Promise<MatchHeader | null>;

/** How many logs the page reads at a time. The rest of them wait their turn. */
const HEADER_CONCURRENCY = 4;

/**
 * The page's supply of log headers: one read per log however many views ask for
 * it, a few at a time, and nothing that ever waits for one.
 *
 * Three rules, and the reason for each:
 *
 * - **No draw waits for a read.** A caller draws the listing with the label the
 *   listing itself supports and asks this for the fuller words afterwards. A page
 *   that awaited every log was a blank front view until the last one landed.
 * - **One read per log.** The Matches view and the Leaderboard view label the
 *   same logs; whoever asks second is given the first one's promise, not a second
 *   request.
 * - **A few at a time.** The console answers a log request by streaming the whole
 *   file, and does not stop when the reader stops reading, so each of these reads
 *   costs it the log's full size. A full series is around 150 logs of about a
 *   megabyte, and a page of labels is not worth a hundred and fifty megabytes of
 *   disk and socket work arriving at once.
 */
export const createMatchHeaderSource = (
  fetchJson: FetchJson = fetch,
  limit: number = HEADER_CONCURRENCY,
): MatchHeaderReader => {
  const asked = new Map<string, Promise<MatchHeader | null>>();
  const waiting: (() => void)[] = [];
  let reading = 0;

  /** Take a place, waiting for one when they are all taken. */
  const take = async (): Promise<void> => {
    if (reading >= limit) await new Promise<void>((done) => void waiting.push(done));
    reading += 1;
  };
  /** Give one back, and hand it to whoever asked first. */
  const give = (): void => {
    reading -= 1;
    waiting.shift()?.();
  };

  return (url: string): Promise<MatchHeader | null> => {
    const already = asked.get(url);
    if (already !== undefined) return already;

    const started = (async (): Promise<MatchHeader | null> => {
      await take();
      try {
        return await readMatchHeader(url, fetchJson);
      } finally {
        give();
      }
    })();
    asked.set(url, started);
    return started;
  };
};

/**
 * Both listings, read together. The section is one thing, so it arrives as one.
 *
 * The rows arrive with `header: null`: what a match was is in the log, and the
 * page reads those afterwards, as they come, rather than holding the whole
 * section back for them.
 */
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

/** A name, a URL, or a line the console wrote — set in the CLI's face. */
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The day a log's header says it was written, as the page says it: `7 Oct 2026`.
 *
 * Read back in the zone the reader's browser is in, which is the zone every other
 * time on this page is in — the progress section says a run started at the
 * clock on their wall. A day worked out in UTC would put a match played at half
 * past midnight under the day before the run that played it, with both on the
 * same page. The header's timestamp is an instant, not a day; the day is the
 * reader's.
 */
export const dateOf = (iso: string): string => {
  const at = new Date(iso);
  return `${String(at.getDate())} ${MONTHS[at.getMonth()]} ${String(at.getFullYear())}`;
};

/**
 * The seed a log's own file name carries: `<seed>-<seat A>-<seat B>.json`, which
 * is how the runner names them.
 *
 * The name is not drawn — a file name is what this page is not supposed to show.
 * It is used to keep two rows apart before their logs have been read, and the
 * seed is the one fact in the name that a reader would use for that.
 */
const seedOfName = (name: string): string | null => /^(\d+)-/.exec(name)?.[1] ?? null;

/** What a row can say about a match from the listing alone. */
const seedWords = (row: MatchRow): string => {
  const seed = seedOfName(row.name);
  return seed === null ? "a match this console has no facts about" : `a match on seed ${seed}`;
};

/**
 * What a match was, in the words a reader looks for: the two seats, the seed,
 * the day. The log's own file name says the same three things to whoever named
 * the file, and nothing to anyone else.
 *
 * Before the log has been read the row says what the listing already knows — the
 * seed — and says the log has not been read. It does not claim the log is
 * unreadable, which would be a guess about a read that has not happened.
 */
export const matchLabel = (row: MatchRow): string => {
  const header = row.header;
  if (header === null) return `${seedWords(row)}, whose log this console has not read`;
  return (
    `${header.seats[0]} vs ${header.seats[1]} — seed ${String(header.seed)}, ` +
    `played ${dateOf(header.playedOn)}`
  );
};

/**
 * What a row says once the read has been made and did not answer.
 *
 * The seed is still there, so a list of logs that will not read is still a list
 * of different matches rather than the same sentence over and over, each one
 * linking somewhere the reader cannot name.
 */
export const unreadMatchLabel = (row: MatchRow): string => `${seedWords(row)}, whose log this console could not read`;

/**
 * What the series is and how far it got: its name, its pairing, and the pair
 * and match counts. The pairing is spelled the way the console spells a seat, so
 * the line can be read against the leaderboard's.
 */
const seriesHead = (row: SeriesRow): Node => {
  const el = document.createElement("span");
  el.className = "series-head";
  el.append(
    document.createTextNode(row.name),
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

/**
 * One finished match: what it was, linked at the viewer's own URL for it.
 *
 * The link's words are the row's, not the log's: the URL it
 * points at is the console's and is set once and untouched afterwards. When a
 * header arrives the words over it change and the address does not.
 */
const matchItem = (row: MatchRow, headers?: MatchHeaderReader): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = "match-row";
  const link = document.createElement("a");
  link.className = "match-viewer";
  link.href = row.viewerUrl;
  link.textContent = matchLabel(row);
  fillWhenRead(headers, row, link);
  li.append(
    link,
    document.createTextNode(row.series === null ? " — a match played on its own" : ` — from ${row.series}`),
  );
  return li;
};

/**
 * Replace a link's words when the log's header turns up, and say what the log
 * could not be read as, when it does not.
 *
 * Nothing is awaited: the row is on the page with what the listing supports, and
 * this is a later change to one text node. A row drawn out from
 * under the answer by a later render simply loses the write — the newer render
 * asked for the same header and will have its own link to fill.
 */
const fillWhenRead = (headers: MatchHeaderReader | undefined, row: MatchRow, link: HTMLAnchorElement): void => {
  if (headers === undefined) return;
  void headers(row.url).then((header) => {
    link.textContent = header === null ? unreadMatchLabel(row) : matchLabel({ ...row, header });
  });
};

/**
 * The section, as the console's two listings describe it.
 *
 * The page says which folders are in view without naming them: a series
 * started somewhere else is real work this console will never list, and a page
 * that said "no series" without saying that would be a page that contradicted
 * what its reader watched start.
 *
 * `headers`, when the caller has one, is where the fuller label for each match
 * comes from — asked for here and written in when it lands, never waited for.
 */
export const renderResults = (
  el: HTMLElement,
  results: Results,
  onResume: (dir: string) => void,
  headers?: MatchHeaderReader,
): void => {
  clear(el);

  el.append(
    paragraph(
      "roots",
      "This console lists the series and matches in the folders it was started with. A series " +
        "started somewhere else is not here.",
    ),
  );

  if (results.series.length === 0) {
    el.append(paragraph("series-none", "No series here yet."));
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
    el.append(paragraph("matches-none", "No finished match here yet."));
  } else {
    el.append(list("matches", results.matches.map((row) => matchItem(row, headers))));
  }
};
