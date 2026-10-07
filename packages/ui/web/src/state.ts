/**
 * What `GET /api/state` answers, declared on the page's side of the wire.
 *
 * The server that writes it is a Node module the page may not bundle — it reads
 * `providers.json` off disk through `@no-dice/runner` — so the page declares
 * what it reads, the way the viewer declares the showcase sidecar's shape in
 * `series.ts` rather than importing it from the package that writes the file.
 *
 * `parseState` is the page's protection against a console that answered
 * something else: a half-written state is one readable line, and the frame is
 * left drawing nothing rather than drawing a `undefined` into a list.
 */

/** One provider as the page is allowed to know it: a name, and a key variable name. */
export interface ProviderOption {
  readonly name: string;
  /** The environment variable its key is read from, or `null` for an endpoint that checks none. */
  readonly apiKeyEnv: string | null;
}

/** The console's state, as the page reads it. */
export interface UiState {
  /** The baseline bot seats: `bot:random`, `bot:greedy`. */
  readonly bots: readonly string[];
  /** The providers the registry names. */
  readonly providers: readonly ProviderOption[];
  /** The directory series are listed from. */
  readonly seriesRoot: string;
  /** The directory finished match logs are listed from. */
  readonly matchesRoot: string;
  /** The run in flight, and `null` when there is none. Its shape is the run manager's. */
  readonly running: unknown;
}

/** Anything that should have been an object, as the line that says it was not. */
const recordOf = (value: unknown, what: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
};

/** A list of strings, or the line that says it is not one. */
const stringList = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value) || !value.every((each) => typeof each === "string")) {
    throw new Error(`${what} is not a list of strings`);
  }
  return value as string[];
};

/** A directory the console reads, or the line that says the answer has none. */
const pathOf = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value === "") throw new Error(`${what} is not a directory`);
  return value;
};

/** One provider entry: its name, and the name of the variable its key is read from. */
const providerOf = (value: unknown, what: string): ProviderOption => {
  const entry = recordOf(value, what);
  const name = entry["name"];
  if (typeof name !== "string" || name === "") throw new Error(`${what}.name is not a provider name`);
  const apiKeyEnv = entry["apiKeyEnv"];
  if (typeof apiKeyEnv !== "string" && apiKeyEnv !== null) {
    throw new Error(`${what}.apiKeyEnv is neither a variable name nor null`);
  }
  return { name, apiKeyEnv };
};

/**
 * The answer from `/api/state`, or the reason it is not one. Every field is
 * named in its failure, because the page shows that line and the person reading
 * it is the one who can go and fix the console.
 */
export const parseState = (value: unknown): UiState => {
  const state = recordOf(value, "the answer from /api/state");
  if (!Array.isArray(state["providers"])) throw new Error("providers is not a list");
  const providers = state["providers"].map((each, index) =>
    providerOf(each, `providers[${String(index)}]`),
  );

  return {
    bots: stringList(state["bots"], "bots"),
    providers,
    seriesRoot: pathOf(state["seriesRoot"], "seriesRoot"),
    matchesRoot: pathOf(state["matchesRoot"], "matchesRoot"),
    running: state["running"] ?? null,
  };
};
