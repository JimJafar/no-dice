/**
 * Drawing the Providers section, and nothing else.
 *
 * What the page reads and sends is `providers.ts`'s business; this file turns an
 * entry into lines, turns the add form into a body, and puts whatever the
 * console answered back on the page. Three rules shape the drawing.
 *
 * **Every field an entry has is on the page, and no key value is.** The base
 * URL, the api, the *name* of the environment variable a key is read from (or
 * "no key checked"), whether it streams reasoning, `contextWindow`, `maxTokens`
 * and the four rates: those are the numbers a match's log is read against, so an
 * operator who cannot see them cannot tell what a run was played under. The add
 * form asks for the same list, and the box beside "key variable" takes a
 * variable's *name* — the page never learns, and never asks, what is in it.
 *
 * **A refusal is the server's line, verbatim.** The page does not decide what a
 * valid entry is: it posts, and shows what came back. A name the registry
 * already has is refused rather than overwritten — the entry a run is seated on
 * keeps its terms — and zod's line naming the field it refused is drawn as it
 * arrived. A refusal adds nothing, so the list stays exactly as it was.
 *
 * **The credential check is asked per row, and answered per row.** A small input
 * for a model id and a button, sending `{ model: "<provider>/<id>" }` to
 * `/api/providers/check` — the same question `no-dice series` asks before it
 * plays a turn — and Pi's `ok`, `reason` and `message` go under that row, as
 * they came. That is why this section belongs to this module and not to the
 * frame: a frame that redrew it on its own would be a frame that wiped the
 * check the operator just asked for.
 */
import { modelOf, providerBodyOf } from "./providers.ts";
import type { AddOutcome, AddValues, CheckOutcome, ProviderRow } from "./providers.ts";
import { clear } from "./render-frame.ts";

/** What the section needs from outside itself. */
export interface ProvidersViewOptions {
  /** The entries `GET /api/providers` answered with, in the registry's own order. */
  rows: readonly ProviderRow[];
  /** Ask the console to add the entry the form holds — `providers.ts`'s `addProvider`. */
  onAdd: (values: AddValues) => Promise<AddOutcome>;
  /** Ask Pi about one model — `providers.ts`'s `checkCredential`. */
  onCheck: (model: string) => Promise<CheckOutcome>;
  /** What to do once an entry has been added: the page reads the list again. */
  onAdded: (name: string) => void;
}

/** A short element with a class and a sentence. */
const paragraph = (className: string, text: string): HTMLElement => {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
};

/** A name or a URL, as a path. */
const code = (text: string): HTMLElement => {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
};

/** A text input, untyped: nothing here decides what a URL, a name or a number looks like. */
const textInput = (className: string, placeholder: string): HTMLInputElement => {
  const input = document.createElement("input");
  input.className = className;
  input.type = "text";
  input.placeholder = placeholder;
  return input;
};

/** A control with what it stands for written above it. */
const field = (label: string, control: HTMLElement, className: string): HTMLElement => {
  const wrap = document.createElement("label");
  wrap.className = `field ${className}`;
  const text = document.createElement("span");
  text.className = "field-label";
  text.textContent = label;
  wrap.append(text, control);
  return wrap;
};

/** One entry's fields, as the page states them: the key variable's name, never its value. */
const fieldsOf = (row: ProviderRow): string[] => [
  row.apiKeyEnv === null ? "no key checked" : `key from ${row.apiKeyEnv}`,
  row.reasoning ? "streams reasoning" : "no reasoning",
  `context window ${String(row.contextWindow)}`,
  `max output ${String(row.maxTokens)}`,
  `rates per million tokens — input ${String(row.cost.input)}, output ${String(row.cost.output)}, ` +
    `cache read ${String(row.cost.cacheRead)}, cache write ${String(row.cost.cacheWrite)}`,
];

/**
 * One entry: what it is, what it costs, and the credential check asked of it.
 *
 * The check's input is left blank rather than prefilled with a model id the page
 * invented: the operator is the one who knows which model this endpoint serves,
 * and a blank id sent as `marvin/` comes back as the console's own line.
 */
const providerItem = (row: ProviderRow, onCheck: (model: string) => Promise<CheckOutcome>): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = "provider-row";
  li.dataset["provider"] = row.name;

  const head = document.createElement("span");
  head.className = "provider-head";
  head.append(
    code(row.name),
    document.createTextNode(" — "),
    code(row.baseUrl),
    document.createTextNode(` (${row.api})`),
  );

  const fields = paragraph("provider-fields", fieldsOf(row).join("; "));

  const model = textInput(`field-model-id field-model-id-${row.name}`, "model id");
  const button = document.createElement("button");
  button.className = "check";
  button.type = "button";
  button.textContent = "Check credential";

  const outcome = paragraph("check-outcome", "");
  outcome.setAttribute("role", "status");

  const check = document.createElement("div");
  check.className = "provider-check";
  check.append(field(`Credential for ${row.name}/<id>`, model, `check-model-${row.name}`), button, outcome);

  /** Ask, and put what Pi said under this row and no other. */
  const run = async (): Promise<void> => {
    const asked = modelOf(row.name, model.value);
    button.disabled = true;
    const answer = await onCheck(asked);
    button.disabled = false;

    if (!answer.ok) {
      outcome.className = "check-outcome check-refused bad";
      outcome.textContent = `${asked} — ${answer.error}`;
      return;
    }
    // Pi's own three parts, as they came: `ok` because it is the answer, and
    // `reason` and `message` because they are the wording the CLI would have
    // stopped a run with. A `null` reason and an empty message are nothing to
    // say, not the word `null` and not a colon after nothing.
    outcome.className = `check-outcome ${answer.auth.ok ? "check-ready" : "check-not-ready bad"}`;
    const verdict = answer.auth.ok ? "ready" : "not ready";
    const said = [answer.auth.reason, answer.auth.message].filter((each) => each !== null && each !== "");
    outcome.textContent = `${asked} — ${said.length === 0 ? verdict : `${verdict}: ${said.join(" — ")}`}`;
  };

  button.addEventListener("click", () => void run());
  li.append(head, fields, check);
  return li;
};

/**
 * The form beside the list: every field an entry has, in the registry's own
 * order. The key box is labelled for a variable's name because that is all it
 * takes, and the numbers are text boxes because the server is the one that says
 * what a number is — a blank one is left out of the body so its "required" line
 * names the field.
 */
const addForm = (
  onAdd: (values: AddValues) => Promise<AddOutcome>,
  onAdded: (name: string) => void,
): HTMLElement => {
  const name = textInput("field-provider-name", "one path segment, as --a takes it");
  const baseUrl = textInput("field-base-url", "https://example.ts.net:8033/v1");
  const api = textInput("field-api", "openai-completions");
  const apiKeyEnv = textInput("field-api-key-env", "variable name, blank for no key checked");
  const reasoning = document.createElement("input");
  reasoning.className = "field-reasoning";
  reasoning.type = "checkbox";
  const contextWindow = textInput("field-context-window", "131072");
  const maxTokens = textInput("field-max-tokens", "8192");
  const costInput = textInput("field-cost-input", "0");
  const costOutput = textInput("field-cost-output", "0");
  const costCacheRead = textInput("field-cost-cache-read", "0");
  const costCacheWrite = textInput("field-cost-cache-write", "0");

  const button = document.createElement("button");
  button.className = "add-provider";
  button.type = "button";
  button.textContent = "Add provider";

  const outcome = paragraph("add-outcome", "");
  outcome.setAttribute("role", "status");

  const root = document.createElement("div");
  root.className = "provider-add";
  root.append(
    paragraph(
      "provider-add-note",
      "Adds an entry to the registry file this console writes. The key box takes the name of the " +
        "environment variable a key is read from — no key value is ever typed here, sent, or stored.",
    ),
    field("Name", name, "field-provider-name-wrap"),
    field("Base URL", baseUrl, "field-base-url-wrap"),
    field("API", api, "field-api-wrap"),
    field("Key variable", apiKeyEnv, "field-api-key-env-wrap"),
    field("Streams reasoning", reasoning, "field-reasoning-wrap"),
    field("Context window", contextWindow, "field-context-window-wrap"),
    field("Max tokens", maxTokens, "field-max-tokens-wrap"),
    field("Rate, input", costInput, "field-cost-input-wrap"),
    field("Rate, output", costOutput, "field-cost-output-wrap"),
    field("Rate, cache read", costCacheRead, "field-cost-cache-read-wrap"),
    field("Rate, cache write", costCacheWrite, "field-cost-cache-write-wrap"),
    button,
    outcome,
  );

  const values = (): AddValues => ({
    name: name.value,
    baseUrl: baseUrl.value,
    api: api.value,
    apiKeyEnv: apiKeyEnv.value,
    reasoning: reasoning.checked,
    contextWindow: contextWindow.value,
    maxTokens: maxTokens.value,
    costInput: costInput.value,
    costOutput: costOutput.value,
    costCacheRead: costCacheRead.value,
    costCacheWrite: costCacheWrite.value,
  });

  /** Post, and show what came back. A refusal adds nothing to the list. */
  const submit = async (): Promise<void> => {
    const given = values();
    const asked = providerBodyOf(given);
    button.disabled = true;
    const answer = await onAdd(given);
    button.disabled = false;

    if (!answer.ok) {
      // The server's line as it wrote it — zod's, or the one the registry
      // writes for a name it already has. Nothing was filed, so the list above
      // still says what the file says, and this line is the whole answer.
      outcome.className = "add-outcome add-refused bad";
      outcome.textContent = answer.error;
      return;
    }

    // Nothing is written into this paragraph on a success: the list is read
    // again, which takes the form and this line with it, and the status line at
    // the top of the page says what was added. A line in a paragraph about to be
    // replaced would be a line no one got to read.
    onAdded(asked.name);
  };

  button.addEventListener("click", () => void submit());
  return root;
};

/**
 * The section: the entries the console listed, the form that adds one, and a
 * credential check under every row.
 *
 * The whole section is replaced on every render, the way every other section is
 * — an entry that went out of the file must not keep its row on the page — which
 * is also why the frame leaves it alone: only this module knows when a redraw
 * is wanted, and it is after a read or an add, never under one.
 */
export const renderProviders = (el: HTMLElement, options: ProvidersViewOptions): void => {
  clear(el);

  el.append(
    paragraph(
      "providers-note",
      "The registry this console lists, adds to and seats its runs on. An entry names the " +
        "environment variable a key is read from; no key value is ever listed here.",
    ),
  );

  if (options.rows.length === 0) {
    el.append(paragraph("providers-none", "The registry names no provider yet."));
  } else {
    const list = document.createElement("ul");
    list.className = "providers";
    list.append(...options.rows.map((row) => providerItem(row, options.onCheck)));
    el.append(list);
  }

  el.append(addForm(options.onAdd, options.onAdded));
};
