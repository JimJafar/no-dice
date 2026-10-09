/**
 * Drawing the Providers section, and nothing else.
 *
 * What the page reads and sends is `providers.ts`'s business; this file turns an
 * entry into lines, turns the add form and each row's edit form into a body, and
 * puts whatever the console answered back on the page. The rules below shape the
 * drawing.
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
 * **The section's own words are plain.** No flag name, no path into the machine:
 * the hint beside a name says what a name is used for rather than which command
 * takes it. The entry's base URL is the exception in kind — it is not a path a
 * reader has to do anything with, it is what the entry *is*, and it is the address
 * a run is seated on.
 *
 * **The credential check is asked per row, and answered per row.** A small input
 * for a model id and a button, sending `{ model: "<provider>/<id>" }` to
 * `/api/providers/check` — the same question `no-dice series` asks before it
 * plays a turn — and Pi's `ok`, `reason` and `message` go under that row, as
 * they came. That is why this section belongs to this module and not to the
 * frame: a frame that redrew it on its own would be a frame that wiped the
 * check the operator just asked for.
 *
 * **A row edits itself, and asks once before it goes.** Every row carries an
 * edit that uncovers that entry's own fields, prefilled from the registry, and a
 * remove that turns its own control into a confirm and a cancel and sends
 * nothing until the confirm — no browser dialog, because the
 * frame draws its own lines everywhere else and a dialog cannot be styled or
 * tested from this page. The name is shown and is not editable, and the row says
 * why in one clause: it is the name a seat is written with, so changing it means
 * removing this provider and adding the other. Either write, once it succeeds,
 * sends the list back to `GET /api/providers` for the same reason an add does —
 * the page should show the file's account of itself. Either write, once it
 * fails, leaves the row exactly where it was with what was typed still in it,
 * which is why the section is redrawn on a success and never on a refusal.
 */
import { editValuesOf, modelOf, providerBodyOf } from "./providers.ts";
import type {
  AddOutcome,
  AddValues,
  CheckOutcome,
  EditValues,
  ProviderRow,
  WriteOutcome,
} from "./providers.ts";
import { clear } from "./render-frame.ts";

/** What the section needs from outside itself. */
export interface ProvidersViewOptions {
  /** The entries `GET /api/providers` answered with, in the registry's own order. */
  rows: readonly ProviderRow[];
  /** Ask the console to add the entry the form holds — `providers.ts`'s `addProvider`. */
  onAdd: (values: AddValues) => Promise<AddOutcome>;
  /** Ask the console to replace one row's entry — `providers.ts`'s `updateProvider`. */
  onEdit: (name: string, values: EditValues) => Promise<WriteOutcome>;
  /** Ask the console to delete one row's entry — `providers.ts`'s `removeProvider`. */
  onRemove: (name: string) => Promise<WriteOutcome>;
  /** Ask Pi about one model — `providers.ts`'s `checkCredential`. */
  onCheck: (model: string) => Promise<CheckOutcome>;
  /** What to do once an entry has been added: the page reads the list again. */
  onAdded: (name: string) => void;
  /** What to do once an entry has been changed: the page reads the list again. */
  onEdited: (name: string) => void;
  /** What to do once an entry has been removed: the page reads the list again. */
  onRemoved: (name: string) => void;
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

/** The reasoning tick box, which has nothing to type. */
const checkbox = (className: string): HTMLInputElement => {
  const input = document.createElement("input");
  input.className = className;
  input.type = "checkbox";
  return input;
};

/** A button of this section, with what it stands for written on it. */
const buttonOf = (className: string, label: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = label;
  return button;
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

/** The ten boxes an entry's own fields are typed into — the add form's, and a row's. */
interface EntryBoxes {
  readonly baseUrl: HTMLInputElement;
  readonly api: HTMLInputElement;
  readonly apiKeyEnv: HTMLInputElement;
  readonly reasoning: HTMLInputElement;
  readonly contextWindow: HTMLInputElement;
  readonly maxTokens: HTMLInputElement;
  readonly costInput: HTMLInputElement;
  readonly costOutput: HTMLInputElement;
  readonly costCacheRead: HTMLInputElement;
  readonly costCacheWrite: HTMLInputElement;
}

/**
 * One box's classes: the add form's named for their field alone, a row's named
 * for the field, for being an edit's, and for the row — which is what lets a
 * stylesheet and a test reach one provider's context window without reaching
 * another row's or the add form's.
 */
const boxClass = (name: string, at: string): string =>
  at === "" ? `field-${name}` : `field-edit-${name} field-edit-${name}-${at}`;

/** The same, for the wrapper that carries a field's label. */
const wrapClass = (name: string, at: string): string =>
  at === "" ? `field-${name}-wrap` : `field-edit-${name}-wrap`;

/**
 * The ten boxes, in the registry's own order, named by `at`: blank for the add
 * form, the entry's name for a row's form. The numbers are text boxes because
 * the server is the one that says what a number is, and the key box is labelled
 * for a variable's name because that is all it takes.
 */
const entryBoxes = (at: string): EntryBoxes => ({
  baseUrl: textInput(boxClass("base-url", at), "https://example.ts.net:8033/v1"),
  api: textInput(boxClass("api", at), "openai-completions"),
  apiKeyEnv: textInput(boxClass("api-key-env", at), "variable name, blank for no key checked"),
  reasoning: checkbox(boxClass("reasoning", at)),
  contextWindow: textInput(boxClass("context-window", at), "131072"),
  maxTokens: textInput(boxClass("max-tokens", at), "8192"),
  costInput: textInput(boxClass("cost-input", at), "0"),
  costOutput: textInput(boxClass("cost-output", at), "0"),
  costCacheRead: textInput(boxClass("cost-cache-read", at), "0"),
  costCacheWrite: textInput(boxClass("cost-cache-write", at), "0"),
});

/** Those boxes, labelled, in the registry's own order — the same ten in both forms. */
const entryFields = (boxes: EntryBoxes, at: string): HTMLElement[] => [
  field("Base URL", boxes.baseUrl, wrapClass("base-url", at)),
  field("API", boxes.api, wrapClass("api", at)),
  field("Key variable", boxes.apiKeyEnv, wrapClass("api-key-env", at)),
  field("Streams reasoning", boxes.reasoning, wrapClass("reasoning", at)),
  field("Context window", boxes.contextWindow, wrapClass("context-window", at)),
  field("Max tokens", boxes.maxTokens, wrapClass("max-tokens", at)),
  field("Rate, input", boxes.costInput, wrapClass("cost-input", at)),
  field("Rate, output", boxes.costOutput, wrapClass("cost-output", at)),
  field("Rate, cache read", boxes.costCacheRead, wrapClass("cost-cache-read", at)),
  field("Rate, cache write", boxes.costCacheWrite, wrapClass("cost-cache-write", at)),
];

/** What the boxes hold, as the routes take it: nothing coerced and nothing trimmed here. */
const valuesOf = (name: string, boxes: EntryBoxes): AddValues => ({
  name,
  baseUrl: boxes.baseUrl.value,
  api: boxes.api.value,
  apiKeyEnv: boxes.apiKeyEnv.value,
  reasoning: boxes.reasoning.checked,
  contextWindow: boxes.contextWindow.value,
  maxTokens: boxes.maxTokens.value,
  costInput: boxes.costInput.value,
  costOutput: boxes.costOutput.value,
  costCacheRead: boxes.costCacheRead.value,
  costCacheWrite: boxes.costCacheWrite.value,
});

/** Put an entry's fields into a row's boxes, as the registry holds them. */
const fill = (boxes: EntryBoxes, values: EditValues): void => {
  boxes.baseUrl.value = values.baseUrl;
  boxes.api.value = values.api;
  boxes.apiKeyEnv.value = values.apiKeyEnv;
  boxes.reasoning.checked = values.reasoning;
  boxes.contextWindow.value = values.contextWindow;
  boxes.maxTokens.value = values.maxTokens;
  boxes.costInput.value = values.costInput;
  boxes.costOutput.value = values.costOutput;
  boxes.costCacheRead.value = values.costCacheRead;
  boxes.costCacheWrite.value = values.costCacheWrite;
};

/**
 * A row's edit form: that entry's fields, prefilled with what the registry
 * holds, and its name shown and not editable.
 *
 * It is built with the row and hidden, so the boxes hold the entry before
 * anyone asks for them: a form assembled at the click would be a form someone
 * could find half-filled, and one rebuilt every time they changed their mind.
 * Saving posts the row's name and the whole entry — the route replaces what a
 * name holds rather than patching the fields that moved — and the name posted is
 * the row's, whatever this form shows, because a name is an entry's identity and
 * a seat is written with it. That is why the name box is disabled rather than
 * absent: an operator who cannot see which entry they are editing is editing the
 * wrong one.
 *
 * A refusal leaves this form open with what was typed in it. The console refused
 * the edit, not the operator, and the run in flight that refused it ends.
 */
const providerEditForm = (
  row: ProviderRow,
  onEdit: (name: string, values: EditValues) => Promise<WriteOutcome>,
  onEdited: (name: string) => void,
): HTMLElement => {
  const boxes = entryBoxes(row.name);
  fill(boxes, editValuesOf(row));

  const name = textInput("field-edit-provider-name", "");
  name.value = row.name;
  name.disabled = true;

  const save = buttonOf("save-provider", "Save changes");
  const cancel = buttonOf("cancel-edit", "Cancel");

  const outcome = paragraph("edit-outcome", "");
  outcome.setAttribute("role", "status");

  const root = document.createElement("div");
  root.className = "provider-edit";
  root.hidden = true;
  root.append(
    paragraph(
      "provider-edit-note",
      `The name “${row.name}” is the name a seat is written with, so it is not edited here: ` +
        "changing it means removing this provider and adding the other. The key box takes the " +
        "name of the environment variable a key is read from — no key value is ever typed here, " +
        "sent, or stored.",
    ),
    field("Name", name, "field-edit-provider-name-wrap"),
    ...entryFields(boxes, row.name),
    save,
    cancel,
    outcome,
  );

  /** Post the row's name and what the boxes hold, and show what came back. */
  const submit = async (): Promise<void> => {
    const given = valuesOf(row.name, boxes);
    save.disabled = true;
    cancel.disabled = true;
    const answer = await onEdit(row.name, given);
    save.disabled = false;
    cancel.disabled = false;

    if (!answer.ok) {
      // The console's line as it wrote it — zod's field, the name it does not
      // hold, or the run in flight. All three are the whole answer, and the one
      // an operator has to read before trying again.
      outcome.className = "edit-outcome edit-refused bad";
      outcome.textContent = answer.error;
      return;
    }

    // Nothing is written into this paragraph on a success: the list is read
    // again, which takes this row and its form with it.
    onEdited(row.name);
  };

  save.addEventListener("click", () => void submit());
  cancel.addEventListener("click", (): void => {
    // Called off, and the boxes put back to the entry: what was typed here is
    // not left in a hidden form for the next person who opens it.
    fill(boxes, editValuesOf(row));
    outcome.className = "edit-outcome";
    outcome.textContent = "";
    root.hidden = true;
  });

  return root;
};

/**
 * One entry: what it is, what it costs, the credential check asked of it, and
 * the two things an operator can do to it.
 *
 * The check's input is left blank rather than prefilled with a model id the page
 * invented: the operator is the one who knows which model this endpoint serves,
 * and a blank id sent as `marvin/` comes back as the console's own line.
 *
 * The removal asks in the page: the first click turns this row's own control
 * into a confirm and a cancel and sends nothing, and another row's remove is a
 * separate question with a separate answer. A browser dialog is not used
 * anywhere on this page, and one could not be styled or tested from here.
 */
const providerItem = (row: ProviderRow, options: ProvidersViewOptions): HTMLLIElement => {
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
    const answer = await options.onCheck(asked);
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

  // The two things an operator can do to this entry. The removal's confirm and
  // cancel start hidden and the `Remove` control starts showing; the first click
  // swaps them, in this row alone, and sends nothing.
  const edit = buttonOf("edit-provider", "Edit");
  const remove = buttonOf("remove-provider", "Remove");
  const confirm = buttonOf("confirm-remove", "Confirm removal");
  const keep = buttonOf("cancel-remove", "Cancel");
  confirm.hidden = true;
  keep.hidden = true;

  const refused = paragraph("remove-outcome", "");
  refused.setAttribute("role", "status");

  const form = providerEditForm(row, options.onEdit, options.onEdited);

  const actions = document.createElement("div");
  actions.className = "provider-actions";
  actions.append(edit, remove, confirm, keep);

  /** Put this row's own remove control into one of its two states. */
  const askedToRemove = (asked: boolean): void => {
    remove.hidden = asked;
    confirm.hidden = !asked;
    keep.hidden = !asked;
  };

  /** Ask the console to delete this entry, once the confirm has been clicked. */
  const runRemove = async (): Promise<void> => {
    remove.disabled = true;
    confirm.disabled = true;
    keep.disabled = true;
    const answer = await options.onRemove(row.name);
    remove.disabled = false;
    confirm.disabled = false;
    keep.disabled = false;

    if (!answer.ok) {
      // The console's line, verbatim — the run in flight above all, which is the
      // answer an operator most needs to read whole. Nothing was deleted, so the
      // row stays listed and its control goes back to asking: the entry can be
      // removed once the run that refused it has finished.
      refused.className = "remove-outcome remove-refused bad";
      refused.textContent = answer.error;
      askedToRemove(false);
      return;
    }

    // As with an add and an edit: the list is read from the console again, so an
    // entry the file no longer holds does not keep its row on the page.
    options.onRemoved(row.name);
  };

  edit.addEventListener("click", (): void => {
    form.hidden = false;
  });
  remove.addEventListener("click", (): void => askedToRemove(true));
  confirm.addEventListener("click", () => void runRemove());
  keep.addEventListener("click", (): void => {
    askedToRemove(false);
    refused.className = "remove-outcome";
    refused.textContent = "";
  });

  li.append(head, fields, check, actions, refused, form);
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
  const name = textInput("field-provider-name", "the name before the slash, as in marvin/subagent");
  const boxes = entryBoxes("");

  const button = buttonOf("add-provider", "Add provider");

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
    ...entryFields(boxes, ""),
    button,
    outcome,
  );

  const values = (): AddValues => valuesOf(name.value, boxes);

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
 * The section: the entries the console listed, the form that adds one, and under
 * every row a credential check, an edit and a removal.
 *
 * The whole section is replaced on every render, the way every other section is
 * — an entry that went out of the file must not keep its row on the page — which
 * is also why the frame leaves it alone: only this module knows when a redraw
 * is wanted, and it is after a read, an add, an edit or a removal the console
 * took — never after one it refused, and never under a poll.
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
    list.append(...options.rows.map((row) => providerItem(row, options)));
    el.append(list);
  }

  el.append(addForm(options.onAdd, options.onAdded));
};
