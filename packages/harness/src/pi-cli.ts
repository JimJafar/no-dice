/**
 * The Pi build a match runs on, found through this repo's dependency on it.
 *
 * brief §6.3 asks for the Pi version to be pinned and recorded in every log
 * header, and this is where that pin is kept: `packages/harness/package.json`
 * depends on `@earendil-works/pi-coding-agent` at an exact version, and
 * `piCli()` hands back the path and the version of the copy that dependency
 * installed. Everything in the Pi milestone spawns `node <path> …` with that
 * path, and nothing runs `pi`.
 *
 * The `pi` on `PATH` is not a usable substitute: it is whatever a machine has
 * installed, and a Pi from before 1.0 has no MCP support at all, so a seat
 * started through one would have no game tools to call and would still start
 * cleanly. Resolving
 * through the dependency instead makes the version a match reports the version
 * the lockfile pins, and makes a checkout that installed a different Pi a
 * visibly different match.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The package the pinned Pi is installed from. */
export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** The pinned Pi, as a command line: what to run, and which version it is. */
export interface PiCli {
  /** Absolute path to the installed package's `dist/cli.js`, to spawn as `node <path> …`. */
  path: string;
  /** The exact version the dependency installed, e.g. `"1.0.2"`. */
  version: string;
}

/**
 * Where the installed Pi lives, and what version it is.
 *
 * The package's exports map names its entry (`dist/index.js`, which is also
 * where `RpcClient` comes from) and no path to its own manifest, so the
 * manifest is read from beside the entry's directory, and the CLI is taken to
 * sit in the same `dist/` as the entry. Both assumptions are checked rather
 * than relied on: a Pi build that lays itself out differently is an error here,
 * not a match that silently runs on something else.
 */
export const piCli = (): PiCli => {
  const entry = fileURLToPath(import.meta.resolve(PI_PACKAGE));
  const dist = dirname(entry);
  const manifest = JSON.parse(readFileSync(join(dirname(dist), "package.json"), "utf-8")) as {
    name?: unknown;
    version?: unknown;
  };
  if (manifest.name !== PI_PACKAGE || typeof manifest.version !== "string") {
    throw new Error(`${PI_PACKAGE} resolved to ${entry}, which is not its installed package`);
  }
  const path = join(dist, "cli.js");
  if (!existsSync(path)) {
    throw new Error(`${PI_PACKAGE} ${manifest.version} has no dist/cli.js at ${path}`);
  }
  return { path, version: manifest.version };
};
