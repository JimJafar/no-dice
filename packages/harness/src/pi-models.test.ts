/**
 * The model list a seat on a provider Pi knows natively is chosen from.
 *
 * A seat on a provider the console registered needs a `models.json` entry,
 * because Pi has never heard of that provider. A seat on a provider Pi knows
 * natively needs nothing but the key in the environment, so the console cannot
 * list those models off its own registry — it has to ask Pi. What it has to get
 * back is the list a seat could actually be seated on, which is why these tests
 * are mostly about the config directory the question is asked with:
 *
 * - pointed at a directory holding a `models.json`, the pinned build lists that
 *   file's models too — one entry named `ghost` answers a row for `evil/ghost` —
 *   and no seat could ever play that model, because `createSeatHome` relocates
 *   `PI_CODING_AGENT_DIR` to an empty directory for every seat. The call points
 *   the variable at a fresh empty directory of its own and never takes one from
 *   the caller, which is what makes the answer be Pi's built-in catalogue
 *   filtered to the keys that are set;
 * - the directory is gone once Pi has answered, so a run leaves nothing behind;
 * - the table is read, not guessed: the empty sentence is an empty list, and a
 *   first line that is neither the header nor that sentence is an error, because
 *   an empty list would tell the operator that no key is set when the truth is
 *   that the question could not be read.
 *
 * The tests that ask the pinned build start a real `node` process, so they carry
 * a timeout of their own like the other Pi test files do. None of them needs a
 * real credential: Pi lists a provider's models when its key variable is set at
 * all, and never opens a connection to the endpoint.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { piCli } from "./pi-cli.ts";
import { listPiModels, parsePiModelTable } from "./pi-models.ts";

/** How long a test that starts the pinned Pi may take. */
const PI_TIMEOUT_MS = 60_000;

/** A key that is not a key: Pi lists a provider when its variable is set at all. */
const DUMMY_KEY = "a-key-that-is-not-a-key";

/** The prefix `listPiModels` makes its throwaway config directory with. */
const HOME_PREFIX = "no-dice-models-";

/** The table the pinned build prints for a deepseek key, padded as it prints it. */
const TABLE = [
  "provider  model            context  max-out  thinking  images",
  "deepseek  deepseek-flash   1M       384K     yes       yes",
  "deepseek  deepseek-v4-pro  1M       384K     yes       no",
].join("\n");

/** A `models.json` naming one model, `evil/ghost`, that no seat could reach. */
const ghostModelsJson = {
  providers: {
    evil: {
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

describe("the models the pinned Pi knows natively and has a key for", () => {
  it(
    "lists the deepseek models for a DEEPSEEK_API_KEY of any value, as Pi printed them",
    async () => {
      const models = await listPiModels({ env: { DEEPSEEK_API_KEY: DUMMY_KEY } });

      expect(models.map((model) => model.reference)).toContain("deepseek/deepseek-flash");
      expect(models.map((model) => model.reference)).toContain("deepseek/deepseek-v4-pro");
      // The six printed columns land in the six fields, with Pi's own rounded
      // figures kept as the strings they were printed as.
      expect(models.find((model) => model.reference === "deepseek/deepseek-flash")).toEqual({
        provider: "deepseek",
        id: "deepseek-flash",
        reference: "deepseek/deepseek-flash",
        context: "1M",
        maxOut: "384K",
        thinking: "yes",
        images: "yes",
      });
    },
    PI_TIMEOUT_MS,
  );

  it("answers nothing at all when the environment holds no key", async () => {
    // `env` replaces this process's environment rather than merging over it, so
    // this is an environment with literally nothing in it — the state of a
    // console started with no key exported.
    expect(await listPiModels({ env: {} })).toEqual([]);
  }, PI_TIMEOUT_MS);

  it(
    "keeps a caller's PI_CODING_AGENT_DIR out of the question, because a seat never gets one",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "no-dice-ghost-home-"));
      writeFileSync(join(home, "models.json"), `${JSON.stringify(ghostModelsJson)}\n`, "utf-8");
      try {
        // Asked with that directory as its config, the pinned build really does
        // list the file's model. This is the leak the empty directory is for.
        const leaked = execFileSync(process.execPath, [piCli().path, "--list-models"], {
          env: { PI_CODING_AGENT_DIR: home },
          encoding: "utf-8",
        });
        expect(leaked).toContain("ghost");

        // The call names its own directory instead, so the model no seat can
        // play is not on the list — while the rest of the answer still works.
        const models = await listPiModels({
          env: { DEEPSEEK_API_KEY: DUMMY_KEY, PI_CODING_AGENT_DIR: home },
        });
        const references = models.map((model) => model.reference);
        expect(references).toContain("deepseek/deepseek-flash");
        expect(references).not.toContain("evil/ghost");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    PI_TIMEOUT_MS,
  );

  it(
    "throws away the config directory it asked with",
    async () => {
      // The directory's name is the call's own, so what is observable is that it
      // leaves none behind: every `no-dice-models-*` that exists afterwards was
      // already there beforehand.
      const before = new Set(readdirSync(tmpdir()));
      await listPiModels({ env: {} });
      const left = readdirSync(tmpdir()).filter(
        (name) => name.startsWith(HOME_PREFIX) && !before.has(name),
      );
      expect(left).toEqual([]);
    },
    PI_TIMEOUT_MS,
  );

  it("reports what the pinned build wrote to stderr when it does not answer", async () => {
    // A child that fails to start exits non-zero and explains itself on stderr;
    // that explanation is the error, not an empty list.
    const env = { NODE_OPTIONS: "--not-a-real-node-flag" };
    await expect(listPiModels({ env })).rejects.toThrow(/not-a-real-node-flag/);
  }, PI_TIMEOUT_MS);

  it("is exported from the package entry the console imports", async () => {
    const harness = await import("./index.ts");
    expect(harness.listPiModels).toBe(listPiModels);
  }, PI_TIMEOUT_MS);
});

describe("the table Pi prints, read", () => {
  /** The header row on its own, padded as the pinned build pads it. */
  const header = "provider  model  context  max-out  thinking  images";

  it("splits each padded row on the run of spaces between the columns", () => {
    expect(parsePiModelTable(TABLE)).toEqual([
      {
        provider: "deepseek",
        id: "deepseek-flash",
        reference: "deepseek/deepseek-flash",
        context: "1M",
        maxOut: "384K",
        thinking: "yes",
        images: "yes",
      },
      {
        provider: "deepseek",
        id: "deepseek-v4-pro",
        reference: "deepseek/deepseek-v4-pro",
        context: "1M",
        maxOut: "384K",
        thinking: "yes",
        images: "no",
      },
    ]);
  });

  it("answers an empty list for the sentence Pi prints when no provider has a key", () => {
    const answer =
      "No models available. Use /login to log into a provider via OAuth or API key. See:\n" +
      "  /opt/pi/docs/providers.md\n  /opt/pi/docs/models.md\n";
    expect(parsePiModelTable(answer)).toEqual([]);
  });

  it("refuses a first line that is neither the header nor that sentence", () => {
    // Answering an empty list here would tell the operator that no key is set,
    // when the truth is that the question could not be read.
    const printed = `Pi now prints a banner first:\n${header}`;
    expect(() => parsePiModelTable(printed)).toThrow(/banner first/);
  });

  it("refuses an answer that is not a table at all", () => {
    expect(() => parsePiModelTable("")).toThrow(/printed nothing/);
  });

  it("refuses a row that is not the columns the header names", () => {
    const printed = `${header}\ndeepseek  deepseek-flash  1M`;
    expect(() => parsePiModelTable(printed)).toThrow(/not 6 columns/);
  });
});
