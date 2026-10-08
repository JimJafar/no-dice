// @vitest-environment happy-dom
/**
 * The Providers section, on the page: the shape the page accepts from
 * `/api/providers`, `/api/providers/check` and `/api/models`, the body it posts
 * to add an entry, and what it draws from all of them.
 *
 * What the registry itself allows is the runner's rule and
 * `packages/runner/src/providers.test.ts` owns it; what the console answers is
 * `packages/ui/src/providers.test.ts`'s. This file asks only that the page draws
 * whatever those answers say, sends the body the routes take, and shows the
 * server's own line when it refuses — including the two things the page must
 * never do, which are hold a key value in a field and decide for itself that an
 * entry is valid. It also checks the words the section speaks: no flag name and
 * no path into the machine, because a reader here is naming an endpoint, not
 * typing a command.
 */
import { describe, expect, it } from "vitest";

import { expectPlainWords, wordsOf } from "./plain-words.ts";
import {
  addProvider,
  checkCredential,
  fetchModels,
  fetchProviders,
  modelOf,
  parseAuth,
  parseModelRows,
  parseProviderRows,
  providerBodyOf,
} from "./providers.ts";
import type { AddOutcome, AddValues, CheckOutcome } from "./providers.ts";
import { renderProviders } from "./render-providers.ts";
import type { ProvidersViewOptions } from "./render-providers.ts";
import type { ProviderRow } from "./providers.ts";

/** A keyless entry, as `GET /api/providers` answers it. */
const MARVIN = {
  name: "marvin",
  baseUrl: "https://marvin.example.ts.net:8033/v1",
  api: "openai-completions",
  apiKeyEnv: null,
  reasoning: true,
  contextWindow: 131072,
  maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** An entry whose key is read from a variable, and whose rates are not all zero. */
const OPENAI = {
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  api: "openai-responses",
  apiKeyEnv: "OPENAI_API_KEY",
  reasoning: false,
  contextWindow: 200000,
  maxTokens: 16000,
  cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 3.75 },
};

/** What Pi said about a credential that resolves. */
const READY = { ok: true, provider: "openai", reason: null, message: "credential resolves" };

/** A model the pinned Pi knows and this console has a key for, as `/api/models` answers it. */
const FLASH = {
  provider: "deepseek",
  id: "deepseek-flash",
  reference: "deepseek/deepseek-flash",
  context: "1M",
  maxOut: "384K",
  thinking: "yes",
  images: "yes",
};

/** What Pi said about one that does not. */
const MISSING = {
  ok: false,
  provider: "openai",
  reason: "missing_environment_variable",
  message: "OPENAI_API_KEY is not set in this environment",
};

/** The add form, as an operator filled it: a variable name, not a value. */
const VALUES: AddValues = {
  name: "  new-co  ",
  baseUrl: " https://new.example.ts.net:9/v1 ",
  api: " openai-completions ",
  apiKeyEnv: "   ",
  reasoning: true,
  contextWindow: "131072",
  maxTokens: "8192",
  costInput: "0",
  costOutput: "2.5",
  costCacheRead: "",
  costCacheWrite: "0",
};

/** A section, as `index.html` has one. */
const section = (): HTMLElement => {
  const el = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = "Providers";
  el.append(heading);
  document.body.append(el);
  return el;
};

/** Every item the section lists, under one class. */
const itemsOf = (el: HTMLElement, listClass: string): string[] =>
  [...el.querySelectorAll<HTMLElement>(`.${listClass} > li`)].map((li) => li.textContent ?? "");

/** The section, drawn with callbacks a test does not have to drive. */
const view = (rows: readonly ProviderRow[]): ProvidersViewOptions => ({
  rows,
  onAdd: (): Promise<AddOutcome> => Promise.resolve({ ok: true }),
  onCheck: (): Promise<CheckOutcome> => Promise.resolve({ ok: true, auth: READY }),
  onAdded: () => undefined,
});

/** Draw the section with a view whose callbacks the test can drive. */
const withView = (options: ProvidersViewOptions): HTMLElement => {
  const el = section();
  renderProviders(el, options);
  return el;
};

/** Draw the section and read it back as text. */
const drawn = (rows: readonly ProviderRow[]): { el: HTMLElement; text: string } => {
  const el = withView(view(rows));
  return { el, text: el.textContent ?? "" };
};

/** Let every promise the click started settle. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("parseProviderRows", () => {
  it("keeps every field of every entry, in the registry's own order", () => {
    expect(parseProviderRows([MARVIN, OPENAI])).toEqual([MARVIN, OPENAI]);
  });

  it("keeps a keyless entry as checking no key, rather than as missing a field", () => {
    expect(parseProviderRows([MARVIN])[0]!.apiKeyEnv).toBeNull();
  });

  it("names the field when the answer is missing one, rather than drawing undefined", () => {
    const { maxTokens, ...withoutCap } = MARVIN;
    expect(maxTokens).toBeTypeOf("number");
    expect(() => parseProviderRows([withoutCap])).toThrow("providers[0].maxTokens is not a number");
    const { cacheRead, ...cost } = MARVIN.cost;
    expect(cacheRead).toBeTypeOf("number");
    const withoutRate = [{ ...MARVIN, cost }];
    expect(() => parseProviderRows(withoutRate)).toThrow("providers[0].cost.cacheRead is not a number");
    expect(() => parseProviderRows({ providers: [MARVIN] })).toThrow(
      "the answer from /api/providers is not a list",
    );
  });
});

describe("fetchProviders", () => {
  it("reads the registry from /api/providers", async () => {
    const asked: string[] = [];
    const rows = await fetchProviders((path) => {
      asked.push(path);
      return Promise.resolve(Response.json([MARVIN, OPENAI]));
    });

    expect(asked).toEqual(["/api/providers"]);
    expect(rows).toEqual([MARVIN, OPENAI]);
  });

  it("fails with the console's own line when the registry cannot be read", async () => {
    const refuses = (): Promise<Response> =>
      Promise.resolve(Response.json({ error: "providers.json is not JSON" }, { status: 500 }));

    await expect(fetchProviders(refuses)).rejects.toThrow("providers.json is not JSON");
  });
});

describe("the model list the page reads", () => {
  it("keeps the reference and Pi's four figures, which is all a seat needs", () => {
    // The provider and the model id arrive as separate fields and are not kept:
    // the reference is the string a seat is seated with, and the only one the
    // estimate's figures are looked up by.
    expect(parseModelRows({ models: [FLASH] })).toEqual([
      { reference: "deepseek/deepseek-flash", context: "1M", maxOut: "384K", thinking: "yes", images: "yes" },
    ]);
  });

  it("names the field when a row is missing one, rather than drawing undefined", () => {
    const { maxOut, ...withoutCap } = FLASH;
    expect(maxOut).toBeTypeOf("string");
    expect(() => parseModelRows({ models: [withoutCap] })).toThrow("models[0].maxOut is not a string");
    expect(() => parseModelRows([FLASH])).toThrow("the answer from /api/models is not an object");
    expect(() => parseModelRows({ models: FLASH })).toThrow("models is not a list");
  });

  it("reads the list from /api/models, in Pi's own order", async () => {
    const asked: string[] = [];
    const rows = await fetchModels((path) => {
      asked.push(path);
      return Promise.resolve(Response.json({ models: [FLASH] }));
    });

    expect(asked).toEqual(["/api/models"]);
    expect(rows.map((row) => row.reference)).toEqual(["deepseek/deepseek-flash"]);
  });

  it("fails with the console's line when Pi did not answer, rather than answering no models", async () => {
    // An empty list tells the operator that no key is set. A Pi that failed to
    // answer is the opposite fact, and it has to arrive as an error.
    const refuses = (): Promise<Response> =>
      Promise.resolve(Response.json({ error: "the pinned Pi's --list-models exited 1" }, { status: 500 }));

    await expect(fetchModels(refuses)).rejects.toThrow("--list-models exited 1");
  });

  it("answers no rows when this console was started with no key", async () => {
    const rows = await fetchModels(() => Promise.resolve(Response.json({ models: [] })));

    expect(rows).toEqual([]);
  });
});

describe("providerBodyOf", () => {
  it("sends the name and the entry the routes take, with the numbers as numbers", () => {
    expect(providerBodyOf(VALUES)).toEqual({
      name: "new-co",
      entry: {
        baseUrl: "https://new.example.ts.net:9/v1",
        api: "openai-completions",
        apiKeyEnv: null,
        reasoning: true,
        contextWindow: 131072,
        maxTokens: 8192,
        cost: { input: 0, output: 2.5, cacheWrite: 0 },
      },
    });
  });

  it("sends the key variable's name, and null when the box is blank", () => {
    expect(providerBodyOf({ ...VALUES, apiKeyEnv: " OPENAI_API_KEY " }).entry["apiKeyEnv"]).toBe(
      "OPENAI_API_KEY",
    );
    expect(providerBodyOf({ ...VALUES, apiKeyEnv: "" }).entry["apiKeyEnv"]).toBeNull();
  });

  it("leaves a blank number out of the body, so the server's required line names it", () => {
    const entry = providerBodyOf({ ...VALUES, contextWindow: "  ", costOutput: "" }).entry;
    expect("contextWindow" in entry).toBe(false);
    expect("cacheRead" in entry).toBe(false);
    expect("output" in (entry["cost"] as object)).toBe(false);
  });

  it("sends a box that does not hold a number as the text it holds, so the server's line names that", () => {
    const entry = providerBodyOf({ ...VALUES, maxTokens: "8k" }).entry;
    expect(entry["maxTokens"]).toBe("8k");
  });
});

describe("addProvider", () => {
  it("posts the form's entry to /api/providers and reports that the console took it", async () => {
    const posted: { path: string; body: unknown }[] = [];
    const answer = await addProvider(VALUES, (path, init) => {
      posted.push({ path, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(Response.json([MARVIN]));
    });

    expect(posted).toEqual([{ path: "/api/providers", body: providerBodyOf(VALUES) }]);
    expect(answer).toEqual({ ok: true });
  });

  it("hands back the server's own line when it refuses, and adds nothing", async () => {
    // The registry's line for a name it already has: the page does not check the
    // name first, because the file is the one that knows what it holds.
    const line =
      'the provider registry already names "marvin": it is refused rather than ' +
      "overwritten, because a run seated on it would change terms";
    const answer = await addProvider({ ...VALUES, name: "marvin" }, () =>
      Promise.resolve(Response.json({ error: line }, { status: 400 })),
    );

    expect(answer).toEqual({ ok: false, error: line });
  });

  it("hands back zod's line verbatim when the entry is not one", async () => {
    const line = '"new-co" is not a provider entry: cost.input: Invalid input: expected number, required';
    const answer = await addProvider(VALUES, () =>
      Promise.resolve(Response.json({ error: line }, { status: 400 })),
    );

    expect(answer).toEqual({ ok: false, error: line });
  });
});

describe("modelOf", () => {
  it("makes the model the way --a takes it, and leaves a blank id blank", () => {
    expect(modelOf("marvin", "subagent")).toBe("marvin/subagent");
    expect(modelOf("marvin", "  ")).toBe("marvin/");
  });
});

describe("parseAuth", () => {
  it("keeps what Pi said, including a reason it did not give", () => {
    expect(parseAuth(READY)).toEqual(READY);
    expect(parseAuth(MISSING)).toEqual(MISSING);
  });

  it("names the field when the answer is missing one", () => {
    const { message, ...withoutMessage } = MISSING;
    expect(message).toBeTypeOf("string");
    expect(() => parseAuth(withoutMessage)).toThrow("message is not a string");
    expect(() => parseAuth("not ready")).toThrow("the answer from /api/providers/check is not an object");
  });
});

describe("checkCredential", () => {
  it("asks /api/providers/check about the whole model reference", async () => {
    const posted: { path: string; body: unknown }[] = [];
    const answer = await checkCredential("openai/gpt-4", (path, init) => {
      posted.push({ path, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(Response.json(MISSING));
    });

    expect(posted).toEqual([{ path: "/api/providers/check", body: { model: "openai/gpt-4" } }]);
    expect(answer).toEqual({ ok: true, auth: MISSING });
  });

  it("hands back the console's line for a check it would not make", async () => {
    const line = 'a Pi seat\'s model is "<provider>/<id>", not "openai"';
    const answer = await checkCredential("openai", () =>
      Promise.resolve(Response.json({ error: line }, { status: 400 })),
    );

    expect(answer).toEqual({ ok: false, error: line });
  });
});

describe("renderProviders", () => {
  it("draws every field of every entry, in the registry's own order", () => {
    const { el, text } = drawn([MARVIN, OPENAI]);

    expect(itemsOf(el, "providers")).toHaveLength(2);
    expect(text).toContain("marvin");
    expect(text).toContain(MARVIN.baseUrl);
    expect(text).toContain("(openai-completions)");
    expect(text).toContain("no key checked");
    expect(text).toContain("streams reasoning");
    expect(text).toContain("context window 131072");
    expect(text).toContain("max output 8192");
    expect(text).toContain("input 0, output 0, cache read 0, cache write 0");

    expect(text).toContain("openai");
    expect(text).toContain(OPENAI.baseUrl);
    // The variable's name, which is the fact; what is in it is not on the page.
    expect(text).toContain("key from OPENAI_API_KEY");
    expect(text).toContain("no reasoning");
    expect(text).toContain("context window 200000");
    expect(text).toContain("max output 16000");
    expect(text).toContain("input 2.5, output 10, cache read 1.25, cache write 3.75");
  });

  it("asks for a key variable's name and never for a value", () => {
    const { el, text } = drawn([MARVIN]);
    const inputs = [...el.querySelectorAll<HTMLInputElement>("input")];

    // A password box on this page would be a box for something the registry
    // cannot hold and the console would refuse anyway.
    expect(inputs.some((input) => input.type === "password")).toBe(false);
    const keyField = el.querySelector<HTMLElement>(".field-api-key-env-wrap");
    expect(keyField?.textContent).toContain("Key variable");
    expect(el.querySelector<HTMLInputElement>(".field-api-key-env")?.placeholder).toContain("variable name");
    expect(text).toContain("no key value is ever typed here");
  });

  it("says when the registry names no provider, rather than drawing an empty list", () => {
    const { el, text } = drawn([]);

    expect(el.querySelector(".providers")).toBeNull();
    expect(text).toContain("The registry names no provider yet.");
  });

  it("says what a name is for, rather than which command takes it", () => {
    const { el } = drawn([MARVIN]);
    const name = el.querySelector<HTMLInputElement>(".field-provider-name")!;

    // The hint has to say how the name is used — it is the part of a seat before
    // the slash — without reaching for the flag that carries it.
    expect(name.placeholder).toContain("marvin/subagent");
    expect(name.placeholder).not.toContain("--");
  });

  it("asks the credential check per row, sending <provider>/<id> and rendering what Pi said", async () => {
    const asked: string[] = [];
    const el = withView({
      rows: [MARVIN, OPENAI],
      onAdd: () => Promise.resolve({ ok: true }),
      onCheck: (model): Promise<CheckOutcome> => {
        asked.push(model);
        return Promise.resolve({ ok: true, auth: MISSING });
      },
      onAdded: () => undefined,
    });

    const rows = [...el.querySelectorAll<HTMLElement>("li.provider-row")];
    expect(rows.map((row) => row.dataset["provider"])).toEqual(["marvin", "openai"]);

    const model = rows[1]!.querySelector<HTMLInputElement>(".field-model-id")!;
    model.value = "gpt-4";
    rows[1]!.querySelector<HTMLButtonElement>("button.check")!.click();
    await settled();

    // The same reference `--a openai/gpt-4` would take, and the same
    // question `no-dice series` asks before it plays a turn.
    expect(asked).toEqual(["openai/gpt-4"]);
    const outcome = rows[1]!.querySelector<HTMLElement>(".check-outcome")!;
    expect(outcome.textContent).toContain("openai/gpt-4");
    expect(outcome.textContent).toContain("not ready");
    expect(outcome.textContent).toContain("missing_environment_variable");
    expect(outcome.textContent).toContain("OPENAI_API_KEY is not set in this environment");
    // The other row keeps its own empty line: a check asked of one provider is
    // not an answer about another.
    expect(rows[0]!.querySelector<HTMLElement>(".check-outcome")!.textContent).toBe("");
  });

  it("renders a ready check without inventing a reason Pi did not give", async () => {
    const el = withView({
      rows: [OPENAI],
      onAdd: () => Promise.resolve({ ok: true }),
      onCheck: () => Promise.resolve({ ok: true, auth: READY }),
      onAdded: () => undefined,
    });

    el.querySelector<HTMLButtonElement>("button.check")!.click();
    await settled();

    const outcome = el.querySelector<HTMLElement>(".check-outcome")!;
    expect(outcome.textContent).toBe("openai/ — ready: credential resolves");
    expect(outcome.textContent).not.toContain("null");
  });

  it("renders a check Pi answered with neither a reason nor a message", async () => {
    const el = withView({
      rows: [MARVIN],
      onAdd: () => Promise.resolve({ ok: true }),
      onCheck: (): Promise<CheckOutcome> =>
        Promise.resolve({ ok: true, auth: { ok: true, provider: "marvin", reason: null, message: "" } }),
      onAdded: () => undefined,
    });

    el.querySelector<HTMLInputElement>(".field-model-id")!.value = "subagent";
    el.querySelector<HTMLButtonElement>("button.check")!.click();
    await settled();

    // Pi's real answer for a keyless endpoint is `ok` with nothing else to say.
    // Drawing the absences would put `null` on the page for a check that passed.
    expect(el.querySelector<HTMLElement>(".check-outcome")!.textContent).toBe("marvin/subagent — ready");
  });

  it("shows the console's own line for a check it refused to make", async () => {
    const line = 'a Pi seat\'s model is "<provider>/<id>", not "openai"';
    const el = withView({
      rows: [OPENAI],
      onAdd: () => Promise.resolve({ ok: true }),
      onCheck: (): Promise<CheckOutcome> => Promise.resolve({ ok: false, error: line }),
      onAdded: () => undefined,
    });

    el.querySelector<HTMLInputElement>(".field-model-id")!.value = "gpt-4";
    el.querySelector<HTMLButtonElement>("button.check")!.click();
    await settled();

    const outcome = el.querySelector<HTMLElement>(".check-outcome")!;
    expect(outcome.textContent).toContain(line);
    expect(outcome.className).toContain("bad");
  });

  it("posts what the add form holds and asks for the list to be read again when the console took it", async () => {
    const given: AddValues[] = [];
    const added: string[] = [];
    const el = withView({
      rows: [MARVIN],
      onAdd: (values): Promise<AddOutcome> => {
        given.push(values);
        return Promise.resolve({ ok: true });
      },
      onCheck: () => Promise.resolve({ ok: true, auth: READY }),
      onAdded: (name): void => {
        added.push(name);
      },
    });

    const fill = (className: string, value: string): void => {
      const input = el.querySelector<HTMLInputElement>(`.${className}`);
      expect(input).not.toBeNull();
      input!.value = value;
    };
    fill("field-provider-name", " new-co ");
    fill("field-base-url", "https://new.example.ts.net:9/v1");
    fill("field-api", "openai-completions");
    fill("field-api-key-env", "");
    fill("field-context-window", "131072");
    fill("field-max-tokens", "8192");
    fill("field-cost-input", "0");
    fill("field-cost-output", "2.5");
    fill("field-cost-cache-read", "");
    fill("field-cost-cache-write", "0");
    el.querySelector<HTMLInputElement>(".field-reasoning")!.checked = true;

    el.querySelector<HTMLButtonElement>("button.add-provider")!.click();
    await settled();

    expect(given).toHaveLength(1);
    expect(providerBodyOf(given[0]!)).toEqual(providerBodyOf(VALUES));
    // The list is re-read rather than appended to: the file is what the next run
    // seats on, and its account of itself is the one the page should show.
    expect(added).toEqual(["new-co"]);
  });

  it("shows the server's own line for an entry it refused, and adds nothing", async () => {
    const line =
      'the provider registry already names "marvin": it is refused rather than ' +
      "overwritten, because a run seated on it would change terms";
    const added: string[] = [];
    const el = withView({
      rows: [MARVIN],
      onAdd: (): Promise<AddOutcome> => Promise.resolve({ ok: false, error: line }),
      onCheck: () => Promise.resolve({ ok: true, auth: READY }),
      onAdded: (name): void => {
        added.push(name);
      },
    });

    el.querySelector<HTMLInputElement>(".field-provider-name")!.value = "marvin";
    el.querySelector<HTMLButtonElement>("button.add-provider")!.click();
    await settled();

    const outcome = el.querySelector<HTMLElement>(".add-outcome")!;
    // Verbatim, and nothing the page added to it: the name is the registry's to
    // refuse, and the entry it refused is still not in the file.
    expect(outcome.textContent).toBe(line);
    expect(outcome.className).toContain("bad");
    expect(added).toEqual([]);
    expect(itemsOf(el, "providers")).toHaveLength(1);
  });

  it("replaces the whole section, so an entry that went away does not stay on the page", () => {
    const el = withView(view([MARVIN, OPENAI]));
    renderProviders(el, view([]));

    expect(itemsOf(el, "providers")).toEqual([]);
    expect(el.querySelectorAll("button.check")).toHaveLength(0);
    expect(el.querySelectorAll("h2")).toHaveLength(1);
  });
});

describe("the words the providers section speaks", () => {
  it("lists the entries and the add form in plain words", () => {
    // The base URL is drawn, and it is the one address on this page that is the
    // fact rather than the furniture: it is what the entry is, and what a run is
    // seated on. Nothing else here names a path or a flag — including the hints
    // inside the fields, which is where a flag name creeps back in first.
    const { el } = drawn([MARVIN, OPENAI]);

    expectPlainWords("providers", wordsOf(el));
  });

  it("lists an empty registry and its add form in plain words", () => {
    const { el } = drawn([]);

    expectPlainWords("providers", wordsOf(el));
  });
});
