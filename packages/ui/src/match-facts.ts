/**
 * What each finished match *was*: one row per log under the console's two roots,
 * naming its two seats, who won, the final score, the seed and the day it was
 * played, beside the `url`, `viewerUrl` and `series` `/api/matches` already gives
 * for that same log.
 *
 * **A route of its own, with `/api/matches` left exactly as it is.** The
 * listing's rows are pinned field by field in `./results.test.ts`, and they are
 * what the page's match rows are drawn from today. The milestone's rule is that a
 * view which needs more asks a new route rather than widening one that is
 * already read, and what this needs is a read of every log — which is the whole
 * difference in cost between the two answers.
 *
 * **The facts cannot come from `series.json`.** A series record already names
 * each played match's seed, winner, result type and margin, but not its final
 * score and not the day it was played: those two are only in the log header and
 * in its `result.score`. So the facts have to come from the logs, and a log under
 * `--matches-root` alone has no record to ask at all.
 *
 * **The cost, and what is deliberately not done about it.** This reads every
 * log of every series under the roots, about a megabyte each
 * (`docs/pi-harness-notes.md` §7 measured a real match log at that size), so it
 * is one pass with one read per log, on a route the page asks at the listings'
 * clock — when it is opened, and when a run it was watching ends — and never
 * on a poll. What is *not* done is reading only the head and tail of each file:
 * the format does not promise where `result` sits in it, because the key order is
 * the writer's and not the format's, and a seek to the tail would be a bet on
 * `packages/runner`'s JSON.stringify keeping that order. Anyone who grows a cache
 * here should key it on each log's own mtime, the way `./results.ts` says of a
 * series cache.
 *
 * **The same walk as the listing, so the two answers line up.** `matchRows`
 * is the only walk of the two roots, and this calls it: the fact rows carry the
 * same `url`, the same `viewerUrl` and the same `series` — a series' directory
 * name, or `null` for a log that is only under the matches root — in the same
 * order, and a log that has gone between the two routes' reads is a difference
 * both answers can be read against, not a fact invented here.
 *
 * **The reader is the stats package's own.** Each log goes through `readLogOf`,
 * which tries the paths a record names and parses with `matchLogSchema` — the
 * same reader `seriesReport` uses. A second parser here is how the console starts
 * calling a log unreadable that `no-dice stats` reads, and the other way round.
 *
 * **A log that is not there, or will not parse, is one entry in `unreadable`**
 * with the line it failed on — exactly as an unreadable series record already is
 * on `/api/series` — and every other log is still listed with its facts. One
 * half-written file is not a reason to answer the page with nothing.
 */
import { dirname } from "node:path";

import type { MatchLog } from "@no-dice/log";
import { playerLabel, readLogOf } from "@no-dice/stats/series-report";

import { matchRows } from "./results.ts";
import type { MatchRow } from "./results.ts";
import type { UiRoots } from "./state.ts";

/** The route the page asks what each finished match was at. */
export const MATCH_FACTS_PATH = "/api/match-facts";

/**
 * One finished log, and what it was. The first five fields are `MatchRow`'s,
 * unchanged: a fact row and the listing row for the same log are the same
 * log, and a page that has one can link to the replay from the other.
 */
export interface MatchFactRow extends MatchRow {
  /** The seed the match was played on, as its header records it. */
  seed: number;
  /** When it was played, as the log header wrote it — an ISO timestamp. */
  created: string;
  /** The two seats, labelled as `playerLabel` spells a seat. */
  seats: { A: string; B: string };
  /** The winning seat's label, or `null` for a draw. */
  winner: string | null;
  /** The final score, both seats' points as the log's `result` records them. */
  score: { A: number; B: number };
  /** Which rule ended it: the log's `result.type`. */
  type: MatchLog["result"]["type"];
  /** The turn it ended on. */
  turn: number;
  /** The margin the log records. */
  margin: number;
}

/** A log the console listed and could not read. */
export interface UnreadableLog {
  /** The log's file name. */
  name: string;
  /** The log on disk, as an absolute path. */
  path: string;
  /** The URL it would have been served at — the one `/api/matches` gives it. */
  url: string;
  /** The series it belongs to, or `null` for a match played on its own. */
  series: string | null;
  /** The one line the read failed on, which the page shows as it stands. */
  error: string;
}

/** What `GET /api/match-facts` answers. */
export interface MatchFactsListing {
  matchesRoot: string;
  /** One row per log this console could read, in the order `/api/matches` lists them. */
  matches: MatchFactRow[];
  /** Logs under the roots that are not there or will not parse. */
  unreadable: UnreadableLog[];
}

/** What reading one listed log gave: its facts, or the one line it failed on. */
export type LogFacts = { row: MatchFactRow; error: null } | { row: null; error: string };

/** One line for the page, from anything a read or a parse threw. */
const lineOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The line a failed read gives the operator, with the log named exactly once.
 * `readLogOf`'s own line for a file that would not parse says what is wrong with
 * the JSON and nothing about where it is; a read error like `EACCES` already
 * carries the path. Same rule as the unreadable locks in `./results.ts`, and an
 * empty `why` is `readLogOf`'s way of saying no file was there at all.
 */
const failureOf = (path: string, why: string): string => {
  const line = why === "" ? "the log the listing named is not on disk" : why;
  return line.includes(path) ? line : `${path}: ${line}`;
};

/** The facts a parsed log gives, beside the row that named it. */
const factsOf = (row: MatchRow, log: MatchLog): MatchFactRow => ({
  ...row,
  seed: log.seed,
  created: log.created,
  seats: { A: playerLabel(log.players.A), B: playerLabel(log.players.B) },
  winner: log.result.winner === null ? null : playerLabel(log.players[log.result.winner]),
  score: log.result.score,
  type: log.result.type,
  turn: log.result.turn,
  margin: log.result.margin,
});

/**
 * What one listed log says it was, or the one line reading it failed on.
 *
 * `readLogOf` is handed the log's own directory and its own absolute path, which
 * is the first path it tries — the record-relative candidates it also tries are
 * there for a series record's paths, which are written relative to wherever the
 * run was started, and a listing row already names the file.
 *
 * The read is wrapped in a `try` even though `readLogOf` catches what it finds:
 * a log this console listed and cannot read is one entry in `unreadable`, and
 * nothing a file on disk can do is allowed to take the route down.
 */
export const factsOfRow = async (row: MatchRow): Promise<LogFacts> => {
  let log: MatchLog | null;
  let why: string;
  try {
    ({ log, why } = await readLogOf(dirname(row.path), row.path));
  } catch (error) {
    return { row: null, error: failureOf(row.path, lineOf(error)) };
  }
  if (log === null) return { row: null, error: failureOf(row.path, why) };
  return { row: factsOf(row, log), error: null };
};

/**
 * Every finished log under either root, and what each one was.
 *
 * One walk — `matchRows`' — and one read per log it returns. The rows come back
 * in the listing's own order, so the two answers describe the same disk the same
 * way; the unreadable logs are in that order too, and are in the answer rather
 * than left out of it, because a log that has gone corrupt is work the operator
 * can see missing only if it is named.
 */
export const matchFactsRows = async (roots: UiRoots): Promise<MatchFactsListing> => {
  const listing = await matchRows(roots);
  const matches: MatchFactRow[] = [];
  const unreadable: UnreadableLog[] = [];

  for (const row of listing.matches) {
    const facts = await factsOfRow(row);
    if (facts.row === null) {
      unreadable.push({
        name: row.name,
        path: row.path,
        url: row.url,
        series: row.series,
        error: facts.error,
      });
      continue;
    }
    matches.push(facts.row);
  }

  return { matchesRoot: listing.matchesRoot, matches, unreadable };
};
