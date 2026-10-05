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
 */
import { readFileSync } from "node:fs";
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
const costSchema = z
  .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
  })
  .strict();

/**
 * One entry, strict: a field the schema does not name is a typo that would
 * otherwise sit in a committed file while the run played with a default nobody
 * chose.
 */
const entrySchema = z
  .object({
    baseUrl: z.url(),
    api: z.string().min(1),
    apiKeyEnv: z.string().min(1).nullable().optional(),
    reasoning: z.boolean(),
    contextWindow: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    cost: costSchema,
  })
  .strict();

/** The whole file: a map of provider names to entries, and nothing else. */
const registrySchema = z.record(z.string().min(1), entrySchema);

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
  const parsed = registrySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source} is not a provider registry: ${describeIssues(parsed.error.issues)}`);
  }
  return Object.fromEntries(
    Object.entries(parsed.data).map(([name, entry]) => [
      name,
      { ...entry, apiKeyEnv: entry.apiKeyEnv ?? null },
    ]),
  );
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

/** The entry for one provider name, or `null` when the registry does not name it. */
export const providerEntry = (name: string): ProviderEntry | null =>
  providerRegistry()[name] ?? null;

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
