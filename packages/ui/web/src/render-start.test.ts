// @vitest-environment happy-dom
/**
 * The start form, on the page: what its seat pickers list, what the page says
 * the run will be bounded by before anyone presses Start, and what it does with
 * the answer.
 *
 * The form is where a 48-hour run gets started by accident, so most of what is
 * checked here is what the page *states*: the ceilings block has to name
 * 75 pairs and a concurrency of 1 while the fields are still blank, the seat
 * line has to be the string that will be posted, and a refusal has to be the
 * console's own line with nothing started.
 *
 * `onStart` is a stub rather than a server: which route the payload goes to
 * and what the page makes of the answer are `start.ts`'s tests, and what is under
 * test here is the drawing and the wiring — which control appears when, and what
 * the page says after an answer arrives.
 */
import { describe, expect, it } from "vitest";

import { renderStart } from "./render-start.ts";
import type { SeatChoices } from "./render-start.ts";
import type { RunKind, StartBody, StartOutcome } from "./start.ts";
import type { RunSnapshot } from "./progress.ts";

/** The seats a console with one provider in its registry offers. */
const CHOICES: SeatChoices = {
  bots: ["bot:random", "bot:greedy"],
  providers: [
    { name: "marvin", apiKeyEnv: null },
    { name: "openai", apiKeyEnv: "OPENAI_API_KEY" },
  ],
};

/** Every seat either picker should list, in order. */
const SEATS = ["bot:random", "bot:greedy", "marvin", "openai"];

/** The run a successful start answers with. */
const STARTED: RunSnapshot = {
  state: "running",
  lines: [],
  dir: "/repo/series/alpha",
  out: null,
  startedAt: "2025-03-01T12:03:00.000Z",
  endedAt: null,
  exitCode: null,
  counters: null,
};

/** `parseArgs`'s own line for a provider picked with no model id typed. */
const NO_MODEL = '--a takes bot:random, bot:greedy and <provider>/<model-id>, not "marvin/"';

/** A section in the shape `index.html` gives it. */
const section = (): HTMLElement => {
  const el = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = "Start a run";
  el.append(heading);
  document.body.append(el);
  return el;
};

/** One control, or the reason the page is not the page it should be. */
const control = <T extends Element>(el: HTMLElement, selector: string): T => {
  const found = el.querySelector<T>(selector);
  if (found === null) throw new Error(`${selector} is not on the page`);
  return found as T;
};

/** The text of one element, and of everything under it. */
const textOf = (el: HTMLElement, selector: string): string =>
  el.querySelector<HTMLElement>(selector)?.textContent ?? "";

/** The items of the ceilings block, as the page writes them. */
const ceilingItems = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>(".ceilings > li")].map((li) => li.textContent ?? "");

/** Set a control and tell the page, the way a person typing would. */
const set = (el: HTMLElement, selector: string, value: string): void => {
  const found = control<HTMLInputElement>(el, selector);
  found.value = value;
  found.dispatchEvent(new Event(found.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};

/** What the page asked the console for, and what it was told back. */
interface Asked {
  kind: RunKind;
  body: StartBody;
}

/** Draw the form over a stub that answers every start the same way. */
const drawn = (
  answer: StartOutcome,
): {
  el: HTMLElement;
  asked: Asked[];
  started: RunSnapshot[];
  /** Press Start and let the answer arrive. */
  press: () => Promise<void>;
} => {
  const el = section();
  const asked: Asked[] = [];
  const started: RunSnapshot[] = [];

  renderStart(el, {
    choices: CHOICES,
    onStart: (kind, body) => {
      asked.push({ kind, body });
      return Promise.resolve(answer);
    },
    onStarted: (run) => void started.push(run),
  });

  return {
    el,
    asked,
    started,
    press: async () => {
      control<HTMLButtonElement>(el, "button.start").click();
      // The answer arrives on a promise, and the drawing that follows it with.
      await new Promise((later) => void setTimeout(later, 0));
    },
  };
};

describe("the seat pickers", () => {
  it("lists the bots and then every provider the registry names, in both seats", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    const pickers = [...el.querySelectorAll<HTMLSelectElement>("select.field-seat")];
    expect(pickers).toHaveLength(2);
    for (const picker of pickers) {
      expect([...picker.options].map((option) => option.value)).toEqual(SEATS);
    }
  });

  it("offers the one game there is", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    expect([...control<HTMLSelectElement>(el, "select.field-game").options].map((o) => o.value)).toEqual([
      "salient",
    ]);
  });

  it("uncovers a text input for the model id when a provider is picked, and hides it for a bot", () => {
    const { el } = drawn({ ok: true, run: STARTED });
    const model = control<HTMLInputElement>(el, "input.field-model-a");

    expect(model.hidden).toBe(true);
    set(el, "select.field-seat-a", "marvin");
    expect(model.hidden).toBe(false);
    // The placeholder says what the flag expects, in the flag's own words.
    expect(model.placeholder).toContain("--a marvin/<id>");

    set(el, "select.field-seat-a", "bot:greedy");
    expect(model.hidden).toBe(true);
  });

  it("states the seat it is about to send, as `<provider>/<id>`", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    set(el, "select.field-seat-a", "marvin");
    set(el, "input.field-model-a", "subagent");
    expect(textOf(el, ".seat-sent-a")).toBe("seat a — marvin/subagent");
    expect(textOf(el, ".seat-sent-b")).toBe("seat b — bot:random");
  });

  it("sends a model seat typed as subagent against marvin as marvin/subagent", async () => {
    const { el, asked, press } = drawn({ ok: true, run: STARTED });

    set(el, "select.field-kind", "match");
    set(el, "select.field-seat-a", "marvin");
    set(el, "input.field-model-a", "subagent");
    set(el, "select.field-seat-b", "openai");
    set(el, "input.field-model-b", "gpt-4o");
    set(el, "input.field-seed", "135");
    await press();

    expect(asked).toHaveLength(1);
    expect(asked[0]!.kind).toBe("match");
    expect(asked[0]!.body.a).toBe("marvin/subagent");
    expect(asked[0]!.body.b).toBe("openai/gpt-4o");
  });

  it("sends a provider with nothing typed as it stands, and never repairs it on the page", async () => {
    const { el, asked, press } = drawn({ ok: false, error: NO_MODEL });

    set(el, "select.field-seat-a", "marvin");
    await press();

    expect(asked[0]!.body.a).toBe("marvin/");
  });
});

describe("the ceilings beside Start", () => {
  it("states the ceilings of the run the form starts on, before anything is pressed", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    // A series is what the console is for, so it is what the form holds
    // untouched — and its ceilings are stated rather than left to be inferred.
    expect(control<HTMLSelectElement>(el, "select.field-kind").value).toBe("series");
    expect(ceilingItems(el)).toHaveLength(5);
  });

  it("names the runner's defaults for a series whose limits are all blank", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    expect(ceilingItems(el)).toEqual([
      "--max-pairs 75 — the runner's default, the field is blank",
      "--concurrency 1 — the runner's default, the field is blank",
      "--max-cost none — the runner's default, the field is blank",
      "--max-tokens none — the runner's default, the field is blank",
      "--seed-base 0 — the runner's default, the field is blank",
    ]);
  });

  it("names what was typed instead, and stops calling it a default", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    set(el, "input.field-max-pairs", "3");
    set(el, "input.field-max-tokens", "900000");

    expect(ceilingItems(el)).toEqual([
      "--max-pairs 3",
      "--concurrency 1 — the runner's default, the field is blank",
      "--max-cost none — the runner's default, the field is blank",
      "--max-tokens 900000",
      "--seed-base 0 — the runner's default, the field is blank",
    ]);
  });

  it("states what a series at its default length costs, in the measurement's own words", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    const measured = textOf(el, ".start-measured");
    expect(measured).toContain("48 hours");
    expect(measured).toContain("688M tokens");
    expect(measured).toContain("150 matches");
  });

  it("says a match is one pair and has no ceilings", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    set(el, "select.field-kind", "match");
    set(el, "input.field-seed", "135");

    expect(ceilingItems(el)).toEqual([
      "matches 2 — one pair, both seat orders",
      "--seed 135",
      "ceilings none: a single match has no pair, cost or token limit",
    ]);
    // The series' limits are not a match's flags, and a field that is not sent
    // is not shown.
    expect(control<HTMLElement>(el, ".field-max-pairs-wrap").hidden).toBe(true);
    expect(control<HTMLElement>(el, ".field-seed-wrap").hidden).toBe(false);
    expect(control<HTMLElement>(el, ".start-measured").hidden).toBe(true);
  });
});

describe("pressing Start", () => {
  it("asks the console for the run the form describes, and starts watching it", async () => {
    const { el, asked, started, press } = drawn({ ok: true, run: STARTED });

    set(el, "input.field-max-pairs", "3");
    set(el, "input.field-name", "alpha");
    await press();

    expect(asked).toEqual([
      {
        kind: "series",
        body: { game: "salient", a: "bot:random", b: "bot:random", maxPairs: "3", name: "alpha" },
      },
    ]);
    expect(started).toEqual([STARTED]);
    expect(textOf(el, ".start-started")).toContain("/repo/series/alpha");
  });

  it("shows a payload the console refuses as the console's own line, and starts nothing", async () => {
    const { el, started, press } = drawn({ ok: false, error: NO_MODEL });

    set(el, "select.field-seat-a", "marvin");
    await press();

    // Verbatim: `parseArgs` named the flag and the value, and the wording the
    // terminal uses is the wording whoever typed the form can check it against.
    expect(textOf(el, ".start-refused")).toBe(NO_MODEL);
    expect(el.querySelector(".start-started")).toBeNull();
    expect(started).toEqual([]);
  });

  it("leaves the form as it was typed, so the mistake can be fixed and pressed again", async () => {
    const { el, press } = drawn({ ok: false, error: NO_MODEL });

    set(el, "select.field-seat-a", "marvin");
    await press();

    expect(control<HTMLSelectElement>(el, "select.field-seat-a").value).toBe("marvin");
    expect(control<HTMLButtonElement>(el, "button.start").disabled).toBe(false);
  });

  it("asks once, and listens for the answer before it will ask again", async () => {
    const { el, press } = drawn({ ok: true, run: STARTED });
    const button = control<HTMLButtonElement>(el, "button.start");

    await press();

    expect(button.disabled).toBe(false);
    button.click();
    await new Promise((later) => void setTimeout(later, 0));
    expect([...el.querySelectorAll(".start-started")]).toHaveLength(1);
  });
});

describe("what the section says about the run's life", () => {
  it("says closing the page does not stop a run, and closing the console does", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    const lifetime = textOf(el, ".start-lifetime");
    expect(lifetime).toContain("Closing this page does not stop a run");
    expect(lifetime).toContain("closing the console does");
  });

  it("says when the console named no seat at all, rather than drawing empty pickers", () => {
    const el = section();
    renderStart(el, {
      choices: { bots: [], providers: [] },
      onStart: () => Promise.resolve({ ok: true, run: STARTED }),
      onStarted: () => undefined,
    });

    expect(textOf(el, ".seats-none")).toContain("no seat");
    expect(el.querySelector("button.start")).toBeNull();
  });

  it("keeps the heading and replaces the form whole, so a redraw leaves one form", () => {
    const el = section();
    const options = {
      choices: CHOICES,
      onStart: () => Promise.resolve({ ok: true, run: STARTED } as StartOutcome),
      onStarted: () => undefined,
    };

    renderStart(el, options);
    renderStart(el, { ...options, choices: { bots: CHOICES.bots, providers: [] } });

    expect(el.querySelectorAll("h2")).toHaveLength(1);
    expect(el.querySelectorAll("button.start")).toHaveLength(1);
    expect([...el.querySelectorAll<HTMLSelectElement>("select.field-seat-a")[0]!.options]).toHaveLength(2);
  });
});
