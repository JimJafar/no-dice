/**
 * Reading a file out of the directory the console serves — the built browser app
 * in `web/dist` — without letting a URL read anything else.
 *
 * A path is served only when it stays inside that directory twice over: once
 * after it has been percent-decoded and resolved, and once again after symlinks
 * have been followed. `/%2e%2e/package.json` and a symlink planted inside `dist`
 * are each a request for a file the console was never given, and both are
 * refused here rather than at each call site, so there is one answer to "can
 * this path be read".
 *
 * Nothing is streamed here: this file decides which file a request may have,
 * and `server.ts` writes it. The content-type map covers every file the console
 * serves that way — the built app's assets, the match logs under `/logs/`, and
 * the `report.md` a finished series wrote beside its record.
 */
import { realpathSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

/** The types the built app is made of, so a browser gets a `<script>` it will run. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  // A series' `report.md`, which the console serves under `/logs/` and the
  // leaderboard links to: text a browser shows, rather than bytes it downloads.
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** A file's type by its extension, and a type nothing will mistake for a script. */
export const contentTypeOf = (path: string): string =>
  CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

/**
 * The file inside `root` that `urlPath` asks for, or `null` when
 * it asks for nothing servable: a path that leaves `root`, a path that is not
 * there, a directory, or a symlink that leads out of it.
 *
 * `urlPath` is the request's own path, undecoded — a browser or a `curl
 * --path-as-is` can name `..` in either form, and both have to be refused.
 */
export const resolveStatic = (root: string, urlPath: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // a path that is not percent-decodable names no file either
  }
  if (decoded.includes("\0")) return null;

  const base = resolve(root);
  // Leading slashes go first: `resolve` would otherwise take an absolute-looking
  // path as an absolute path and leave `base` behind.
  const target = resolve(base, decoded.replace(/^\/+/, ""));
  if (target !== base && !target.startsWith(base + sep)) return null;

  try {
    if (!statSync(target).isFile()) return null;
    const real = realpathSync(target);
    const realBase = realpathSync(base);
    return real === realBase || real.startsWith(realBase + sep) ? real : null;
  } catch {
    return null; // not there, or not readable, or a root that does not exist yet
  }
};
