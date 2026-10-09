/**
 * The Providers half of the console: the registry as the page lists it, the
 * entries the page adds, changes and deletes, and what Pi says about a seat's
 * credential.
 *
 * **No key value crosses this line, and none exists to cross it.** A
 * `providers.json` entry names the environment variable a key is read from
 * (`packages/runner/src/providers.ts`), and this module never reads that
 * variable: the detail view answers with the *name*, or `null` for an endpoint
 * that checks none. `/api/state` keeps its narrower name-and-key-variable
 * answer for the seat pickers; this is the wider one, and it is reachable only
 * on loopback like everything else this server does.
 *
 * **There is no second validator here.** A posted entry goes to `addProvider`
 * or `updateProvider`, which parse it with `providerEntrySchema` — the same
 * strict list of fields `parseProviders` reads the file back with — so a
 * field the schema does not name, `apiKey` above all, is refused with zod's own
 * line naming that field, and the file is left byte-identical. A console with
 * its own copy of the field list is a console that accepts an entry the runner
 * then refuses to read. The same holds of a name: `updateProvider` and
 * `removeProvider` refuse a name the registry does not hold, so a mis-typed one
 * is a 400 in the runner's words rather than an edit that quietly adds an entry
 * or deletes nothing.
 *
 * **The write and the reload are one move.** `addProvider`, `updateProvider`
 * and `removeProvider` each write the file atomically (one temp file and one
 * rename, so no reader ever sees a registry cut in half), and `reloadProviders`
 * replaces what this process holds with what the file now says, so the next run
 * this console starts seats on the entry the operator just typed and
 * `/api/state` names it in the seat picker without a restart — and no longer
 * names one the page has deleted. The answer is the registry as it now stands on
 * disk, re-read through the same loader, rather than what the request
 * claimed to have sent. Every write is refused while the console has a run in
 * flight, and that rule is the runner's rather than one invented here:
 * `providerRegistry()` is read once per process and a series asks it again as
 * each match starts (`seatsOf`), so an entry changed or removed under a run in
 * flight would change the window, the cap and the rates of the matches that run
 * has yet to play while its record said one game — and a removed one would seat
 * a later match on a provider the registry no longer names. The route that
 * refuses it lives in `server.ts`, which is where the run slot is.
 *
 * **The credential check opens no connection.** `POST /api/providers/check`
 * makes the exact call `packages/runner/src/cli.ts` makes before a run —
 * `checkPiAuth` with the seat's `models.json` when the registry names the
 * provider, and with an empty config directory when it does not, which is what
 * `createSeatHome` gives every seat — and `pi auth check` reads configuration
 * only. That is what makes the route testable with no credential on the machine:
 * it is a question about the registry and the environment, not a request to an
 * endpoint, and it plays no match. A check that answers "not ready" is answered
 * with 200 and Pi's own reason, because the check *was* made; only a request that
 * asked for something that is not a `<provider>/<id>` is a 400 — and the provider
 * half has to be a name the registry could hold, because `checkPiAuth` hands it
 * to Pi as `--provider <name>` and a model like `--flag/x` would be a flag in
 * Pi's parser rather than a provider.
 */
import {
  addProvider,
  isProviderName,
  reloadProviders,
  removeProvider,
  seatModelsJson,
  updateProvider,
} from "@no-dice/runner/providers";
import type { ProviderRegistry } from "@no-dice/runner/providers";
import { checkPiAuth, providerOfModel } from "@no-dice/harness";
import type { PiAuth } from "@no-dice/harness";

/** The route the page lists providers at, and adds one to. */
export const PROVIDERS_PATH = "/api/providers";

/** The route that replaces the entry one name holds. */
export const PROVIDER_UPDATE_PATH = "/api/providers/update";

/** The route that deletes the entry one name holds. */
export const PROVIDER_REMOVE_PATH = "/api/providers/remove";

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

/**
 * What a provider write answers: the registry as it now stands on disk, or one
 * line. Add, update and remove all three answer one of these, which is why the
 * route can send the answer to one `providerRows` call.
 */
export type WriteResult = { ok: true; registry: ProviderRegistry } | ProviderRefusal;

/** The `{ name }` a provider request carries, or one line saying it does not. */
const askedName = (payload: unknown): { ok: true; name: string } | ProviderRefusal => {
  const given =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as { name?: unknown }).name
      : undefined;
  // A body that is no object at all gets this line too: either way the request
  // does not name an entry. Only that it is a name at all — whether it is one
  // the registry can hold, one path segment and not `__proto__`, is the
  // runner's rule, in its words.
  if (typeof given !== "string" || given === "") {
    return {
      ok: false,
      error: "the provider request needs the provider's name, one path segment as --a uses it",
    };
  }
  return { ok: true, name: given };
};

/** The `{ name, entry }` an add or an update carries, or one line saying it does not. */
const askedEntry = (
  payload: unknown,
  verb: "add" | "update",
): { ok: true; name: string; entry: unknown } | ProviderRefusal => {
  const asked = askedName(payload);
  if (!asked.ok) return asked;
  const given = (payload as { entry?: unknown }).entry;
  if (typeof given !== "object" || given === null || Array.isArray(given)) {
    // Which fields an entry has is the schema's to say, and it says so when the
    // entry is there and wrong; this line is only for there being no entry.
    return {
      ok: false,
      error: `"${asked.name}" needs an entry to ${verb}, as the registry holds one`,
    };
  }
  return { ok: true, name: asked.name, entry: given };
};

/**
 * Do one registry write, and hand back the registry as it now stands on disk —
 * or the runner's own line for a refusal, which leaves the file byte-identical
 * and so lets this route refuse without having written either.
 */
const wroteRegistry = (write: () => ProviderRegistry): WriteResult => {
  let written: ProviderRegistry;
  try {
    written = write();
  } catch (error) {
    return { ok: false, error: lineOf(error) };
  }

  // The registry the file the page wrote holds has to be the registry every run
  // this process starts seats on, and nothing else re-reads a registry that is
  // cached once per process. A console that wrote a registry the runner
  // never read would be a console that lied about what a run was seated on. The
  // object the write read back is what the cache is set to, so the answer and
  // the seat picker are one read of the file rather than two that could
  // disagree.
  return { ok: true, registry: reloadProviders(written) };
};

/**
 * Add the entry a POST carried to the registry at `path`, and hand back the
 * registry as it now stands on disk.
 *
 * Everything past the envelope is the runner's decision: the name, the
 * field list and the atomic write all live in `addProvider`, and a refusal there
 * leaves the file byte-identical, so a refusal here can too.
 */
export const addProviderEntry = (payload: unknown, path: string): WriteResult => {
  const asked = askedEntry(payload, "add");
  if (!asked.ok) return asked;
  return wroteRegistry(() => addProvider(asked.name, asked.entry, path));
};

/**
 * Replace the entry the registry at `path` holds under the posted name, and hand
 * back the registry as it now stands on disk.
 *
 * The name is not editable, and that is the runner's rule rather than a page
 * rule: an entry is filed under its name, a seat is written as `<provider>/<id>`,
 * so an update that moved an entry would leave every run seated on the old name
 * pointing at a provider nobody chose. A rename is a remove and an add, which is
 * what the two routes let the page say out loud.
 */
export const updateProviderEntry = (payload: unknown, path: string): WriteResult => {
  const asked = askedEntry(payload, "update");
  if (!asked.ok) return asked;
  return wroteRegistry(() => updateProvider(asked.name, asked.entry, path));
};

/**
 * Delete the entry the registry at `path` holds under the posted name, and hand
 * back the registry as it now stands on disk.
 *
 * Nothing played on the entry is touched: a match log names its own
 * `<provider>/<id>` and `context_window`, and every turn's cost was worked out
 * from the rates of the moment it was played, so removing an entry changes
 * what the *next* run can be seated on and moves no result. Removing the last
 * entry leaves `{}`, which is a registry the loader reads — the view has to be
 * able to empty it.
 */
export const removeProviderEntry = (payload: unknown, path: string): WriteResult => {
  const asked = askedName(payload);
  if (!asked.ok) return asked;
  return wroteRegistry(() => removeProvider(asked.name, path));
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
  let provider: string;
  try {
    // The shape is the harness's rule, so the line a model without a provider
    // half gets is the line the CLI gives it rather than one invented here.
    provider = providerOfModel(given);
  } catch (error) {
    return { ok: false, error: lineOf(error) };
  }
  // The name is the registry's own rule, plus one: `checkPiAuth` hands it to Pi
  // as `--provider <name>`, so a name starting with `-` would be a flag in Pi's
  // parser. No file can name an entry that way — `parseProviders` refuses it —
  // so this refuses only a model typed at the page.
  if (!isProviderName(provider) || provider.startsWith("-")) {
    return {
      ok: false,
      error: `"${provider}" is not a provider a seat can address: one path segment that names an entry`,
    };
  }
  return { ok: true, model: given };
};

/**
 * Ask Pi what it would say about seating a run on `model`, and answer with
 * what it said.
 *
 * The call is the CLI's own, `seatModelsJson` included: a provider the registry
 * names is checked against the `models.json` its seat would be given, and one it
 * does not name is checked with an empty config directory, because that is what
 * a seat gets — `createSeatHome` relocates `PI_CODING_AGENT_DIR` to a fresh one
 * for every match. So the page cannot report a seat as ready that `no-dice`
 * would stop, and cannot report one ready from an OAuth login kept in the
 * operator's own `~/.pi/agent`, which no seat this console starts ever reads.
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
