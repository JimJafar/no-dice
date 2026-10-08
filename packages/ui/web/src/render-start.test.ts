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
 *
 * The form is also where the page is most tempted to talk like a terminal, so its
 * labels and its ceilings are checked for flag names, absolute paths and log file
 * names at the bottom of this file. The console's own refusal line is the one line
 * that is not: it names the field and the value it rejected, verbatim.
 */
import { describe, expect, it } from "vitest";

import { expectPlainWords, wordsOf } from "./plain-words.ts";
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
    // The placeholder shows the shape a seat takes, without dressing it up as a
    // command the reader would have to type somewhere else.
    expect(model.placeholder).toContain("marvin/<id>");
    expect(model.placeholder).not.toContain("--");

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

describe("what the form opens with", () => {
  it("holds five pairs and one at a time in the boxes, with the ceilings and the seed base blank", () => {
    // The page shows what it sends: the pair limit is in the box rather than
    // behind a placeholder, so the run a press of Start asks for is on the
    // page before anyone types.
    const { el } = drawn({ ok: true, run: STARTED });

    expect(control<HTMLInputElement>(el, "input.field-max-pairs").value).toBe("5");
    expect(control<HTMLInputElement>(el, "input.field-concurrency").value).toBe("1");
    for (const selector of ["input.field-max-cost", "input.field-max-tokens", "input.field-seed-base"]) {
      expect(control<HTMLInputElement>(el, selector).value).toBe("");
    }
  });

  it("reads the pair limit it opens on as a value from the form, not as a default", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    expect(ceilingItems(el)).toEqual([
      "Pairs: 5",
      "Pairs at once: 1",
      "Cost ceiling: none — the runner's default, the field is blank",
      "Token ceiling: none — the runner's default, the field is blank",
      "Seed base: 0 — the runner's default, the field is blank",
    ]);
  });

  it("says in each placeholder what a blank would mean, rather than what the box holds", () => {
    // A placeholder is the last place a default can be hidden in, so the ones
    // that remain explain the blank rather than repeating the number.
    const { el } = drawn({ ok: true, run: STARTED });

    for (const selector of ["input.field-max-pairs", "input.field-concurrency"]) {
      expect(control<HTMLInputElement>(el, selector).placeholder).toContain("blank");
    }
  });

  it("sends the pair limit it opened with, and omits it once the box is cleared", async () => {
    const { el, asked, press } = drawn({ ok: true, run: STARTED });

    await press();
    expect(asked[0]!.body).toEqual({
      game: "salient",
      a: "bot:random",
      b: "bot:random",
      maxPairs: "5",
      concurrency: "1",
    });

    set(el, "input.field-max-pairs", "");
    // Clearing the box is the case the ceilings block exists for: the page says
    // whose 75 it now means, and sends no pair limit at all.
    expect(ceilingItems(el)[0]).toBe("Pairs: 75 — the runner's default, the field is blank");

    await press();
    expect(asked[1]!.body).toEqual({ game: "salient", a: "bot:random", b: "bot:random", concurrency: "1" });
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

    // The form opens with a pair limit and a concurrency in the boxes, so the all
    // blank series is the one an operator made by clearing them — and the block
    // then says whose numbers those are.
    set(el, "input.field-max-pairs", "");
    set(el, "input.field-concurrency", "");

    expect(ceilingItems(el)).toEqual([
      "Pairs: 75 — the runner's default, the field is blank",
      "Pairs at once: 1 — the runner's default, the field is blank",
      "Cost ceiling: none — the runner's default, the field is blank",
      "Token ceiling: none — the runner's default, the field is blank",
      "Seed base: 0 — the runner's default, the field is blank",
    ]);
  });

  it("names what was typed instead, and stops calling it a default", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    set(el, "input.field-max-pairs", "3");
    set(el, "input.field-max-tokens", "900000");

    expect(ceilingItems(el)).toEqual([
      "Pairs: 3",
      "Pairs at once: 1",
      "Cost ceiling: none — the runner's default, the field is blank",
      "Token ceiling: 900000",
      "Seed base: 0 — the runner's default, the field is blank",
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
      "Matches: 2 — one pair, both seat orders",
      "Seed: 135",
      "Ceilings: none — a single match has no pair, cost or token limit",
    ]);
    // The series' limits are not a match's flags, and a field that is not sent
    // is not shown.
    expect(control<HTMLElement>(el, ".field-max-pairs-wrap").hidden).toBe(true);
    expect(control<HTMLElement>(el, ".field-seed-wrap").hidden).toBe(false);
    expect(control<HTMLElement>(el, ".start-measured").hidden).toBe(true);
  });
});

describe("the advanced block", () => {
  /** The disclosure itself, or the reason the page is not the page it should be. */
  const advancedOf = (el: HTMLElement): HTMLDetailsElement =>
    control<HTMLDetailsElement>(el, "details.advanced");

  it("starts closed, and opens on a click without leaving the page", () => {
    const { el } = drawn({ ok: true, run: STARTED });
    const advanced = advancedOf(el);
    const name = control<HTMLInputElement>(el, "input.field-name");
    name.value = "alpha";

    expect(advanced.open).toBe(false);

    control<HTMLElement>(el, "details.advanced > summary").click();

    // Opened, and still the same page: no reload, no navigation, and nothing that
    // was typed went with it — the form was not drawn again.
    expect(advanced.open).toBe(true);
    expect(el.querySelector("input.field-name")).toBe(name);
    expect(name.value).toBe("alpha");
    expect(el.querySelectorAll("button.start")).toHaveLength(1);
    expect(el.querySelectorAll("details.advanced")).toHaveLength(1);
  });

  it("holds the seed base and both ceilings, and leaves the first run's knobs in the open", () => {
    const { el } = drawn({ ok: true, run: STARTED });
    const advanced = advancedOf(el);

    for (const selector of ["input.field-seed-base", "input.field-max-cost", "input.field-max-tokens"]) {
      control<HTMLInputElement>(advanced, selector);
    }
    for (const selector of ["input.field-max-pairs", "input.field-concurrency", "input.field-name"]) {
      expect(advanced.querySelector(selector)).toBeNull();
    }

    // A match's seed is what that run is about, so it is not folded away either.
    set(el, "select.field-kind", "match");
    expect(advanced.querySelector("input.field-seed")).toBeNull();
    control<HTMLInputElement>(el, "input.field-seed");
  });

  it("names what is inside, in the page's own words, on the line that opens it", () => {
    const { el } = drawn({ ok: true, run: STARTED });
    const summary = control<HTMLElement>(el, "details.advanced > summary");
    const said = (summary.textContent ?? "").toLowerCase();

    for (const what of ["seed base", "cost ceiling", "token ceiling"]) {
      expect(said).toContain(what);
    }
    expect(said).not.toContain("--");
  });

  it("states how long a turn gets, in one line, and offers no box for it", () => {
    const { el } = drawn({ ok: true, run: STARTED });
    const advanced = advancedOf(el);
    const lines = [...advanced.querySelectorAll<HTMLElement>(".turn-timeout")];

    expect(lines).toHaveLength(1);
    const line = lines[0]!.textContent ?? "";
    expect(line).toMatch(/five minutes/);
    // The cap is the runner's and no flag reaches it, so there is no field for it:
    // a box would promise a change the console cannot make.
    expect(advanced.querySelectorAll("input.field-turn, input.field-turn-timeout")).toHaveLength(0);
    expect([...advanced.querySelectorAll<HTMLElement>(".field-label")].map((each) => each.textContent)).not.toContain(
      "Turn timeout",
    );
  });

  it("keeps the turn line for a match, whose own ceilings the block has none of", () => {
    const { el } = drawn({ ok: true, run: STARTED });
    const advanced = advancedOf(el);

    set(el, "select.field-kind", "match");

    // A turn gets five minutes whatever the command was, so the line stays; the
    // series' ceilings are not a match's flags and go back to hidden.
    expect(textOf(el, ".turn-timeout")).toMatch(/five minutes/);
    for (const selector of [".field-seed-base-wrap", ".field-max-cost-wrap", ".field-max-tokens-wrap"]) {
      expect(control<HTMLElement>(advanced, selector).hidden).toBe(true);
    }
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
        body: {
          game: "salient",
          a: "bot:random",
          b: "bot:random",
          maxPairs: "3",
          concurrency: "1",
          name: "alpha",
        },
      },
    ]);
    expect(started).toEqual([STARTED]);
    // The run is reported as what started. Where it writes is in the run's own
    // lines, and the reader who needs them can read them there.
    expect(textOf(el, ".start-started")).toBe("Started a series.");
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

describe("the words the start form speaks", () => {
  it("labels every field with what it is for, not with the flag it stands for", () => {
    const { el } = drawn({ ok: true, run: STARTED });

    expect([...el.querySelectorAll<HTMLElement>(".field-label")].map((each) => each.textContent ?? "")).toEqual([
      "Run",
      "Game",
      "Seat A",
      "Seat B",
      "Seed, for one match",
      "Pairs",
      "Pairs at once",
      "Series name",
      "Seed base",
      "Token ceiling",
      "Cost ceiling",
    ]);
  });

  it("draws the form, its ceilings and its answer in plain words", () => {
    // A series with every limit blank, which is the state a run gets started by
    // accident from: the block under the button is the page's own prose, and it
    // has to say 75 pairs without saying `--max-pairs`. The hints inside the
    // fields are checked too, since a hint is where a flag name goes back in.
    const { el } = drawn({ ok: true, run: STARTED });

    expectPlainWords("runs", wordsOf(el));
  });

  it("draws a match run's ceilings in plain words too", () => {
    const { el } = drawn({ ok: true, run: STARTED });
    set(el, "select.field-kind", "match");

    expectPlainWords("runs", wordsOf(el));
  });

  it("repeats the console's refusal as the console wrote it, flag and all", async () => {
    // The one line the page quotes rather than words. It names the field and the
    // value the console rejected, and whoever typed the form is the one who can
    // fix it — so the line is shown exactly as it came back.
    const { el, press } = drawn({ ok: false, error: NO_MODEL });
    set(el, "select.field-seat-a", "marvin");
    await press();

    expect(textOf(el, ".start-refused")).toBe(NO_MODEL);
  });
});
