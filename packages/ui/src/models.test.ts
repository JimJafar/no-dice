/**
 * The console's model list over real HTTP: what `GET /api/models` answers, what
 * it answers when the pinned Pi has nothing to say, and what it answers when
 * the pinned Pi did not answer at all.
 *
 * Four things these tests hold, and none of them restates
 * `packages/harness/src/pi-models.test.ts` — that file owns the question asked of
 * Pi and the table it is parsed from:
 *
 * - the answer is `{ models: [...] }`, one row per model with the seven fields
 *   and no others, in Pi's own order, and Pi's rounded figures stay the strings
 *   Pi printed them as — a number invented here would be a figure the console
 *   then has to defend;
 * - no key value is in the bytes, and no key variable is named: the rows carry
 *   providers, model ids and Pi's figures, and the route does not go looking in
 *   `process.env` to be helpful;
 * - the real call is the harness's own, asked with no `env` option, so a console
 *   whose environment carries `DEEPSEEK_API_KEY` answers `deepseek/deepseek-flash`
 *   — the models *this console* has a key for, which is what the page is told;
 * - a Pi that failed to answer is a 500 carrying its line, not an empty list:
 *   an empty list tells the operator that no key is set, which is the opposite of
 *   what happened.
 *
 * Every test listens on port 0 and is closed at the end of its own test.
 * Only the one that proves the wiring to the pinned Pi starts a `node` process,
 * so only it carries a longer timeout.
 */
import { request, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PiModel } from "@no-dice/harness";

import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";
import { modelRows } from "./models.ts";

/** A response, read to the end, with its headers kept. */
interface Answer {
  status: number;
  type: string;
  headers: Record<string, string>;
  body: string;
}

let server: Server | null = null;

/** Listen on a free port, and hand that port back. */
async function listen(options: UiOptions): Promise<number> {
  server = await startServer(options);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the console did not listen on a TCP port");
  }
  return address.port;
}

/** One request, with the method and the extra headers as written. */
const send = (
  port: number,
  path: string,
  method: string,
  headers: Record<string, string> = {},
): Promise<Answer> =>
  new Promise((done, failed) => {
    const req = request(
      { host: HOST, port, path, method, agent: false, headers },
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
    req.end();
  });

const get = (port: number, path: string, method = "GET"): Promise<Answer> =>
  send(port, path, method);

/** Stop the server this test started. */
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
});

/** A key that is not a key: the pinned Pi lists a provider when its variable is set at all. */
const DUMMY_KEY = "a-key-that-is-not-a-key";

/** Two rows as the pinned Pi printed them, padded columns and all. */
const PI_ROWS: PiModel[] = [
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
];

/** A console whose model list is answered without a subprocess. */
const consoleOn = async (models: () => Promise<readonly PiModel[]>): Promise<number> =>
  listen({ port: 0, models });

/** The rows a `GET /api/models` answered with. */
const rowsOf = (answer: Answer): { reference: string }[] =>
  (JSON.parse(answer.body) as { models: { reference: string }[] }).models;

/**
 * The fields a row has, and no others. This is what "no key value, and no
 * key variable" rests on: a value under any name at all would be a field, and a
 * field added to the answer fails here until it is argued for.
 */
const ROW_FIELDS = ["context", "id", "images", "maxOut", "provider", "reference", "thinking"];

describe("the model list the console answers with", () => {
  it("answers one row per model, with the seven fields and Pi's own figures", async () => {
    const port = await consoleOn(async () => PI_ROWS);
    const answer = await get(port, "/api/models");

    expect(answer.status).toBe(200);
    expect(answer.type).toBe("application/json; charset=utf-8");
    expect(rowsOf(answer).map((row) => row.reference)).toEqual([
      "deepseek/deepseek-flash",
      "deepseek/deepseek-v4-pro",
    ]);
    expect(JSON.parse(answer.body)).toEqual({
      models: [
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
      ],
    });
    // The field set is closed, which is what "no key value" rests on: the route
    // never reads `process.env`, and Pi's own answer names no variable.
    for (const row of JSON.parse(answer.body).models as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(ROW_FIELDS);
    }
    expect(answer.body).not.toMatch(/"(api_?key|token|secret|env)[":]/i);
  });

  it("answers an empty list when this console's environment has no key", async () => {
    // The state of a console started with no key exported: Pi prints its
    // "No models available" sentence, and the harness answers no rows.
    const port = await consoleOn(async () => []);
    const answer = await get(port, "/api/models");

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ models: [] });
  });

  it("answers a Pi that did not answer with a 500 carrying its line", async () => {
    // An empty list would tell the operator that no key is set. The line the
    // harness threw is what the page shows, so it has to arrive whole.
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const port = await consoleOn(async () => {
        throw new Error("the pinned Pi's --list-models exited 1: unknown flag");
      });
      const answer = await get(port, "/api/models");

      expect(answer.status).toBe(500);
      expect(JSON.parse(answer.body).error).toContain("--list-models exited 1: unknown flag");
    } finally {
      reported.mockRestore();
    }
  });

  it("asks the pinned Pi in this process's own environment, and sends no key value", async () => {
    // The one test that starts the pinned Pi: it proves the route is wired to the
    // harness's call with no `env` option, which is what makes the answer be the
    // models *this console* has a key for. The key goes into this process's
    // environment, which is where the route reads it from.
    const had = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = DUMMY_KEY;
    try {
      const port = await listen({ port: 0 });
      const answer = await get(port, "/api/models");

      expect(answer.status).toBe(200);
      const flash = rowsOf(answer).find((row) => row.reference === "deepseek/deepseek-flash");
      expect(flash).toBeDefined();
      // Nothing that looks like a credential is in the bytes, and the key
      // this console was started with is the clearest thing to look for.
      expect(answer.body).not.toContain(DUMMY_KEY);
    } finally {
      if (had === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = had;
    }
  }, 60_000);

  it("answers HEAD with no body, and a method it does not take with a 405", async () => {
    const port = await consoleOn(async () => PI_ROWS);

    const head = await get(port, "/api/models", "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");

    const posted = await get(port, "/api/models", "POST");
    expect(posted.status).toBe(405);
    expect(posted.headers["allow"]).toBe("GET, HEAD");
  });
});

describe("the rows themselves", () => {
  it("keeps Pi's figures as the strings Pi printed them, and drops anything else", () => {
    // A row built field by field, so a field a later harness change adds to
    // `PiModel` has to be argued for here before it reaches the page — and a
    // field that names a key variable never does.
    const extra: PiModel & { apiKeyEnv: string } = {
      provider: "deepseek",
      id: "deepseek-flash",
      reference: "deepseek/deepseek-flash",
      context: "1M",
      maxOut: "384K",
      thinking: "yes",
      images: "yes",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    };
    expect(modelRows([extra])).toEqual([
      {
        provider: "deepseek",
        id: "deepseek-flash",
        reference: "deepseek/deepseek-flash",
        context: "1M",
        maxOut: "384K",
        thinking: "yes",
        images: "yes",
      },
    ]);
  });
});
