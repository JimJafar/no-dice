/**
 * Drawing the start form, and nothing else.
 *
 * What the form means is `start.ts`'s business: this file turns its values into
 * controls, keeps the derived parts of the page in step with them, and puts
 * whatever the console answers back on the page. The rules below shape the drawing.
 *
 * **The seat picker lists what the console can seat a run on, in three kinds.**
 * `/api/state` names the bots and every provider in `providers.json`, and
 * `/api/models` names the models the pinned Pi knows that this console has a key
 * for. The three sit in one control, sorted into groups so the kind a
 * choice belongs to is visible on the page: a bot seats as `bot:greedy`, a
 * registered provider uncovers a text input for the model id and seats as
 * `<provider>/<id>` — `marvin/subagent`, which is what `--a marvin/subagent` has
 * always meant at the terminal — and one of Pi's models seats as its reference
 * with nothing typed anywhere. No call goes to a provider's `/v1/models`, and no
 * key value is ever drawn: the state carries provider names and the *names* of
 * their key variables, and the model list carries references and Pi's figures.
 *
 * **A model list that could not be read is said, and costs one kind.** The route
 * asks Pi, and a Pi that did not answer is a failed read rather than an empty
 * list. The pickers then offer the two kinds `/api/state` gave and the section
 * says the list could not be read: a Pi that failed to answer is not a reason an
 * operator cannot seat a bot.
 *
 * **The ceilings are beside the Start button, before it is pressed.** The block
 * names what the run will be bounded by and says which of those are the runner's
 * defaults rather than what was typed — a blank pair limit is 75 pairs, not
 * nothing — and under it sits the measured cost of a series at that length. A
 * Start button that says nothing is how a 48-hour run gets started by accident.
 *
 * **The boxes hold what the page sends.** The pair limit and the concurrency open
 * at `OPEN_VALUES` — five pairs, one at a time — rather than blank, because a form
 * that opens blank opens at the runner's 75 pairs, which is two days of a machine
 * and the wrong answer to "what happens when I press Start". A blank box is still
 * the runner's default, and the block still says so when an operator clears one;
 * what has changed is that the blank is now a thing an operator did rather than
 * the state the page arrived in.
 *
 * **The knobs nobody touches on a first run are folded away.** The seed base and
 * the two ceilings sit behind a disclosure that starts closed and opens on a click
 * — a `<details>`, so the browser does the opening and nothing is reloaded
 * or navigated. The line that opens it names what is inside in the words the fields
 * inside it are labelled in. The block also states the one cap the form cannot
 * change: every turn gets five minutes, and there is no box for it
 * because no flag reaches it.
 *
 * **The form speaks in words, not in the command line's words.** Every field is
 * labelled with what it is for — Pairs, Pairs at once, Cost ceiling, Seed base —
 * and the ceilings block names each bound the same way its field names it. The
 * form posts the same body and the console starts the same run; only the words
 * over the boxes change. A label that reads `--max-cost` tells a reader that the
 * browser is a skin over a terminal, which is the one thing this page has to
 * avoid saying. The console's own refusal line is the exception, kept verbatim:
 * it names the field and the value it rejected, and it is the line whoever typed
 * the form has to act on.
 *
 * **A refusal is the console's line, verbatim.** The page does not decide what a
 * valid run is: it posts, and shows what came back. A refusal starts nothing, so
 * the progress section stays exactly as it was.
 *
 * The form is built once per `/api/state` read, which is once per page load: a
 * form that rebuilt itself under someone mid-way through typing a model id would
 * be a form that lost what they typed.
 */
import {
  GAMES,
  MEASURED_SERIES,
  OPEN_VALUES,
  RUN_KINDS,
  ceilingsOf,
  payloadOf,
  seatKindOf,
  seatOf,
} from "./start.ts";
import type { Ceiling, RunKind, SeatKind, StartBody, StartOutcome, StartValues } from "./start.ts";
import { clear } from "./render-frame.ts";
import type { RunSnapshot } from "./progress.ts";
import type { ModelRow } from "./providers.ts";
import type { ProviderOption } from "./state.ts";

/** What the seat pickers are built from: `/api/state`'s bots and providers, and `/api/models`. */
export interface SeatChoices {
  readonly bots: readonly string[];
  readonly providers: readonly ProviderOption[];
  /**
   * The models this console's Pi has a key for, or `null` when that list could
   * not be read — which is a different fact from an empty list, since an empty
   * list means no key is set and the pickers say nothing about it.
   */
  readonly models: readonly ModelRow[] | null;
}

/** What the form needs from outside itself. */
export interface StartViewOptions {
  /** The seats the console offered, from `/api/state`. */
  choices: SeatChoices;
  /** Ask the console for the run — `start.ts`'s `startRun` in the page's wiring. */
  onStart: (kind: RunKind, body: StartBody) => Promise<StartOutcome>;
  /** What to do once a run is in flight: the page starts watching it. */
  onStarted: (run: RunSnapshot) => void;
}

/** A short element with a class and a sentence. */
const paragraph = (className: string, text: string): HTMLElement => {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
};

/**
 * A `<select>` with one option per value, the value also being the label. The
 * seat pickers do not use it: their choices are grouped, and a group heading is
 * the one thing an option list cannot say.
 */
const selectOf = (className: string, values: readonly string[]): HTMLSelectElement => {
  const select = document.createElement("select");
  select.className = className;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  return select;
};

/** One choice: the string it sends, and the words that name it. */
const optionOf = (value: string, label = value): HTMLOptionElement => {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
};

/** A run of choices under a heading, so the kind they are is on the page. */
const groupOf = (label: string, options: readonly HTMLOptionElement[]): HTMLOptGroupElement => {
  const group = document.createElement("optgroup");
  group.label = label;
  group.append(...options);
  return group;
};

/**
 * What each group of the seat pickers is called: the three kinds in the words an
 * operator meets elsewhere on the page, so a choice is picked for what it is
 * rather than for where it sits in a list.
 */
const GROUP_LABELS: Record<SeatKind, string> = {
  bot: "Bots",
  provider: "Registered providers",
  model: "Pi's models",
};

/**
 * One of Pi's models as a picker names it: the reference a seat is seated with,
 * and Pi's own four figures beside it, spelled as Pi spelled them. The reference
 * comes first because it is the string the run is started with and the label
 * the estimate's figures are looked up by; the figures are there to choose on.
 */
const modelLabel = (model: ModelRow): string =>
  `${model.reference} — ${model.context} context, ${model.maxOut} output, ` +
  `thinking ${model.thinking}, images ${model.images}`;

/**
 * The picker's choices, in three groups: the bots, the registered providers, and
 * Pi's models. A group with nothing in it is left off rather than drawn as an
 * empty heading, and a model list that could not be read leaves its group out
 * altogether — the section says why, once, above the pickers.
 */
const seatGroups = (choices: SeatChoices): HTMLOptGroupElement[] => {
  const groups: readonly (readonly [SeatKind, readonly HTMLOptionElement[]])[] = [
    ["bot", choices.bots.map((bot) => optionOf(bot))],
    ["provider", choices.providers.map((each) => optionOf(each.name))],
    ...(choices.models === null
      ? []
      : [["model", choices.models.map((each) => optionOf(each.reference, modelLabel(each)))] as const]),
  ];
  return groups
    .filter(([, options]) => options.length > 0)
    .map(([kind, options]) => groupOf(GROUP_LABELS[kind], options));
};

/**
 * A text input, untyped: nothing here decides what a number or an id looks like.
 * `value` is what the box holds before anyone types — a box that opens holding a
 * value needs no placeholder for it, because the page shows what it will send.
 */
const textInput = (className: string, placeholder: string, value = ""): HTMLInputElement => {
  const input = document.createElement("input");
  input.className = className;
  input.type = "text";
  input.placeholder = placeholder;
  input.value = value;
  return input;
};

/** A control with the flag it stands for written above it. */
const field = (label: string, control: HTMLElement, className: string): HTMLElement => {
  const wrap = document.createElement("label");
  wrap.className = `field ${className}`;
  const text = document.createElement("span");
  text.className = "field-label";
  text.textContent = label;
  wrap.append(text, control);
  return wrap;
};

/** One seat: its picker, the model id typed against it, and the seat as it will be sent. */
interface SeatPicker {
  readonly root: HTMLElement;
  readonly select: HTMLSelectElement;
  readonly model: HTMLInputElement;
  /** The seat as `--a` or `--b` will take it. */
  seat: () => string;
  /** The model input and the seat line, drawn for the seat picked now. */
  draw: () => void;
}

/**
 * One seat picker: the bots, the registered providers and Pi's models in one
 * grouped control, then a text input for the model id that only a registered
 * provider needs. The line under it is the seat as it will be sent, read off
 * `seatOf` — the same function the payload is built with — so what the page
 * says it is about to send and what it sends are one string.
 */
const seatPicker = (which: "a" | "b", choices: SeatChoices): SeatPicker => {
  const select = document.createElement("select");
  select.className = `field-seat field-seat-${which}`;
  select.append(...seatGroups(choices));
  const model = textInput(`field-model field-model-${which}`, "model id");
  const sent = paragraph(`seat-sent seat-sent-${which}`, "");

  const root = document.createElement("div");
  root.className = `seat seat-${which}`;
  root.append(field(`Seat ${which.toUpperCase()}`, select, `seat-picker-${which}`), model, sent);

  const seat = (): string => seatOf(select.value, model.value.trim());

  const draw = (): void => {
    // Which of the three kinds the choice is decides whether a model id is asked
    // for at all: a provider needs one typed, a bot has none, and a Pi model's
    // reference already names both halves. `seatKindOf` is where that is settled,
    // once, for this line, for the box and for the payload.
    const needsId = seatKindOf(select.value) === "provider";
    model.hidden = !needsId;
    // A model id typed against a seat that wants none is left in the box rather
    // than cleared: it is what the operator typed, and switching the seat back
    // should not lose it. The hint shows the shape a seat takes —
    // `provider/model` — without dressing it up as a command.
    model.placeholder = needsId ? `model id, as ${select.value}/<id>` : "model id";
    sent.textContent = `seat ${which} — ${seat()}`;
  };

  return { root, select, model, seat, draw };
};

/** One ceiling as the page states it: what the run is bounded by, the value, and whose it is. */
const ceilingItem = (ceiling: Ceiling): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = `ceiling ceiling-${ceiling.source}`;
  li.append(document.createTextNode(`${ceiling.label}: ${ceiling.value}`));
  // Only a runner's default is explained. A value that came from the form needs
  // no attribution, and a fact about the command is not a field's value at all.
  if (ceiling.source === "runner") {
    li.append(document.createTextNode(" — the runner's default, the field is blank"));
  }
  return li;
};

/** A limit field and the commands it belongs to. */
interface LimitField {
  readonly wrap: HTMLElement;
  readonly kinds: readonly RunKind[];
}

/**
 * What the folded block's own line says, in the words the fields inside it are
 * labelled in: a disclosure is only folded away from someone who can tell what
 * they are opening.
 */
const ADVANCED_LABEL = "Seed base, cost ceiling, token ceiling — and how long a turn gets";

/**
 * The turn cap, stated rather than offered. The runner gives every turn five
 * minutes — `TURN_TIMEOUT_MS` in `packages/runner/src/match.ts` — and no flag
 * changes it, so the block says the fact instead of drawing a box that would
 * promise a change the console cannot make.
 */
const TURN_TIMEOUT_LINE =
  "Every turn gets five minutes. That is the runner's own cap, and this page does not change it.";

/**
 * What the section says when the model list is missing because the read failed:
 * which kinds the pickers do offer, and no route, subprocess or config file — the
 * operator cannot act on any of those, and the form starts a run without them.
 */
const MODELS_UNREAD =
  "The model list could not be read, so these pickers offer the bots and the " +
  "providers the console names.";

/**
 * Whether there is any seat to offer at all: a bot, a registered provider, or a
 * model of a console whose Pi answered. With none of the three there is nothing
 * to start, and a form that cannot be started is worse than a line saying so.
 */
const hasSeats = (choices: SeatChoices): boolean =>
  choices.bots.length > 0 ||
  choices.providers.length > 0 ||
  (choices.models !== null && choices.models.length > 0);

/**
 * The start section: the form, the ceilings beside its button, and the line the
 * console answered with.
 */
export const renderStart = (el: HTMLElement, options: StartViewOptions): void => {
  clear(el);

  el.append(
    paragraph(
      "start-lifetime",
      "A run plays in the console's own process. Closing this page does not stop a run; " +
        "closing the console does, and leaves the series on disk to be resumed in the results below.",
    ),
  );

  if (!hasSeats(options.choices)) {
    el.append(paragraph("seats-none", "The console named no seat this page can start a run with."));
    return;
  }

  // `RUN_KINDS`'s order is the select's: a series is what the form starts on,
  // and the ceilings block under the button states what that run is bounded by
  // before anyone presses it.
  const kind = selectOf("field-kind", [...RUN_KINDS]);
  const game = selectOf("field-game", [...GAMES]);
  const seatA = seatPicker("a", options.choices);
  const seatB = seatPicker("b", options.choices);

  // The pair limit and the concurrency open holding `OPEN_VALUES`, so the run a
  // press of Start asks for is on the page rather than behind a placeholder. The
  // placeholders that remain say what a *blank* means — the runner's 75, the
  // runner's one at a time, no ceiling — which is the one thing the box itself
  // cannot say once it is full.
  const seed = textInput("field-seed", "a whole number");
  const seedBase = textInput("field-seed-base", "the runner's own base, when blank", OPEN_VALUES.seedBase);
  const maxPairs = textInput("field-max-pairs", "the runner's 75, when blank", OPEN_VALUES.maxPairs);
  const maxTokens = textInput("field-max-tokens", "no ceiling, when blank", OPEN_VALUES.maxTokens);
  const maxCost = textInput("field-max-cost", "no ceiling, when blank", OPEN_VALUES.maxCost);
  const concurrency = textInput("field-concurrency", "one at a time, when blank", OPEN_VALUES.concurrency);
  const name = textInput("field-name", "named from the two seats, when blank");

  // The knobs a first run is about stay in the open — a match's seed, the pair
  // limit, how many pairs at a time, and what the series is called — and the ones
  // nobody touches on a first run go behind the disclosure below.
  const openLimits: readonly LimitField[] = [
    { wrap: field("Seed, for one match", seed, "field-seed-wrap"), kinds: ["match"] },
    { wrap: field("Pairs", maxPairs, "field-max-pairs-wrap"), kinds: ["series"] },
    { wrap: field("Pairs at once", concurrency, "field-concurrency-wrap"), kinds: ["series"] },
    { wrap: field("Series name", name, "field-name-wrap"), kinds: ["series"] },
  ];

  const advancedLimits: readonly LimitField[] = [
    { wrap: field("Seed base", seedBase, "field-seed-base-wrap"), kinds: ["series"] },
    { wrap: field("Token ceiling", maxTokens, "field-max-tokens-wrap"), kinds: ["series"] },
    { wrap: field("Cost ceiling", maxCost, "field-max-cost-wrap"), kinds: ["series"] },
  ];

  // One list for the drawing, whichever block a field was put in: a field the
  // chosen Run kind has no flag for is hidden wherever it sits.
  const limits: readonly LimitField[] = [...openLimits, ...advancedLimits];

  const limitsBlock = document.createElement("div");
  limitsBlock.className = "limits";
  limitsBlock.append(...openLimits.map((each) => each.wrap));

  // A `<details>` is the disclosure the browser already has: the click
  // that opens it reloads nothing and navigates nowhere, so the form keeps what
  // was typed in it. It is drawn closed, because the ceilings are not what a first
  // run is decided on, and it stays on the page for a match — whose turns get the
  // same five minutes — with only its turn line left showing.
  const advancedLabel = document.createElement("summary");
  advancedLabel.textContent = ADVANCED_LABEL;

  const advancedFields = document.createElement("div");
  advancedFields.className = "limits advanced-fields";
  advancedFields.append(...advancedLimits.map((each) => each.wrap));

  const advanced = document.createElement("details");
  advanced.className = "advanced";
  advanced.append(advancedLabel, advancedFields, paragraph("turn-timeout", TURN_TIMEOUT_LINE));

  const start = document.createElement("button");
  start.className = "start";
  start.type = "button";
  start.textContent = "Start";

  const ceilings = document.createElement("ul");
  ceilings.className = "ceilings";

  const measured = paragraph("start-measured", MEASURED_SERIES);
  const outcome = paragraph("start-outcome", "");
  outcome.setAttribute("role", "status");

  const row = document.createElement("div");
  row.className = "start-row";
  row.append(start, ceilings);

  const form = document.createElement("div");
  form.className = "start-form";
  form.append(
    field("Run", kind, "field-kind-wrap"),
    field("Game", game, "field-game-wrap"),
    seatA.root,
    seatB.root,
    // The third kind is missing because a read failed, and the page says so
    // rather than leaving an operator to wonder whether the console has no such
    // models. The form still starts a run on the two kinds it does have.
    ...(options.choices.models === null ? [paragraph("models-none", MODELS_UNREAD)] : []),
    limitsBlock,
    advanced,
    row,
    measured,
    outcome,
  );
  el.append(form);

  /** The form's values, read off the controls as they stand. */
  const valuesOf = (): StartValues => ({
    kind: kind.value as RunKind,
    game: game.value,
    seatA: seatA.select.value,
    modelA: seatA.model.value,
    seatB: seatB.select.value,
    modelB: seatB.model.value,
    seed: seed.value,
    seedBase: seedBase.value,
    maxPairs: maxPairs.value,
    maxTokens: maxTokens.value,
    maxCost: maxCost.value,
    concurrency: concurrency.value,
    name: name.value,
  });

  /** The parts of the section that are a consequence of what the form holds. */
  const draw = (): void => {
    const values = valuesOf();
    seatA.draw();
    seatB.draw();
    for (const each of limits) each.wrap.hidden = !each.kinds.includes(values.kind);
    ceilings.replaceChildren(...ceilingsOf(values).map(ceilingItem));
    measured.hidden = values.kind !== "series";
  };

  /** Ask for the run, and show the answer. A refusal shows the console's line. */
  const submit = async (): Promise<void> => {
    const payload = payloadOf(valuesOf());
    start.disabled = true;
    const answer = await options.onStart(payload.kind, payload.body);
    start.disabled = false;

    if (!answer.ok) {
      // The console's line as it wrote it: `parseArgs` named the flag and the
      // value, and whoever typed the form is the one who can fix it. Nothing has
      // been started, so nothing else on the page moves.
      outcome.className = "start-outcome start-refused bad";
      outcome.textContent = answer.error;
      return;
    }

    outcome.className = "start-outcome start-started";
    // The run is reported as what started, not as where it writes: the directory
    // is the operator's, and the run's own lines name it below, verbatim.
    outcome.textContent = `Started a ${payload.kind}.`;
    options.onStarted(answer.run);
  };

  form.addEventListener("input", draw);
  form.addEventListener("change", draw);
  start.addEventListener("click", () => void submit());

  draw();
};
