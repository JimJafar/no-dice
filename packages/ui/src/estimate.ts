/**
 * What a run would cost, measured off the matches this console can already see:
 * the series under its root that have played each of the two seats.
 *
 * **The figures are the stats package's own.** Every number in an answer comes
 * out of a `seriesReport`'s `models[]` row for that seat — `matches`,
 * `metrics.turnCount`, `metrics.tokens.total`, `metrics.costUsd`,
 * `metrics.wallMs` — summed over the series that played it and then scaled to
 * the length being asked about. Nothing here counts a turn, prices a token or
 * adds a millisecond a second time: the reason `./results.ts` and
 * `./leaderboard.ts` refuse a second account of a win rate is the reason this
 * file refuses a second account of a token count. The only arithmetic in this
 * file is a sum over reports and a scale by a match count, and the only
 * arithmetic left to the page is `pairs × 2 = matches`, which is what a pair
 * *is* — one pair, played both ways.
 *
 * **One walk, and the expensive one.** `seriesEntries` is the same walk
 * `/api/series` and `/api/leaderboard` do: it reads `series.json` and then every
 * match log the record names, and `docs/pi-harness-notes.md` §7 measures a real
 * match log at about a megabyte, so a full series is 150 of them. This route
 * pays that walk once per request. That is what the page is told beside it — the
 * estimate is asked when the form is opened, not on every keystroke — and it is
 * why the once-a-second poll stays on `/api/playing`, which reads no match log.
 *
 * **A seat is measured by the series that played it**, not by the pairing in the
 * query: the reports that count for a label are the ones under the root carrying
 * a model row with that label, and their figures are pooled. A seat no series
 * under the root has played is answered as unmeasured and quotes the one
 * figure this repo has ever measured rather than inventing one — see
 * `DOCUMENTED_MATCH`. A run whose seats are both bots is answered from the bots'
 * own rows, which are real: the greedy bot's figures are 0 tokens and a few
 * milliseconds a turn, and quoting them is more honest than quoting a model's.
 *
 * **Time is time in the seats, not elapsed time.** `wallMs` is one seat's own
 * wall clock, and the two seats of a match play in turn, so a match's time is
 * the two seats' figures added. `--concurrency` plays *pairs* at a time and
 * divides neither seat's clock, so it is echoed in the answer and used in no
 * arithmetic at all. The field is named `seatMs` for that reason: an answer that
 * said `ms` would be read as elapsed time, which is a different quantity and the
 * one a page would then be tempted to divide by its concurrency.
 *
 * **No path in the answer.** A series is named by the name the results listing
 * gives it — the series directory's own name, `deepseek-flash-vs-greedy` —
 * because the page may not print a path into the repo. That is why this answer
 * carries no `seriesRoot` either, unlike `/api/series` and `/api/leaderboard`:
 * the root is a path, and an estimate has no use for one. A series whose record
 * this console cannot read contributes nothing here and is not listed; the line
 * it failed on, which names a path, is on `/api/series`.
 *
 * **The query is the command line's, not a second one.** `a`, `b`, `pairs` and
 * `concurrency` are handed to `parseArgs` as the `no-dice series` flags they
 * stand for, so a seat typed as `marvin` with no model id comes back as the
 * terminal's own line and a `pairs` of `0` is refused the way `--max-pairs 0`
 * is. A field the query left blank contributes no flag, which is what makes it
 * the runner's default rather than a zero.
 */
import { DEFAULT_MAX_PAIRS } from "@no-dice/runner/series-plan";
import { parseArgs } from "@no-dice/runner/args";
import { seatLabel } from "@no-dice/stats/series-report";
import type { ModelRow, SeriesReport } from "@no-dice/stats/series-report";

import { seriesEntries } from "./results.ts";
import type { SeriesWalk } from "./results.ts";
import type { UiRoots } from "./state.ts";

/** The route the page asks for an estimate at. */
export const ESTIMATE_PATH = "/api/estimate";

/** The one game this console plays, spelled as `--game` takes it. */
const GAME = "salient";

/**
 * The pair limit and the concurrency the runner plays when the query names
 * neither: `DEFAULT_MAX_PAIRS` in `packages/runner/src/series-plan.ts`, and
 * `DEFAULT_CONCURRENCY` in `packages/runner/src/series.ts`. The first is
 * imported; `series.ts`, which holds the second, is not in that map, so its
 * value is named here with its source, the way
 * `packages/ui/web/src/start.ts` names the same three numbers.
 */
const DEFAULT_PAIRS = DEFAULT_MAX_PAIRS;
const DEFAULT_CONCURRENCY = 1;

/**
 * The one model match this repo has measured, quoted rather than computed:
 * `docs/pi-harness-notes.md` §7 — one match of Pi on `marvin/subagent`
 * against the greedy bot, nineteen minutes of wall time and 4.59M tokens, on
 * hardware that prices nothing. It is spelled out here and nowhere else in the
 * console, because a page that multiplied its own copy of it into a series
 * estimate would be a page disagreeing with the notes.
 *
 * There is no `turns` and no `costUsd` in it on purpose: the notes record the
 * time and the tokens, and Marvin's cost was never a number anybody had.
 */
export const DOCUMENTED_MATCH = {
  tokens: 4_590_000,
  seatMs: 19 * 60 * 1000,
  line:
    "the only model match measured on this repo's record: the first Marvin match, " +
    "about 19 minutes and 4.59M tokens for one match",
} as const;

/** What the route was asked for, once its query has been read. */
export interface EstimateQuery {
  /** Seat A, as `--a` takes it and as a report's model row labels it. */
  a: string;
  b: string;
  /** Pairs to play; the run is twice that in matches. */
  pairs: number;
  /** Matches played at once, echoed: it divides nothing in this answer. */
  concurrency: number;
}

/** A query read: the ask, or one line saying what was wrong with it. */
export type EstimateRequest = { ok: true; query: EstimateQuery } | { ok: false; error: string };

/** The query's parameters, and the `no-dice series` flag each one stands for. */
const QUERY_FLAGS: readonly [param: string, flag: string][] = [
  ["a", "--a"],
  ["b", "--b"],
  ["pairs", "--max-pairs"],
  ["concurrency", "--concurrency"],
];

/**
 * The query of a `GET /api/estimate` request, as the CLI would read it.
 *
 * The seats come back as labels, because a label is what a report's model row is
 * keyed by and what the page has to name a seat by. A parameter the query left
 * out contributes no flag, so a missing `pairs` is the runner's default rather
 * than a zero, and a missing seat is `parseArgs`'s own "`--a` and `--b` are
 * required". A parameter that is there but is not a seat — `marvin` with no
 * model id, `bot:surprise` — is refused in the terminal's wording, which is the
 * wording the page already shows for a run form that typed the same thing.
 */
export const estimateQueryOf = (url: string | undefined): EstimateRequest => {
  let params: URLSearchParams;
  try {
    params = new URL(url ?? "/", "http://127.0.0.1").searchParams;
  } catch {
    return { ok: false, error: `"${String(url ?? "")}" is not a query this route can read` };
  }

  const argv = ["series", "--game", GAME];
  for (const [param, flag] of QUERY_FLAGS) {
    const value = params.get(param);
    if (value === null || value === "") continue;
    argv.push(flag, value);
  }

  const parsed = parseArgs(argv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.command.name !== "series") {
    return { ok: false, error: `"${String(parsed.command.name)}" is not a series run` };
  }
  const command = parsed.command;

  return {
    ok: true,
    query: {
      a: seatLabel(command.a),
      b: seatLabel(command.b),
      pairs: command.maxPairs ?? DEFAULT_PAIRS,
      concurrency: command.concurrency ?? DEFAULT_CONCURRENCY,
    },
  };
};

/** One seat's counts over a scope of matches, in the stats package's own units. */
export interface SeatFigures {
  /** Turns that seat played, over every match in scope. */
  turns: number;
  /** Tokens that seat used: the report's `tokens.total`, which counts cache reads. */
  tokens: number;
  /** What that seat cost, or 0 for hardware nobody prices. */
  costUsd: number;
  /** That seat's own wall clock — see the note at the top of this file. */
  seatMs: number;
}

/** A seat the root has played: measured, and scaled to the run being asked about. */
export interface MeasuredSeat {
  label: string;
  measured: {
    /** The series that played it, named as the results listing names a series. */
    series: string[];
    /** Matches the seat played across those series — the denominator of `perMatch`. */
    matches: number;
    perMatch: SeatFigures;
  };
  /** The same figures over the run's matches. */
  run: SeatFigures;
}

/** A seat no series under the root has played: the documented figure, quoted. */
export interface UnmeasuredSeat {
  label: string;
  measured: null;
  fallback: {
    /** The documented match's own figures, for one match. */
    perMatch: { tokens: number; seatMs: number };
    /** What it was measured on, in words: a browser has no use for a path. */
    line: string;
  };
}

/** What the route answers for one seat. */
export type SeatEstimate = MeasuredSeat | UnmeasuredSeat;

/** What `GET /api/estimate` answers. */
export interface Estimate {
  pairs: number;
  /** `pairs × 2`: a pair is played twice, with the seats swapped. */
  matches: number;
  concurrency: number;
  /** Seat A first, then seat B, as the query named them. */
  seats: SeatEstimate[];
}

/** One series report, with the name its directory gives it. */
interface NamedReport {
  name: string;
  report: SeriesReport;
}

/**
 * The reports one walk read, each kept with the name of the series it came from.
 *
 * This is `reportsOf`'s pooling with the name held on to: a `SeriesReport`
 * carries its own directory, and the answer names a series by the name the
 * results listing gives it and never by a path. A series whose record the
 * walk could not read has no report to contribute and drops out here, as it does
 * from the leaderboard's pooled rows.
 */
const namedReportsOf = (walk: SeriesWalk): NamedReport[] =>
  walk.entries.flatMap((entry) =>
    entry.report === null ? [] : [{ name: entry.name, report: entry.report }],
  );

/** The model row for `label`, in the series that played it, and the series' names. */
const rowsOf = (
  label: string,
  played: readonly NamedReport[],
): { rows: ModelRow[]; series: string[] } => {
  const rows: ModelRow[] = [];
  const series: string[] = [];
  for (const { name, report } of played) {
    const row = report.models.find((each) => each.label === label);
    if (row === undefined) continue;
    rows.push(row);
    series.push(name);
  }
  return { rows, series };
};

/** A sum over the reports' own rows — the stats package's figures, added. */
const added = (rows: readonly ModelRow[], pick: (row: ModelRow) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0);

/**
 * Those totals over another number of matches.
 *
 * The counts and the milliseconds are kept whole by rounding down, so a figure
 * never claims more than was measured. The run's figures are scaled from the
 * totals rather than from the rounded per-match figures, which is what makes a
 * run of exactly the length that was measured report exactly what was measured:
 * a per-match figure rounded down and then multiplied back reports 147,559,550
 * tokens for a series that measured 147,559,555.
 */
const over = (totals: SeatFigures, matches: number, of: number): SeatFigures => ({
  turns: Math.floor((totals.turns * matches) / of),
  tokens: Math.floor((totals.tokens * matches) / of),
  costUsd: (totals.costUsd * matches) / of,
  seatMs: Math.floor((totals.seatMs * matches) / of),
});

/**
 * One seat, measured or quoted.
 *
 * `matches` is the run's match count, and the seat's own measured match count is
 * the denominator: a seat measured over two matches and asked about ten is
 * scaled by five, and the answer says both numbers so the page can say which of
 * them a figure rests on.
 */
const seatEstimate = (label: string, played: readonly NamedReport[], matches: number): SeatEstimate => {
  const { rows, series } = rowsOf(label, played);
  const measured = added(rows, (row) => row.matches);

  // No row for that label anywhere under the root, or none that counted a match:
  // nothing this console can see has ever played that seat, so there is nothing
  // to measure and the only honest answer is the figure the notes carry, named as
  // a quoted one.
  if (measured === 0) {
    return {
      label,
      measured: null,
      fallback: {
        perMatch: { tokens: DOCUMENTED_MATCH.tokens, seatMs: DOCUMENTED_MATCH.seatMs },
        line: DOCUMENTED_MATCH.line,
      },
    };
  }

  const totals: SeatFigures = {
    turns: added(rows, (row) => row.metrics.turnCount),
    tokens: added(rows, (row) => row.metrics.tokens.total),
    costUsd: added(rows, (row) => row.metrics.costUsd),
    seatMs: added(rows, (row) => row.metrics.wallMs),
  };

  return {
    label,
    measured: { series, matches: measured, perMatch: over(totals, 1, measured) },
    run: over(totals, matches, measured),
  };
};

/**
 * The estimate for one ask: both seats, over every series under `roots` that
 * has played them.
 *
 * `inFlight` is passed through to the walk unchanged; it decides nothing here,
 * and passing it is what keeps this route on the one walk rather than a variant
 * of it. A root nobody has run anything into answers with two unmeasured seats,
 * which is the truth about it.
 */
export const estimateRows = async (
  roots: UiRoots,
  query: EstimateQuery,
  inFlight: string | null,
): Promise<Estimate> => {
  const played = namedReportsOf(await seriesEntries(roots, inFlight));
  const matches = query.pairs * 2;
  return {
    pairs: query.pairs,
    matches,
    concurrency: query.concurrency,
    seats: [
      seatEstimate(query.a, played, matches),
      seatEstimate(query.b, played, matches),
    ],
  };
};
