/**
 * The console over real HTTP: what `/api/state` answers, where the socket is
 * bound, what happens to a path that tries to leave the directory being served,
 * and what `/` says before and after the browser app has been built.
 *
 * Every request goes out over a real socket with the path written exactly as
 * the test means it — `..` included, which is what `curl --path-as-is` sends —
 * and every server is started on port 0 and closed at the end of
 * its own test, so nothing here depends on a port being free or on the order
 * the tests run in.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { providerRegistry } from "@no-dice/runner/providers";

import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";
import type { UiState } from "./state.ts";

/** A response, read to the end. */
interface Answer {
  status: number;
  type: string;
  body: string;
}

let server: Server | null = null;
let temp: string | null = null;

/** Listen on a free port, and hand that port back. */
async function listen(options: UiOptions): Promise<number> {
  server = await startServer(options);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the console did not listen on a TCP port");
  }
  return address.port;
}

/** One GET, with the path sent exactly as written. */
const get = (port: number, path: string, method = "GET"): Promise<Answer> =>
  new Promise((done, failed) => {
    const req = request({ host: HOST, port, path, method, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        done({
          status: response.statusCode ?? 0,
          type: String(response.headers["content-type"]),
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", failed);
    req.end();
  });

/** A built app to serve, with one file beside it that is not for the page. */
function builtApp(): string {
  temp = mkdtempSync(join(tmpdir(), "nd-ui-dist-"));
  const dist = join(temp, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>No Dice console</title>");
  writeFileSync(join(dist, "assets", "app.js"), "export const drawn = true;\n");
  writeFileSync(join(temp, "package.json"), "{ \"name\": \"not for the page\" }\n");
  return dist;
}

/** A request line written by hand, which is how a client sends a target no browser would. */
const raw = (port: number, target: string): Promise<string> =>
  new Promise((done) => {
    const socket = connect({ host: HOST, port }, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${HOST}:${String(port)}\r\nConnection: close\r\n\r\n`);
    });
    let statusLine = "";
    socket.on("data", (chunk: Buffer) => {
      if (statusLine === "") statusLine = chunk.toString("utf8").split("\r\n")[0] ?? "";
    });
    socket.on("close", () => done(statusLine));
    socket.on("error", (error: Error) => done(`error: ${error.message}`));
    socket.setTimeout(3000, () => {
      socket.destroy();
      done("timed out");
    });
  });

/** Stop the server this test started, and let go of its temp directory. */
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
  if (temp !== null) {
    rmSync(temp, { recursive: true, force: true });
    temp = null;
  }
});

describe("GET /api/state", () => {
  it("answers the two bot seats, the roots it was given as absolute paths, and no run", async () => {
    const port = await listen({
      port: 0,
      cwd: "/repo",
      seriesRoot: "/tmp/nd-ui/series",
      matchesRoot: "matches",
    });
    const answer = await get(port, "/api/state");

    expect(answer.status).toBe(200);
    expect(answer.type).toBe("application/json; charset=utf-8");
    const state = JSON.parse(answer.body) as UiState;
    expect(state.bots).toEqual(["bot:random", "bot:greedy"]);
    expect(state.seriesRoot).toBe("/tmp/nd-ui/series");
    expect(state.matchesRoot).toBe("/repo/matches");
    expect(state.running).toBeNull();
  });

  it("names every provider the registry names, and no endpoint and no key value", async () => {
    const port = await listen({ port: 0 });
    const answer = await get(port, "/api/state");
    const state = JSON.parse(answer.body) as UiState;

    expect(state.providers.map((each) => each.name)).toEqual(Object.keys(providerRegistry()));
    expect(state.providers.map((each) => each.name)).toContain("marvin");
    expect(answer.body).not.toContain("baseUrl");
    expect(answer.body).not.toContain("https://");
  });
});

describe("where the console listens", () => {
  it("binds loopback and nothing else", async () => {
    const port = await listen({ port: 0 });
    expect(server?.address()).toMatchObject({ address: "127.0.0.1", port });
  });

  it("keeps the port it was asked for, so a run from the terminal is predictable", async () => {
    const free = await listen({ port: 0 });
    await stop();

    const port = await listen({ port: free });
    expect(server?.address()).toMatchObject({ address: "127.0.0.1", port: free });
    expect(port).toBe(free);
  });
});

describe("paths that try to leave the directory the console serves", () => {
  it("refuses /../package.json even though that file is on disk", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    const answer = await get(port, "/../package.json");
    expect(answer.status).toBe(404);
    expect(answer.body).not.toContain("not for the page");
  });

  it("refuses the same climb percent-encoded, and one from inside a subdirectory", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    expect((await get(port, "/%2e%2e/package.json")).status).toBe(404);
    expect((await get(port, "/assets/../../package.json")).status).toBe(404);
  });

  it("refuses a request for an absolute path", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    expect((await get(port, "/etc/passwd")).status).toBe(404);
  });
});

describe("the page", () => {
  it("serves the built app at / and its asset by name", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(page.type).toBe("text/html; charset=utf-8");
    expect(page.body).toContain("<title>No Dice console</title>");

    const asset = await get(port, "/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.type).toBe("text/javascript; charset=utf-8");
    expect(asset.body).toContain("drawn");
  });

  it("says to build the app when web/dist has not been built", async () => {
    temp = mkdtempSync(join(tmpdir(), "nd-ui-dist-"));
    const port = await listen({ port: 0, webRoot: join(temp, "dist") });

    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(page.type).toBe("text/html; charset=utf-8");
    expect(page.body).toContain("pnpm --filter @no-dice/ui build");
  });

  it("answers a path it has nothing for with a 404 the page can read as JSON", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    const answer = await get(port, "/nope.js");
    expect(answer.status).toBe(404);
    expect(answer.type).toBe("application/json; charset=utf-8");
    expect(JSON.parse(answer.body)).toEqual({ error: "nothing to serve at /nope.js" });
  });

  it("answers a request line it cannot read with a 400, and stays up for the next one", async () => {
    const port = await listen({ port: 0 });

    // `//[` is a request target Node's parser accepts and no URL can be made of
    // it. An exception out of the handler would end the process, and a run in
    // flight lives in the process.
    expect(await raw(port, "//[")).toBe("HTTP/1.1 400 Bad Request");
    expect((await get(port, "/api/state")).status).toBe(200);
  });

  it("answers an unknown /api route with a 404, and a method it has no route for with a 405", async () => {
    const port = await listen({ port: 0 });

    const missing = await get(port, "/api/run");
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body)).toEqual({ error: "no route at /api/run" });

    const posted = await get(port, "/api/state", "POST");
    expect(posted.status).toBe(405);
    expect(JSON.parse(posted.body)).toEqual({ error: "POST is not a route of this server" });
  });
});
