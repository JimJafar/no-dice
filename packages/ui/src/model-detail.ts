/**
 * One model's detail: the pooled headline figures, and one block per series that
 * counted a match for it — everything the detail the leaderboard opens draws, in
 * one answer, so the page draws figures rather than works them out.
 *
 * **No arithmetic but one division.** The headline is `pooledModelRows`' row for
 * the label, figure for figure, over the reports one `seriesEntries` walk read —
 * the same walk `./leaderboard.ts` already pays for and by the same route to it,
 * `reportsOf`. Each block is that series' own `ModelRow` for the label, which is
 * already in those reports, so no series is reported twice. The one figure the
 * stats package does not answer is the wall clock *per match*: `perTurn.wallMs`
 * is a mean over turns and there is no per-match mean to take from a sum of
 * turns, so `wallMs / matches` is divided out here, over the matches that model
 * played in that series. Nothing else is counted, summed, averaged or intervalled
 * in this file — the epic's acceptance is that the page and `no-dice stats` agree
 * to the digit, and a second account of a win rate or a token count is how they
 * stop agreeing.
 *
 * **A click, not a page load.** `seriesEvidence(dir)` reads every log of a series
 * again, about a megabyte each (`docs/pi-harness-notes.md` §7), so one opening
 * costs one walk of the series root plus one evidence read per series that model
 * played in. That is why the rules' counters are not on `/api/leaderboard`, why
 * nothing polls this route, and why the page asks it when a row is clicked. The
 * evidence read is not avoidable from here: those five counters come off the two
 * boards each log carries, and the report keeps none of them.
 *
 * **Where a block's replay links come from.** A `ModelRow` names no log — it is a
 * row of figures — so the paths come from the evidence read the block already
 * pays for: its `rows` name every counted match's log and both seats' labels,
 * which is exactly the set of matches this model's row counts and the set this
 * block links. Turning them into addresses is `logUrlOf` and `viewerUrlOf`, and
 * costs no read beyond the two the block already costs. A block whose evidence
 * read failed therefore has no replay links either, and says the line it failed
 * on instead.
 *
 * **What cannot be read, and how it is said.** A label no report on this disk
 * names is refused with one line: there is no pooled row to answer with, and an
 * empty answer would read as a model that played and did nothing. A series whose
 * evidence this console cannot read stays a block — its figures came from the
 * report and stand — with `rules` carrying the line the evidence failed on. A
 * series whose *record* this console could not read at all cannot be
 * attributed to the label, since a record is what names a pairing, and
 * it is still listed as a block carrying that line: a series that has quietly
 * gone missing from a model's detail reads as a series that model never played,
 * which is the same rule `./leaderboard.ts` applies with its `unreadable` rows.
 *
 * **The kept copies are named only when they are there.** `report.md` the runner
 * wrote inside the series directory is served at `/logs/<series>/report.md`
 * whether or not it was ever written, and the console answers that 404 in its own
 * words. The copies under the reports root are different: `docs/series-notes.md`
 * §7 says they are made by hand and that it has been forgotten, so each one is
 * answered with whether it is on disk, and the page offers no link to a report
 * that was never written.
 */
import { basename, resolve } from "node:path";

import type { Seat } from "@no-dice/log";
import { pooledModelRows } from "@no-dice/stats/leaderboard";
import { seriesEvidence } from "@no-dice/stats/rules-evidence";
import type { SeriesEvidence } from "@no-dice/stats/rules-evidence";
import type { ModelRow, ResultRow } from "@no-dice/stats/series-report";

import {
  REPORTS_PREFIX,
  logUrlOf,
  reportPathOf,
  reportsOf,
  seriesEntries,
  viewerUrlOf,
} from "./results.ts";
import type { SeriesWalk } from "./results.ts";
import type { UiRoots } from "./state.ts";

/** The route the page asks one model's detail at. */
export const MODEL_DETAIL_PATH = "/api/model-detail";

/**
 * The view a block's replay links go back to, spelled as the console's own URL
 * spells a view. The detail is opened from a leaderboard row, so the reader goes
 * back to the leaderboard they clicked in; `./results.ts` writes the same note
 * about the matches listing's own view, and the test beside this file checks the
 * two spellings meet.
 */
const LEADERBOARD_VIEW = "#leaderboard";

/** One line for the page, from anything a read threw. */
const lineOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What the route was asked for, once its query has been read. */
export type DetailRequest = { ok: true; label: string } | { ok: false; error: string };

/**
 * The `label` of a `GET /api/model-detail` request, as the query wrote it.
 *
 * It is taken as it is spelled and not parsed as a seat: the label is what a
 * match log's header wrote, and a label that names no model on this disk is
 * refused further down, in the words that say so, rather than by a seat parser
 * that would refuse `bot:greedy`'s log label for reasons of its own.
 */
export const detailLabelOf = (url: string | undefined): DetailRequest => {
  let params: URLSearchParams;
  try {
    params = new URL(url ?? "/", "http://127.0.0.1").searchParams;
  } catch {
    return { ok: false, error: `"${String(url ?? "")}" is not a query this route can read` };
  }
  const label = params.get("label");
  if (label === null || label === "") {
    return {
      ok: false,
      error: "this route answers one model: it needs a `label`, spelled as the log headers spell it",
    };
  }
  return { ok: true, label };
};

/** The line for a label no report on this disk names. */
const notPlayedLine = (roots: UiRoots, label: string): string =>
  `"${label}" is not a model any report on this disk names: no series under ` +
  `${resolve(roots.seriesRoot)} has counted a match for it`;

/** One counted match of one series, and where this console serves its replay. */
export interface DetailMatchLink {
  /** The log's file name: `<seed>-<seat A>-<seat B>.json`. */
  name: string;
  /** The log on disk, as an absolute path — the one the evidence read counted. */
  path: string;
  /** The URL this console serves it at, under `/logs/`. */
  url: string;
  /** The viewer opened on that log, back to the leaderboard this block sits in. */
  viewerUrl: string;
  /** The seed the match was played on: a seed names a pair, so it names two matches. */
  seed: number;
}

/**
 * What a block links to, and which of those links are known to be dead.
 *
 * `reportUrl` is the runner's own copy inside the series directory, which is
 * gitignored with it and may never have been written; the two kept copies are the
 * ones `docs/series-notes.md` §7 carries out of that directory, and each carries
 * whether it is actually on disk, because a link to a report nobody copied is
 * a link the page should not offer.
 */
export interface DetailLinks {
  reportUrl: string;
  keptReportUrl: string;
  keptEvidenceUrl: string;
  keptReport: boolean;
  keptEvidence: boolean;
}

/**
 * One series' figures for one model: that series' `ModelRow` metrics, with the
 * per-match wall clock divided out here — see the note at the top of this file.
 *
 * `passes` is the stats package's own count by reason, which is where a timeout
 * is counted; `compactions` is how many of this model's turns compacted their
 * context, which the report answers as a list of turns and the page wants a
 * number of.
 */
export interface DetailFigures {
  turnCount: number;
  /** That model's own wall clock over the series — a seat's clock, not elapsed time. */
  wallMs: number;
  /** `wallMs` over the matches that model played in this series. */
  wallMsPerMatch: number;
  perTurn: { wallMs: number; costUsd: number; tokens: number };
  tokens: ModelRow["metrics"]["tokens"];
  costUsd: number;
  passedTurns: number;
  passes: ModelRow["metrics"]["passes"];
  compactions: number;
}

/**
 * The rules' five counters for one series, as that series' figures: they count
 * both seats of its pairing, since a lead and a board belong to the match rather
 * than to one model, so they are answered as the series' own figures rather than
 * as a per-model share of them, which nothing could check.
 */
export interface DetailRules {
  leadChanges: number;
  flipsPerTurn: number;
  nodeHandChanges: number;
  neutralCaptures: number;
  reScouts: number;
}

/** Those counters, or the one line the evidence read failed on. */
export type RulesAnswer = DetailRules | { error: string };

/**
 * One series this model played in, or one series this console could not read.
 *
 * `error` is non-null for the second: the line the record or the evidence
 * failed on. A block with an error still names the series and its links, because
 * the operator reading a failed series wants to know *which* series failed and be
 * able to open what is left of it.
 */
export interface ModelDetailBlock {
  /** The series directory's own name, which is what `--name` gave it. */
  name: string;
  /** The series directory, as an absolute path. */
  dir: string;
  /** The line this series failed on, or `null` when it was read. */
  error: string | null;
  /** That series' own row for the model: its rate and its 95% interval. */
  result: ResultRow | null;
  /** The same over only the matches this model played from each seat. */
  seatSplit: Record<Seat, ResultRow> | null;
  figures: DetailFigures | null;
  rules: RulesAnswer;
  /** The matches this block counts, each linked to its replay. */
  matches: DetailMatchLink[];
  links: DetailLinks;
}

/**
 * What `GET /api/model-detail` answers: the label, and the pooled row as
 * `pooledModelRows` answers it, plus one block per series that counted a match
 * for it. The pooled row's own `series` field — a list of directories — is
 * replaced by the blocks, which name each of those directories and everything
 * else about it.
 */
export interface ModelDetail {
  label: string;
  matches: number;
  seats: Record<Seat, number>;
  result: ResultRow;
  seatSplit: Record<Seat, ResultRow>;
  missing: number;
  missingNote: string;
  series: ModelDetailBlock[];
}

/** The answer: the detail, or one line saying the label names no model here. */
export type ModelDetailAnswer = { ok: true; detail: ModelDetail } | { ok: false; error: string };

/** One model's metrics in one series, as the block answers them. */
const figuresOf = (row: ModelRow): DetailFigures => ({
  turnCount: row.metrics.turnCount,
  wallMs: row.metrics.wallMs,
  // The one division in this file. `matches` is the count this row is taken
  // over, so the figure and the denominator are the same scope.
  wallMsPerMatch: row.matches === 0 ? 0 : row.metrics.wallMs / row.matches,
  perTurn: {
    wallMs: row.metrics.perTurn.wallMs,
    costUsd: row.metrics.perTurn.costUsd,
    tokens: row.metrics.perTurn.tokens,
  },
  tokens: row.metrics.tokens,
  costUsd: row.metrics.costUsd,
  passedTurns: row.metrics.passedTurns,
  passes: row.metrics.passes,
  compactions: row.metrics.context.compactionTurns.length,
});

/** The rules' five counters, out of the evidence read's own totals and means. */
const rulesOf = (evidence: SeriesEvidence): DetailRules => ({
  leadChanges: evidence.totals.leadChanges,
  // The one of the five the rules ask for as a rate: "about 6.5 hexes a turn
  // late on". The other four are counted per series, as the rules count them.
  flipsPerTurn: evidence.means.perTurn.flips,
  nodeHandChanges: evidence.totals.nodeHandChanges,
  neutralCaptures: evidence.totals.neutralCaptures,
  reScouts: evidence.totals.reScouts,
});

/** A kept copy's one URL segment, and the same segment in the address and in the lookup. */
const keptSegment = (file: string): string => encodeURIComponent(file);

/** Whether the reports root holds that kept copy: the `/reports/` route's own lookup. */
const keptOnDisk = (roots: UiRoots, file: string): boolean =>
  reportPathOf(roots, keptSegment(file)) !== null;

/** What one series links to, and which of its kept copies are on disk. */
const linksOf = (roots: UiRoots, name: string): DetailLinks => ({
  reportUrl: logUrlOf(`${name}/report.md`),
  keptReportUrl: `${REPORTS_PREFIX}/${keptSegment(`${name}.md`)}`,
  keptEvidenceUrl: `${REPORTS_PREFIX}/${keptSegment(`${name}-evidence.md`)}`,
  keptReport: keptOnDisk(roots, `${name}.md`),
  keptEvidence: keptOnDisk(roots, `${name}-evidence.md`),
});

/**
 * The matches this model played in that series, each linked to its replay.
 *
 * The evidence rows are the matches that counted — the same rule, the same
 * reader and the same record as the report that the figures came from — and a
 * match of a two-seat pairing counts for both of its seats, so the filter is on
 * the row's own headers rather than on the record's `seat`, which names model X's
 * seat and not this model's.
 */
const matchLinksOf = (
  name: string,
  rows: SeriesEvidence["rows"],
  label: string,
): DetailMatchLink[] =>
  rows
    .filter((each) => each.players.A === label || each.players.B === label)
    .map((each) => {
      const file = basename(each.path);
      const url = logUrlOf(`${name}/matches/${file}`);
      return { name: file, path: each.path, url, viewerUrl: viewerUrlOf(url, LEADERBOARD_VIEW), seed: each.seed };
    });

/** A series under the root whose record this console could not read. */
const unreadableBlock = (roots: UiRoots, name: string, dir: string, error: string): ModelDetailBlock => ({
  name,
  dir,
  error,
  result: null,
  seatSplit: null,
  figures: null,
  rules: { error },
  matches: [],
  links: linksOf(roots, name),
});

/**
 * One model's detail, from one walk of the series root and one evidence read per
 * series that model played in.
 *
 * `inFlight` is passed through to the walk unchanged; it decides
 * nothing here, and passing it is what keeps this route on the one walk rather
 * than a variant of it. A label no report names is `{ ok: false }` with the line
 * that says so, which the route answers as a refusal rather than as a
 * detail with nothing in it.
 */
export const modelDetailOf = async (
  roots: UiRoots,
  label: string,
  inFlight: string | null,
): Promise<ModelDetailAnswer> => {
  const walk: SeriesWalk = await seriesEntries(roots, inFlight);
  const pooled = pooledModelRows(reportsOf(walk)).find((each) => each.label === label);
  if (pooled === undefined) return { ok: false, error: notPlayedLine(roots, label) };

  const series: ModelDetailBlock[] = [];
  for (const entry of walk.entries) {
    if (entry.report === null) {
      // No report, so no model row, so nothing that says this model played
      // there — and no way to find that out, since the record is what would say
      // it. The series is named anyway, with the line: the alternative is a
      // detail that reads as though the model never played in a series that is
      // sitting on disk under the same root as the rest.
      series.push(unreadableBlock(roots, entry.name, entry.dir, entry.error));
      continue;
    }
    const row = entry.report.models.find((each) => each.label === label);
    if (row === undefined) continue;

    let rules: RulesAnswer;
    let matches: DetailMatchLink[];
    let error: string | null = null;
    try {
      const evidence = await seriesEvidence(entry.dir);
      rules = rulesOf(evidence);
      matches = matchLinksOf(entry.name, evidence.rows, label);
    } catch (thrown) {
      // The figures came out of the report and stand; the rules' counters and
      // the replay links came out of the second read and do not. The block says
      // which line it failed on rather than going missing.
      error = lineOf(thrown);
      rules = { error };
      matches = [];
    }

    series.push({
      name: entry.name,
      dir: entry.dir,
      error,
      result: row.result,
      seatSplit: row.seatSplit,
      figures: figuresOf(row),
      rules,
      matches,
      links: linksOf(roots, entry.name),
    });
  }

  return {
    ok: true,
    detail: {
      label: pooled.label,
      matches: pooled.matches,
      seats: pooled.seats,
      result: pooled.result,
      seatSplit: pooled.seatSplit,
      missing: pooled.missing,
      missingNote: pooled.missingNote,
      series,
    },
  };
};
