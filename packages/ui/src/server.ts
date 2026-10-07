#!/usr/bin/env node
/**
 * The No Dice console's server: the page, and the state the page reads.
 *
 * It listens on `127.0.0.1` and nothing else. The console is one user on one
 * machine (`plan/epics/management-ui.md`), with no auth and no HTTPS, so a host
 * flag would only be a way to expose a run starter to a network by accident. The
 * bind address is not the whole answer: a domain can be aimed at the loopback
 * address, and then a stranger's page is same-origin with this port, so a
 * request whose `Host` is not `127.0.0.1` or `localhost` is refused too. A route
 * that *changes* anything — the one that starts a run — has to check `Origin`
 * over and above that, and no such route exists yet.
 *
 * Two halves answer. `/api/state` says what a run may be seated on — the bots
 * and the providers the registry names, names and key-variable names only — the
 * two roots the console reads, and the run in flight. Everything else is the
 * built browser app in `web/dist`, served path-safely through `static.ts`, or a
 * page saying to build it when nobody has.
 *
 * Nothing a request can do is allowed to end this process, because this process
 * is where a run in flight lives. A request line that cannot be read, a `Host`
 * that names somebody else's domain, a method with no route, a `web/dist` that
 * `vite build` is rewriting under us and a `providers.json` that does not parse
 * are each answered with one line the page can show — and a route that throws
 * anyway is caught at the bottom of `handle` rather than reaching Node, which
 * would take the process down over it.
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

import { providerRegistry } from "@no-dice/runner/providers";
import type { ProviderRegistry } from "@no-dice/runner/providers";

import { DEFAULT_MATCHES_ROOT, DEFAULT_PORT, DEFAULT_SERIES_ROOT, USAGE, parseUiFlags } from "./args.ts";
import { contentTypeOf, resolveStatic } from "./static.ts";
import { uiState } from "./state.ts";
import type { UiRoots, UiState } from "./state.ts";

/** The only address this server binds. Not a flag — see the note at the top. */
export const HOST = "127.0.0.1";

/**
 * The `Host` names a request may carry. `127.0.0.1` and `localhost` are the
 * two a browser can be pointed at this port with; anything else means a domain
 * that has been aimed at the loopback address, which is how DNS rebinding makes
 * a stranger's page same-origin with a console that has no auth.
 */
const HOSTS = ["127.0.0.1", "localhost"] as const;

/** Where the built browser app goes, beside this package: `packages/ui/web/dist`. */
export const WEB_ROOT: string = fileURLToPath(new URL("../web/dist", import.meta.url));

/** What a console was told to serve, with every path absolute. */
export interface UiConfig {
  port: number;
  seriesRoot: string;
  matchesRoot: string;
  webRoot: string;
}

/** What a console may be asked for. The command line's three flags, plus a test's three. */
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
  /**
   * Where the seat options come from. The process's own cached registry by
   * default; a test points it at a file of its own, including a broken one.
   */
  registry?: () => ProviderRegistry;
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
const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    ...headers,
  });
  // Node drops the body of a `HEAD` answer by itself, so the length above is
  // what a `curl -I` sees and nothing follows it.
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

/**
 * A file the request was allowed to have, written as it stands — or `false`
 * when it no longer has one. `resolveStatic` looked a moment ago, and `vite
 * build` deletes and rewrites `web/dist` under a running console, so a file can
 * go between the two; one that has gone gets the same 404 as one that was never
 * there, rather than a stack trace.
 */
const sendFile = (path: string, head: boolean, response: ServerResponse): boolean => {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return false;
  }
  response.writeHead(200, {
    "content-type": contentTypeOf(path),
    "content-length": String(size),
  });
  if (head) {
    // A `HEAD` answer is the length and the type with nothing after them; there
    // is no reason to read the file to say how big it is.
    response.end();
    return true;
  }
  createReadStream(path).on("error", () => response.destroy()).pipe(response);
  return true;
};

/**
 * The page and its assets. `/` always answers: with the built app when it is
 * there, and with the page that says how to build it when it is not. Any other
 * path is a file inside `web/dist` or a 404 — and a path that tries to climb out
 * of `web/dist` is the 404 too, before anything is read.
 */
const serveApp = (config: UiConfig, path: string, head: boolean, response: ServerResponse): void => {
  const notThere = (): void => {
    sendJson(response, 404, { error: `nothing to serve at ${path}` });
  };

  if (path === "/") {
    const index = resolveStatic(config.webRoot, "/index.html");
    if (index === null) {
      sendHtml(response, 200, NOT_BUILT_PAGE);
      return;
    }
    if (!sendFile(index, head, response)) notThere();
    return;
  }

  const file = resolveStatic(config.webRoot, path);
  if (file === null || !sendFile(file, head, response)) {
    notThere();
  }
};

/** The host a request was addressed to, with any port taken off. */
const hostNameOf = (host: string): string =>
  (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d*$/, "")).toLowerCase();

/**
 * Whether the request's `Host` names this console rather than a domain aimed at
 * the loopback address. The bind address already keeps the machine's other
 * interfaces from answering; this keeps a stranger's page from being told it is
 * looking at its own origin — which is what a route that starts a run needs
 * before it exists, not after.
 */
const hostIsOurs = (request: IncomingMessage): boolean => {
  const host = request.headers.host;
  // An HTTP/1.0 request with no `Host` at all is not a browser, and a browser
  // cannot send one.
  return host !== undefined && (HOSTS as readonly string[]).includes(hostNameOf(host));
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

/** Where the console's state comes from — the registry is a file this process does not own. */
type StateOf = (roots: UiRoots) => UiState;

/** One request, routed. The routes so far are reads; a run is started by a later one. */
const route = (
  config: UiConfig,
  stateOf: StateOf,
  path: string,
  method: string,
  response: ServerResponse,
): void => {
  if (method !== "GET" && method !== "HEAD") {
    sendJson(response, 405, { error: `${method} is not a route of this server` }, { allow: "GET, HEAD" });
    return;
  }

  if (path === "/api/state") {
    sendJson(response, 200, stateOf(config));
    return;
  }
  if (path.startsWith("/api/")) {
    sendJson(response, 404, { error: `no route at ${path}` });
    return;
  }

  serveApp(config, path, method === "HEAD", response);
};

/**
 * One request, from the outside in: a path we can read, a `Host` that names
 * us, and then the route. The route is run inside a `try` because it reads
 * files this process does not own — `providers.json` is a hand-edited file, and
 * `web/dist` is rewritten by a build — and Node does not catch an
 * exception thrown out of a request listener: it ends the process, run and all.
 */
const handle = (
  config: UiConfig,
  stateOf: StateOf,
  request: IncomingMessage,
  response: ServerResponse,
): void => {
  const path = pathOf(request.url);
  if (path === null) {
    sendJson(response, 400, { error: `"${request.url ?? ""}" is not a path this server can read` });
    return;
  }

  if (!hostIsOurs(request)) {
    sendJson(response, 400, {
      error: `"${request.headers.host ?? "no host"}" is not an address this console listens on`,
    });
    return;
  }

  try {
    route(config, stateOf, path, request.method ?? "GET", response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The page gets one line it can show, and the terminal gets the same one:
    // whoever can fix a registry that does not parse is reading a terminal.
    console.error(`no-dice-ui: ${path}: ${message}`);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 500, { error: `the console could not answer ${path}: ${message}` });
  }
};

/**
 * Listen, and hand back the server. The host is fixed; only the port is the
 * caller's, and `0` means "any free one" — read it back from
 * `server.address().port`.
 */
export async function startServer(options: UiOptions = {}): Promise<Server> {
  const config = configOf(options);
  // A source rather than a registry, so a broken `providers.json` throws inside a
  // request — where `handle` can answer it — rather than while this function is
  // still being called. The default source is the process's own, which reads the
  // file once and keeps it.
  const registryOf = options.registry ?? providerRegistry;
  const stateOf = (roots: UiRoots): UiState => uiState(roots, registryOf());
  const server = createServer((request, response) => handle(config, stateOf, request, response));

  await new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(config.port, HOST, () => listening());
  });

  // Past this point the promise has settled, and an error the listening socket
  // reports later — a descriptor limit reached mid-series — would be handed to
  // the listener above, whose rejection nobody is watching any more. It is said
  // out loud instead, because a console that has stopped answering sockets while
  // its run goes on is the silent failure this whole file is written against.
  // The listener above is the only one attached: it was put there to report a
  // failed start, and the start has not failed.
  server.removeAllListeners("error");
  server.on("error", (error: Error) => {
    console.error(`no-dice-ui: the server failed: ${error.message}`);
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
