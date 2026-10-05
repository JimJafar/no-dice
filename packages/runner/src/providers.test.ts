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
 * these tests hold three things about it:
 *
 * - the file parses, and says what the milestone measured: Marvin's endpoint,
 *   its keyless-ness, and the `contextWindow` and `maxTokens` that were decided
 *   for it because `/v1/models` reports neither;
 * - a seat on a listed provider is given that provider's `models.json`, and a
 *   seat on one that is not listed is given nothing at all, which is what leaves
 *   Pi's built-in lookup — and an exported `ANTHROPIC_API_KEY` — in charge;
 * - no key is ever in the file: an entry names the environment variable a key
 *   is read from, and the seat's own `models.json` interpolates it, so the value
 *   exists only in the seat's environment.
 *
 * None of it needs a network, a credential or a live provider: the seat is read
 * back as the spec the runner is handed, not as a match it would play.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { seatSpec } from "./match.ts";
import {
  PROVIDERS_FILE,
  loadProviders,
  modelsJsonFor,
  parseProviders,
  providerEntry,
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
