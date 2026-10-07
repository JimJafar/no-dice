#!/usr/bin/env node
/**
 * The No Dice console's server: the page, and the state the page reads.
 *
 * It listens on `127.0.0.1` and nothing else. The console is one user on one
 * machine (`plan/epics/management-ui.md`), with no auth and no HTTPS, so a host
 * flag would only be a way to expose a run starter to a network by accident.
 *
 * Two halves answer. `/api/state` says what a run may be seated on — the bots
 * and the providers the registry names, names and key-variable names only — the
 * two roots the console reads, and the run in flight. Everything else is the
 * built browser app in `web/dist`, served path-safely through `static.ts`, or a
 * page saying to build it when nobody has.
 *
 * `startServer` is the whole server and returns the `http.Server` it has
 * listened, so a test can ask for port 0 and read the port back. This file is
 * also the package's `no-dice-ui` bin, and runs itself only when it is executed
 * rather than imported — the same guard `packages/runner/src/cli.ts` has, for the
 * same reason: a bin is started through a `node_modules/.bin` shim whose route to
 * this file goes through a symlinked package directory, while Node loads the
 * module at its real path.
 *
 * Like the rest of the workspace this runs under bare Node (22.18 or later,
 * which strips the types) with file-named imports; only the browser half is
 * built, and only into `web/dist`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { DEFAULT_MATCHES_ROOT, DEFAULT_PORT, DEFAULT_SERIES_ROOT, USAGE, parseUiFlags } from "./args.ts";
import { contentTypeOf, resolveStatic } from "./static.ts";
import { uiState } from "./state.ts";

/** The only address this server binds. Not a flag — see the note at the top. */
export const HOST = "127.0.0.1";

/** Where the built browser app goes, beside this package: `packages/ui/web/dist`. */
export const WEB_ROOT: string = fileURLToPath(new URL("../web/dist", import.meta.url));

/** What a console was told to serve, with every path absolute. */
export interface UiConfig {
  port: number;
  seriesRoot: string;
  matchesRoot: string;
  webRoot: string;
}

/** What a console may be asked for. The command line's three flags, plus a test's two. */
export interface UiOptions {
  /** The port to listen on; `0` asks for a free one, which is what a test uses. */
  port?: number;
  /** Where series are listed from, relative to `cwd` unless absolute. */
  seriesRoot?: string;
  /** Where finished match logs are, the same way. */
  matchesRoot?: string;
  /** Where the built app is. A test points it at a fixture, or at nothing. */
  webRoot?: string;
  /** What a relative root is taken relative to — the repo root for a real run. */
  cwd?: string;
}

/** The page this server can write for itself, when the app has not been built. */
const NOT_BUILT_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>No Dice console</title></head>
<body>
<h1>No Dice console</h1>
<p>The browser app has not been built, so there is nothing here to serve yet.</p>
<p>Build it with <code>pnpm --filter @no-dice/ui build</code> and reload this page.</p>
<p>The console's own state is at <a href="/api/state">/api/state</a>.</p>
</body>
</html>
`;

/** The configuration a console runs on, with every path resolved. */
const configOf = (options: UiOptions): UiConfig => {
  const cwd = options.cwd ?? process.cwd();
  return {
    port: options.port ?? DEFAULT_PORT,
    seriesRoot: resolve(cwd, options.seriesRoot ?? DEFAULT_SERIES_ROOT),
    matchesRoot: resolve(cwd, options.matchesRoot ?? DEFAULT_MATCHES_ROOT),
    webRoot: resolve(cwd, options.webRoot ?? WEB_ROOT),
  };
};

/** An answer the page reads as data rather than as HTML. */
const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
  });
  response.end(text);
};

/** An answer the browser renders. */
const sendHtml = (response: ServerResponse, status: number, html: string): void => {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(Buffer.byteLength(html)),
  });
  response.end(html);
};

/** A file the request was allowed to have, written as it stands. */
const sendFile = (path: string, response: ServerResponse): void => {
  response.writeHead(200, {
    "content-type": contentTypeOf(path),
    "content-length": String(statSync(path).size),
  });
  createReadStream(path).on("error", () => response.destroy()).pipe(response);
};

/**
 * The page and its assets. `/` always answers: with the built app when it is
 * there, and with the page that says how to build it when it is not. Any other
 * path is a file inside `web/dist` or a 404 — and a path that tries to climb out
 * of `web/dist` is the 404 too, before anything is read.
 */
const serveApp = (config: UiConfig, path: string, response: ServerResponse): void => {
  if (path === "/") {
    const index = resolveStatic(config.webRoot, "/index.html");
    if (index === null) {
      sendHtml(response, 200, NOT_BUILT_PAGE);
      return;
    }
    sendFile(index, response);
    return;
  }

  const file = resolveStatic(config.webRoot, path);
  if (file === null) {
    sendJson(response, 404, { error: `nothing to serve at ${path}` });
    return;
  }
  sendFile(file, response);
};

/**
 * The path a request names, or `null` for a request line this server will not
 * read. A request that cannot be parsed is answered rather than thrown: an
 * exception out of this handler would take the process down, and the process is
 * where a run in flight lives.
 */
const pathOf = (url: string | undefined): string | null => {
  try {
    return new URL(url ?? "/", `http://${HOST}`).pathname;
  } catch {
    return null;
  }
};

/** One request, routed. The routes so far are reads; a run is started by a later one. */
const handle = (config: UiConfig, request: IncomingMessage, response: ServerResponse): void => {
  const path = pathOf(request.url);
  if (path === null) {
    sendJson(response, 400, { error: `"${request.url ?? ""}" is not a path this server can read` });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: `${request.method ?? "that method"} is not a route of this server` });
    return;
  }

  if (path === "/api/state") {
    sendJson(response, 200, uiState(config));
    return;
  }
  if (path.startsWith("/api/")) {
    sendJson(response, 404, { error: `no route at ${path}` });
    return;
  }

  serveApp(config, path, response);
};

/**
 * Listen, and hand back the server. The host is fixed; only the port is the
 * caller's, and `0` means "any free one" — read it back from
 * `server.address().port`.
 */
export async function startServer(options: UiOptions = {}): Promise<Server> {
  const config = configOf(options);
  const server = createServer((request, response) => handle(config, request, response));

  await new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(config.port, HOST, () => listening());
  });

  return server;
}

/** The port a listening server was given, which is not the one asked for when it was 0. */
const portOf = (server: Server): number => {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the console is not listening on a port");
  return address.port;
};

/** The real path of the file this process was started on, or `null` when it is not there. */
const realpathOf = (path: string | undefined): string | null => {
  if (path === undefined) return null;
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

// The bin: parse the command line, listen, and say where. Only when executed —
// importing `startServer` must not open a port.
const invoked = realpathOf(process.argv[1]);
if (invoked !== null && import.meta.url === pathToFileURL(invoked).href) {
  const parsed = parseUiFlags(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`error: ${parsed.error}`);
    console.error(USAGE);
    process.exitCode = 1;
  } else {
    // The same resolution `startServer` does, so what is printed is where the
    // console will really look rather than where the flag was typed.
    const config = configOf(parsed.flags);
    try {
      const server = await startServer(config);
      console.log(`no-dice-ui on http://${HOST}:${String(portOf(server))}`);
      console.log(`series root: ${config.seriesRoot}`);
      console.log(`matches root: ${config.matchesRoot}`);
      if (resolveStatic(config.webRoot, "/index.html") === null) {
        console.log(`the page is not built: "pnpm --filter @no-dice/ui build" builds it`);
      }
    } catch (error) {
      // A port already taken is the usual one, and it is said in one line rather
      // than as a stack trace over a terminal that is trying to start a run.
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
