/**
 * The console's own command line: what it defaults to, and how a mistake is
 * named. The host is not among the flags, and a test that it is not is a test
 * that the console cannot be pointed at a network interface by accident.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_MATCHES_ROOT, DEFAULT_PORT, DEFAULT_SERIES_ROOT, USAGE, parseUiFlags } from "./args.ts";

/** The flags, or the one line the parser answered with. */
const flagsOf = (argv: readonly string[]): unknown => {
  const parsed = parseUiFlags(argv);
  return parsed.ok ? parsed.flags : parsed.error;
};

describe("parseUiFlags", () => {
  it("defaults the port and the two roots to the runner's own", () => {
    expect(flagsOf([])).toEqual({
      port: DEFAULT_PORT,
      seriesRoot: DEFAULT_SERIES_ROOT,
      matchesRoot: DEFAULT_MATCHES_ROOT,
    });
    expect(DEFAULT_PORT).toBe(8765);
    expect(DEFAULT_SERIES_ROOT).toBe("series");
    expect(DEFAULT_MATCHES_ROOT).toBe("matches");
  });

  it("takes each flag, and leaves a path as it was given", () => {
    expect(
      flagsOf(["--port", "8795", "--series-root", "/tmp/nd-ui/series", "--matches-root", "matches"]),
    ).toEqual({ port: 8795, seriesRoot: "/tmp/nd-ui/series", matchesRoot: "matches" });
    // A relative root stays relative here; the server resolves it against its
    // own current directory, which is the only place that knows it.
    expect(flagsOf(["--series-root", "../elsewhere"])).toEqual({
      port: DEFAULT_PORT,
      seriesRoot: "../elsewhere",
      matchesRoot: DEFAULT_MATCHES_ROOT,
    });
  });

  it("takes port 0, which is how a test asks for a free port", () => {
    expect(flagsOf(["--port", "0"])).toEqual({
      port: 0,
      seriesRoot: DEFAULT_SERIES_ROOT,
      matchesRoot: DEFAULT_MATCHES_ROOT,
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
  });

  it("names a flag with no value, including one whose value looks like a flag", () => {
    expect(flagsOf(["--series-root"])).toMatch(/--series-root needs a value/);
    expect(flagsOf(["--series-root", "--port", "1"])).toMatch(/--series-root needs a value/);
  });

  it("refuses a port that is not a whole number in the range the operating system has", () => {
    expect(flagsOf(["--port", "87.5"])).toMatch(/--port takes a whole number, not "87.5"/);
    expect(flagsOf(["--port", "65536"])).toMatch(/between 0 and 65535/);
    expect(flagsOf(["--port", "-1"])).toMatch(/between 0 and 65535/);
  });

  it("refuses a root named as nothing", () => {
    expect(flagsOf(["--matches-root", ""])).toMatch(/--matches-root needs a directory/);
  });

  it("gives the usage line a mistake at the terminal can be answered with", () => {
    expect(USAGE).toBe("usage: no-dice-ui [--port <n>] [--series-root <dir>] [--matches-root <dir>]");
  });
});
