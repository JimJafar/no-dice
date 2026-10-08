/**
 * The Providers half of the page: the entries `GET /api/providers` lists, the
 * entry `POST /api/providers` adds, and what `POST /api/providers/check` says
 * about a seat's credential. Drawing them is `render-providers.ts`'s business;
 * this file only reads, writes and checks.
 *
 * **No key value crosses this file, and there is none to cross it.** An entry in
 * `providers.json` names the environment variable a key is read from
 * (`packages/runner/src/providers.ts`), and the form asks for that *name*.
 * Nothing here reads an environment variable, no field of the form is a
 * password box, and the server refuses an entry that carries a value
 * anyway — its schema is strict, and zod's own line names the field it refused.
 *
 * **The page does not decide what a valid entry is.** It posts, and shows
 * whatever comes back, exactly as `start.ts` leaves what a valid run is to
 * `parseArgs`. A blank number is left out of the body so the server's own
 * "required" line names it, a box holding something that is not a number is sent
 * as the text so the server's line names *that*, and a name the registry already
 * has is refused there rather than silently overwriting the entry a run is
 * seated on. A second validator here would be a second opinion the runner can
 * disagree with.
 *
 * **The check is the same question `no-dice series` asks before it plays a
 * turn.** `{ model: "<provider>/<id>" }` goes to `/api/providers/check`, and
 * what comes back is Pi's own `ok`, `reason` and `message`, drawn as they came.
 * The model is formed from the row's provider and an id typed against it, which
 * is what `--a marvin/subagent` has always meant at the terminal.
 *
 * **The models Pi knows natively are read, not polled.** `/api/models` answers
 * the models the pinned Pi knows and this console's own environment has a key
 * for — the seats that need no entry, no endpoint and no variable typed. The
 * route costs a subprocess of about 0.7 s, so the page asks it once per load and
 * never on a poll. A row is read field by field, and the five fields kept are
 * the five the page has a use for: the reference a seat is seated with, and Pi's
 * four figures as Pi printed them. A read that failed is an error the caller
 * turns into a line, not an empty list — an empty list says no key is set, which
 * is the opposite of what happened.
 *
 * The shapes below are declared here rather than imported from
 * `packages/ui/src/providers.ts`, which imports `@no-dice/runner` and
 * `@no-dice/harness` and reads the filesystem; a browser bundle may not.
 * `parseProviderRows` and `parseAuth` are what keep the two halves from drifting
 * quietly: an answer missing a field is one readable line, not an `undefined`
 * drawn into the page.
 */
import { getJson, postJson } from "./api.ts";
import type { FetchJson } from "./api.ts";

/** Where the page lists the registry, and adds one entry to it. */
export const PROVIDERS_PATH = "/api/providers";

/** Where the page asks Pi whether a seat's credential resolves. */
export const PROVIDER_CHECK_PATH = "/api/providers/check";

/** Where the page lists the models the pinned Pi knows and this console has a key for. */
export const MODELS_PATH = "/api/models";

/** One entry as the console lists it: everything the registry holds, and no value. */
export interface ProviderRow {
  /** The name `--a <provider>/<id>` and the seat picker both use. */
  readonly name: string;
  /** The endpoint Pi talks to. */
  readonly baseUrl: string;
  /** The API Pi speaks to it. */
  readonly api: string;
  /** The name of the variable its key is read from, or `null` for an endpoint that checks none. */
  readonly apiKeyEnv: string | null;
  /** Whether the endpoint streams reasoning output. */
  readonly reasoning: boolean;
  /** The window Pi compacts against and the log header records. */
  readonly contextWindow: number;
  /** The output cap the run's requests are made under. */
  readonly maxTokens: number;
  /** US dollars per million tokens, the four of them, as `--max-cost` means them. */
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
}

/**
 * One of Pi's own models as the page is shown it.
 *
 * `reference` is the string a seat is seated with — `<provider>/<id>`, spelled as
 * the terminal spells it and as the estimate looks a seat's figures up by — and
 * the four figures are what Pi printed, kept as strings because `1M` and `384K`
 * are rounded figures for a person to read; a seat needs no numbers for them,
 * because Pi knows that model's real window natively.
 */
export interface ModelRow {
  /** The provider and the model id together: `deepseek/deepseek-flash`. */
  readonly reference: string;
  /** Pi's own rounded context window, as Pi printed it, e.g. `"1M"`. */
  readonly context: string;
  /** Pi's own rounded output cap, as Pi printed it, e.g. `"384K"`. */
  readonly maxOut: string;
  /** Whether the model reasons, as Pi printed it: `"yes"` or `"no"`. */
  readonly thinking: string;
  /** Whether the model takes images, as Pi printed it: `"yes"` or `"no"`. */
  readonly images: string;
}

/** What Pi said about a credential, as the console handed it over. */
export interface AuthAnswer {
  readonly ok: boolean;
  /** The provider the check was made for. */
  readonly provider: string;
  /** Pi's own reason, or the reason the harness inferred. `null` when it had none to give. */
  readonly reason: string | null;
  /** One line naming the problem, for the operator to act on. */
  readonly message: string;
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

/** A number, or the line that says the answer is not one. */
const numberOf = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a number`);
  return value;
};

/** A yes or no, or the line that says the answer is neither. */
const boolOf = (value: unknown, what: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${what} is not a yes or no`);
  return value;
};

/** A word that may be absent, or the line that says it is neither. */
const stringOrNull = (value: unknown, what: string): string | null =>
  value === null ? null : stringOf(value, what);

/** The four rates, all of them named in a failure. */
const costOf = (
  value: unknown,
  what: string,
): { input: number; output: number; cacheRead: number; cacheWrite: number } => {
  const cost = recordOf(value, what);
  return {
    input: numberOf(cost["input"], `${what}.input`),
    output: numberOf(cost["output"], `${what}.output`),
    cacheRead: numberOf(cost["cacheRead"], `${what}.cacheRead`),
    cacheWrite: numberOf(cost["cacheWrite"], `${what}.cacheWrite`),
  };
};

/** One entry of `/api/providers`. */
const rowOf = (value: unknown, what: string): ProviderRow => {
  const row = recordOf(value, what);
  return {
    name: stringOf(row["name"], `${what}.name`),
    baseUrl: stringOf(row["baseUrl"], `${what}.baseUrl`),
    api: stringOf(row["api"], `${what}.api`),
    apiKeyEnv: stringOrNull(row["apiKeyEnv"], `${what}.apiKeyEnv`),
    reasoning: boolOf(row["reasoning"], `${what}.reasoning`),
    contextWindow: numberOf(row["contextWindow"], `${what}.contextWindow`),
    maxTokens: numberOf(row["maxTokens"], `${what}.maxTokens`),
    cost: costOf(row["cost"], `${what}.cost`),
  };
};

/**
 * The answer from `/api/providers`, in the registry's own order. A missing
 * field is named in the line, because whoever reads it is the one who can go
 * and fix the file the console read.
 */
export const parseProviderRows = (value: unknown): ProviderRow[] => {
  if (!Array.isArray(value)) throw new Error("the answer from /api/providers is not a list");
  return value.map((each, at) => rowOf(each, `providers[${String(at)}]`));
};

/**
 * The registry as the console lists it.
 *
 * The entries are the console's — `GET /api/providers` answers out of the same
 * file a run seats on — and the page adds nothing to them.
 */
export const fetchProviders = async (fetchJson: FetchJson = fetch): Promise<ProviderRow[]> =>
  parseProviderRows(await getJson<unknown>(PROVIDERS_PATH, fetchJson));

/** One model of `/api/models`: its reference, and Pi's four figures. */
const modelRowOf = (value: unknown, what: string): ModelRow => {
  const row = recordOf(value, what);
  return {
    reference: stringOf(row["reference"], `${what}.reference`),
    context: stringOf(row["context"], `${what}.context`),
    maxOut: stringOf(row["maxOut"], `${what}.maxOut`),
    thinking: stringOf(row["thinking"], `${what}.thinking`),
    images: stringOf(row["images"], `${what}.images`),
  };
};

/**
 * The answer from `/api/models`, in Pi's own order. A row missing a field is
 * named in the line, because whoever reads it is the one who can go and fix the
 * console that read Pi wrongly.
 */
export const parseModelRows = (value: unknown): ModelRow[] => {
  const list = recordOf(value, "the answer from /api/models");
  if (!Array.isArray(list["models"])) throw new Error("models is not a list");
  return list["models"].map((each, at) => modelRowOf(each, `models[${String(at)}]`));
};

/**
 * The models the pinned Pi knows natively that this console's environment has a
 * key for — the seats that need nothing typed.
 *
 * A console whose Pi did not answer throws, and the caller decides what to say:
 * an empty list would tell the operator that no key is set, which is the
 * opposite of a Pi that failed to answer.
 */
export const fetchModels = async (fetchJson: FetchJson = fetch): Promise<ModelRow[]> =>
  parseModelRows(await getJson<unknown>(MODELS_PATH, fetchJson));

/**
 * What the add form holds: every field as it was typed, and reasoning as it was
 * ticked. Nothing is coerced here — a box that holds `12x` is a box that holds
 * `12x` until the server has said what it thinks of it.
 */
export interface AddValues {
  /** The provider's name, one path segment as `--a` takes its half of a model. */
  name: string;
  baseUrl: string;
  api: string;
  /** The *name* of the variable a key is read from; blank means the endpoint checks none. */
  apiKeyEnv: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
}

/** The body `POST /api/providers` takes: a name, and the entry to file under it. */
export interface ProviderBody {
  name: string;
  entry: Record<string, unknown>;
}

/**
 * One number field as the page sends it: the number when the box holds one, the
 * text when it holds something else, and `null` — meaning no field at all — when
 * it is blank. A blank left out is what makes the server's "required" line name
 * the field, and a `12x` sent as `12x` is what makes its "expected number" line
 * name that instead; deciding here that a blank means zero would be the page
 * choosing a context window for someone who forgot to type one.
 */
const givenNumber = (raw: string): number | string | null => {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : text;
};

/** The form's values as a body, in the order the registry's own fields go. */
export const providerBodyOf = (values: AddValues): ProviderBody => {
  const entry: Record<string, unknown> = {
    baseUrl: values.baseUrl.trim(),
    api: values.api.trim(),
    // Blank says the endpoint checks no key, which is what the registry itself
    // says with `null`. The form never holds a key, so there is nothing else it
    // could send for a provider that does check one: only the variable's name.
    apiKeyEnv: values.apiKeyEnv.trim() === "" ? null : values.apiKeyEnv.trim(),
    reasoning: values.reasoning,
  };

  const cost: Record<string, unknown> = {};
  const rates: readonly (readonly [string, string])[] = [
    ["input", values.costInput],
    ["output", values.costOutput],
    ["cacheRead", values.costCacheRead],
    ["cacheWrite", values.costCacheWrite],
  ];
  for (const [field, raw] of rates) {
    const given = givenNumber(raw);
    if (given !== null) cost[field] = given;
  }
  entry.cost = cost;

  for (const [field, raw] of [
    ["contextWindow", values.contextWindow],
    ["maxTokens", values.maxTokens],
  ] as const) {
    const given = givenNumber(raw);
    if (given !== null) entry[field] = given;
  }

  return { name: values.name.trim(), entry };
};

/** What an add answered: the console took the entry, or said why it did not. */
export type AddOutcome = { ok: true } | { ok: false; error: string };

/** One line for the page, from whatever the console or `fetch` threw. */
const lineOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Ask the console to add the entry the form holds, and report what it said.
 *
 * The answer on success is the registry as the file now stands, but the page
 * reads the list again rather than drawing from what it posted: the file is what
 * the next run seats on, and the list on the page should be the file's account
 * rather than the form's. A refusal writes nothing, so the list is left exactly
 * as it was and only the line moves.
 */
export const addProvider = async (
  values: AddValues,
  fetchJson: FetchJson = fetch,
): Promise<AddOutcome> => {
  try {
    await postJson<unknown>(PROVIDERS_PATH, providerBodyOf(values), fetchJson);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: lineOf(error) };
  }
};

/**
 * The model a row's check asks about: the provider the row is for, and the id
 * typed against it — `marvin/subagent`, spelled the way `--a` spells it. A blank
 * id is left blank, so the seat goes as `marvin/` and the console's own line
 * says what is wrong with it.
 */
export const modelOf = (provider: string, modelId: string): string => `${provider}/${modelId.trim()}`;

/** What Pi said, or the console's line for a check it would not make. */
export type CheckOutcome = { ok: true; auth: AuthAnswer } | { ok: false; error: string };

/**
 * The answer from `/api/providers/check`: what Pi said about the credential, in
 * Pi's words. `reason` is `null` when Pi gave none, which is not a missing field
 * and is drawn as nothing rather than as the word `null`.
 */
export const parseAuth = (value: unknown): AuthAnswer => {
  const auth = recordOf(value, "the answer from /api/providers/check");
  return {
    ok: boolOf(auth["ok"], "ok"),
    provider: stringOf(auth["provider"], "provider"),
    reason: stringOrNull(auth["reason"], "reason"),
    message: stringOf(auth["message"], "message"),
  };
};

/**
 * Ask Pi what it would say about seating a run on `model`.
 *
 * The route answers "not ready" with 200 and Pi's reason, because the check
 * *was* made; only a 400 — a model that is not a `<provider>/<id>` — arrives as
 * an error, and its line is the console's own.
 */
export const checkCredential = async (
  model: string,
  fetchJson: FetchJson = fetch,
): Promise<CheckOutcome> => {
  try {
    return { ok: true, auth: parseAuth(await postJson<unknown>(PROVIDER_CHECK_PATH, { model }, fetchJson)) };
  } catch (error) {
    return { ok: false, error: lineOf(error) };
  }
};
