/**
 * The Models half of the console: the models the pinned Pi knows natively that
 * *this console* has a key for.
 *
 * A seat on a provider the console registered needs a `models.json` entry naming
 * it, because Pi has never heard of that provider. A seat on a provider Pi knows
 * natively needs nothing but the key in the environment — `--model
 * deepseek/deepseek-flash` has always worked at the terminal — so the console
 * cannot list those models off its own registry. It asks the pinned Pi, and
 * `packages/harness/src/pi-models.ts` says how that question is asked, why the
 * answer is a table of models rather than a lookup of its own, and why the call
 * is made with no `env` option.
 *
 * **The environment is this process's own, deliberately.** `listPiModels` is
 * called with no `env` option, so the child inherits this console's environment —
 * which is the honest one, because a run this console starts is played in this
 * process (`./runs.ts`) and its seat's child inherits the same environment. That
 * is why `scripts/console-daemon.sh` pulls the key variables in before it execs
 * the server. The list is therefore *the models this console has a key for*, not
 * the models the machine has keys for, and the page says so.
 *
 * **No key value crosses it, and it names no key variable either.** The rows
 * carry providers, model ids and Pi's own figures. Pi's answer does not name
 * variables, and reporting which of this process's environment variables happen
 * to be set would tell a stranger on loopback more than the registry does. Each
 * row is built field by field rather than spread, so a field a later harness
 * change adds to `PiModel` does not arrive on this route by accident.
 *
 * **It is a separate route from `/api/state` on purpose.** `/api/state` is read
 * on every page load and answers from memory; this costs a subprocess of about
 * 0.7 s, so the views that need it ask for it themselves, once, and nothing
 * polls it. A failure from Pi is a 500 carrying Pi's own line rather than an
 * empty list: an empty list tells the operator that no key is set, which is the
 * opposite of what happened.
 */
import { listPiModels } from "@no-dice/harness";
import type { PiModel } from "@no-dice/harness";

/** The route the page lists them at. */
export const MODELS_PATH = "/api/models";

/** One model as the page is shown it: the reference a seat is seated with, and Pi's figures. */
export interface ModelRow {
  /** The provider Pi knows natively, e.g. `"deepseek"`. */
  readonly provider: string;
  /** The model id, e.g. `"deepseek-flash"`. */
  readonly id: string;
  /** `<provider>/<id>` — the string a seat is seated with, and nothing else is needed. */
  readonly reference: string;
  /** Pi's own rounded context window, as Pi printed it, e.g. `"1M"`. */
  readonly context: string;
  /** Pi's own rounded maximum output, as Pi printed it, e.g. `"384K"`. */
  readonly maxOut: string;
  /** Whether the model reasons, as Pi printed it: `"yes"` or `"no"`. */
  readonly thinking: string;
  /** Whether the model takes images, as Pi printed it: `"yes"` or `"no"`. */
  readonly images: string;
}

/** What `GET /api/models` answers. */
export interface ModelList {
  readonly models: readonly ModelRow[];
}

/** Where the models come from: the pinned Pi by default, a test's answer otherwise. */
export type PiModelSource = () => Promise<readonly PiModel[]>;

/**
 * Pi's rows as the page is shown them, in Pi's own order.
 *
 * The fields are copied one by one rather than spread, so the field set of the
 * answer is this module's decision and not whatever the harness happens to
 * return; that is what "no key value, and no key variable" rests on here.
 */
export const modelRows = (models: readonly PiModel[]): ModelRow[] =>
  models.map((model) => ({
    provider: model.provider,
    id: model.id,
    reference: model.reference,
    context: model.context,
    maxOut: model.maxOut,
    thinking: model.thinking,
    images: model.images,
  }));

/**
 * The answer: the models this console's own environment has a key for.
 *
 * `list` defaults to the harness's call, asked with no `env` option so the child
 * inherits this process's environment — the one the seats this console starts
 * get. A source that throws (a Pi that did not answer, or printed something that
 * is not its table) is left to throw: the route turns it into a 500 carrying the
 * line, which is the truth, rather than an empty list, which is not.
 */
export const modelList = async (list: PiModelSource = listPiModels): Promise<ModelList> => ({
  models: modelRows(await list()),
});
