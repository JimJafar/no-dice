/**
 * The console's provider routes over real HTTP: what `GET /api/providers`
 * answers, what a `POST` to it writes and refuses, and what `POST
 * /api/providers/check` reports about a credential.
 *
 * Three things these tests hold, and none of them is restated from
 * `packages/runner/src/providers.test.ts` — that file owns the registry itself:
 *
 * - the detail view answers with the whole entry — endpoint, api, the *name* of
 *   the key variable, reasoning, the window, the cap, the four rates — and with
 *   no key value anywhere in the bytes, because there is none to send: the
 *   registry holds variable names, and this route does not go and read
 *   `process.env` to be helpful;
 * - a posted entry is validated by the runner's own schema, so a field it
 *   does not name is refused with zod's line naming that field and the file is
 *   left byte-identical, while a good entry lands in the file the console was
 *   given, is listed by the next `GET`, and is offered by `/api/state` without a
 *   restart — which is what `reloadProviders` at startup and
 *   after a write is for;
 * - the check answers what `checkPiAuth` answers, which is testable because
 *   `pi auth check` reads configuration only: a keyless entry is ready, an entry
 *   whose variable is not exported is not, and no connection is opened and no
 *   match played either way.
 *
 * Every test writes a registry of its own in a temp directory, so none of them
 * touches the committed `providers.json`, and every server listens on port 0 and
 * is closed at the end of its own test.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadProviders, seatModelsJson } from "@no-dice/runner/providers";
import type { ProviderRegistry } from "@no-dice/runner/providers";

import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";
import { addProviderEntry, checkCredential, providerRows } from "./providers.ts";
import type { ProviderRow } from "./providers.ts";
import type { UiState } from "./state.ts";

/** A response, read to the end, with its headers kept. */
interface Answer {
  status: number;
  type: string;
  headers: Record<string, string>;
  body: string;
}

let server: Server | null = null;
const temps: string[] = [];

/** A temp directory for this test, removed when the test ends. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Listen on a free port, and hand that port back. */
async function listen(options: UiOptions): Promise<number> {
  server = await startServer(options);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the console did not listen on a TCP port");
  }
  return address.port;
}

/** One request, with the method, the body and the extra headers as written. */
const send = (
  port: number,
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> =>
  new Promise((done, failed) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = request(
      {
        host: HOST,
        port,
        path,
        method,
        agent: false,
        headers: {
          ...(text === "" ? {} : { "content-type": "application/json" }),
          "content-length": String(Buffer.byteLength(text)),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const kept: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            kept[name] = Array.isArray(value) ? value.join(", ") : String(value);
          }
          done({
            status: response.statusCode ?? 0,
            type: String(response.headers["content-type"]),
            headers: kept,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", failed);
    req.end(text);
  });

const get = (port: number, path: string, method = "GET"): Promise<Answer> =>
  send(port, path, method);

const post = (
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> => send(port, path, "POST", body, headers);

/** Stop the server this test started, and let go of its temp directories. */
async function stop(): Promise<void> {
  const running = server;
  server = null;
  if (running !== null) {
    running.closeAllConnections();
    await new Promise<void>((closed) => running.close(() => closed()));
  }
}

afterEach(async () => {
  await stop();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Two providers, neither of which any operator's config or registry has: one
 * that checks no key at all, and one whose key comes from a variable this test
 * does not export. Those are the two states the credential check is asked about,
 * and both are answerable from configuration alone.
 */
const KEYLESS = "ndkeyless";
const KEYED = "ndkeyed";

/** The variable the keyed entry names, which nothing in this test sets. */
const NOT_EXPORTED = "ND_PROVIDERS_TEST_KEY_NOT_EXPORTED";

/** One provider entry, spelled out, to post or to put in a fixture file. */
const entryOf = (baseUrl: string, apiKeyEnv: string | null): Record<string, unknown> => ({
  baseUrl,
  api: "openai-completions",
  apiKeyEnv,
  reasoning: true,
  contextWindow: 131_072,
  maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

/** A registry file of the console's own, in a temp directory of the test's. */
function registryFile(): string {
  const file = join(tempDir("nd-ui-providers-"), "providers.json");
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        [KEYLESS]: entryOf("https://keyless.example.test:8033/v1", null),
        [KEYED]: entryOf("https://keyed.example.test/v1", NOT_EXPORTED),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return file;
}

/** A console listening on a registry of its own, and the port it answers on. */
const consoleOn = async (file: string, options: UiOptions = {}): Promise<number> =>
  listen({ port: 0, providersFile: file, ...options });

/** The rows a `GET /api/providers` answered with. */
const rowsOf = (answer: Answer): ProviderRow[] => JSON.parse(answer.body) as ProviderRow[];

describe("the provider list the console answers with", () => {
  it("answers each entry as the registry holds it, in the registry's order", () => {
    const registry = loadProviders(registryFile());
    const rows = providerRows(registry);

    expect(rows.map((row) => row.name)).toEqual([KEYLESS, KEYED]);
    expect(rows[0]).toEqual({
      name: KEYLESS,
      baseUrl: "https://keyless.example.test:8033/v1",
      api: "openai-completions",
      apiKeyEnv: null,
      reasoning: true,
      contextWindow: 131_072,
      maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    // The key variable's *name* is the fact the page shows; it is the entry's
    // only mention of a credential.
    expect(rows[1]?.apiKeyEnv).toBe(NOT_EXPORTED);
  });

  it("serves the whole entry over HTTP, and no key value in the bytes it answers with", async () => {
    const port = await consoleOn(registryFile());
    const answer = await get(port, "/api/providers");

    expect(answer.status).toBe(200);
    expect(answer.type).toBe("application/json; charset=utf-8");
    expect(answer.body).toContain('"baseUrl":"https://keyless.example.test:8033/v1"');
    expect(answer.body).toContain('"apiKeyEnv":null');
    expect(answer.body).toContain('"contextWindow":131072');
    expect(answer.body).toContain('"maxTokens":8192');
    expect(answer.body).toContain('"cacheWrite":0');
    // Nothing named like a credential, and nothing that is one: the
    // route never reads `process.env[apiKeyEnv]`, so there is no
    // value here to look for.
    expect(answer.body).not.toMatch(/"(api_?key|token|secret)[":]/i);
    expect(rowsOf(answer)).toHaveLength(2);
  });

  it("answers a registry that does not parse with the line /api/state already gives", async () => {
    const broken = join(tempDir("nd-ui-registry-"), "providers.json");
    writeFileSync(broken, "{ not json at all", "utf8");
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // The injected source keeps working for the new route, and the failure is
      // the same one line rather than a second account of it.
      const port = await listen({ port: 0, registry: () => loadProviders(broken) });
      const providers = await get(port, "/api/providers");
      const state = await get(port, "/api/state");

      expect(providers.status).toBe(500);
      const line = `${broken} is not JSON`;
      expect(JSON.parse(providers.body).error).toContain(line);
      // The same failure, said the same way, on both routes that read it.
      expect(JSON.parse(state.body).error).toContain(line);
    } finally {
      reported.mockRestore();
    }
  });

  it("answers a method the route does not take with a 405 naming the ones it does", async () => {
    const port = await consoleOn(registryFile());

    const put = await get(port, "/api/providers", "PUT");
    expect(put.status).toBe(405);
    expect(put.headers["allow"]).toBe("GET, HEAD, POST");

    const head = await get(port, "/api/providers", "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
  });
});

describe("adding a provider through the console", () => {
  /** The entry the page would post: a real shape, no real key. */
  const ACME = {
    baseUrl: "https://acme.example.com/v1",
    api: "openai-completions",
    apiKeyEnv: "ACME_API_KEY",
    reasoning: false,
    contextWindow: 200_000,
    maxTokens: 4096,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  };

  it("writes the entry to the file it was given, lists it, and seats the next run on it", async () => {
    const file = registryFile();
    const port = await consoleOn(file);

    const posted = await post(port, "/api/providers", { name: "acme", entry: ACME });
    expect(posted.status).toBe(200);
    expect(rowsOf(posted).map((row) => row.name)).toEqual([KEYLESS, KEYED, "acme"]);

    // The file, as the runner writes it: valid JSON, the key variable named, and
    // no key value in it.
    const onDisk = readFileSync(file, "utf8");
    expect(JSON.parse(onDisk) as ProviderRegistry).toMatchObject({
      acme: { baseUrl: "https://acme.example.com/v1", apiKeyEnv: "ACME_API_KEY" },
    });
    expect(onDisk).not.toContain("sk-");

    // The next read of the same console lists it, and the seat picker
    // offers it — which is `reloadProviders` after the write, not a restart.
    expect(rowsOf(await get(port, "/api/providers")).some((row) => row.name === "acme")).toBe(true);
    const state = JSON.parse((await get(port, "/api/state")).body) as UiState;
    expect(state.providers.map((each) => each.name)).toContain("acme");
    expect(state.providers.find((each) => each.name === "acme")?.apiKeyEnv).toBe("ACME_API_KEY");

    // And the process's own registry, which is what a run is seated from.
    expect(seatModelsJson("acme/m1")).not.toBeNull();
  });

  it("refuses an entry the schema refuses, names the field, and leaves the file byte-identical", async () => {
    const file = registryFile();
    const before = readFileSync(file, "utf8");
    const port = await consoleOn(file);

    const posted = await post(port, "/api/providers", {
      name: "evil",
      entry: { ...ACME, baseUrl: "not a url", apiKey: "sk-not-a-secret" },
    });

    expect(posted.status).toBe(400);
    // zod's own line, from the runner's own field list: the field it refused is
    // in it, as is the one that is not a URL.
    const error = JSON.parse(posted.body).error as string;
    expect(error).toContain("apiKey");
    expect(error).toContain("baseUrl");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(rowsOf(await get(port, "/api/providers")).map((row) => row.name)).toEqual([
      KEYLESS,
      KEYED,
    ]);
  });

  it("refuses a name the registry already has, rather than moving a seat under a run", async () => {
    const file = registryFile();
    const before = readFileSync(file, "utf8");
    const port = await consoleOn(file);

    const posted = await post(port, "/api/providers", { name: KEYLESS, entry: ACME });
    expect(posted.status).toBe(400);
    expect(JSON.parse(posted.body).error).toContain("already names");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses a body that is not a provider request, in one line the page can show", async () => {
    const port = await consoleOn(registryFile());

    const noEntry = await post(port, "/api/providers", { name: "acme" });
    expect(noEntry.status).toBe(400);
    expect(JSON.parse(noEntry.body).error).toContain("needs an entry to add");

    const noName = await post(port, "/api/providers", { entry: ACME });
    expect(noName.status).toBe(400);
    expect(JSON.parse(noName.body).error).toContain("needs the provider's name");
  });

  it("refuses a POST from another page, and leaves the registry alone", async () => {
    const file = registryFile();
    const before = readFileSync(file, "utf8");
    const port = await consoleOn(file);

    const crossOrigin = await post(
      port,
      "/api/providers",
      { name: "acme", entry: ACME },
      { origin: "http://evil.example" },
    );
    expect(crossOrigin.status).toBe(403);
    expect(JSON.parse(crossOrigin.body).error).toContain("http://evil.example");
    expect(readFileSync(file, "utf8")).toBe(before);

    // The console's own page, and a terminal with no `Origin` at all, are both
    // still allowed to write.
    expect((await post(port, "/api/providers", { name: "acme", entry: ACME })).status).toBe(200);
  });

  it("refuses a body too big to be a form, under the same cap the run POSTs use", async () => {
    const file = registryFile();
    const before = readFileSync(file, "utf8");
    const port = await consoleOn(file);

    const posted = await post(port, "/api/providers", {
      name: "acme",
      entry: { ...ACME, api: "x".repeat(20_000) },
    });
    expect(posted.status).toBe(400);
    expect(JSON.parse(posted.body).error).toContain("fit in");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("adds to a registry of its own and not to the committed one", () => {
    const file = registryFile();
    const added = addProviderEntry({ name: "acme", entry: ACME }, file);

    expect(added.ok).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("ACME_API_KEY");
    // The refusal is the runner's line, and it comes back without a write.
    const refused = addProviderEntry({ name: "acme", entry: ACME }, file);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.error).toContain("already names");
  });
});

describe("asking Pi about a seat's credential", () => {
  it("says ready for an endpoint that checks no key, and names the provider it checked", async () => {
    const port = await consoleOn(registryFile());

    const answer = await post(port, "/api/providers/check", { model: `${KEYLESS}/m1` });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({
      ok: true,
      provider: KEYLESS,
      reason: null,
      message: "",
    });
  }, 60_000);

  it("says not ready, with Pi's reason, for an entry whose key variable is not exported", async () => {
    const port = await consoleOn(registryFile());

    const answer = await post(port, "/api/providers/check", { model: `${KEYED}/m1` });
    expect(answer.status).toBe(200);
    const auth = JSON.parse(answer.body) as { ok: boolean; provider: string; reason: string | null; message: string };
    expect(auth.ok).toBe(false);
    expect(auth.provider).toBe(KEYED);
    expect(auth.reason).not.toBeNull();
    expect(auth.message).toContain(`"${KEYED}"`);
    // The check is the answer, not a console that failed, so it is not a 4xx.
    expect(answer.body).not.toContain("could not answer");
  }, 60_000);

  it("refuses a model that is not a <provider>/<id>, in the CLI's own line", async () => {
    const port = await consoleOn(registryFile());

    const answer = await post(port, "/api/providers/check", { model: "just-a-model" });
    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.body).error).toContain('a Pi seat\'s model is "<provider>/<id>"');
  });

  it("refuses a GET, and a POST from another page", async () => {
    const port = await consoleOn(registryFile());

    const read = await get(port, "/api/providers/check");
    expect(read.status).toBe(405);
    expect(read.headers["allow"]).toBe("POST");

    const crossOrigin = await post(
      port,
      "/api/providers/check",
      { model: `${KEYLESS}/m1` },
      { origin: "http://evil.example" },
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("answers what checkPiAuth answered, for a provider the registry does not name", async () => {
    // A provider the registry does not name is handed no `models.json`, which is
    // what leaves it to Pi's own lookup — and with no credential on the machine,
    // that lookup says not ready. The route does not invent an answer for it.
    const port = await consoleOn(registryFile());
    const answer = await post(port, "/api/providers/check", { model: "ndnowhere/m1" });

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toMatchObject({ ok: false, provider: "ndnowhere" });

    const direct = await checkCredential({ model: "ndnowhere/m1" });
    expect(direct.ok).toBe(true);
    expect(direct.ok && direct.auth.ok).toBe(false);
  }, 60_000);
});
