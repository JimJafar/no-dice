/**
 * What the console says about itself: the seats out of the runner's own lists,
 * the providers out of the registry, and no key value anywhere in the answer.
 *
 * The seat lists are not restated here — `BOTS` and `providers.json` are the
 * authorities, and a test that pinned their contents would fail when someone
 * added a bot or an endpoint without telling the page. What is pinned is the
 * shape of the answer, and that it carries names only.
 */
import { describe, expect, it } from "vitest";

import { providerRegistry } from "@no-dice/runner/providers";
import type { ProviderRegistry } from "@no-dice/runner/providers";

import { botOptions, providerOptions, uiState } from "./state.ts";

const ROOTS = {
  seriesRoot: "/repo/series",
  matchesRoot: "/repo/matches",
  reportsRoot: "/repo/reports/series",
};

/**
 * A registry with an endpoint, a key variable and rates in it — the fields the
 * page has no use for, and the ones that would be a secret if the entry
 * named one.
 */
const REGISTRY: ProviderRegistry = {
  marvin: {
    baseUrl: "https://marvin.example.ts.net:8033/v1",
    api: "openai-completions",
    apiKeyEnv: "MARVIN_API_KEY",
    reasoning: true,
    contextWindow: 131072,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};

describe("botOptions", () => {
  it("names the baseline bots the way the command line and the form both name them", () => {
    expect(botOptions()).toEqual(["bot:random", "bot:greedy"]);
  });
});

describe("providerOptions", () => {
  it("carries a provider's name and its key variable name, and nothing else of its entry", () => {
    expect(providerOptions(REGISTRY)).toEqual([{ name: "marvin", apiKeyEnv: "MARVIN_API_KEY" }]);
  });

  it("says that an endpoint which checks no key checks none, rather than leaving it out", () => {
    expect(providerOptions({ marvin: { ...REGISTRY.marvin, apiKeyEnv: null } })).toEqual([
      { name: "marvin", apiKeyEnv: null },
    ]);
  });
});

describe("uiState", () => {
  it("answers the seats, the two roots as given, and no run in flight", () => {
    expect(uiState(ROOTS, REGISTRY)).toEqual({
      bots: ["bot:random", "bot:greedy"],
      providers: [{ name: "marvin", apiKeyEnv: "MARVIN_API_KEY" }],
      seriesRoot: "/repo/series",
      matchesRoot: "/repo/matches",
      running: null,
    });
    // The third root is not in the answer. A kept copy's URL follows from the
    // series' own directory name, and the `/reports/` route can say whether the
    // file is there; a page told the root would be a page guessing about a
    // directory it has not asked about.
    expect(JSON.stringify(uiState(ROOTS, REGISTRY))).not.toContain("reports");
  });

  it("sends no endpoint, no window, no rate and no key value in the bytes it answers with", () => {
    const json = JSON.stringify(uiState(ROOTS, REGISTRY));
    expect(json).not.toContain("marvin.example.ts.net");
    expect(json).not.toContain("baseUrl");
    expect(json).not.toContain("contextWindow");
    expect(json).not.toContain("maxTokens");
    // The variable's name is said; its value is never read here, let alone sent.
    const secret = process.env["MARVIN_API_KEY"];
    expect(secret === undefined || !json.includes(secret)).toBe(true);
  });

  it("names every provider the committed registry names, in the registry's order", () => {
    const state = uiState(ROOTS);
    expect(state.providers.map((each) => each.name)).toEqual(Object.keys(providerRegistry()));
    expect(state.providers.map((each) => each.name)).toContain("marvin");
  });
});
