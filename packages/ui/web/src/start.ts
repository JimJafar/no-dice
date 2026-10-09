/**
 * Starting a run: the form's values, the payload the console takes, and the
 * ceilings the run will be started under.
 *
 * **The page does not decide what a valid run is.** It posts, and shows whatever
 * comes back. `parseArgs` in `packages/runner/src/args.ts` is the one authority
 * on what a run may ask for, and `packages/ui/src/runs.ts` hands every payload to
 * it before anything is started — so a seat chosen as `marvin` with no model id
 * typed comes back as `--a takes bot:random, bot:greedy and
 * <provider>/<model-id>, not "marvin/"`, which is the terminal's own line, and
 * nothing is started. A second validator here would be a second opinion the CLI
 * can disagree with.
 *
 * **A seat is one of three kinds, and only one of them types anything.**
 * `bot:random`, `bot:greedy` and every provider in `providers.json` are listed by
 * `/api/state`; the model id is typed against the provider that was picked, and
 * that seat goes as `<provider>/<id>` — which is what `--a marvin/subagent` has
 * always meant at the terminal. The third kind is one of Pi's own models, listed
 * by `/api/models`: its reference is already `<provider>/<id>`, so it is seated
 * as it stands and nothing is typed anywhere. `seatKindOf` says which of the
 * three a choice is, in one place, and `seatOf` and the picker's model-id box
 * both read that answer rather than each guessing from the string.
 *
 * There is no call to a provider's `/v1/models`, and no key value anywhere near
 * this file: `/api/state` carries provider names and the *names* of their key
 * variables only, and `/api/models` carries model references and Pi's figures.
 *
 * **The ceilings are stated before Start is pressed.** A blank limit is not "no
 * limit": it is the runner's default, and the page names it — 75 pairs, which is
 * 150 matches, a concurrency of 1, and no cost or token ceiling. A page whose
 * Start button said nothing about that is a page someone starts a two-day run
 * from by accident. The only arithmetic on this page is `pairs × 2 = matches`,
 * which is what a pair *is*.
 *
 * **What a run would cost is read, not held.** `GET /api/estimate` answers what
 * the series under the root measured for the two seats in the pickers, names the
 * series it counted and how many matches it counted, and for a seat nothing
 * under the root has played it says so and quotes the one documented figure with
 * what it was measured on. The browser holds no copy of that figure: it draws what
 * the route answered. It may round a figure to make it readable and it may not add,
 * multiply or average one — that arithmetic happened once, in the route, over the
 * logs. The ask goes out when a seat or the pair count changes and not on every
 * keystroke, because the route walks every match log under the root, which is
 * seconds rather than milliseconds.
 *
 * A blank pair box asks with the runner's own 75, which is what a blank means and
 * what the ceilings block states beside the Start button: the ask and the promise
 * are about the same run.
 *
 * The defaults are declared here rather than imported from the runner: the
 * browser half may not bundle `@no-dice/runner` (it reads `providers.json` and
 * `node:path`), and `series-plan.ts` and `series.ts` are not in the runner's
 * `exports` map. `DEFAULTS` names the same three numbers `DEFAULT_MAX_PAIRS`,
 * `DEFAULT_CONCURRENCY` and `DEFAULT_SEED_BASE` do, and the comment beside
 * each says where they come from.
 *
 * **What the form opens with is a separate thing.** `OPEN_VALUES` is the pair
 * limit and concurrency the boxes hold before anyone types — five pairs, one at a
 * time — while `DEFAULTS` stays what a *cleared* box means. The two are kept apart
 * so the ceilings block can go on quoting the runner's 75 when a field is blank
 * while the page stops opening on a two-day run.
 */
import { getJson, postJson } from "./api.ts";
import { parseRun } from "./progress.ts";
import type { FetchJson } from "./api.ts";
import type { RunSnapshot } from "./progress.ts";

/** The games the form offers — the same list `args.ts` exports as `GAMES`. */
export const GAMES = ["salient"] as const;

/**
 * The two commands this form starts, which are the two the console starts.
 * `series` is first, so it is what the form holds when nobody has touched it:
 * a series is what the console is for, and it is the command whose ceilings the
 * page has to state — 75 pairs, a concurrency of 1, no cost or token ceiling —
 * because those are the runner's defaults rather than anything the form gave.
 */
export const RUN_KINDS = ["series", "match"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/**
 * The runner's own defaults, named on the page when a field is left blank:
 * `DEFAULT_MAX_PAIRS`, `DEFAULT_CONCURRENCY` and `DEFAULT_SEED_BASE` in
 * `packages/runner/src/series-plan.ts` and `series.ts`. The two ceilings have no
 * default at all — a series with no `--max-cost` and no `--max-tokens` is
 * bounded by nothing but its pair limit, which is the fact the page has to say.
 */
export const DEFAULTS = {
  maxPairs: 75,
  concurrency: 1,
  seedBase: 0,
  maxCost: null,
  maxTokens: null,
} as const;

/** The limit boxes the form opens with a value in, as the page holds them. */
export type OpenValues = Pick<StartValues, "maxPairs" | "concurrency" | "seedBase" | "maxCost" | "maxTokens">;

/**
 * The values the form **opens with**, which are not `DEFAULTS` and are not trying
 * to be: the boxes hold five pairs, one pair at a time, and both ceilings and the
 * seed base are left blank. `DEFAULTS` is what a *blank* box means, and the
 * ceilings block quotes it as the runner's own — that quote has to stay what
 * `parseArgs` would do, however the page opens.
 *
 * The reason they differ is what a blank form asks for. 75 pairs is 150 matches,
 * one at a time, which is about two days of a machine, and a page that opens
 * there answers "what happens when I press Start" with the wrong thing. Five
 * pairs, one at a time, is a run someone can look at, and the ceilings block says
 * so in the same breath as it says what a cleared box would mean.
 */
export const OPEN_VALUES: OpenValues = {
  maxPairs: "5",
  concurrency: "1",
  seedBase: "",
  maxCost: "",
  maxTokens: "",
};

/** The prefix that tells a bot seat from a model seat — `args.ts`'s own rule. */
const BOT_PREFIX = "bot:";

/** Whether a seat choice names a bot rather than a provider, as the parser reads it. */
export const isBotSeat = (choice: string): boolean => choice.startsWith(BOT_PREFIX);

/** The three kinds a seat picker offers. */
export type SeatKind = "bot" | "provider" | "model";

/**
 * Which kind a picker's choice is, read off the choice alone.
 *
 * A bot is `args.ts`'s own rule: the `bot:` prefix. A registered provider's name
 * is one path segment — `isProviderName` in `packages/runner/src/providers.ts`
 * refuses one with a slash in it, because a seat is `<name>/<id>` — so a slash in
 * the choice means it is already a whole `<provider>/<id>`: one of Pi's own model
 * references, which needs no id typed against it. That is the whole test, and it
 * is made here once, because the seat line under the picker, the box beside it
 * and the payload all have to agree on which kind they are drawing.
 */
export const seatKindOf = (choice: string): SeatKind =>
  isBotSeat(choice) ? "bot" : choice.includes("/") ? "model" : "provider";

/**
 * The seat as `--a` and `--b` take it: a bot choice as it stands, a
 * provider choice with the typed model id after a slash, and a Pi model's
 * reference as it stands — it already names both halves, and an id left in the
 * box from an earlier choice contributes nothing.
 *
 * A blank model id against a provider is left blank, so the seat goes as
 * `marvin/` and the CLI's own line says what is wrong with it — the page has no
 * opinion to offer instead.
 */
export const seatOf = (choice: string, modelId: string): string =>
  seatKindOf(choice) === "provider" ? `${choice}/${modelId}` : choice;

/** The limit fields of each command, in the order the terminal takes them. */
type LimitField = "seed" | "seedBase" | "maxPairs" | "maxTokens" | "maxCost" | "concurrency" | "name";

const LIMITS: Record<RunKind, readonly LimitField[]> = {
  match: ["seed"],
  series: ["maxPairs", "maxCost", "maxTokens", "concurrency", "seedBase", "name"],
};

/** Every field the form holds, as the page holds it: a string, blank when unset. */
export interface StartValues {
  kind: RunKind;
  game: string;
  /** Seat A's picker: `bot:random`, `bot:greedy`, a provider name, or a Pi model's reference. */
  seatA: string;
  /** Seat A's model id, typed by hand; unused for a bot seat and for one of Pi's models. */
  modelA: string;
  seatB: string;
  modelB: string;
  seed: string;
  seedBase: string;
  maxPairs: string;
  maxTokens: string;
  maxCost: string;
  concurrency: string;
  name: string;
}

/** The body `POST /api/run/match` and `POST /api/run/series` take. */
export type StartBody = Record<string, string>;

/** What a start asks for: the route, and the fields the form gave for it. */
export interface StartPayload {
  kind: RunKind;
  path: string;
  body: StartBody;
}

/**
 * The form's values as a payload. A field the form left blank contributes
 * nothing at all, which is what makes a blank limit the runner's default rather
 * than a zero, and what makes a missing seat come back as `parseArgs`'s
 * "`--a` is required". The other command's fields are left out too: a match
 * never carries a pair limit, so a payload cannot ask for one by accident.
 */
export const payloadOf = (values: StartValues): StartPayload => {
  const body: StartBody = {
    game: values.game,
    a: seatOf(values.seatA, values.modelA),
    b: seatOf(values.seatB, values.modelB),
  };
  for (const field of LIMITS[values.kind]) {
    const raw = values[field].trim();
    if (raw !== "") body[field] = raw;
  }
  return { kind: values.kind, path: `/api/run/${values.kind}`, body };
};

/** One ceiling as the page states it. */
export interface Ceiling {
  /** What the run is bounded by, in the words the form's own field uses. */
  label: string;
  /** What the bound is set to, and whose setting it is. */
  value: string;
  /** Where that value came from, which is what the page says beside it. */
  source: CeilingSource;
}

/**
 * Where a ceiling's value came from. `runner` is the case the page exists for:
 * a blank field is not "no limit", it is the runner's default, and an
 * operator who has not read the source has to be told.
 * `fixed` is a fact about the command rather than a field's value — a match is
 * two matches whatever the form holds — or the absence of one.
 */
export type CeilingSource = "form" | "runner" | "fixed";

/** One limit as a ceiling: the typed value, or the default that a blank leaves. */
const ceilingOf = (label: string, raw: string, fallback: string): Ceiling => {
  const value = raw.trim();
  return value === ""
    ? { label, value: fallback, source: "runner" }
    : { label, value, source: "form" };
};

/**
 * The ceilings the run will be started under, in the order they bind. A match
 * has no ceilings — it is one pair, played both ways — and the page says that
 * rather than leaving the block empty, because an empty block reads as "no
 * limits" and a match really does have none.
 *
 * Each is named in the words the form's field is named in, not in the words the
 * terminal spells it in: the block is there to tell someone what the browser is
 * about to do, and `--max-pairs` would send them back to the command line to find
 * out.
 */
export const ceilingsOf = (values: StartValues): Ceiling[] =>
  values.kind === "match"
    ? [
        { label: "Matches", value: "2 — one pair, both seat orders", source: "fixed" },
        values.seed.trim() === ""
          ? { label: "Seed", value: "none given", source: "fixed" }
          : { label: "Seed", value: values.seed.trim(), source: "form" },
        {
          label: "Ceilings",
          value: "none — a single match has no pair, cost or token limit",
          source: "fixed",
        },
      ]
    : [
        ceilingOf("Pairs", values.maxPairs, String(DEFAULTS.maxPairs)),
        ceilingOf("Pairs at once", values.concurrency, String(DEFAULTS.concurrency)),
        ceilingOf("Cost ceiling", values.maxCost, "none"),
        ceilingOf("Token ceiling", values.maxTokens, "none"),
        ceilingOf("Seed base", values.seedBase, String(DEFAULTS.seedBase)),
      ];

/** What a start answered: the run now in flight, or the console's own line. */
export type StartOutcome = { ok: true; run: RunSnapshot } | { ok: false; error: string };

/**
 * Ask the console to start the run, and hand back its snapshot or the console's
 * line. The line is what `postJson` made of the answer, which for a 400 is
 * `parseArgs`'s message verbatim; the snapshot is read through
 * `parseRun`, the same reader the progress section uses, so the run the start
 * reports and the run the page then watches are read the same way.
 *
 * Nothing here retries, and nothing here starts anything on a refusal: the run
 * is started by the console or not at all.
 */
export const startRun = async (
  kind: RunKind,
  body: StartBody,
  fetchJson: FetchJson = fetch,
): Promise<StartOutcome> => {
  try {
    return { ok: true, run: parseRun(await postJson<unknown>(`/api/run/${kind}`, body, fetchJson)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Where the page asks what a run like this one would cost. */
export const ESTIMATE_PATH = "/api/estimate";

/**
 * One seat's figures, in the units the console answers them in.
 *
 * `seatMs` is that seat's own wall clock, not the match's elapsed time: the two
 * seats of a match play in turn, so the two figures are two figures and the
 * page is not at liberty to add them into one. `costUsd` is 0 for hardware nobody
 * prices, which the page says as "no cost on record" rather than as free.
 */
export interface SeatFigures {
  turns: number;
  tokens: number;
  costUsd: number;
  seatMs: number;
}

/** A seat the series under the root have played: measured, and scaled to the run. */
export interface MeasuredSeat {
  label: string;
  measured: {
    /** The series that played it, named as the results listing names a series. */
    series: string[];
    /** How many matches the figures were counted over. */
    matches: number;
    perMatch: SeatFigures;
  };
  /** The same figures over the run being asked about. */
  run: SeatFigures;
}

/** A seat no series under the root has played: the documented figure, quoted. */
export interface UnmeasuredSeat {
  label: string;
  measured: null;
  fallback: {
    /** The documented match's own figures, for one match — no turns, no cost. */
    perMatch: { tokens: number; seatMs: number };
    /** What it was measured on, in words, as the route wrote them. */
    line: string;
  };
}

/** What the route answers for one seat. */
export type SeatEstimate = MeasuredSeat | UnmeasuredSeat;

/** What `GET /api/estimate` answers.
 *
 * `concurrency` is in the route's answer and not in this shape: it divides none of
 * the route's figures, and the ceilings block already states what the run plays at.
 */
export interface Estimate {
  pairs: number;
  /** The run's match count, as the route gave it — the page does not double anything. */
  matches: number;
  seats: SeatEstimate[];
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

/** A list of words, each named in a failure. */
const stringsOf = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list`);
  return value.map((each, at) => stringOf(each, `${what}[${String(at)}]`));
};

/** One seat's four figures, named in a failure by which seat's they are. */
const figuresOf = (value: unknown, what: string): SeatFigures => {
  const figures = recordOf(value, what);
  return {
    turns: countOf(figures["turns"], `${what}.turns`),
    tokens: countOf(figures["tokens"], `${what}.tokens`),
    costUsd: countOf(figures["costUsd"], `${what}.costUsd`),
    seatMs: countOf(figures["seatMs"], `${what}.seatMs`),
  };
};

/**
 * One seat of the answer: measured over the series that played it, or quoted from
 * the documented match.
 *
 * `measured` being `null` is the route saying it found no match under the root that
 * played this seat. Anything else is a measurement, and a seat that carries
 * neither is an answer this page cannot draw honestly, so it is a line.
 */
const seatEstimateOf = (value: unknown, what: string): SeatEstimate => {
  const seat = recordOf(value, what);
  const label = stringOf(seat["label"], `${what}.label`);
  if (seat["measured"] === null) {
    const fallback = recordOf(seat["fallback"], `${what}.fallback`);
    const perMatch = recordOf(fallback["perMatch"], `${what}.fallback.perMatch`);
    return {
      label,
      measured: null,
      fallback: {
        perMatch: {
          tokens: countOf(perMatch["tokens"], `${what}.fallback.perMatch.tokens`),
          seatMs: countOf(perMatch["seatMs"], `${what}.fallback.perMatch.seatMs`),
        },
        line: stringOf(fallback["line"], `${what}.fallback.line`),
      },
    };
  }
  const measured = recordOf(seat["measured"], `${what}.measured`);
  return {
    label,
    measured: {
      series: stringsOf(measured["series"], `${what}.measured.series`),
      matches: countOf(measured["matches"], `${what}.measured.matches`),
      perMatch: figuresOf(measured["perMatch"], `${what}.measured.perMatch`),
    },
    run: figuresOf(seat["run"], `${what}.run`),
  };
};

/**
 * The answer from `GET /api/estimate`, read field by field.
 *
 * A figure the answer does not carry is one readable line rather than an
 * `undefined` drawn into the page as `NaN tokens`: the estimate is the one place a
 * made-up number would be believed, so nothing here defaults.
 */
export const parseEstimate = (value: unknown): Estimate => {
  const answer = recordOf(value, "the answer from /api/estimate");
  const seats = answer["seats"];
  if (!Array.isArray(seats)) throw new Error("seats is not a list");
  return {
    pairs: countOf(answer["pairs"], "pairs"),
    matches: countOf(answer["matches"], "matches"),
    seats: seats.map((each, at) => seatEstimateOf(each, `seats[${String(at)}]`)),
  };
};

/**
 * The ask, as a route and a query: the two seats the pickers hold, spelled as
 * `payloadOf` would send them, and the pair count the form holds.
 *
 * A blank pair box asks with `DEFAULTS.maxPairs`, because a blank is the runner's
 * 75 rather than nothing, and the ceilings block beside the Start button says the
 * same. No other field the form holds changes what a match costs, and the
 * concurrency is left out of the query entirely: the route echoes it and
 * divides none of its figures by it.
 */
export const estimatePathOf = (values: StartValues): string => {
  const params = new URLSearchParams();
  params.set("a", seatOf(values.seatA, values.modelA));
  params.set("b", seatOf(values.seatB, values.modelB));
  const pairs = values.maxPairs.trim();
  params.set("pairs", pairs === "" ? String(DEFAULTS.maxPairs) : pairs);
  return `${ESTIMATE_PATH}?${params.toString()}`;
};

/**
 * What a run like the form describes would cost, read from the console.
 *
 * This is one of the page's expensive reads — the route walks every match log of
 * every series under the root — so it is asked when a seat or the pair count
 * changes, and never per keystroke. It throws with the console's own line, as every
 * other read here does; the section that asked leaves the estimate it has and
 * says the estimate could not be read.
 */
export const fetchEstimate = async (values: StartValues, fetchJson: FetchJson = fetch): Promise<Estimate> =>
  parseEstimate(await getJson<unknown>(estimatePathOf(values), fetchJson));
