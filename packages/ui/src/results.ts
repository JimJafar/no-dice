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
 * **What is not listed, and says so.** Only what is under the roots the console
 * was given. A series started with `--dir` somewhere else is not under the root,
 * so it is not listed — and the page says that in as many words, because a series
 * that has quietly gone missing from the list is worse than one that is admitted
 * to be out of reach. The same goes for a match log written outside
 * `--matches-root`. A directory under the root that holds a `series.json` this
 * console cannot report is listed separately, with the line the report failed on,
 * rather than dropped.
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
 */
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import { seatLabel, seriesReport } from "@no-dice/stats/series-report";

import { resolveStatic } from "./static.ts";
import type { UiRoots } from "./state.ts";

/** The prefix every log on this console is served under. */
export const LOG_PREFIX = "/logs";

/** The prefix the built replay viewer is served under. */
export const VIEWER_PREFIX = "/viewer";

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

/** One series as the page lists it: the pairing, how far it got, and how it ended. */
export interface SeriesRow {
  /** The directory's own name, which is what `--name` gave it. */
  name: string;
  /** The series directory, as an absolute path — what a resume posts back. */
  dir: string;
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
  /** Whether the console offers to resume it: a series whose run is not in flight. */
  resumable: boolean;
}

/** What `GET /api/series` answers. */
export interface SeriesListing {
  seriesRoot: string;
  series: SeriesRow[];
  /** Directories under the root that hold a `series.json` this console could not report. */
  unreadable: { name: string; dir: string; error: string }[];
}

/** One series report, as a row. */
const rowOf = (
  name: string,
  dir: string,
  report: Awaited<ReturnType<typeof seriesReport>>,
  inFlight: string | null,
): SeriesRow => ({
  name,
  dir,
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
  resumable: inFlight === null || resolve(inFlight) !== dir,
});

/**
 * Every series under the root: every directory that holds a `series.json`, with
 * the figures `no-dice stats` prints for it.
 *
 * `inFlight` is the series directory the console has a run in, if any; that one
 * is not offered as a resume, because a second run into the same directory would
 * be a second run of the same matches.
 */
export const seriesRows = async (roots: UiRoots, inFlight: string | null): Promise<SeriesListing> => {
  const seriesRoot = resolve(roots.seriesRoot);
  const series: SeriesRow[] = [];
  const unreadable: SeriesListing["unreadable"] = [];

  for (const name of await subdirectories(seriesRoot)) {
    const dir = join(seriesRoot, name);
    if (!(await hasRecord(dir))) continue;
    try {
      series.push(rowOf(name, dir, await seriesReport(dir), inFlight));
    } catch (error) {
      // A record this console cannot read is still a series on disk, and the
      // operator has to be able to see that it is there and what is wrong with
      // it — a list that dropped it would read as a series that was never run.
      unreadable.push({ name, dir, error: lineOf(error) });
    }
  }

  return { seriesRoot, series, unreadable };
};

/** One finished match log, and where this console serves it. */
export interface MatchRow {
  /** The log's file name: `<seed>-<seat A>-<seat B>.json`. */
  name: string;
  /** The log on disk, as an absolute path. */
  path: string;
  /** The URL this console serves it at, under `/logs/`. */
  url: string;
  /** The viewer opened on that log — the `?log=` path `load.ts` already fetches. */
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

/** The viewer's own URL for a log this console serves. */
export const viewerUrlOf = (logUrl: string): string =>
  `${VIEWER_PREFIX}/?log=${logUrl}`;

const matchRowOf = (path: string, underRoot: string, series: string | null): MatchRow => {
  const url = logUrlOf(underRoot);
  return { name: path.slice(path.lastIndexOf("/") + 1), path, url, viewerUrl: viewerUrlOf(url), series };
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
 * What the series in `dir` says about how it should be resumed.
 *
 * The read is synchronous, like the run slot's other reads: a start is answered
 * synchronously, and the file is a few kilobytes read once per resume rather than
 * once per poll. A directory with no record, one whose record is not JSON, and one
 * whose record has no pairing to resume are each one line the console answers
 * with — the last of those is a series interrupted before its first write, and
 * there is no pairing to resume it with, which is worth saying out loud rather
 * than drawing a fresh one.
 */
export const resumeRecordOf = (dir: string): ResumeRecord => {
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
