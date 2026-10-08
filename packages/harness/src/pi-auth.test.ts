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
 *   no exported key looks like, and what a seat on it must be stopped for;
 * - **the question is asked in a fresh config directory, and never in one the
 *   caller names.** With no `models.json` handed to it the directory is empty,
 *   because that is what `createSeatHome` gives every seat: the operator's own
 *   `~/.pi/agent`, whose `auth.json` can hold an OAuth login no seat will ever
 *   read, is kept out — a `ready` from that login is a promise the run it just
 *   encouraged cannot keep. An exported key is still found, because the
 *   environment is inherited.
 *
 * `pi auth check` answers about configuration only — it opens no connection to
 * the endpoint — so these run the pinned CLI against a throwaway config
 * directory, with no credential anywhere on the machine and no network in play.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { piCli } from "./pi-cli.ts";
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

/**
 * A provider named only in a config directory somebody hands to the call — the
 * shape of the leak that is: an operator's own `~/.pi/agent` can name a
 * provider, and no seat this repo starts ever reads that directory.
 */
const GHOST = "ndghosthome";

/** A `models.json` naming that provider, as an operator's config would hold it. */
const ghostModelsJson = {
  providers: {
    [GHOST]: {
      baseUrl: "https://x.invalid/v1",
      api: "openai-completions",
      apiKey: "none",
      models: [
        {
          id: "ghost",
          name: "ghost",
          input: ["text"],
          contextWindow: 1000,
          maxTokens: 100,
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  },
};

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

  it("keeps a config directory the caller names out of the question, because no seat reads one", async () => {
    const home = mkdtempSync(join(tmpdir(), "no-dice-operator-home-"));
    writeFileSync(join(home, "models.json"), `${JSON.stringify(ghostModelsJson)}\n`, "utf-8");
    try {
      // Asked with that directory as its config, the pinned build really does find
      // the file's provider. This is the leak the fresh directory is for.
      const leaked = execFileSync(
        process.execPath,
        [piCli().path, "auth", "check", "--provider", GHOST, "--json"],
        { env: { PI_CODING_AGENT_DIR: home }, encoding: "utf-8" },
      );
      expect(leaked).toContain('"status":"ready"');

      // The check names a directory of its own instead, so a provider only the
      // caller's config names is refused — which is the state a seat on it is in.
      const auth = await checkPiAuth({ model: `${GHOST}/ghost`, env: { PI_CODING_AGENT_DIR: home } });
      expect(auth.ok).toBe(false);
      expect(auth.message).toContain(`"${GHOST}"`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it("finds a built-in provider's exported key with an empty config directory", async () => {
    // The state a seat on a provider Pi knows natively is in: no `models.json`
    // anywhere, the key in the environment it is about to be given, and the
    // operator's own config kept out of the question.
    const auth = await checkPiAuth({
      model: "deepseek/deepseek-flash",
      env: { DEEPSEEK_API_KEY: "a-key-that-is-not-a-key" },
    });
    expect(auth.ok).toBe(true);
    expect(auth.provider).toBe("deepseek");
  }, 60_000);
});
