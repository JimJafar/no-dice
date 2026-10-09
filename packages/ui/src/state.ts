/**
 * What `GET /api/state` answers: the seat options the console's form is built
 * out of, the two roots it reads, and the run in flight.
 *
 * The seat options come from the runner's own lists — `BOTS` and the
 * `providers.json` registry — so the page offers exactly what the command line
 * accepts, and a bot or a provider added at the terminal shows up in the form
 * without anything here being edited.
 *
 * **No key value crosses this line, and no key value exists to cross it.**
 * `providers.json` names the environment variable each key is read from
 * (`packages/runner/src/providers.ts`), and the answer carries provider names
 * and those variable names only — not a `baseUrl`, not a token, not a value
 * read from the environment. The page is a browser: anything it is told can be
 * read by anything that can reach the loopback port.
 */
import { BOTS } from "@no-dice/runner/args";
import { providerRegistry } from "@no-dice/runner/providers";
import type { ProviderRegistry } from "@no-dice/runner/providers";

/** One provider as the page is allowed to know it. */
export interface ProviderOption {
  /** The name `--a <provider>/<id>` names it by. */
  readonly name: string;
  /** The environment variable its key is read from, or `null` for an endpoint that checks none. */
  readonly apiKeyEnv: string | null;
}

/** The console's state: what a run may be seated on, what it reads, and what is running. */
export interface UiState {
  /** The baseline bot seats, spelled as the command line spells them. */
  readonly bots: readonly string[];
  /** The providers the registry names, in the order the registry lists them. */
  readonly providers: readonly ProviderOption[];
  /** The directory series are listed from, as an absolute path. */
  readonly seriesRoot: string;
  /** The directory finished match logs are listed from, as an absolute path. */
  readonly matchesRoot: string;
  /**
   * The run in flight, and `null` when there is none. The run slot answers for
   * itself at `/api/run`, with its lines and its counters, and the page reads
   * that route while it says `running`; a copy of it here would be a
   * second, staler account of the same run.
   */
  readonly running: unknown;
}

/** The bot seats, as `--a` and the form's seat picker both name them. */
export const botOptions = (): string[] => BOTS.map((bot) => `bot:${bot}`);

/**
 * The providers, names and key-variable names only. An entry's endpoint, window,
 * token cap and rates stay in the registry: the form needs none of them, and a
 * page that was shown them could be shown a secret by the next entry somebody
 * adds.
 */
export const providerOptions = (registry: ProviderRegistry): ProviderOption[] =>
  Object.entries(registry).map(([name, entry]) => ({ name, apiKeyEnv: entry.apiKeyEnv }));

/** The roots the console reads, as the server resolved them. */
export interface UiRoots {
  readonly seriesRoot: string;
  readonly matchesRoot: string;
  /**
   * Where the kept copies of a finished series' report and rules evidence are
   * (`docs/series-notes.md` §7). The `/reports/` route reads it and nothing else
   * does — in particular `UiState` below does not answer it, because a kept
   * copy's URL follows from the series' own directory name and the route that is
   * asked can say whether the file is there.
   */
  readonly reportsRoot: string;
}

/**
 * The state of one console. The registry is the process's own — read once, as
 * `providers.ts` caches it — and is a parameter so a test can answer with a
 * registry of its own.
 */
export const uiState = (roots: UiRoots, registry: ProviderRegistry = providerRegistry()): UiState => ({
  bots: botOptions(),
  providers: providerOptions(registry),
  seriesRoot: roots.seriesRoot,
  matchesRoot: roots.matchesRoot,
  running: null,
});
