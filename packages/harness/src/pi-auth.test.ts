/**
 * The credential check a run makes before a turn is played.
 *
 * brief §6.3 asks for it because a seat with no credential does not fail loudly:
 * every one of its turns settles with a provider error, the match plays, writes a
 * log, and reads as a model that passed 25 times rather than a run that never
 * started. So the run asks the pinned Pi, and the answer depends on which
 * `models.json` Pi is looking at — which is the whole of what these tests hold:
 *
 * - a provider named only in the `models.json` the seat is about to be given
 *   resolves, because the check is made against that file rather than against
 *   whatever config the operator's shell happens to have. This is what lets
 *   `no-dice series` seat a provider the repo's registry names: the command line
 *   asks before a match directory exists to write a seat home in, so the file has
 *   to be handed to the check directly;
 * - naming the provider is not the same as having a key: an entry whose key comes
 *   from a variable that is not in the environment is refused, with the provider
 *   named in the line the operator gets;
 * - a provider named nowhere is refused, which is what a built-in provider with
 *   no exported key looks like, and what a seat on it must be stopped for.
 *
 * `pi auth check` answers about configuration only — it opens no connection to
 * the endpoint — so these run the pinned CLI against a throwaway config
 * directory, with no credential anywhere on the machine and no network in play.
 */
import { describe, expect, it } from "vitest";

import { checkPiAuth } from "./pi-auth.ts";

/**
 * A provider name no operator's config is going to have configured, so "is it
 * found?" has one answer and it is the one this file is about.
 */
const PROVIDER = "nodicecheck";

/** The entry a seat would be given for that provider, with the key as Pi takes it. */
const modelsJsonFor = (apiKey: string): unknown => ({
  providers: {
    [PROVIDER]: {
      baseUrl: "http://127.0.0.1:1/v1",
      api: "openai-completions",
      apiKey,
      models: [
        {
          id: "m1",
          name: `${PROVIDER}/m1`,
          input: ["text"],
          contextWindow: 4_096,
          maxTokens: 256,
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  },
});

/** A variable this test does not set, spelled the way Pi substitutes it. */
const MISSING_VAR = "NODICECHECK_KEY_NOT_EXPORTED_IN_THIS_TEST";

describe("the credential check before a match is played", () => {
  it("finds a provider named only in the models.json the seat is about to be given", async () => {
    const auth = await checkPiAuth({
      model: `${PROVIDER}/m1`,
      modelsJson: modelsJsonFor("none"),
    });
    expect(auth.ok).toBe(true);
    expect(auth.provider).toBe(PROVIDER);
  }, 60_000);

  it("refuses the same provider when its entry names a key variable that is not set", async () => {
    // The registry holds the variable's name, not its value, so this is the
    // state a run is in when the operator has not exported the key.
    const auth = await checkPiAuth({
      model: `${PROVIDER}/m1`,
      modelsJson: modelsJsonFor(`\${${MISSING_VAR}}`),
    });
    expect(auth.ok).toBe(false);
    expect(auth.message).toContain(`"${PROVIDER}"`);
  }, 60_000);

  it("finds it when the key is in the environment the check is given", async () => {
    const auth = await checkPiAuth({
      model: `${PROVIDER}/m1`,
      modelsJson: modelsJsonFor(`\${${MISSING_VAR}}`),
      env: { [MISSING_VAR]: "a-key-that-is-not-a-key" },
    });
    expect(auth.ok).toBe(true);
  }, 60_000);

  it("refuses a provider named nowhere, which is a built-in provider with no key", async () => {
    const auth = await checkPiAuth({ model: `${PROVIDER}/m1` });
    expect(auth.ok).toBe(false);
    expect(auth.message).toContain(`"${PROVIDER}"`);
  }, 60_000);
});
