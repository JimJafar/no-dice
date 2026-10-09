/**
 * The provider registry: `providers.json` at the repo root, and the
 * `models.json` a seat is given because of it.
 *
 * A Pi seat reaches its model either through a provider Pi knows natively — in
 * which case the operator's exported key is the whole of its credential — or
 * through a `models.json` entry naming an endpoint Pi has never heard of. The
 * second is how every real match on this box has been played: Jim's Marvin
 * server is an OpenAI-compatible llama-swap endpoint, and without an entry
 * naming it the run stops at `checkPiAuth` before a turn is played. So the entry
 * is committed here rather than written into whichever script needs it, because
 * four of its numbers are not incidental:
 *
 * - `contextWindow` is what the log header records as `players.<seat>.
 *   context_window`, what compaction is measured against, and — since
 *   `/v1/models` reports no context length — a decision rather than a lookup;
 * - `maxTokens` is the cap the run's model requests were made under, so a rerun
 *   under another one is a different match;
 * - the token rates are what `--max-cost` means, and all-zero rates are exactly
 *   why `--max-tokens` exists (`docs/pi-harness-notes.md` §7: a Marvin match
 *   costs 0 dollars and 4.59M tokens).
 *
 * **No key is ever in this file.** An entry names the environment variable a key
 * is read from, and the seat's own `models.json` interpolates it as `${NAME}`,
 * which Pi substitutes from the child's environment when the seat runs
 * (`docs/models.md`, "Configure a compatible endpoint", checked against the
 * pinned 1.0.2). A provider that checks no key — Marvin, and any local endpoint
 * — keeps `apiKeyEnv: null` and gets Pi's documented `"apiKey": "none"`.
 *
 * A provider the registry does not name is left alone: `seatModelsJson` answers
 * `null`, the seat is given no `models.json`, and Pi's built-in lookup and the
 * operator's exported `ANTHROPIC_API_KEY` work as they did before.
 *
 * The console can add an entry to that file and seat the next run on it in the
 * same process: `addProvider` writes through the same schema and the same
 * single-rename discipline the logs are written with, and `reloadProviders` is
 * the one deliberate exception to reading the registry once per process. The
 * console edits and empties the same file through `updateProvider` and
 * `removeProvider`, and an edit is not a rename: the name an entry is filed
 * under is its identity — a seat is `<provider>/<id>` and `providerOf` splits it
 * on the first `/`, while the entry itself carries no name — so a rename is a
 * remove followed by an add, and `addProvider` stays the only route to a new
 * entry. Removing an entry reaches no match already played: a log header names
 * its own `<provider>/<id>` and `context_window`, each turn's `cost_usd` was
 * computed from the rates of the moment it was played, and the kept `series/`
 * baselines are never rewritten.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

/** Where the registry lives: one committed file at the repo root. */
export const PROVIDERS_FILE: string = fileURLToPath(
  new URL("../../../providers.json", import.meta.url),
);

/** What one provider's entry says, in the shape a seat's `models.json` needs. */
export interface ProviderEntry {
  /** The endpoint Pi talks to, e.g. `https://marvin.example.ts.net:8033/v1`. */
  baseUrl: string;
  /** The API Pi speaks to it: `openai-completions`, `openai-responses`, `anthropic-messages`. */
  api: string;
  /**
   * The environment variable holding the key, or `null` for an endpoint that
   * checks none. The key itself is never in the registry.
   */
  apiKeyEnv: string | null;
  /** Whether the endpoint streams reasoning output, which is what `--thinking` asks for. */
  reasoning: boolean;
  /** The window Pi compacts against and the log header records. A decision when the endpoint reports none. */
  contextWindow: number;
  /** The output cap the run's requests are made under. A decision when the endpoint reports none. */
  maxTokens: number;
  /**
   * US dollars per million tokens, which is what turns usage into `cost_usd`
   * and `--max-cost` into a ceiling.
   */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** The registry: provider name, as `--a <provider>/<id>` names it, to its entry. */
export type ProviderRegistry = Record<string, ProviderEntry>;

/** The rates a seat's model entry carries, all four of them. */
export const providerCostSchema = z
  .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
  })
  .strict();

/**
 * One entry, strict: a field the schema does not name is a typo that would
 * otherwise sit in a committed file while the run played with a default
 * nobody chose — and it is what refuses an entry carrying a key value (`apiKey`,
 * `key`) at the write, rather than hoping no caller sends one.
 *
 * Exported because the console validates a posted entry with this same list of
 * fields: a second list is a second rule, and the two drift.
 */
export const providerEntrySchema = z
  .object({
    baseUrl: z.url(),
    api: z.string().min(1),
    apiKeyEnv: z.string().min(1).nullable().optional(),
    reasoning: z.boolean(),
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    cost: providerCostSchema,
  })
  .strict();

/** The whole file: a map of provider names to entries, and nothing else. */
export const providerRegistrySchema = z.record(z.string().min(1), providerEntrySchema);

/**
 * Whether `name` can name an entry: one path segment, because a seat is
 * addressed as `<provider>/<id>` and `providerOf` splits on the first `/` — and
 * not `__proto__`, the one key that would not survive the round trip through the
 * registry, since assigning it sets a prototype instead of adding an entry, so
 * the file would say one thing and every reader another.
 *
 * Exported because the same question is asked of the provider half of a model a
 * console is asked to check a credential for: a name that could not name an
 * entry is not a seat either, and Pi would be handed it as
 * `--provider <name>`.
 */
export const isProviderName = (name: string): boolean =>
  name !== "" &&
  name !== "." &&
  name !== ".." &&
  !name.includes("/") &&
  name !== "__proto__";

/** Why a registry did not parse, one clause per problem, with the provider named. */
const describeIssues = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string =>
  issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

/**
 * Validate a decoded `providers.json`, and hand back the registry with every
 * entry's `apiKeyEnv` present: an entry that names no variable is a keyless
 * endpoint, which is a fact worth saying out loud rather than an absence.
 *
 * A file that does not parse is an error naming the provider and the field, not
 * a seat that quietly runs with half its metadata: the numbers in here decide
 * what a match's log says about its own window and cost.
 */
export const parseProviders = (value: unknown, source: string): ProviderRegistry => {
  const named =
    typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
  const unaddressable = named.filter((name) => !isProviderName(name));
  if (unaddressable.length > 0) {
    throw new Error(
      `${source} names a provider no seat can address: ${unaddressable
        .map((name) => `"${name}"`)
        .join(", ")}`,
    );
  }
  const parsed = providerRegistrySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source} is not a provider registry: ${describeIssues(parsed.error.issues)}`);
  }
  // Built on no prototype, so a lookup can never answer with something inherited
  // off `Object.prototype`: a name the registry does not have is no entry at
  // all, and a seat on it is left to Pi's own lookup.
  const next: ProviderRegistry = Object.create(null);
  for (const [name, entry] of Object.entries(parsed.data)) {
    next[name] = { ...entry, apiKeyEnv: entry.apiKeyEnv ?? null };
  }
  return next;
};

/** Read and validate the registry at `path`. */
export const loadProviders = (path: string = PROVIDERS_FILE): ProviderRegistry => {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`the provider registry is not readable at ${path}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseProviders(decoded, path);
};

/**
 * The registry this process reads, taken once.
 *
 * Cached rather than re-read per seat because a series seats a match at a time:
 * a file edited halfway through a run would otherwise seat the two matches of
 * one pair on different windows, and the pair would be measuring two different
 * games while its record said one.
 */
let registry: ProviderRegistry | null = null;

/** The committed registry, parsed once per process. */
export const providerRegistry = (): ProviderRegistry => {
  registry ??= loadProviders();
  return registry;
};

/**
 * Re-read the registry at `path` and replace what this process holds with it —
 * or take one that has already been read, which is what a write hands back: the
 * registry as it left the file. The two are one read rather than two that a
 * concurrent writer could pull apart, so a console cannot report an entry
 * as seated while the process holds a registry without it.
 *
 * The one deliberate exception to reading once: a provider added through the
 * console has to be seatable by the next run this process starts, without a
 * restart. Nothing else asks for it, so a file edited mid-run still cannot
 * put one pair's two matches on two different context windows.
 */
export const reloadProviders = (
  source: string | ProviderRegistry = PROVIDERS_FILE,
): ProviderRegistry => {
  registry = typeof source === "string" ? loadProviders(source) : source;
  return registry;
};

/**
 * A provider name has to be one that `parseProviders` can hand back: see
 * `isProviderName`.
 */
const checkProviderName = (name: string): void => {
  if (!isProviderName(name)) {
    throw new Error(
      `"${name}" is not a provider name: it has to be one path segment that names an ` +
        "entry rather than a prototype",
    );
  }
};

/**
 * Write the registry in one step, the way `match.ts` writes a log and
 * `series-plan.ts` writes a series record: the text goes to a temp file named
 * `<path>.tmp-*` in the same directory, is synced before the name appears, and one
 * `renameSync` moves it over the target, so the only file another process can ever
 * read is a whole registry — a registry cut in half seats the next match on
 * nothing. It is written as 2-space JSON with a trailing newline, so the file
 * stays a `git diff` a person can read.
 */
const writeRegistry = (path: string, next: ProviderRegistry): void => {
  const tmp = `${path}.tmp-${randomUUID()}`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, `${JSON.stringify(next, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // The half file is already gone: there is nothing to take away.
    }
    throw error;
  }
};

/**
 * Add `entry` under `name` to the registry at `path`, and answer with the
 * registry as it now stands on disk.
 *
 * Three things are refused before a byte is written, so a refusal always leaves
 * the file exactly as it was: a name that is not one path segment, a name the
 * registry already has — silently overwriting the entry a run is seated
 * on changes that run's terms — and an entry the schema refuses, which includes
 * one carrying a key value. The entry is validated by the same schema that reads
 * the file back, so nothing a seat could misread gets in.
 *
 * One writer at a time is assumed: the read and the rename are one uninterrupted
 * step inside this process, but a file someone else edits in between — a hand
 * edit, a `git pull`, a second console — is overwritten without a word.
 */
export const addProvider = (
  name: string,
  entry: unknown,
  path: string = PROVIDERS_FILE,
): ProviderRegistry => {
  checkProviderName(name);
  const current = loadProviders(path);
  if (Object.hasOwn(current, name)) {
    throw new Error(
      `the provider registry already names "${name}": it is refused rather than ` +
        "overwritten, because a run seated on it would change terms",
    );
  }
  const parsed = providerEntrySchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error(`"${name}" is not a provider entry: ${describeIssues(parsed.error.issues)}`);
  }
  writeRegistry(path, {
    ...current,
    [name]: { ...parsed.data, apiKeyEnv: parsed.data.apiKeyEnv ?? null },
  });
  return loadProviders(path);
};

/**
 * Replace the entry the registry holds under `name` with `entry`, and answer with
 * the registry as it now stands on disk.
 *
 * **The name is the identity, not a field.** An entry carries no name — which is
 * why `addProvider` takes one — so `name` is an argument here too, and an update
 * never changes the name the entry is filed under: a seat is `<provider>/<id>`
 * and `providerOf` splits it on the first `/`, so moving an entry to another name
 * would leave every run seated on the old one pointing at a provider nobody
 * chose. A rename is `removeProvider` followed by `addProvider`, two calls that
 * say what they do.
 *
 * A name the registry does not hold is refused: an update that quietly *added* an
 * entry is a typo dressed up as an edit, and `addProvider` stays the only route
 * to a new one. The entry goes through `providerEntrySchema` before anything is
 * written, so an update cannot smuggle a key value in any more than an add can,
 * and cannot leave behind an entry the loader would refuse. Every refusal — of
 * the name or of the entry — happens before a byte is written, so the file stays
 * byte-identical, and the write is the same temp-file-and-rename step, so
 * `loadProviders` never reads half a file. One writer at a time is assumed, as
 * with `addProvider`: a file someone else edits in between is overwritten.
 */
export const updateProvider = (
  name: string,
  entry: unknown,
  path: string = PROVIDERS_FILE,
): ProviderRegistry => {
  checkProviderName(name);
  const current = loadProviders(path);
  if (!Object.hasOwn(current, name)) {
    throw new Error(
      `the provider registry does not name "${name}": an update replaces the entry ` +
        "that is there, and adding one is addProvider",
    );
  }
  const parsed = providerEntrySchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error(`"${name}" is not a provider entry: ${describeIssues(parsed.error.issues)}`);
  }
  writeRegistry(path, {
    ...current,
    // Spread keeps the entry in the registry's own order: an edit changes what one
    // name says, and moves nothing.
    [name]: { ...parsed.data, apiKeyEnv: parsed.data.apiKeyEnv ?? null },
  });
  return loadProviders(path);
};

/**
 * Delete the entry the registry holds under `name`, and answer with the registry
 * as it now stands on disk.
 *
 * A name the registry does not hold is refused, as an update to one is: a remove
 * that matches nothing has usually mis-typed a name that does exist. An empty
 * registry is a valid file — removing the last entry leaves `{}`, which
 * `loadProviders` reads — because the view has to be able to empty it, and a
 * registry that names nothing is what leaves every seat to Pi's own lookup.
 *
 * What is removed is the entry, and nothing played on it. A match log already
 * names its own `<provider>/<id>` and `context_window`, and every turn's
 * `cost_usd` was computed from the rates of the moment it was played, so no
 * result moves; the kept `series/` baselines are never rewritten either.
 */
export const removeProvider = (name: string, path: string = PROVIDERS_FILE): ProviderRegistry => {
  checkProviderName(name);
  const current = loadProviders(path);
  if (!Object.hasOwn(current, name)) {
    throw new Error(`the provider registry does not name "${name}": there is no entry to remove`);
  }
  const next: ProviderRegistry = Object.create(null);
  for (const [held, entry] of Object.entries(current)) {
    if (held !== name) next[held] = entry;
  }
  writeRegistry(path, next);
  return loadProviders(path);
};

/**
 * The entry for one provider name, or `null` when the registry does not name it.
 * The name is asked of the registry's own keys, so a name that is only inherited
 * — `valueOf`, `toString` — is no entry, and a seat on it is left to Pi.
 */
export const providerEntry = (name: string): ProviderEntry | null => {
  const current = providerRegistry();
  return Object.hasOwn(current, name) ? current[name] : null;
};

/**
 * The provider half of a `<provider>/<id>` model reference, or `null` for a
 * reference without one.
 */
const providerOf = (model: string): string | null => {
  const at = model.indexOf("/");
  return at <= 0 || at === model.length - 1 ? null : model.slice(0, at);
};

/**
 * The `models.json` a seat reads to reach `model` through `entry`: the provider
 * under the name the command line gave it, its endpoint and API, and the model's
 * metadata spelled out because a compatible endpoint does not advertise it.
 *
 * The key is the one field that is not copied: a named variable becomes
 * `${NAME}` for Pi to substitute from the seat's environment, and a keyless
 * endpoint gets `"none"`, which is Pi's documented dummy key.
 */
export const modelsJsonFor = (model: string, entry: ProviderEntry): Record<string, unknown> => {
  const at = model.indexOf("/");
  const provider = at === -1 ? model : model.slice(0, at);
  const id = at === -1 ? model : model.slice(at + 1);
  return {
    providers: {
      [provider]: {
        baseUrl: entry.baseUrl,
        api: entry.api,
        apiKey: entry.apiKeyEnv === null ? "none" : `\${${entry.apiKeyEnv}}`,
        models: [
          {
            id,
            name: model,
            input: ["text"],
            contextWindow: entry.contextWindow,
            maxTokens: entry.maxTokens,
            reasoning: entry.reasoning,
            cost: entry.cost,
          },
        ],
      },
    },
  };
};

/**
 * The `models.json` for a seat playing `<provider>/<id>`, or `null` when the
 * registry does not name that provider — which is what leaves a built-in provider
 * to Pi's own lookup, credential and all.
 */
export const seatModelsJson = (model: string): Record<string, unknown> | null => {
  const provider = providerOf(model);
  const entry = provider === null ? null : providerEntry(provider);
  return entry === null ? null : modelsJsonFor(model, entry);
};
