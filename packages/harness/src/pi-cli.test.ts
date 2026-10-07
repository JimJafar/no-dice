/**
 * The Pi build a match runs on.
 *
 * A match is only comparable with another match if it ran on the same Pi, and
 * the Pi on `PATH` is not a build anyone pinned: it is whatever a machine has
 * installed, and one from before 1.0 has no MCP support at all, so a seat
 * started through it would be handed no game tools and would still start
 * without complaint. These tests
 * hold the two things brief §6.3 asks for — an exact version in the harness's
 * dependencies, and a path to the copy that dependency installed — and then
 * prove the build is what it claims to be by asking it: `--version` has to
 * match the pin, and `mcp list --json` has to answer, which is a command a
 * pre-1.0 Pi does not have.
 *
 * The three tests that ask the build itself — two `pi` processes and one import
 * of the whole package — carry a timeout of their own, for the same reason the
 * other Pi test files do: they cost a real process and a real module graph, so
 * what they cost in wall clock is whatever the machine will spare. The two that
 * only read files keep vitest's default.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PI_PACKAGE, piCli } from "./pi-cli.ts";

/** The version `packages/harness/package.json` pins, and every log header records. */
const PINNED = "1.0.2";

/**
 * How long a test that starts the pinned `pi`, or imports it, may take.
 *
 * A `pi --version` process measures 1.3–1.9 s here, and the import of the
 * package's root pulls in Pi's whole module graph; both are over vitest's 5 s
 * default once other workspaces are sharing the box. 60 s is what
 * `packages/ui/src/providers.test.ts` gives the same kind of probe, and a test
 * that outlives this one is not slow so much as stuck.
 */
const PI_CLI_TIMEOUT_MS = 60_000;

/** This workspace's root, which is where the pinned Pi has to have come from. */
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Read a JSON file at an absolute path. */
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;

/**
 * Run the resolved CLI the way a seat is run: as `node <path> …`, with a
 * throwaway `PI_CODING_AGENT_DIR` so it reads nobody's real config, and with
 * the version check and telemetry off so a test run makes no network calls.
 */
const runPi = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [piCli().path, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "no-dice-pi-home-")),
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("the pinned Pi build", () => {
  it("is the installed dependency's dist/cli.js, not a pi from PATH", () => {
    const { path } = piCli();

    expect(existsSync(path)).toBe(true);
    expect(basename(path)).toBe("cli.js");
    expect(basename(dirname(path))).toBe("dist");
    // The package that owns it, and that it came out of this workspace's install.
    expect(readJson(join(dirname(dirname(path)), "package.json")).name).toBe(PI_PACKAGE);
    expect(path.startsWith(join(workspaceRoot, "node_modules"))).toBe(true);
  });

  it("is pinned to an exact version in the harness's dependencies and lockfile", () => {
    const dependencies = readJson(join(workspaceRoot, "packages/harness/package.json"))
      .dependencies as Record<string, string>;

    // An exact specifier, not a range: a caret would let a future Pi change
    // what a match ran on without anything in the repo saying so.
    expect(dependencies[PI_PACKAGE]).toBe(PINNED);

    // The lockfile resolved that pin, and nothing else of the package.
    const lockfile = readFileSync(join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
    expect(lockfile).toContain(`'${PI_PACKAGE}':\n        specifier: ${PINNED}\n`);
    const resolved = [...lockfile.matchAll(/@earendil-works\/pi-coding-agent@(\d[^'(:]*)/g)];
    expect(resolved.length).toBeGreaterThan(0);
    expect(new Set(resolved.map((each) => each[1]))).toEqual(new Set([PINNED]));
  });

  it("reports the pinned version, and fails on a 0.x build", () => {
    const { version } = piCli();
    const run = runPi(["--version"]);

    expect(run.status).toBe(0);
    const reported = run.stdout.trim();
    expect(version).toBe(PINNED);
    expect(reported).toBe(version);
    // The Pi on this machine's PATH would answer here with a 0.x.
    expect(reported.split(".")[0]).not.toBe("0");
  }, PI_CLI_TIMEOUT_MS);

  it("has an mcp command, which a pre-1.0 Pi does not", () => {
    const run = runPi(["mcp", "list", "--json"]);

    // An empty config directory holds no mcp.json, so the honest answer is an
    // empty list. A Pi with no `mcp` command exits non-zero instead.
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ servers: [], errors: [] });
  }, PI_CLI_TIMEOUT_MS);

  it("exports RpcClient from its package root, which PiPlayer imports", async () => {
    const pi = (await import(PI_PACKAGE)) as { RpcClient?: unknown };

    expect(typeof pi.RpcClient).toBe("function");
  }, PI_CLI_TIMEOUT_MS);
});
