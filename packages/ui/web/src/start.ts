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
 * **A seat is a name and an id typed by hand.** `bot:random`, `bot:greedy` and
 * every provider in `providers.json` are listed by `/api/state`; the model id is
 * typed against the provider that was picked, and the seat goes as
 * `<provider>/<id>` — which is what `--a marvin/subagent` has always meant at the
 * terminal. There is no call to a provider's `/v1/models`, and no key value
 * anywhere near this file: `/api/state` carries provider names and the *names* of
 * their key variables only.
 *
 * **The ceilings are stated before Start is pressed.** A blank limit is not "no
 * limit": it is the runner's default, and the page names it — 75 pairs, which is
 * 150 matches, a concurrency of 1, and no cost or token ceiling. One model match was
 * measured at ~19 minutes and 4.59M tokens (`docs/pi-harness-notes.md` §7), so a
 * series at its default length is ~48 hours and ~688M tokens, and a page whose
 * Start button said nothing about that is a page someone starts a two-day run
 * from by accident. The numbers are quoted from that measurement rather than
 * multiplied out here: the only arithmetic on this page is `pairs × 2 = matches`,
 * which is what a pair *is*.
 *
 * The defaults are declared here rather than imported from the runner: the
 * browser half may not bundle `@no-dice/runner` (it reads `providers.json` and
 * `node:path`), and `series-plan.ts` and `series.ts` are not in the runner's
 * `exports` map. `DEFAULTS` names the same three numbers `DEFAULT_MAX_PAIRS`,
 * `DEFAULT_CONCURRENCY` and `DEFAULT_SEED_BASE` do, and the comment beside
 * each says where they come from.
 */
import { postJson } from "./api.ts";
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

/**
 * What a measured model match costs, as the page says it. Where the
 * measurement comes from — `docs/pi-harness-notes.md` §7 — is said here rather
 * than on the page: a reader in a browser has no use for a path into the repo,
 * and the figure's claim to be quoted, not computed, is made by the sentence.
 */
export const MEASURED_MATCH = "about 19 minutes and 4.59M tokens";

/**
 * What a series at its default length costs, said from that measurement. Quoted
 * rather than computed, so the page cannot disagree with the notes.
 */
export const MEASURED_SERIES =
  `A model match measured ${MEASURED_MATCH}, so a series at the default ` +
  `${String(DEFAULTS.maxPairs)} pairs — ${String(DEFAULTS.maxPairs * 2)} matches — ` +
  `is roughly 48 hours and 688M tokens.`;

/** The prefix that tells a bot seat from a model seat — `args.ts`'s own rule. */
const BOT_PREFIX = "bot:";

/** Whether a seat choice names a bot rather than a provider, as the parser reads it. */
export const isBotSeat = (choice: string): boolean => choice.startsWith(BOT_PREFIX);

/**
 * The seat as `--a` and `--b` take it: a bot choice as it stands, a
 * provider choice with the typed model id after a slash. A blank model id is
 * left blank, so the seat goes as `marvin/` and the CLI's own line says what is
 * wrong with it — the page has no opinion to offer instead.
 */
export const seatOf = (choice: string, modelId: string): string =>
  isBotSeat(choice) ? choice : `${choice}/${modelId}`;

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
  /** Seat A's picker: `bot:random`, `bot:greedy`, or a provider name. */
  seatA: string;
  /** Seat A's model id, typed by hand; unused for a bot seat. */
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
