/**
 * The provider registry: `providers.json` at the repo root, and what a seat is
 * given because of it.
 *
 * A model seat reaches its provider through the `models.json` written into its
 * own Pi home. Pi knows a handful of providers natively and looks their
 * credentials up in the operator's environment; anything else — Jim's Marvin
 * server above all — has to be named in that file, or the run stops at the
 * credential check before a turn is played. So the entry a real run plays on is
 * committed rather than written into whichever script happens to need it, and
 * these tests hold four things about it:
 *
 * - the file parses, and says what the milestone measured: Marvin's endpoint,
 *   its keyless-ness, and the `contextWindow` and `maxTokens` that were decided
 *   for it because `/v1/models` reports neither;
 * - a seat on a listed provider is given that provider's `models.json`, and a
 *   seat on one that is not listed is given nothing at all, which is what leaves
 *   Pi's built-in lookup — and an exported `ANTHROPIC_API_KEY` — in charge;
 * - no key is ever in the file: an entry names the environment variable a key
 *   is read from, and the seat's own `models.json` interpolates it, so the value
 *   exists only in the seat's environment;
 * - an entry can be added to a registry file and re-read in the same process, which
 *   is how the console seats its next run on a provider the operator just typed in.
 *
 * None of it needs a network, a credential or a live provider: the seat is read
 * back as the spec the runner is handed, not as a match it would play.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { seatSpec } from "./match.ts";
import {
  PROVIDERS_FILE,
  addProvider,
  loadProviders,
  modelsJsonFor,
  parseProviders,
  providerEntry,
  providerEntrySchema,
  providerRegistrySchema,
  reloadProviders,
  seatModelsJson,
} from "./providers.ts";
import type { ProviderEntry } from "./providers.ts";

/** A keyed provider of the shape a second pairing would add, with no real key. */
const ACME: ProviderEntry = {
  baseUrl: "https://acme.example.com/v1",
  api: "openai-completions",
  apiKeyEnv: "ACME_API_KEY",
  reasoning: false,
  contextWindow: 200_000,
  maxTokens: 4_096,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

/** One provider, spelled out, for `parseProviders` to accept or refuse. */
const acmeJson = (entry: unknown): unknown => ({ acme: entry });

/** The entry the committed file names, as a temp registry can start from it. */
const MARVIN: ProviderEntry = {
  baseUrl: "https://marvin.example.ts.net:8033/v1",
  api: "openai-completions",
  apiKeyEnv: null,
  reasoning: true,
  contextWindow: 131_072,
  maxTokens: 8_192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** A registry file to write into: one temp directory, one `providers.json` in it. */
const tempRegistry = (dir: string, registry: unknown): string => {
  const path = join(dir, "providers.json");
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return path;
};

/** Run `body` against a fresh temp registry, and clean the directory up after. */
const withTempRegistry = <T>(registry: unknown, body: (dir: string, path: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "no-dice-providers-write-"));
  try {
    return body(dir, tempRegistry(dir, registry));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("the committed provider registry", () => {
  it("names Marvin with the entry a real run plays on", () => {
    // The values milestone 03 checked against the server from this box. The two
    // sizes are decisions, not lookups: `/v1/models` reports no context length
    // and no output cap, and they are what the log header and `--max-cost` are
    // read against, so they belong in a committed file rather than in prose.
    expect(providerEntry("marvin")).toEqual({
      baseUrl: "https://marvin.akita-betelgeuse.ts.net:8033/v1",
      api: "openai-completions",
      apiKeyEnv: null,
      reasoning: true,
      contextWindow: 131_072,
      maxTokens: 8_192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("holds no key, only the name of the variable one would be read from", () => {
    const raw = readFileSync(PROVIDERS_FILE, "utf8");
    expect(raw).not.toMatch(/"apiKey"\s*:/);
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("reads an entry that names the variable its key comes from", () => {
    const registry = parseProviders(acmeJson(ACME), "providers.json");
    expect(registry.acme).toEqual(ACME);
  });

  it("treats an entry that names no variable as a keyless endpoint", () => {
    const registry = parseProviders(
      acmeJson({
        baseUrl: ACME.baseUrl,
        api: ACME.api,
        reasoning: ACME.reasoning,
        contextWindow: ACME.contextWindow,
        maxTokens: ACME.maxTokens,
        cost: ACME.cost,
      }),
      "providers.json",
    );
    expect(registry.acme?.apiKeyEnv).toBeNull();
  });

  it("refuses an entry with no endpoint, and names the provider and the field", () => {
    const registry = acmeJson({
      api: ACME.api,
      apiKeyEnv: ACME.apiKeyEnv,
      reasoning: ACME.reasoning,
      contextWindow: ACME.contextWindow,
      maxTokens: ACME.maxTokens,
      cost: ACME.cost,
    });
    expect(() => parseProviders(registry, "providers.json")).toThrow(
      /providers\.json.*acme.*baseUrl/s,
    );
  });

  it("refuses an entry that invents a field, so a typo cannot go unnoticed", () => {
    expect(() =>
      parseProviders(acmeJson({ ...ACME, contextwindow: 128_000 }), "providers.json"),
    ).toThrow(/providers\.json.*acme/s);
  });

  it("says there is no entry for a provider it does not name", () => {
    expect(providerEntry("anthropic")).toBeNull();
  });

  it("has no entry for a name that is only inherited off Object.prototype", () => {
    // A seat on `valueOf/x` is no seat at all, not an inherited member dressed up
    // as an entry and handed to a run as a `models.json`.
    for (const name of ["valueOf", "toString", "constructor"]) {
      expect(providerEntry(name)).toBeNull();
      expect(seatModelsJson(`${name}/m1`)).toBeNull();
    }
  });

  it("reads a registry from wherever it is kept, and refuses one that is malformed", () => {
    // The path is a parameter rather than a constant so a second checkout, or a
    // test, can point at its own file; the committed one is the default.
    const dir = mkdtempSync(join(tmpdir(), "no-dice-providers-"));
    try {
      const path = join(dir, "providers.json");
      writeFileSync(path, JSON.stringify({ acme: ACME }), "utf8");
      expect(loadProviders(path).acme).toEqual(ACME);

      writeFileSync(path, `{"acme": {"api": "openai-completions"}}`, "utf8");
      expect(() => loadProviders(path)).toThrow(/providers\.json.*acme.*baseUrl/s);

      expect(() => loadProviders(join(dir, "absent.json"))).toThrow(/not readable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the models.json a seat is given", () => {
  it("names the provider, its endpoint and the model's decided metadata", () => {
    expect(seatModelsJson("marvin/subagent")).toEqual({
      providers: {
        marvin: {
          baseUrl: "https://marvin.akita-betelgeuse.ts.net:8033/v1",
          api: "openai-completions",
          // Pi's documented pattern for an endpoint that checks no key.
          apiKey: "none",
          models: [
            {
              id: "subagent",
              name: "marvin/subagent",
              input: ["text"],
              contextWindow: 131_072,
              maxTokens: 8_192,
              reasoning: true,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    });
  });

  it("interpolates a keyed provider's key from the variable its entry names", () => {
    // The value is never here: Pi substitutes `$NAME` in a `models.json`
    // `apiKey` from the process's own environment, so the key is read when the
    // seat runs and is never written into a committed file or a match directory.
    const json = modelsJsonFor("acme/m1", ACME) as {
      providers: Record<string, { apiKey: string }>;
    };
    expect(json.providers.acme?.apiKey).toBe("${ACME_API_KEY}");
  });

  it("is nothing at all for a provider the registry does not name", () => {
    // `anthropic` is one of Pi's built-ins: no `models.json` is what leaves the
    // operator's exported `ANTHROPIC_API_KEY` in charge, exactly as before.
    expect(seatModelsJson("anthropic/claude-x")).toBeNull();
  });
});

describe("a seat the command line names", () => {
  it("is given its provider's models.json when the registry lists it", () => {
    expect(seatSpec({ kind: "model", provider: "marvin", model: "subagent" })).toEqual({
      kind: "pi",
      model: "marvin/subagent",
      thinking: "medium",
      modelsJson: {
        providers: {
          marvin: {
            baseUrl: "https://marvin.akita-betelgeuse.ts.net:8033/v1",
            api: "openai-completions",
            apiKey: "none",
            models: [
              {
                id: "subagent",
                name: "marvin/subagent",
                input: ["text"],
                contextWindow: 131_072,
                maxTokens: 8_192,
                reasoning: true,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
    });
  });

  it("is seated through Pi's built-in lookup when the registry does not list it", () => {
    const spec = seatSpec({ kind: "model", provider: "anthropic", model: "claude-x" });
    expect(spec).toEqual({ kind: "pi", model: "anthropic/claude-x", thinking: "medium" });
    // No key at all, rather than an empty one: writing a `models.json` for a
    // built-in provider would replace Pi's own lookup for that name.
    expect("modelsJson" in spec).toBe(false);
  });

  it("is a bot seat, registry or no registry", () => {
    expect(seatSpec({ kind: "bot", bot: "greedy" })).toEqual({ kind: "bot", bot: "greedy" });
  });
});

describe("adding a provider to the registry", () => {
  it("writes the entry into the file it was given, and leaves no half file beside it", () => {
    // The write is one `rename` of a temp file in the same directory over the
    // target, so the only registry another process can ever read is a whole one: a
    // file cut in half by a crash seats the next match on nothing.
    withTempRegistry({ marvin: MARVIN }, (dir, path) => {
      const saved = addProvider("acme", ACME, path);
      expect(saved.acme).toEqual(ACME);
      // What the caller is told is what the file says: the answer is re-read.
      expect(loadProviders(path)).toEqual(saved);
      expect(readdirSync(dir)).toEqual(["providers.json"]);
      // 2-space JSON with a trailing newline, so the registry stays a `git diff` a
      // person can read.
      expect(readFileSync(path, "utf8")).toBe(
        `${JSON.stringify({ marvin: MARVIN, acme: ACME }, null, 2)}\n`,
      );
    });
  });

  it("writes an entry that names no key variable as an explicitly keyless one", () => {
    const { apiKeyEnv: _apiKeyEnv, ...keyless } = ACME;
    withTempRegistry({ marvin: MARVIN }, (_dir, path) => {
      expect(addProvider("keyless", keyless, path).keyless?.apiKeyEnv).toBeNull();
      expect(readFileSync(path, "utf8")).toContain('"apiKeyEnv": null');
    });
  });

  it("refuses an entry carrying a key value, names the field, and leaves the file alone", () => {
    // The strict entry schema is what enforces "no key value anywhere" at the write,
    // rather than hoping the page never sends one.
    withTempRegistry({ marvin: MARVIN }, (dir, path) => {
      const before = readFileSync(path, "utf8");
      expect(() => addProvider("evil", { ...ACME, apiKey: "sk-not-a-secret" }, path)).toThrow(
        /apiKey/,
      );
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(readdirSync(dir)).toEqual(["providers.json"]);
    });
  });

  it("refuses an entry the schema refuses, naming the field that is wrong", () => {
    withTempRegistry({ marvin: MARVIN }, (_dir, path) => {
      const before = readFileSync(path, "utf8");
      expect(() => addProvider("acme", { ...ACME, baseUrl: "not a url" }, path)).toThrow(
        /baseUrl/,
      );
      expect(() => addProvider("acme", { ...ACME, contextWindow: 0 }, path)).toThrow(
        /contextWindow/,
      );
      expect(readFileSync(path, "utf8")).toBe(before);
    });
  });

  it("refuses a name the registry already has, rather than moving a seat under a run", () => {
    withTempRegistry({ marvin: MARVIN }, (_dir, path) => {
      const before = readFileSync(path, "utf8");
      expect(() => addProvider("marvin", ACME, path)).toThrow(/marvin/);
      expect(readFileSync(path, "utf8")).toBe(before);
    });
  });

  it("refuses a name that is not one path segment, which would break <provider>/<id>", () => {
    // `providerOf` splits on the first `/`, so a name carrying one — like `.` and
    // `..`, which are not names either — makes an entry no command line can address.
    for (const name of ["", ".", "..", "acme/m1", "a/b"]) {
      withTempRegistry({ marvin: MARVIN }, (_dir, path) => {
        const before = readFileSync(path, "utf8");
        expect(() => addProvider(name, ACME, path)).toThrow(/one path segment/);
        expect(readFileSync(path, "utf8")).toBe(before);
      });
    }
  });

  it('refuses "__proto__", the one name that would not survive the file it writes', () => {
    // Assigning that key sets a prototype rather than adding an entry, so the file
    // would carry an entry no reader could see — the opposite of the answer the
    // caller is given.
    withTempRegistry({ marvin: MARVIN }, (_dir, path) => {
      const before = readFileSync(path, "utf8");
      expect(() => addProvider("__proto__", ACME, path)).toThrow(/one path segment/);
      expect(readFileSync(path, "utf8")).toBe(before);
    });
  });

  it("refuses a file that names such a provider, rather than reading half of it", () => {
    withTempRegistry({ marvin: MARVIN }, (_dir, path) => {
      writeFileSync(
        path,
        `{"marvin": ${JSON.stringify(MARVIN)}, "__proto__": ${JSON.stringify(ACME)}}\n`,
        "utf8",
      );
      expect(() => loadProviders(path)).toThrow(/__proto__/);
    });
  });

  it("exports the schemas `parseProviders` parses with, so there is one field list", () => {
    // A page validates with these rather than with a copy of the fields: a second
    // list is a second rule, and the two drift.
    expect(providerEntrySchema.safeParse(ACME).success).toBe(true);
    expect(providerRegistrySchema.safeParse({ marvin: MARVIN, acme: ACME }).success).toBe(true);
    expect(
      providerRegistrySchema.safeParse({ acme: { ...ACME, apiKey: "sk-not-a-secret" } }).success,
    ).toBe(false);
    expect(Object.keys(providerEntrySchema.shape).sort()).toEqual([
      "api",
      "apiKeyEnv",
      "baseUrl",
      "contextWindow",
      "cost",
      "maxTokens",
      "reasoning",
    ]);
  });
});

describe("re-reading the registry in the same process", () => {
  // These reload the module's cache from a temp file, so they hand it back to the
  // committed registry when they are done.
  const withReloaded = (registry: unknown, body: (path: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "no-dice-providers-reload-"));
    try {
      const path = tempRegistry(dir, registry);
      reloadProviders(path);
      body(path);
    } finally {
      reloadProviders(PROVIDERS_FILE);
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("seats on an entry that was not in the file when the process started", () => {
    // The reload is the one deliberate exception to reading once: it is what lets a
    // provider added through the console be seated on without a restart.
    withReloaded({ marvin: MARVIN }, (path) => {
      expect(providerEntry("acme")).toBeNull();
      expect(seatModelsJson("acme/m1")).toBeNull();
      addProvider("acme", ACME, path);
      reloadProviders(path);
      expect(providerEntry("acme")).toEqual(ACME);
      expect(seatModelsJson("acme/m1")).toMatchObject({
        providers: { acme: { baseUrl: ACME.baseUrl, apiKey: "${ACME_API_KEY}" } },
      });
    });
  });

  it("seats on the registry a write handed back, rather than on a second reading of the file", () => {
    withReloaded({ marvin: MARVIN }, (path) => {
      const written = addProvider("acme", ACME, path);
      // The file moves under the process between the write and the reload. The
      // registry the write read back is what the process seats on, so a console
      // cannot answer with an entry the next run would not seat on — and one read
      // of the file cannot disagree with another.
      writeFileSync(path, `${JSON.stringify({ marvin: MARVIN }, null, 2)}\n`, "utf8");
      reloadProviders(written);
      expect(providerEntry("acme")).toEqual(ACME);
      expect(seatModelsJson("acme/m1")).toMatchObject({
        providers: { acme: { baseUrl: ACME.baseUrl, apiKey: "${ACME_API_KEY}" } },
      });
    });
  });

  it("keeps one pair's two matches on one window when nothing asked for a reload", () => {
    withReloaded({ marvin: MARVIN, acme: { ...ACME, contextWindow: 1_000 } }, (path) => {
      expect(providerEntry("acme")?.contextWindow).toBe(1_000);
      // The file moves under the process; the registry it seats on does not.
      writeFileSync(
        path,
        `${JSON.stringify({ marvin: MARVIN, acme: { ...ACME, contextWindow: 9_000 } }, null, 2)}\n`,
        "utf8",
      );
      expect(providerEntry("acme")?.contextWindow).toBe(1_000);
      expect(reloadProviders(path).acme?.contextWindow).toBe(9_000);
      expect(seatModelsJson("acme/m1")).toMatchObject({
        providers: {
          acme: {
            baseUrl: ACME.baseUrl,
            apiKey: "${ACME_API_KEY}",
            models: [{ id: "m1", contextWindow: 9_000 }],
          },
        },
      });
    });
  });
});
