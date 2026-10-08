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
 * **A series another process is playing is drawn as playing.** The row carries
 * that fact as `playing` — the lock's holder — and `progress`, the record's own
 * counters, which the console reads only while the lock is live. Such a row says
 * the series is being played, says by another process on this machine, and shows
 * those counters. It draws **no** stop line: the record has no `stop` field while
 * a run is in flight, so the `stopped on max_pairs — its full length` the report
 * falls back to is a stop that has not happened. And it offers **no** Resume: a
 * second run over the matches the first is playing is the damage this whole
 * feature exists to prevent. A lock whose process has gone is the other half:
 * the row says the run has gone, and is resumable as an interrupted series is.
 *
 * **Those counters move without a reload, and only one row is written.** The
 * listings are the expensive read — every match log of every series — so the
 * page polls the console's cheap route, `/api/playing`, and writes the playing
 * row's counters into the span they were drawn in. Re-rendering the section once
 * a second would re-read every log header for nothing. When the poll and the
 * listing disagree about who is playing, the listing is read once more, which is
 * what puts a Resume button back — or takes it away — with nobody reloading.
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
import { parseRunCounters, POLL_MS } from "./progress.ts";
import { viewHash } from "./views.ts";
import type { RunCounters } from "./progress.ts";
import type { FetchJson } from "./api.ts";
import type { ViewName } from "./views.ts";

/**
 * The run a series' lock names: the process that took it, and when it took it.
 *
 * The pid is parsed and then left alone. It is a fact about the machine that
 * nobody in a browser can act on, so it is not drawn — the row says that another
 * process is playing, which is the whole of what a reader can do with it.
 */
export interface LockHolder {
  pid: number;
  startedAt: string;
}

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
  /**
   * The run playing this series, when its lock names a live process: another
   * `no-dice series` on this machine, or this console's own run once its lock
   * exists. `null` when nothing holds the directory.
   */
  playing: LockHolder | null;
  /**
   * The lock a run left behind, when the process it names has gone: the series is
   * interrupted rather than playing, and the recovery is to resume it.
   */
  stale: LockHolder | null;
  /**
   * The record's own counters, and only while the series is playing — the same
   * shape `/api/run` answers with, read by the same parser.
   */
  progress: RunCounters | null;
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

/** A lock's holder, or `null` for a row no lock names anybody at. */
const holderOf = (value: unknown, what: string): LockHolder | null => {
  if (value === null) return null;
  const holder = recordOf(value, what);
  return {
    pid: countOf(holder["pid"], `${what}.pid`),
    startedAt: stringOf(holder["startedAt"], `${what}.startedAt`),
  };
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
    playing: holderOf(row["playing"], `${what}.playing`),
    stale: holderOf(row["stale"], `${what}.stale`),
    // The same `RunCounters` `/api/run` answers with, out of the same record, so
    // it is read by the same parser rather than a second one here.
    progress: parseRunCounters(row["progress"], `${what}.progress`),
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

/** One series the cheap route says somebody is holding. */
export interface PlayingRow {
  name: string;
  dir: string;
  /** Whether the process that lock names has gone: the run died where it stood. */
  stale: boolean;
  /** The record's counters, or `null` for a record the console could not read. */
  progress: RunCounters | null;
}

/**
 * The answer from `GET /api/playing`: who is playing, and how far each has got.
 *
 * The route's rows also carry a pid and the minute the lock was taken. They are
 * not parsed, because the page never draws them: a pid is a fact about the
 * machine that nobody in a browser can act on, and a field the page cannot
 * draw is a field it cannot leak into the page.
 */
export const parsePlayingListing = (value: unknown): { seriesRoot: string; playing: PlayingRow[] } => {
  const listing = recordOf(value, "the answer from /api/playing");
  const playing = listing["playing"];
  if (!Array.isArray(playing)) throw new Error("playing is not a list");
  return {
    seriesRoot: stringOf(listing["seriesRoot"], "seriesRoot"),
    playing: playing.map((each, at) => {
      const row = recordOf(each, `playing[${String(at)}]`);
      return {
        name: stringOf(row["name"], `playing[${String(at)}].name`),
        dir: stringOf(row["dir"], `playing[${String(at)}].dir`),
        stale: boolOf(row["stale"], `playing[${String(at)}].stale`),
        progress: parseRunCounters(row["progress"], `playing[${String(at)}].progress`),
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
    // A read that came back with nothing is not remembered. A log can be
    // missing for a moment — a listing read while the runner was still closing
    // it, one failed fetch — and a page that labelled it "could not read" until
    // the reader reloaded the page would be holding onto a moment. A read that
    // worked is kept: that one will not change, and asking again costs the whole
    // log a second time.
    void started.then(
      (header) => {
        if (header === null) asked.delete(url);
      },
      () => {
        asked.delete(url);
      },
    );
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
 *
 * This is the line of a series that has stopped. A series that is playing never
 * reaches it: its record has no `stop` field, and the report's fallback —
 * `max_pairs`, its full length — describes a decision the stopping rules have not
 * made yet.
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
 * How far a run in flight has got, in the progress section's own words for the
 * same counters: pairs played of the pair limit, matches played and failed, and
 * what it has cost so far. The two sections read one record, so they say the same
 * thing about it.
 */
const countersWords = (progress: RunCounters): string =>
  `pairs ${String(progress.pairsPlayed)} of ${String(progress.maxPairs)} played, ` +
  `matches ${String(progress.matchesPlayed)} played, ${String(progress.matchesFailed)} failed, ` +
  `${progress.tokens.toLocaleString("en-US")} tokens so far, ${usd(progress.costUsd)} so far`;

/**
 * A playing row's own line: who is playing it, and the counters its record is
 * carrying at the moment the listing was read.
 *
 * The counters go in a span of their own, marked with the series' directory, so
 * the poll can rewrite them without touching the rest of the row — and without
 * redrawing the section, which would ask every match log header on the page to be
 * read again. A row whose record has not written its counters yet says that, and
 * does not draw zeroes for a run it cannot see.
 */
const playingLine = (row: SeriesRow): Node => {
  const line = document.createElement("span");
  line.className = "series-playing";
  line.append(
    document.createTextNode(": this series is being played by another process on this machine. "),
  );
  const counters = document.createElement("span");
  counters.className = "series-counters";
  counters.dataset["dir"] = row.dir;
  counters.textContent =
    row.progress === null
      ? "Its record has not written its counters yet."
      : `${countersWords(row.progress)}.`;
  line.append(counters);
  return line;
};

/**
 * What a row says when the lock names a process that is gone: the series is not
 * being played, and the run that left it half-played is not coming back. That is
 * an interrupted series, which is what the Resume beside it is for.
 */
const staleLine = (): Node => {
  const el = document.createElement("span");
  el.className = "series-stale";
  el.textContent = " — the run that left this series half-played has gone";
  return el;
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

/**
 * One series: its figures, and the way to finish it — unless it is not finished.
 *
 * A series somebody else is playing has neither. It has no stop to report and no
 * resume to offer: the matches it is playing are being played, and a second run
 * over them is what the lock is there to stop. Everything else — a finished
 * series, and one a dead run left behind — keeps the report's line and the button.
 */
const seriesItem = (row: SeriesRow, onResume: (dir: string) => void): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = "series-row";
  li.append(seriesHead(row));
  if (row.playing !== null) {
    li.classList.add("series-row-playing");
    li.append(playingLine(row));
    return li;
  }
  if (row.stale !== null) li.append(staleLine());
  li.append(document.createTextNode(`: ${seriesFigures(row)} `), resumeButton(row, onResume));
  return li;
};

/**
 * Write one playing row's counters, and nothing else on the page.
 *
 * This is what lets a row's numbers move once a second while the section around it
 * stands: the poll rewrites the counters the record carries, and the match rows,
 * the leaderboard and every log header already read are left where they are.
 * `false` when the row is not on the page — it has gone, or the listing that put
 * it there has not been read yet — which is the poll's cue to ask for that
 * listing rather than to keep writing into nothing.
 */
export const writeSeriesCounters = (el: HTMLElement, dir: string, progress: RunCounters): boolean => {
  for (const each of el.querySelectorAll<HTMLElement>(".series-counters")) {
    if (each.dataset["dir"] !== dir) continue;
    each.textContent = `${countersWords(progress)}.`;
    return true;
  }
  return false;
};

/** The parameter the viewer reads for the view a replay link was clicked in. */
const BACK_PARAM = "back=";

/**
 * The viewer's URL for a log, opened from the view that is drawing the link.
 *
 * `/api/matches` answers with one `viewerUrl` per log, and the page draws that
 * same log from two of its views — the list here, and a leaderboard row's matches
 * over in `render-leaderboard.ts`. The log's own address is left exactly as the
 * console wrote it, because `?log=` is what the viewer's `load.ts` fetches and it
 * is the same URL whichever row the link sat in; only the `back=` the viewer uses
 * for its way home is restated for the view doing the drawing.
 *
 * The escape is the console's own, and small on purpose: a view is spelled with
 * its `#`, the `#` is the one character a query cannot carry plain (a bare one
 * reads as the start of a fragment), and everything else stays legible in an
 * address bar.
 */
export const viewerUrlFor = (viewerUrl: string, view: ViewName): string => {
  const at = viewerUrl.indexOf(`&${BACK_PARAM}`);
  const base = at === -1 ? viewerUrl : viewerUrl.slice(0, at);
  return `${base}&${BACK_PARAM}${viewHash(view).replaceAll("#", "%23")}`;
};

/**
 * One finished match: what it was, linked at the viewer's own URL for it.
 *
 * The link's words are the row's, not the log's: the URL it
 * points at is the console's and is set once and untouched afterwards. When a
 * header arrives the words over it change and the address does not.
 *
 * The one part of that address this page does restate is the view it names as the
 * way back: this section is the Matches view, and a replay opened from a row here
 * goes back to a row here.
 */
const matchItem = (row: MatchRow, headers?: MatchHeaderReader): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = "match-row";
  const link = document.createElement("a");
  link.className = "match-viewer";
  link.href = viewerUrlFor(row.viewerUrl, "matches");
  link.textContent = matchLabel(row);
  fillMatchLabel(link, row, headers);
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
 * this is a later change to one text node. A row drawn out from under the answer
 * by a later render simply loses the write — the newer render asked for the same
 * header and will have its own link to fill.
 *
 * Both views that label a match call this, so the failure path is in one place:
 * a reader that rejects leaves the row on the words it already had rather than
 * raising an unhandled rejection out of a render.
 */
export const fillMatchLabel = (link: HTMLAnchorElement, row: MatchRow, headers?: MatchHeaderReader): void => {
  if (headers === undefined) return;
  void headers(row.url)
    .then((header) => {
      link.textContent = header === null ? unreadMatchLabel(row) : matchLabel({ ...row, header });
    })
    .catch(() => undefined);
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

/** What the page does with one answer from the console's cheap route. */
export interface PlayingPollerOptions {
  /** The console's own `fetch`. */
  fetchJson: FetchJson;
  /** The results section the rows are drawn in. */
  section: HTMLElement;
  /** The series the page has on the page, as the last listing read gave them. */
  listed: () => readonly SeriesRow[];
  /**
   * Read both listings again. The poll has named a series the listing does not
   * show as playing — or has stopped naming one the listing does — and only a
   * fresh listing can put the row's button and its stop line back.
   */
  relist: () => Promise<void>;
  /** What to say when the console did not answer at all. */
  say: (message: string, bad: boolean) => void;
  /** How long to leave between reads. The run poller's, unless told otherwise. */
  everyMs?: number;
  /** The wait itself, so a test can drive the loop without a clock. */
  wait?: (ms: number) => Promise<void>;
}

/** The page's read of who else on this machine is playing. */
export interface PlayingPoller {
  /**
   * Read, and keep reading while the answer names a playing series. A second
   * call while one is going does nothing: there is one loop per page.
   */
  run: () => Promise<void>;
  /** Stop before the next read. The runs themselves go on whatever the page does. */
  stop: () => void;
}

/** Whether two sorted directory lists name the same series. */
const sameDirs = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((dir, at) => b[at] === dir);

/**
 * Who the poll says is playing, and who the page shows as playing, each as a
 * sorted list of directories.
 *
 * Either direction of disagreement counts. A series the poll names and the
 * listing does not show as playing is a row still saying `stopped` and still
 * offering a Resume over matches somebody is playing; a series the listing shows
 * as playing and the poll no longer names is a row that has lost its Resume to
 * a run that has ended. Both are a row that has to be drawn again, and one read
 * of the listing is what draws it again. The lists come out sorted so the pair
 * of them can stand for the disagreement itself.
 */
const whoIsPlaying = (rows: readonly PlayingRow[], listed: readonly SeriesRow[]): [string[], string[]] => [
  rows
    .filter((row) => row.stale === false)
    .map((row) => row.dir)
    .sort(),
  listed
    .filter((row) => row.playing !== null)
    .map((row) => row.dir)
    .sort(),
];

/**
 * The poll: `/api/playing` once a second, and only while it answers
 * that somebody is playing.
 *
 * Why this loop exists at all: the listings are read when the page opens and when
 * *this console's* run ends, and a series played by `no-dice series` at a terminal
 * is in neither path — its pair count would sit at whatever it was when the page
 * loaded. Why it asks that route and no other: `/api/series` reads every match
 * log of every series, which is a second or two of disk and the reason nothing
 * else on this page is polled, while `/api/playing` reads `series.lock` and
 * `series.json` and nothing else.
 *
 * Why it stops: an answer that names no playing series is a machine on which
 * nothing is being played, and a page that kept asking once a second then would be
 * paying for a poll of nothing. The next listing read starts it again.
 *
 * A console that does not answer is not a machine on which nothing is playing —
 * the run lives in somebody else's process — so a failed read says the line and
 * the loop keeps asking, as the run poller's does.
 *
 * A disagreement is reported to the listings once, not once a tick. The read it
 * asks for costs every match log of every series, and a console that fails it
 * would otherwise be asked for it every second on top of the poll; while both
 * sides stand where they were when the disagreement was last reported, asking
 * again is asking for the same answer.
 */
export const createPlayingPoller = (options: PlayingPollerOptions): PlayingPoller => {
  const everyMs = options.everyMs ?? POLL_MS;
  const wait = options.wait ?? ((ms: number): Promise<void> => new Promise((later) => setTimeout(later, ms)));
  let stopped = false;
  let going = false;
  let reported: string | null = null;

  const run = async (): Promise<void> => {
    if (going) return;
    going = true;
    try {
      for (;;) {
        let rows: PlayingRow[] | null = null;
        try {
          rows = parsePlayingListing(await getJson<unknown>("/api/playing", options.fetchJson)).playing;
        } catch (error) {
          options.say(error instanceof Error ? error.message : String(error), true);
        }
        if (stopped) return;

        if (rows !== null) {
          const live = rows.filter((row) => row.stale === false);
          // The counters first, so the number the operator is looking at moves on
          // the tick it arrived rather than after a listing read that costs a
          // megabyte per series.
          for (const row of live) {
            if (row.progress !== null) writeSeriesCounters(options.section, row.dir, row.progress);
          }
          const [polled, shown] = whoIsPlaying(live, options.listed());
          const disagreement = sameDirs(polled, shown) ? null : JSON.stringify([polled, shown]);
          if (disagreement !== null && disagreement !== reported) {
            reported = disagreement;
            await options.relist();
          }
          if (stopped) return;
          if (live.length === 0) return;
        }

        await wait(everyMs);
        if (stopped) return;
      }
    } finally {
      going = false;
    }
  };

  return { run, stop: (): void => void (stopped = true) };
};
