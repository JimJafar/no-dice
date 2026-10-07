/**
 * The console over real HTTP: what `/api/state` answers, where the socket is
 * bound, what happens to a path that tries to leave the directory being served,
 * what happens to a `Host` that names somebody else's domain, and what `/` says
 * before and after the browser app has been built.
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
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadProviders, providerRegistry } from "@no-dice/runner/providers";

import { HOST, startServer } from "./server.ts";
import type { UiOptions } from "./server.ts";
import type { UiState } from "./state.ts";

/** A response, read to the end. */
interface Answer {
  status: number;
  type: string;
  body: string;
}

/** A response to a request written by hand, with its headers kept. */
interface RawAnswer {
  status: number;
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

/** The size of the asset `builtApp` writes, which a `HEAD` answer states. */
const APP_JS = "export const drawn = true;\n";

/** A built app to serve, with one file beside it that is not for the page. */
function builtApp(): string {
  const temp = tempDir("nd-ui-dist-");
  const dist = join(temp, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>No Dice console</title>");
  writeFileSync(join(dist, "assets", "app.js"), APP_JS);
  writeFileSync(join(temp, "package.json"), "{ \"name\": \"not for the page\" }\n");
  return dist;
}

/** One request written by hand: the method, the target and the `Host` as written. */
const raw = (
  port: number,
  target: string,
  options: { method?: string; host?: string } = {},
): Promise<RawAnswer> =>
  new Promise((done) => {
    const method = options.method ?? "GET";
    const host = options.host ?? `${HOST}:${String(port)}`;
    const socket = connect({ host: HOST, port }, () => {
      socket.write(`${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });

    let text = "";
    const answered = (): void => {
      const headAt = text.indexOf("\r\n\r\n");
      const head = headAt === -1 ? text : text.slice(0, headAt);
      const headers: Record<string, string> = {};
      for (const line of head.split("\r\n").slice(1)) {
        const colon = line.indexOf(":");
        if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
      }
      done({
        status: Number(head.split(" ")[1] ?? 0),
        headers,
        body: headAt === -1 ? "" : text.slice(headAt + 4),
      });
    };

    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    socket.on("close", answered);
    socket.on("error", () => answered());
    socket.setTimeout(3000, () => {
      socket.destroy();
      answered();
    });
  });

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

  it("says out loud when the listening socket fails after the start, and keeps answering", async () => {
    const port = await listen({ port: 0 });
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // What a socket reports mid-series: a descriptor limit reached, a socket
      // closed under it. Left attached to the start's rejection it would be
      // dropped, and the console would go quiet with its run still going.
      server?.emit("error", new Error("too many open files"));

      const lines = reported.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(lines).toContain("no-dice-ui: the server failed: too many open files");
      expect((await get(port, "/api/state")).status).toBe(200);
    } finally {
      reported.mockRestore();
    }
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

  it("refuses a climb whose slash is percent-encoded, which is the one the URL parser leaves whole", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    // `/../package.json` reaches the server as `/package.json`, because the URL
    // parser resolves the dot segment before anything here sees it. These do not:
    // decoded, each names a file outside `web/dist`, and the refusal is the
    // containment rule in `static.ts` rather than a file that happens to be
    // missing. The file it asks for is on disk and says so.
    for (const path of [
      "/..%2fpackage.json",
      "/..%2Fpackage.json",
      "/%2e%2e%2fpackage.json",
      "/assets/..%2f..%2fpackage.json",
    ]) {
      const answer = await get(port, path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).not.toContain("not for the page");
    }
  });

  it("refuses a request for an absolute path", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    expect((await get(port, "/etc/passwd")).status).toBe(404);
    // A leading `//` is a protocol-relative URL to a browser, and the URL parser
    // takes it for a path on this origin; either way nothing outside is served.
    expect((await get(port, "//etc/passwd")).status).toBe(404);
  });
});

describe("the address a request was addressed to", () => {
  it("refuses a Host that names a domain rather than the loopback address", async () => {
    const port = await listen({ port: 0 });

    // DNS rebinding: a page on another machine is made to resolve its own domain
    // to 127.0.0.1, and then its `fetch` is same-origin with the console.
    // The bind address keeps the machine's other interfaces from answering; this
    // is what keeps that page from reading the console at all.
    const rebound = await raw(port, "/api/state", { host: "attacker.example.com" });
    expect(rebound.status).toBe(400);
    expect(JSON.parse(rebound.body).error).toContain("attacker.example.com");

    const missing = await raw(port, "/api/state", { host: "" });
    expect(missing.status).toBe(400);

    // The console is still there for the page that addressed it properly.
    expect((await get(port, "/api/state")).status).toBe(200);
  });

  it("answers `localhost` and a Host with no port, which is how a browser types them", async () => {
    const port = await listen({ port: 0 });

    expect((await raw(port, "/api/state", { host: `localhost:${String(port)}` })).status).toBe(200);
    expect((await raw(port, "/api/state", { host: "127.0.0.1" })).status).toBe(200);
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
    const port = await listen({ port: 0, webRoot: join(tempDir("nd-ui-dist-"), "dist") });

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
    expect((await raw(port, "//[")).status).toBe(400);
    expect((await get(port, "/api/state")).status).toBe(200);
  });

  it("answers a route that throws with one readable line, and stays up for the next request", async () => {
    const registryFile = join(tempDir("nd-ui-registry-"), "providers.json");
    writeFileSync(registryFile, "{ not json at all");

    const webRoot = builtApp();
    const port = await listen({
      port: 0,
      webRoot,
      registry: () => loadProviders(registryFile),
    });
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // The throw is the runner's own, from reading a `providers.json` somebody
      // hand-edited. What is under test is that it stops here: the page gets one
      // line it can show, the terminal gets the same line, and the process that
      // would be holding a run is alive.
      const answer = await get(port, "/api/state");
      expect(answer.status).toBe(500);
      expect(JSON.parse(answer.body).error).toContain(`${registryFile} is not JSON`);

      expect((await get(port, "/api/state")).status).toBe(500);
      expect((await get(port, "/assets/app.js")).status).toBe(200);

      const lines = reported.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(lines).toContain(`${registryFile} is not JSON`);
    } finally {
      reported.mockRestore();
    }
  });

  it("answers HEAD with the type and length of a file and no body, and says what a route takes", async () => {
    const webRoot = builtApp();
    const port = await listen({ port: 0, webRoot });

    const head = await raw(port, "/assets/app.js", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(APP_JS)));
    expect(head.body).toBe("");

    const page = await raw(port, "/", { method: "HEAD" });
    expect(page.status).toBe(200);
    expect(page.body).toBe("");
  });

  it("answers an unknown /api route with a 404, and a method it has no route for with a 405", async () => {
    const port = await listen({ port: 0 });

    const missing = await get(port, "/api/nope");
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body)).toEqual({ error: "no route at /api/nope" });

    const posted = await get(port, "/api/state", "POST");
    expect(posted.status).toBe(405);
    expect(JSON.parse(posted.body)).toEqual({ error: "POST is not a route of this server" });

    // A method the route does not take says which it does, so a client that
    // sent the wrong one is not left guessing.
    expect((await raw(port, "/api/state", { method: "POST" })).headers["allow"]).toBe("GET, HEAD");
  });
});
