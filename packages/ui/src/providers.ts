/**
 * The Providers half of the console: the registry as the page lists it, the
 * entry the page adds, and what Pi says about a seat's credential.
 *
 * **No key value crosses this line, and none exists to cross it.** A
 * `providers.json` entry names the environment variable a key is read from
 * (`packages/runner/src/providers.ts`), and this module never reads that
 * variable: the detail view answers with the *name*, or `null` for an endpoint
 * that checks none. `/api/state` keeps its narrower name-and-key-variable
 * answer for the seat pickers; this is the wider one, and it is reachable only
 * on loopback like everything else this server does.
 *
 * **There is no second validator here.** A posted entry goes to `addProvider`,
 * which parses it with `providerEntrySchema` — the same strict list of fields
 * `parseProviders` reads the file back with — so a field the schema does not
 * name, `apiKey` above all, is refused with zod's own line naming that field,
 * and the file is left byte-identical. A console with its own copy of the field
 * list is a console that accepts an entry the runner then refuses to read.
 *
 * **The write and the reload are one move.** `addProvider` writes the file
 * atomically (one temp file and one rename, so no reader ever sees a
 * registry cut in half), and `reloadProviders` replaces what this process holds
 * with it, so the next run this console starts seats on the entry the operator
 * just typed and `/api/state` names it in the seat picker without a restart.
 * The answer is the registry as it now stands on disk, re-read through the same
 * loader, rather than what the request claimed to have sent.
 *
 * **The credential check opens no connection.** `POST /api/providers/check`
 * makes the exact call `packages/runner/src/cli.ts` makes before a run —
 * `checkPiAuth` with the seat's `models.json` when the registry names the
 * provider — and `pi auth check` reads configuration only. That is what makes
 * the route testable with no credential on the machine: it is a question about
 * the registry and the environment, not a request to an endpoint, and it plays
 * no match. A check that answers "not ready" is answered with 200 and Pi's own
 * reason, because the check *was* made; only a request that asked for something
 * that is not a `<provider>/<id>` is a 400.
 */
import { addProvider, reloadProviders, seatModelsJson } from "@no-dice/runner/providers";
import type { ProviderRegistry } from "@no-dice/runner/providers";
import { checkPiAuth, providerOfModel } from "@no-dice/harness";
import type { PiAuth } from "@no-dice/harness";

/** The route the page lists providers at, and adds one to. */
export const PROVIDERS_PATH = "/api/providers";

/** The route that asks Pi whether a seat's credential resolves. */
export const PROVIDER_CHECK_PATH = "/api/providers/check";

/** One line for the page, from anything the runner or Pi threw. */
const lineOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One entry as the page is shown it: everything the registry holds about it. */
export interface ProviderRow {
  /** The name `--a <provider>/<id>` and the seat picker both use. */
  readonly name: string;
  /** The endpoint Pi talks to. */
  readonly baseUrl: string;
  /** The API Pi speaks to it. */
  readonly api: string;
  /** The name of the variable its key is read from, or `null` for an endpoint that checks none. */
  readonly apiKeyEnv: string | null;
  readonly reasoning: boolean;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
}

/**
 * The registry as the page lists it, in the registry's own order.
 *
 * The spread is safe because of where the registry comes from: `parseProviders`
 * builds every entry through a `strict()` schema, so an entry cannot hold a
 * field the field list does not name — which is the same rule that keeps a key
 * value out of the file in the first place. Nothing here goes looking in
 * `process.env` for the variable an entry names: the name is the fact, its value
 * is not this route's business.
 */
export const providerRows = (registry: ProviderRegistry): ProviderRow[] =>
  Object.entries(registry).map(([name, entry]) => ({ name, ...entry }));

/** A provider request the console will not act on, with one line saying why. */
export type ProviderRefusal = { ok: false; error: string };

/** What `POST /api/providers` answers: the registry as it now stands, or one line. */
export type AddResult = { ok: true; registry: ProviderRegistry } | ProviderRefusal;

/** The `{ name, entry }` a provider POST carries, or one line saying it does not. */
const askedEntry = (
  payload: unknown,
): { ok: true; name: string; entry: unknown } | ProviderRefusal => {
  const given =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as { name?: unknown; entry?: unknown })
      : null;
  if (given === null) {
    return { ok: false, error: "the provider request is not an object with a name and an entry" };
  }
  // Only that it is a name at all: whether it is one the registry can hold —
  // one path segment, not `__proto__` — is `addProvider`'s rule, in its words.
  if (typeof given.name !== "string" || given.name === "") {
    return {
      ok: false,
      error: "the provider request needs the provider's name, one path segment as --a uses it",
    };
  }
  if (typeof given.entry !== "object" || given.entry === null || Array.isArray(given.entry)) {
    // Which fields an entry has is the schema's to say, and it says so when the
    // entry is there and wrong; this line is only for there being no entry.
    return { ok: false, error: `"${given.name}" needs an entry to add, as the registry holds one` };
  }
  return { ok: true, name: given.name, entry: given.entry };
};

/**
 * Add the entry a POST carried to the registry at `path`, and hand back the
 * registry as it now stands on disk.
 *
 * Everything past the envelope is the runner's decision: the name, the
 * field list and the atomic write all live in `addProvider`, and a refusal there
 * leaves the file byte-identical, so a refusal here can too.
 */
export const addProviderEntry = (payload: unknown, path: string): AddResult => {
  const asked = askedEntry(payload);
  if (!asked.ok) return asked;

  try {
    addProvider(asked.name, asked.entry, path);
  } catch (error) {
    return { ok: false, error: lineOf(error) };
  }

  // The file the page wrote has to be the file every run this process starts
  // seats on, and nothing else re-reads a registry that is cached once per
  // process. A console that wrote a registry the runner never read would be a
  // console that lied about what a run was seated on. What comes back is that
  // re-read, so the answer is the file rather than the request.
  return { ok: true, registry: reloadProviders(path) };
};

/** What `POST /api/providers/check` answers: what Pi said, or one line. */
export type CheckResult = { ok: true; auth: PiAuth } | ProviderRefusal;

/** The `{ model }` a check carries, or one line saying it is not a model. */
const askedModel = (payload: unknown): { ok: true; model: string } | ProviderRefusal => {
  const given =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as { model?: unknown }).model
      : undefined;
  if (typeof given !== "string" || given === "") {
    return {
      ok: false,
      error: "the credential check needs a model, typed as --a takes it: <provider>/<id>",
    };
  }
  try {
    // The shape is the harness's rule, so the line a model without a provider
    // half gets is the line the CLI gives it rather than one invented here.
    providerOfModel(given);
  } catch (error) {
    return { ok: false, error: lineOf(error) };
  }
  return { ok: true, model: given };
};

/**
 * Ask Pi what it would say about seating a run on `model`, and answer with
 * what it said.
 *
 * The call is the CLI's own, `seatModelsJson` included: a provider the registry
 * names is checked against the `models.json` its seat would be given, and one it
 * does not name is checked against the operator's own Pi config. So the page
 * cannot report a seat as ready that `no-dice` would stop, and the two answers
 * cannot drift.
 */
export const checkCredential = async (payload: unknown): Promise<CheckResult> => {
  const asked = askedModel(payload);
  if (!asked.ok) return asked;

  const auth = await checkPiAuth({
    model: asked.model,
    modelsJson: seatModelsJson(asked.model) ?? undefined,
  });
  return {
    ok: true,
    auth: { ok: auth.ok, provider: auth.provider, reason: auth.reason, message: auth.message },
  };
};
