/**
 * The page's side of the `/api/state` contract: what it accepts, and the line
 * it answers with when the console said something else. A half-written state has
 * to be refused rather than drawn, because a frame that shows `undefined`
 * in a seat picker is a frame someone starts a 48-hour run from.
 */
import { describe, expect, it } from "vitest";

import { parseState } from "./state.ts";

/** The answer a console that has just started gives. */
const STATE = {
  bots: ["bot:random", "bot:greedy"],
  providers: [{ name: "marvin", apiKeyEnv: null }],
  seriesRoot: "/repo/series",
  matchesRoot: "/repo/matches",
  running: null,
};

describe("parseState", () => {
  it("takes the state as the console answers it", () => {
    expect(parseState(STATE)).toEqual(STATE);
  });

  it("keeps a provider's key variable name, which is the only thing the page is told about a key", () => {
    const state = parseState({
      ...STATE,
      providers: [{ name: "openai", apiKeyEnv: "OPENAI_API_KEY" }],
    });
    expect(state.providers).toEqual([{ name: "openai", apiKeyEnv: "OPENAI_API_KEY" }]);
  });

  it("names the field when the answer is not an object at all", () => {
    expect(() => parseState(null)).toThrow("the answer from /api/state is not an object");
    expect(() => parseState("<!doctype html>")).toThrow("the answer from /api/state is not an object");
  });

  it("names the field that is missing or of the wrong shape", () => {
    expect(() => parseState({ ...STATE, bots: "bot:random" })).toThrow("bots is not a list of strings");
    expect(() => parseState({ ...STATE, bots: ["bot:random", 7] })).toThrow("bots is not a list of strings");
    expect(() => parseState({ ...STATE, seriesRoot: "" })).toThrow("seriesRoot is not a directory");
    expect(() => parseState({ ...STATE, matchesRoot: undefined })).toThrow("matchesRoot is not a directory");
    expect(() => parseState({ ...STATE, providers: {} })).toThrow("providers is not a list");
  });

  it("names which provider entry is wrong, so a registry edit is findable", () => {
    expect(() => parseState({ ...STATE, providers: [STATE.providers[0], { apiKeyEnv: null }] })).toThrow(
      "providers[1].name is not a provider name",
    );
    expect(() => parseState({ ...STATE, providers: [{ name: "marvin" }] })).toThrow(
      "providers[0].apiKeyEnv is neither a variable name nor null",
    );
  });

  it("reads a missing `running` as no run in flight", () => {
    const { running, ...without } = STATE;
    expect(running).toBeNull();
    expect(parseState(without).running).toBeNull();
  });
});
