/**
 * What is on disk: the series under the console's series root, the finished match
 * logs under both roots, and the URL each of them is served at.
 *
 * **The figures are `no-dice stats`' own, not a second account of them.** Every
 * number a series row carries comes out of `seriesReport(dir)` in
 * `@no-dice/stats/series-report` — the same call `renderSeriesReport` makes when
 * the CLI writes the `report.md` sitting beside that `series.json`. Nothing here
 * counts a win, takes an interval, or sorts a match into counted and missing:
 * the epic's acceptance is that the per-pairing row *equals* what
 * `no-dice stats --series <dir>` prints, and two copies of that arithmetic are
 * how two such rows drift apart.
 *
 * **That is not free, and it is still the right trade.** `seriesReport` reads
 * `series.json` and then every match log the record names, and a full series
 * names 150 of them at about a megabyte each (`docs/pi-harness-notes.md` §7
 * measured one real match log at that size). So `GET /api/series` reads the whole
 * series root end to end on every request. For the tool this is — one operator on
 * loopback, a handful of series, a page that asks when it is opened rather than
 * once a second — that is a second or two of local disk against the alternative
 * above. Anyone who grows a cache here should key it on each series' own
 * `series.json` mtime, not on a copy of the figures.
 *
 * **The walk is one function, so a route never walks twice.** `seriesEntries`
 * is the only thing here that reads the series root: it hands back each series'
 * report, or the one line its record failed on, beside its name and directory.
 * `seriesRows` maps that to the rows `/api/series` answers with, and
 * `./leaderboard.ts` calls it once and pools the reports it got, so the
 * leaderboard costs the same walk rather than a second one over the same
 * megabyte logs.
 *
 * **What is not listed, and says so.** Only what is under the roots the console
 * was given. A series started with `--dir` somewhere else is not under the root,
 * so it is not listed — and the page says that in as many words, because a series
 * that has quietly gone missing from the list is worse than one that is admitted
 * to be out of reach. The same goes for a match log written outside
 * `--matches-root`. A directory under the root that holds a `series.json` this
 * console cannot report is listed separately, with the line the report failed on,
 * rather than dropped.
 *
 * **A series another process is playing is listed as playing.** For every
 * series under the root the walk reads `<dir>/series.lock` through
 * `@no-dice/runner/series-lock`: a row carries `playing` — that lock's pid and the
 * minute it was taken — when it names a live process, `stale` when it names one
 * that is gone, and `progress`, the record's own counters, while the run is in
 * flight. The run slot's `inFlight` is still in the resumable decision: it covers
 * the moment after a console run has been started and before its lock exists, and
 * it is the console's own word about its own run. It is no longer the only fact.
 * A series played by `no-dice series` in a terminal has no run in this process at
 * all, and a listing that read only this console's run slot would call it finished
 * and offer to play its matches a second time.
 *
 * **A lock this console cannot open is a series it cannot report.** Reading a lock
 * answers "no lock file", "a lock naming nothing" and "a lock whose process has
 * gone"; anything else — a lock another user wrote and closed (`EACCES`), a
 * `series.lock` that is a directory (`EISDIR`) — throws, and that throw is caught
 * one directory at a time: the series is listed in `unreadable` with the line the
 * read failed on, and every other series under the root is listed as normal. A row
 * that said nobody was playing behind a closed file would be a guess in the one
 * direction that costs anything — it offers a resume over matches somebody may be
 * playing. `GET /api/playing` leaves such a directory out, since it answers only
 * who it can see playing, and the line it failed on is on the other route.
 *
 * **`GET /api/playing` is the cheap half of that reading.** `playingRows` reads
 * `series.lock` and `series.json` and no match log, which is what lets a page that
 * wants a pair count moving ask it on a poll; `/api/series` reads every log of
 * every series, which is the cost the second paragraph above names. The two answer
 * different questions on purpose: a series whose record this console cannot report
 * is in `unreadable` on one route and answers with its counters on the other, and
 * that difference is the reason there are two routes rather than one with a flag.
 *
 * **The two roots share one URL space under `/logs/`.** A series' logs are at
 * `/logs/<series>/matches/<file>.json` and a single match's at
 * `/logs/<file>.json`, so a path is looked for under the series root first and
 * then under the matches root. The two are separate directories in every real
 * setup (`series/` and `matches/` at the repo root); the order only decides the
 * one case where they overlap. Both lookups go through `resolveStatic`, which is
 * the same refuses-to-escape rule the built app is served under — percent-decoded
 * climbs, dot segments and a symlink planted inside the root are each refused
 * before a byte is read.
 *
 * **The kept copies are a third root, and their own URL space.** `report.md` and
 * `evidence.md` inside a series directory are gitignored with it, so what survives
 * the workspace is the pair `docs/series-notes.md` §7 copies by hand into
 * `reports/series/<name>.md` and `reports/series/<name>-evidence.md`. Those are
 * served at `/reports/<name>.md` and `/reports/<name>-evidence.md`, under the same
 * `resolveStatic` refusal as `/logs/`, and nothing else: neither listing looks in
 * that root, because a kept copy's URL follows from the series' own directory name
 * and the route that is asked can say whether the file is there. A listing that
 * guessed would be a listing that lies about a directory it never read — and a
 * series whose copy was never made, which §7 says has happened, is answered with
 * one line rather than a link that goes nowhere.
 */
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import { readSeriesLock, readSeriesLockSync, seriesLockPath } from "@no-dice/runner/series-lock";
import type { LockState, SeriesLock } from "@no-dice/runner/series-lock";
import { seatLabel, seriesReport } from "@no-dice/stats/series-report";
import type { SeriesReport } from "@no-dice/stats/series-report";

import { readRunCounters } from "./progress.ts";
import type { RunCounters } from "./progress.ts";
import { resolveStatic } from "./static.ts";
import type { UiRoots } from "./state.ts";

/** The prefix every log on this console is served under. */
export const LOG_PREFIX = "/logs";

/**
 * The prefix the kept copies are served under: `<name>.md` the report,
 * `<name>-evidence.md` the rules evidence, each named after the series' own
 * directory. A third prefix rather than another path under `/logs/`, because
 * these files are not under either of the two roots `/logs/` reads — that is the
 * whole point of keeping them.
 */
export const REPORTS_PREFIX = "/reports";

/** The prefix the built replay viewer is served under. */
export const VIEWER_PREFIX = "/viewer";

/**
 * The view the match listing is drawn in, spelled as the console's own URL spells
 * a view — the hash its page routes on. A listing's own link goes back there; the
 * page restates it for whichever of its views is drawing the row.
 *
 * The console's page keeps the list of views in its own `views.ts`, which this
 * package cannot import — the page reads these listings as JSON, not as modules —
 * so the one view a listing is drawn in is written out here, and the page's tests
 * check the two spellings meet in the `back=` a link carries.
 */
const MATCHES_VIEW = "#matches";

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";

/** One line for the page, from anything a read or a report threw. */
const lineOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The names of the directories under `dir`, in order; none when it is not there. */
const subdirectories = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((each) => each.isDirectory()).map((each) => each.name).sort();
  } catch (error) {
    // A root nobody has run anything into yet is an empty list, not an error:
    // the page has nothing to list, and says so.
    if (isMissing(error)) return [];
    throw error;
  }
};

/** The `*.json` files directly under `dir`, in order; none when it is not there. */
const jsonFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((each) => each.isFile() && each.name.endsWith(".json")).map((each) => each.name);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
};

/** Whether this directory is a series: it holds a `series.json`. */
const hasRecord = async (dir: string): Promise<boolean> => {
  try {
    return (await stat(join(dir, "series.json"))).isFile();
  } catch {
    // Not there, or not readable, or `dir` is not a directory: either way this is
    // not a series, and the page has nothing to say about it.
    return false;
  }
};

/**
 * The run a series directory's lock names: the process that took it, and when.
 *
 * `startedAt` is copied out of the lock as it was written. It decides nothing here
 * — the pid decides live and gone — but an operator reading a lock a killed run
 * left behind has to be able to tell which run left it.
 */
export interface LockHolder {
  pid: number;
  startedAt: string;
}

/** One series as the page lists it: the pairing, how far it got, and how it ended. */
export interface SeriesRow {
  /** The directory's own name, which is what `--name` gave it. */
  name: string;
  /** The series directory, as an absolute path — what a resume posts back. */
  dir: string;
  /**
   * The report the CLI wrote for this series, served under `/logs/`. The runner
   * writes `report.md` when a series finishes, so a series interrupted inside its
   * first batch has no report to open yet; the link is there either way,
   * and the console answers a report that is not there as a 404 in its own words.
   */
  reportUrl: string;
  /** The pairing, spelled as `--a` and `--b` spell it. */
  a: string;
  b: string;
  /** The pair limit the record holds, which is what a resume restates. */
  maxPairs: number;
  /** Pairs the record lists, and matches it lists in total. */
  pairs: number;
  matches: number;
  /** The matches every figure below is taken over, and the ones left out of it. */
  counted: number;
  missing: number;
  /** Which rule ended it, and whether that was short of `maxPairs`. */
  stopReason: string;
  stoppedEarly: boolean;
  /** Model X's record over the counted matches, with the 95% interval the report quotes. */
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  interval: { low: number; high: number } | null;
  confidence: number;
  /**
   * The ceilings the record's `stop` fields name, or `null` for a run that had
   * none. They are shown so the operator can restate them on a resume: a resumed
   * run that gives no ceiling has no ceiling, which is a fact rather than a
   * detail the page can leave out.
   */
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
   * interrupted rather than playing, and the recovery is to resume it. `null`
   * while the lock names somebody who is alive, and when there is no lock.
   */
  stale: LockHolder | null;
  /**
   * The record's own counters — pairs played, matches played and failed, tokens
   * and cost so far — read with `readRunCounters` as the listing was asked
   * for. Non-null **only** for a series that is playing: a finished row already
   * carries the report's `pairs`, `counted` and `missing`, and a row holding a
   * second account of how far a finished series got is how the two drift apart.
   */
  progress: RunCounters | null;
  /**
   * Whether the console offers to resume it: no run in flight here, and no lock
   * naming a live process. A stale lock does not refuse one — the run that wrote
   * it is gone, and resuming that series is what to do about it.
   */
  resumable: boolean;
}

/** A directory under the root whose `series.json` this console could not report. */
export interface UnreadableSeries {
  name: string;
  dir: string;
  /** The one line the report failed on, which the page shows as it stands. */
  error: string;
}

/** What `GET /api/series` answers. */
export interface SeriesListing {
  seriesRoot: string;
  series: SeriesRow[];
  /** Directories under the root that hold a `series.json` this console could not report. */
  unreadable: UnreadableSeries[];
}

/** One series under the root that this console could read. */
export interface ReadableSeries {
  /** The directory's own name, which is what `--name` gave it. */
  name: string;
  /** The series directory, as an absolute path. */
  dir: string;
  /** Whether the console offers it as a resume: no run in flight, no live lock. */
  resumable: boolean;
  /** The run its lock names, when that process is alive. */
  playing: LockHolder | null;
  /** The lock whose process has gone, when there is one. */
  stale: LockHolder | null;
  /** The record's counters, and only while the series is playing. */
  progress: RunCounters | null;
  /** The report `no-dice stats --series <dir>` prints for it. */
  report: SeriesReport;
  error: null;
}

/** One series under the root whose record this console could not read. */
export interface BrokenSeries {
  name: string;
  dir: string;
  resumable: boolean;
  report: null;
  /** The one line the report failed on. */
  error: string;
}

/** One series under the root, as the walk found it: its report, or the line it failed on. */
export type SeriesEntry = ReadableSeries | BrokenSeries;

/** What one walk of the series root found. */
export interface SeriesWalk {
  seriesRoot: string;
  /** One entry per directory under the root that holds a `series.json`, in name order. */
  entries: SeriesEntry[];
}

/** A lock as the row names who holds it. */
const holderOf = (lock: SeriesLock): LockHolder => ({ pid: lock.pid, startedAt: lock.started_at });

/** What reading one directory's lock found: what it says, or the line it failed on. */
type LockRead = { lock: LockState; failed: null } | { lock: null; failed: string };

/**
 * What `dir`'s lock says, or the line reading it failed on.
 *
 * `readSeriesLock` reports no lock file, a lock that names nothing and a lock whose
 * process has gone, and it throws for anything else — a lock another user wrote and
 * left closed (`EACCES`), a `series.lock` that is a directory (`EISDIR`). Those are
 * the failures this helper keeps, because a directory this console cannot open is
 * one series it cannot report, and letting the throw out would answer the operator
 * with nothing at all: every other series under the root would go down with it.
 */
const lockReadOf = async (dir: string): Promise<LockRead> => {
  try {
    return { lock: await readSeriesLock(dir), failed: null };
  } catch (error) {
    // The line, with the file named when the failure does not name it: EACCES
    // says which path it could not open, EISDIR says nothing of the kind, and an
    // operator reading `unreadable` has to be able to tell which file to fix.
    const line = lineOf(error);
    const path = seriesLockPath(dir);
    return { lock: null, failed: line.includes(path) ? line : `${path}: ${line}` };
  }
};

/** One series report, as a row. */
const rowOf = ({ name, dir, resumable, playing, stale, progress, report }: ReadableSeries): SeriesRow => ({
  name,
  dir,
  reportUrl: logUrlOf(`${name}/report.md`),
  a: seatLabel(report.x),
  b: seatLabel(report.opponent),
  maxPairs: report.maxPairs,
  pairs: report.pairs,
  matches: report.matches,
  counted: report.counted,
  missing: report.missing.total,
  stopReason: report.stop.reason,
  stoppedEarly: report.stop.stoppedEarly,
  wins: report.result.winRate.wins,
  losses: report.result.winRate.losses,
  draws: report.result.winRate.draws,
  winRate: report.result.winRate.rate,
  interval: report.result.interval,
  confidence: report.result.confidence,
  ceilingUsd: report.stop.ceilingUsd ?? null,
  ceilingTokens: report.stop.ceilingTokens ?? null,
  playing,
  stale,
  progress,
  resumable,
});

/**
 * Every series under the root, read once: every directory that holds a
 * `series.json`, with the report `no-dice stats` prints for it beside its name
 * and directory — or with the one line that report failed on.
 *
 * This is the only walk of the series root in the console. `seriesRows` below
 * turns it into the rows `/api/series` answers with, and `./leaderboard.ts`
 * turns one call of it into both of its tables, so a route that wants the
 * figures of every series on disk pays for one read of every match log and not
 * two.
 *
 * `inFlight` is the series directory the console has a run in, if any; that one
 * is not offered as a resume, because a second run into the same directory would
 * be a second run of the same matches. Neither is a series whose lock names a
 * live process: that directory is being played by somebody else on this machine,
 * and the row says so and names the pid rather than offering a second run over
 * the matches the first is playing.
 */
export const seriesEntries = async (roots: UiRoots, inFlight: string | null): Promise<SeriesWalk> => {
  const seriesRoot = resolve(roots.seriesRoot);
  const entries: SeriesEntry[] = [];

  for (const name of await subdirectories(seriesRoot)) {
    const dir = join(seriesRoot, name);
    if (!(await hasRecord(dir))) continue;

    // The lock is the fact this console could not otherwise know. Its run slot
    // only ever holds a run this process started, and a series played by
    // `no-dice series` in a terminal is in no run slot anywhere.
    const read = await lockReadOf(dir);
    if (read.lock === null) {
      // A lock this console cannot open is a series it cannot report: somebody may
      // be playing that directory behind the closed file, and a row saying nobody
      // was playing it would be a guess in the direction that starts a second run
      // over the matches the first is playing. The line the read failed on is what
      // the operator can act on, and this one directory is the whole of the damage.
      entries.push({ name, dir, resumable: false, report: null, error: read.failed });
      continue;
    }
    const lock = read.lock;
    const playing = lock.kind === "held" ? holderOf(lock.lock) : null;
    const stale = lock.kind === "stale" ? holderOf(lock.lock) : null;
    // The run slot stays in the decision: it covers the moment after a console
    // run has been started and before its lock exists, and it is the console's
    // own word about its own run. A stale lock is no refusal — the run that wrote
    // it has gone, and resuming that series is the recovery.
    const resumable = (inFlight === null || resolve(inFlight) !== dir) && playing === null;
    try {
      entries.push({
        name,
        dir,
        resumable,
        playing,
        stale,
        // Only a series that is being played gets the record's counters: a
        // finished row already carries the report's figures, and this is the
        // series' own account of a run still moving, not a second copy of one
        // that has stopped.
        progress: playing === null ? null : readRunCounters(dir),
        report: await seriesReport(dir),
        error: null,
      });
    } catch (error) {
      // A record this console cannot read is still a series on disk, and the
      // operator has to be able to see that it is there and what is wrong with
      // it — a list that dropped it would read as a series that was never run.
      entries.push({ name, dir, resumable, report: null, error: lineOf(error) });
    }
  }

  return { seriesRoot, entries };
};

/** The rows and the unreadable list, split out of one walk. */
export const seriesListingOf = (walk: SeriesWalk): SeriesListing => {
  const series: SeriesRow[] = [];
  const unreadable: UnreadableSeries[] = [];
  for (const entry of walk.entries) {
    if (entry.report === null) unreadable.push({ name: entry.name, dir: entry.dir, error: entry.error });
    else series.push(rowOf(entry));
  }
  return { seriesRoot: walk.seriesRoot, series, unreadable };
};

/** One series under the root that holds a `series.lock`, and what that lock says. */
export interface PlayingRow {
  /** The directory's own name, which is what `--name` gave it. */
  name: string;
  /** The series directory, as an absolute path. */
  dir: string;
  /** The process the lock names. */
  pid: number;
  /** When it took the lock, as the lock wrote it. */
  startedAt: string;
  /** Whether that process has gone: the run that wrote the lock died where it stood. */
  stale: boolean;
  /** The record's own counters, or `null` for a record this console cannot read. */
  progress: RunCounters | null;
}

/** What `GET /api/playing` answers. */
export interface PlayingListing {
  seriesRoot: string;
  /** One entry per series under the root that holds a `series.lock`, in name order. */
  playing: PlayingRow[];
}

/**
 * Every series under the root that holds a `series.lock`, with the counters its
 * own record carries: `series.lock` and `series.json` and no match log.
 *
 * This is what a page can ask once a second. `seriesRows` reads every log of
 * every series — 150 of them at a megabyte each for a full series — and so is a
 * route for when the page is opened, not for a poll. The two are not the same
 * listing and do not fail the same way: a series whose record this console cannot
 * report is in `unreadable` there and answers with its counters here, because a
 * run's counters do not need its finished logs to be readable.
 *
 * A series with no lock is not here at all: this route answers who is playing,
 * and a finished series is playing nobody. A series whose lock it cannot open is
 * not here either — that one is on `/api/series`, in `unreadable`, with the line
 * the read failed on — because this route says only who it can see playing, and
 * one closed file is not a reason to answer the poll with nothing. The counters
 * need no such guard: `readRunCounters` answers `null` for a record it cannot
 * read, and never throws.
 */
export const playingRows = async (roots: UiRoots): Promise<PlayingListing> => {
  const seriesRoot = resolve(roots.seriesRoot);
  const playing: PlayingRow[] = [];

  for (const name of await subdirectories(seriesRoot)) {
    const dir = join(seriesRoot, name);
    const read = await lockReadOf(dir);
    // A directory whose lock this console cannot open is not in this answer: the
    // route says who it can see playing, and it cannot see this one. It is not
    // dropped without a trace — `GET /api/series` lists the same directory in
    // `unreadable` with this line — and one closed file is not a reason to answer
    // the poll with nothing.
    if (read.lock === null) continue;
    const lock = read.lock;
    if (lock.kind === "free") continue;
    playing.push({
      name,
      dir,
      pid: lock.lock.pid,
      startedAt: lock.lock.started_at,
      stale: lock.kind === "stale",
      progress: readRunCounters(dir),
    });
  }

  return { seriesRoot, playing };
};

/**
 * The reports one walk read, in the order it read them. A record that failed to
 * read has no report to hand over, so it contributes nothing to whatever these
 * are pooled into — and it is in `unreadable`, which is what says so.
 */
export const reportsOf = (walk: SeriesWalk): SeriesReport[] =>
  walk.entries.flatMap((entry) => (entry.report === null ? [] : [entry.report]));

/** `GET /api/series`: every series under the root, with the figures `no-dice stats` prints for it. */
export const seriesRows = async (roots: UiRoots, inFlight: string | null): Promise<SeriesListing> =>
  seriesListingOf(await seriesEntries(roots, inFlight));

/** One finished match log, and where this console serves it. */
export interface MatchRow {
  /** The log's file name: `<seed>-<seat A>-<seat B>.json`. */
  name: string;
  /** The log on disk, as an absolute path. */
  path: string;
  /** The URL this console serves it at, under `/logs/`. */
  url: string;
  /** The viewer opened on that log — the `?log=` path `load.ts` already fetches,
   * with the view this listing is drawn in beside it, for the viewer's way back. */
  viewerUrl: string;
  /** The series it belongs to, or `null` for a match played on its own. */
  series: string | null;
}

/** What `GET /api/matches` answers. */
export interface MatchListing {
  matchesRoot: string;
  matches: MatchRow[];
}

/** The URL a path under one of the two roots is served at. */
export const logUrlOf = (pathUnderRoot: string): string =>
  `${LOG_PREFIX}/${pathUnderRoot.split("/").map(encodeURIComponent).join("/")}`;

/** A view as a `back=` value: the `#` is the one character that has to be escaped. */
const backValueOf = (view: string): string => view.replaceAll("#", "%23");

/**
 * The viewer's own URL for a log this console serves, opened from the view whose
 * link it is.
 *
 * `back` is that view, spelled as the console spells its own views (`#matches`)
 * and escaped on the way, so the viewer can offer a way back to the row the replay
 * was clicked in rather than to the top of a page the operator had already read.
 * The escape is only ever of the `#`: a bare one in a query is read as the start of
 * a fragment, and the rest of the value stays plain enough to read in an address
 * bar. `?log=` keeps exactly the form the viewer's `load.ts` fetches.
 */
export const viewerUrlOf = (logUrl: string, view: string): string =>
  `${VIEWER_PREFIX}/?log=${logUrl}&back=${backValueOf(view)}`;

const matchRowOf = (path: string, underRoot: string, series: string | null): MatchRow => {
  const url = logUrlOf(underRoot);
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    url,
    viewerUrl: viewerUrlOf(url, MATCHES_VIEW),
    series,
  };
};

/**
 * Every finished match log: the ones in `<seriesRoot>/<series>/matches/` and the
 * ones directly under `--matches-root`. A log on disk is what the runner counts
 * as a finished match — it writes each one in a single atomic rename, so a
 * half-played match has no log to list and there is nothing here to decide about
 * "finished".
 */
export const matchRows = async (roots: UiRoots): Promise<MatchListing> => {
  const seriesRoot = resolve(roots.seriesRoot);
  const matchesRoot = resolve(roots.matchesRoot);
  const matches: MatchRow[] = [];

  for (const name of await subdirectories(seriesRoot)) {
    for (const file of await jsonFiles(join(seriesRoot, name, "matches"))) {
      const underRoot = `${name}/matches/${file}`;
      matches.push(matchRowOf(join(seriesRoot, underRoot), underRoot, name));
    }
  }
  for (const file of await jsonFiles(matchesRoot)) {
    matches.push(matchRowOf(join(matchesRoot, file), file, null));
  }

  // One order, whatever the filesystem's own order was, so two reads of
  // an unchanged disk draw the same list.
  matches.sort((left, right) => left.url.localeCompare(right.url));
  return { matchesRoot, matches };
};

/**
 * The log file a `/logs/<path>` request names, or `null` when it names nothing
 * servable. `urlPath` is the part after `/logs/`, still percent-encoded as the
 * request wrote it; `resolveStatic` decodes it and refuses anything that leaves
 * the root it is looked up in, symlink included.
 */
export const logPathOf = (roots: UiRoots, urlPath: string): string | null =>
  resolveStatic(roots.seriesRoot, urlPath) ?? resolveStatic(roots.matchesRoot, urlPath);

/**
 * The kept copy a `/reports/<path>` request names, or `null` when it names
 * nothing servable. `urlPath` is the part after `/reports/`, still percent-encoded
 * as the request wrote it; `resolveStatic` decodes it and refuses anything that
 * leaves the reports root, symlink included — the one rule, applied to a third
 * root rather than a second copy of it.
 *
 * A kept copy that is not there is `null` like a climb is `null`, and the route
 * answers both with one line. They are different facts — a series interrupted
 * before it wrote a report, and a finished series whose copy nobody made — but the
 * page cannot tell them apart from a listing either, and §7's answer to the
 * second is a step at the terminal, not a route.
 */
export const reportPathOf = (roots: UiRoots, urlPath: string): string | null =>
  resolveStatic(roots.reportsRoot, urlPath);

/** How a series record names one seat of its pairing. */
const seatRefSchema = z.union([
  z.object({ kind: z.literal("bot"), bot: z.string() }),
  z.object({ kind: z.literal("model"), provider: z.string(), model: z.string() }),
]);

/** What a series' own record says a resumed run has to keep. */
export interface ResumeRecord {
  /** The pairing, spelled as `--a` and `--b` take it. */
  a: string;
  b: string;
  /** The pair limit the record holds: the resume plays that length, not a new one. */
  maxPairs: number;
  /** The ceilings the last run recorded, which the operator may restate. */
  ceilingUsd: number | null;
  ceilingTokens: number | null;
}

/**
 * The part of `series.json` a resume reads. `pairing` and `max_pairs` are what
 * the run has to keep; `stop` is optional because a series interrupted inside its
 * first batch has recorded no decision yet — and a series that ran with no
 * ceilings never records one.
 */
const resumeShape = z.object({
  max_pairs: z.number().int().nonnegative(),
  pairing: z.object({ a: seatRefSchema, b: seatRefSchema }),
  stop: z
    .object({ ceiling_usd: z.number().optional(), ceiling_tokens: z.number().optional() })
    .passthrough()
    .optional(),
});

/**
 * The lock `dir` holds, when it names a process that is alive; `null` for no
 * lock, one that names nothing readable, one whose process has gone, and one this
 * console cannot open.
 *
 * The read is synchronous because the run slot's start is: it answers a POST
 * without awaiting anything. It is the runner's own `readSeriesLockSync`, so the
 * pid bounds, what a lock that will not parse means and what counts as alive are
 * decided in one place, and the console cannot disagree with the run the runner
 * refuses. A lock it cannot open names no process to refuse: the runner is the
 * authority on the directory, and it refuses that run itself when it tries to take
 * the lock and cannot read it.
 */
const liveLockOf = (dir: string): SeriesLock | null => {
  try {
    const lock = readSeriesLockSync(dir);
    return lock.kind === "held" ? lock.lock : null;
  } catch {
    return null;
  }
};

/**
 * What the series in `dir` says about how it should be resumed.
 *
 * The read is synchronous, like the run slot's other reads: a start is answered
 * synchronously, and the file is a few kilobytes read once per resume rather than
 * once per poll. A directory with no record, one whose record is not JSON, and one
 * whose record has no pairing to resume are each one line the console answers
 * with — the last of those is a series interrupted before its first write, and
 * there is no pairing to resume it with, which is worth saying out loud rather
 * than drawing a fresh one.
 *
 * A lock naming a live process is refused first, before the record is read at
 * all. The runner refuses that run too, but a console that started it would show
 * its operator a run whose only output is an error line a minute later; the
 * refusal here is the same fact, said at the moment the button was pressed.
 */
export const resumeRecordOf = (dir: string): ResumeRecord => {
  const held = liveLockOf(dir);
  if (held !== null) {
    throw new Error(
      `another series run holds ${seriesLockPath(dir)}: pid ${String(held.pid)} started at ` +
        `${held.started_at} and is still playing this series, so it is not resumed`,
    );
  }

  const path = join(dir, "series.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} is not there, so there is no series to resume`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} is not JSON, so there is no series to resume`);
  }

  const record = resumeShape.safeParse(parsed);
  if (!record.success) {
    throw new Error(
      `${path} does not record a pairing to resume: ${record.error.issues
        .map((issue) => `${issue.path.join(".") || "series"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return {
    a: seatLabel(record.data.pairing.a),
    b: seatLabel(record.data.pairing.b),
    maxPairs: record.data.max_pairs,
    ceilingUsd: record.data.stop?.ceiling_usd ?? null,
    ceilingTokens: record.data.stop?.ceiling_tokens ?? null,
  };
};
