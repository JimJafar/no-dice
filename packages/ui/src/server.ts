#!/usr/bin/env node
/**
 * The No Dice console's server: the page, and the state the page reads.
 *
 * It listens on `127.0.0.1` and nothing else. The console is one user on one
 * machine (`plan/epics/management-ui.md`), with no auth and no HTTPS, so a host
 * flag would only be a way to expose a run starter to a network by accident. The
 * bind address is not the whole answer: a domain can be aimed at the loopback
 * address, and then a stranger's page is same-origin with this port, so a
 * request whose `Host` is not `127.0.0.1` or `localhost` is refused too. The
 * routes that *change* anything — the two that start a run — check `Origin` over
 * and above that, because a browser sends it and a cross-origin page cannot
 * make it name this console.
 *
 * Two halves answer. `/api/state` says what a run may be seated on — the bots
 * and the providers the registry names, names and key-variable names only —
 * and the two roots the console reads. `/api/run` says what the run slot holds:
 * the run in flight, or the last one, with the lines it has printed. A run
 * is started by `POST /api/run/match` or `POST /api/run/series`, and it is
 * played in this process, so the request that started it is not what keeps it
 * alive; a series left half played by a server that was closed is resumed by
 * `POST /api/run/resume`, which names the series directory and takes everything
 * else about that run from the series' own record.
 *
 * What is already on disk is reachable through the same server. `/api/series`
 * and `/api/matches` list it (`./results.ts`), `/logs/<path>` serves the JSON a
 * listing names, and `/viewer/` serves the built replay viewer, which is what
 * opens one of those logs at
 * `/viewer/?log=/logs/<series>/matches/<file>.json`. The viewer is a separate
 * app the console does not own, built by its own `vite build`, so the console
 * serves it and says what to build when nobody has. Everything else is the
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
import { LOG_PREFIX, VIEWER_PREFIX, logPathOf, matchRows, seriesRows } from "./results.ts";
import { createRunSlot } from "./runs.ts";
import type { RunKind, RunSlot } from "./runs.ts";
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

/**
 * Where the built replay viewer goes: `games/salient/viewer/dist`. The console
 * serves it at `/viewer/` so a match log it can already serve is openable in the
 * viewer that is already written — one server, one origin, and no second port for
 * the operator to start and then forget about.
 */
export const VIEWER_ROOT: string = fileURLToPath(
  new URL("../../../games/salient/viewer/dist", import.meta.url),
);

/** What a console was told to serve, with every path absolute. */
export interface UiConfig {
  port: number;
  seriesRoot: string;
  matchesRoot: string;
  webRoot: string;
  /** Where the built replay viewer is, served under `/viewer/`. */
  viewerRoot: string;
  /** Where a run is played: what a relative `--out` or `--dir` is taken from. */
  cwd: string;
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
  /** Where the built viewer is, the same way. */
  viewerRoot?: string;
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

/**
 * The same page for the viewer, which is a different app with a different build.
 * It names the Salient replay viewer in its own heading because the thing a
 * reader wants to know at that moment is which of the two apps they have not
 * built.
 */
const NOT_BUILT_VIEWER = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Salient replay viewer</title></head>
<body>
<h1>Salient replay viewer</h1>
<p>The viewer has not been built, so there is nothing here to serve yet — it is the salient replay
viewer, a Vite app of its own, and the console mounts its <code>dist</code> here.</p>
<p>Build it with <code>pnpm --filter @no-dice/salient-viewer build</code> and reload this page.</p>
<p>The match logs it would open are listed at <a href="/api/matches">/api/matches</a>.</p>
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
    viewerRoot: resolve(cwd, options.viewerRoot ?? VIEWER_ROOT),
    cwd,
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

/** The largest run request this console will read. A form posts a few hundred bytes. */
const MAX_BODY = 16 * 1024;

/**
 * The JSON a run request carried, or one line saying why it did not. The body is
 * read here rather than by the route, because a run must not be started from a
 * payload that is still arriving — and a body of any size at all is a way to make
 * a console hold a request it will never answer. A body that cannot be read is a
 * bad request, not a console that failed, so the route answers it with the line.
 */
const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const text = await new Promise<string>((answered, refused) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Refused rather than truncated, and the rest of the body is dropped on the
      // floor: the run is not started, and the console does not hold a request it
      // will never answer.
      if (size > MAX_BODY) refused(new Error(`a run request has to fit in ${String(MAX_BODY)} bytes`));
      else chunks.push(chunk);
    });
    request.on("end", () => void answered(Buffer.concat(chunks).toString("utf8")));
    request.on("error", refused);
  });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("the run request body is not JSON");
  }
};

/**
 * Whether the page that posted is this console's own page. A browser sends
 * `Origin`, and a page on another domain cannot make it name this console, so a
 * cross-origin `fetch` against a run route is refused — the `Host` check keeps a
 * rebound domain from reaching the port at all, and this keeps a page that got
 * there by some other route from starting a run in it. A request with no
 * `Origin` is not a browser's cross-origin request: `curl` sends none, and the
 * operator at a terminal is who that is for.
 */
const originIsOurs = (request: IncomingMessage): boolean => {
  const origin = request.headers.origin;
  if (origin === undefined || origin === "") return true;
  const host = request.headers.host;
  return host !== undefined && origin === `http://${host}`;
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
  serveBuilt(config.webRoot, path, NOT_BUILT_PAGE, head, response);
};

/**
 * Serve one built app out of `root`. `path` is the request path *within* that
 * app — `/` for the app's own index — and `notBuilt` is the page for a root
 * nobody has built. Every built app this console serves goes through the same
 * `resolveStatic`, so the refuses-to-escape rule is one rule and not one per
 * mount point.
 */
const serveBuilt = (
  root: string,
  path: string,
  notBuilt: string,
  head: boolean,
  response: ServerResponse,
): void => {
  const notThere = (): void => {
    sendJson(response, 404, { error: `nothing to serve at ${path}` });
  };

  if (path === "/") {
    const index = resolveStatic(root, "/index.html");
    if (index === null) {
      sendHtml(response, 200, notBuilt);
      return;
    }
    if (!sendFile(index, head, response)) notThere();
    return;
  }

  const file = resolveStatic(root, path);
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

/** The routes that start a run, and the command each one starts. */
const RUN_POSTS: ReadonlyMap<string, RunKind> = new Map([
  ["/api/run/match", "match"],
  ["/api/run/series", "series"],
  ["/api/run/resume", "resume"],
]);

/** A method a route does not take, said with the ones it does. */
const sendMethod = (response: ServerResponse, path: string, method: string, allow: string): void => {
  sendJson(response, 405, { error: `${method} is not a route of ${path}` }, { allow });
};

/**
 * One request, routed. The reads answer out of the state, the run slot and the
 * two roots on disk; the run POSTs read their body and ask the slot for a run.
 * The route is `async` only because a body arrives over more than one event — a
 * started run is not awaited here, and a request that is answered while its run
 * has nineteen minutes to go is the whole design of this file.
 */
const route = async (
  config: UiConfig,
  stateOf: StateOf,
  runs: RunSlot,
  path: string,
  method: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  if (path === "/api/run") {
    if (method !== "GET" && method !== "HEAD") {
      sendMethod(response, path, method, "GET, HEAD");
      return;
    }
    sendJson(response, 200, runs.snapshot());
    return;
  }

  const kind = RUN_POSTS.get(path);
  if (kind !== undefined) {
    if (method !== "POST") {
      sendMethod(response, path, method, "POST");
      return;
    }
    if (!originIsOurs(request)) {
      sendJson(response, 403, {
        error: `"${String(request.headers.origin)}" is not a page this console starts runs for`,
      });
      return;
    }

    let body: unknown;
    try {
      body = await readBody(request);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const started = runs.start(kind, body);
    if (!started.ok) {
      // `parseArgs`'s line for a run the CLI would refuse, and the slot's own
      // line for a run already in flight — both one line the page shows as it
      // stands. A 409 rather than a 400 because nothing is wrong with the
      // request: it is the console that cannot take it right now.
      sendJson(response, started.problem === "busy" ? 409 : 400, { error: started.error });
      return;
    }
    // Answered before the run has finished, and answered as the run slot
    // already sees it, so the page can start drawing from the answer.
    sendJson(response, 202, started.snapshot);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    sendJson(response, 405, { error: `${method} is not a route of this server` }, { allow: "GET, HEAD" });
    return;
  }

  if (path === "/api/state") {
    sendJson(response, 200, stateOf(config));
    return;
  }

  // What is on disk. Both listings read their roots on every request, and
  // `./results.ts` says what that costs and why it is still the right trade.
  if (path === "/api/series") {
    sendJson(response, 200, await seriesRows(config, runs.inFlightSeries()));
    return;
  }

  if (path === "/api/matches") {
    sendJson(response, 200, await matchRows(config));
    return;
  }

  if (path.startsWith("/api/")) {
    sendJson(response, 404, { error: `no route at ${path}` });
    return;
  }

  // A match log the console listed, served as the JSON it is. The path is
  // looked for under the series root and then under the matches root, and only
  // there: `resolveStatic` refuses a climb out of both, percent-decoded or not,
  // so `/logs/../../etc/passwd` and `/logs/%2e%2e/package.json` are answered the
  // way any other path outside a root is.
  if (path.startsWith(`${LOG_PREFIX}/`)) {
    const file = logPathOf(config, path.slice(LOG_PREFIX.length + 1));
    if (file === null || !sendFile(file, method === "HEAD", response)) {
      sendJson(response, 404, { error: `no match log at ${path}` });
      return;
    }
    return;
  }

  // The built replay viewer. `/viewer` without the trailing slash is redirected
  // rather than served: the built `index.html` resolves its assets relative to
  // the page (`base: "./"` in the viewer's `vite.config.ts`), so a page served
  // at `/viewer` would ask for them at `/assets/...` and be answered from the
  // console's own app root, where there is no such file. With the slash,
  // `./assets/...` is `/viewer/assets/...`, which is where the built files are.
  if (path === VIEWER_PREFIX) {
    response.writeHead(302, { location: `${VIEWER_PREFIX}/`, "content-length": "0" });
    response.end();
    return;
  }
  if (path.startsWith(`${VIEWER_PREFIX}/`)) {
    serveBuilt(config.viewerRoot, path.slice(VIEWER_PREFIX.length), NOT_BUILT_VIEWER, method === "HEAD", response);
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
 * A route that returns a promise can still reject, and that is the same failure
 * answered the same way.
 */
const handle = (
  config: UiConfig,
  stateOf: StateOf,
  runs: RunSlot,
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

  /** One line the page can show, and the same one for whoever is at a terminal. */
  const failed = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`no-dice-ui: ${path}: ${message}`);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, 500, { error: `the console could not answer ${path}: ${message}` });
  };

  try {
    route(config, stateOf, runs, path, request.method ?? "GET", request, response).catch(failed);
  } catch (error) {
    failed(error);
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
  // One slot per console, made here rather than at module scope: a test that
  // starts two consoles in one process must not have them refuse each
  // other's runs, and a console that is closed has no run to hand on.
  const runs = createRunSlot({ roots: config, cwd: config.cwd });
  const server = createServer((request, response) => handle(config, stateOf, runs, request, response));

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
      if (resolveStatic(config.viewerRoot, "/index.html") === null) {
        console.log(`the viewer is not built: "pnpm --filter @no-dice/salient-viewer build" builds it`);
      }
    } catch (error) {
      // A port already taken is the usual one, and it is said in one line rather
      // than as a stack trace over a terminal that is trying to start a run.
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
