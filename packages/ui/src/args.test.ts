/**
 * The console's own command line: what it defaults to, and how a mistake is
 * named. The host is not among the flags, and a test that it is not is a test
 * that the console cannot be pointed at a network interface by accident.
 */
import { describe, expect, it } from "vitest";

import { PROVIDERS_FILE } from "@no-dice/runner/providers";

import {
  DEFAULT_MATCHES_ROOT,
  DEFAULT_PORT,
  DEFAULT_REPORTS_ROOT,
  DEFAULT_SERIES_ROOT,
  USAGE,
  parseUiFlags,
} from "./args.ts";

/** The flags, or the one line the parser answered with. */
const flagsOf = (argv: readonly string[]): unknown => {
  const parsed = parseUiFlags(argv);
  return parsed.ok ? parsed.flags : parsed.error;
};

describe("parseUiFlags", () => {
  it("defaults the port and the three roots it reads", () => {
    expect(flagsOf([])).toEqual({
      port: DEFAULT_PORT,
      seriesRoot: DEFAULT_SERIES_ROOT,
      matchesRoot: DEFAULT_MATCHES_ROOT,
      reportsRoot: DEFAULT_REPORTS_ROOT,
      providersFile: PROVIDERS_FILE,
    });
    expect(DEFAULT_PORT).toBe(8765);
    expect(DEFAULT_SERIES_ROOT).toBe("series");
    expect(DEFAULT_MATCHES_ROOT).toBe("matches");
    // The kept copies are where `docs/series-notes.md` §7 puts them, which is a
    // directory the runner never writes and only a reader keeps.
    expect(DEFAULT_REPORTS_ROOT).toBe("reports/series");
    // The registry defaults to the runner's own constant, so a console started
    // with no flag writes the very file a terminal run seats its runs on.
    expect(PROVIDERS_FILE.endsWith("providers.json")).toBe(true);
  });

  it("takes each flag, and leaves a path as it was given", () => {
    expect(
      flagsOf([
        "--port",
        "8795",
        "--series-root",
        "/tmp/nd-ui/series",
        "--matches-root",
        "matches",
        "--reports-root",
        "/tmp/nd-ui/reports",
        "--providers",
        "/tmp/nd-ui/providers.json",
      ]),
    ).toEqual({
      port: 8795,
      seriesRoot: "/tmp/nd-ui/series",
      matchesRoot: "matches",
      reportsRoot: "/tmp/nd-ui/reports",
      providersFile: "/tmp/nd-ui/providers.json",
    });
    // A relative root stays relative here; the server resolves it against its
    // own current directory, which is the only place that knows it.
    expect(flagsOf(["--series-root", "../elsewhere"])).toEqual({
      port: DEFAULT_PORT,
      seriesRoot: "../elsewhere",
      matchesRoot: DEFAULT_MATCHES_ROOT,
      reportsRoot: DEFAULT_REPORTS_ROOT,
      providersFile: PROVIDERS_FILE,
    });
  });

  it("takes port 0, which is how a test asks for a free port", () => {
    expect(flagsOf(["--port", "0"])).toEqual({
      port: 0,
      seriesRoot: DEFAULT_SERIES_ROOT,
      matchesRoot: DEFAULT_MATCHES_ROOT,
      reportsRoot: DEFAULT_REPORTS_ROOT,
      providersFile: PROVIDERS_FILE,
    });
  });

  it("has no host flag, because the console listens on loopback only", () => {
    const parsed = parseUiFlags(["--host", "0.0.0.0"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toMatch(/unknown flag "--host"/);
  });

  it("names a flag it does not have, and lists the ones it does", () => {
    const parsed = parseUiFlags(["--portt", "8795"]);
    expect(parsed.ok ? "" : parsed.error).toMatch(/unknown flag "--portt".*--port, --series-root, --matches-root/);
  });

  it("names an argument that is not a flag", () => {
    expect(flagsOf(["serve"])).toMatch(/unexpected argument "serve"/);
  });

  it("names a flag given twice rather than taking the last one", () => {
    expect(flagsOf(["--port", "1", "--port", "2"])).toMatch(/--port given twice/);
    expect(flagsOf(["--providers", "a.json", "--providers", "b.json"])).toMatch(
      /--providers given twice/,
    );
    expect(flagsOf(["--reports-root", "one", "--reports-root", "two"])).toMatch(
      /--reports-root given twice/,
    );
  });

  it("names a flag with no value, including one whose value looks like a flag", () => {
    expect(flagsOf(["--series-root"])).toMatch(/--series-root needs a value/);
    expect(flagsOf(["--series-root", "--port", "1"])).toMatch(/--series-root needs a value/);
    expect(flagsOf(["--reports-root"])).toMatch(/--reports-root needs a value/);
  });

  it("refuses a port that is not a whole number in the range the operating system has", () => {
    expect(flagsOf(["--port", "87.5"])).toMatch(/--port takes a whole number, not "87.5"/);
    expect(flagsOf(["--port", "65536"])).toMatch(/between 0 and 65535/);
    expect(flagsOf(["--port", "-1"])).toMatch(/between 0 and 65535/);
  });

  it("refuses a root named as nothing", () => {
    expect(flagsOf(["--matches-root", ""])).toMatch(/--matches-root needs a directory/);
    expect(flagsOf(["--reports-root", ""])).toMatch(/--reports-root needs a directory/);
    expect(flagsOf(["--providers", ""])).toMatch(/--providers needs a file/);
  });

  it("gives the usage line a mistake at the terminal can be answered with", () => {
    expect(USAGE).toBe(
      "usage: no-dice-ui [--port <n>] [--series-root <dir>] [--matches-root <dir>] " +
        "[--reports-root <dir>] [--providers <file>]",
    );
  });
});
