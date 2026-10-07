/**
 * A seat's Pi home: the directories and the settings file `createSeatHome`
 * writes, the environment it hands the child, and the token that environment
 * carries, which is what the server lets a seat play with and nothing else.
 *
 * That the pinned Pi honours the home — the seven tools and nothing more, the
 * seat's own model — is shown by the seat itself, in `pi-player.test.ts`.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import {
  MatchServer,
  startServer,
  type RunningServer,
} from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSeatHome, type SeatHome } from "./pi-home.ts";

/** Read a JSON file at an absolute path. */
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;

/** An empty directory to play a match in, which `createSeatHome` fills. */
const freshMatchDir = (): string => mkdtempSync(join(tmpdir(), "no-dice-seat-home-"));

describe("the seat home on disk", () => {
  const dirs: string[] = [];
  let matchDir: string;
  let seat: SeatHome;

  beforeAll(() => {
    matchDir = freshMatchDir();
    dirs.push(matchDir);
    seat = createSeatHome({
      matchDir,
      seat: "A",
      serverUrl: "http://127.0.0.1:8787/mcp",
      token: "seat-A-token-32-chars-long-xxxxxxx",
    });
  });

  afterAll(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("makes the three directories brief §6.3 isolates a seat with", () => {
    expect(seat.piHomeDir).toBe(join(matchDir, "pi-home-A"));
    expect(seat.cwd).toBe(join(matchDir, "cwd-A"));
    expect(seat.sessionDir).toBe(join(matchDir, "session-A"));
    for (const dir of [seat.piHomeDir, seat.cwd, seat.sessionDir]) {
      expect(existsSync(dir)).toBe(true);
    }
    // The working directory is empty: a model with a file tool would find no
    // repository, no match log and no other seat's home in it.
    expect(readdirSync(seat.cwd)).toEqual([]);
    // The config directory holds only the settings file the runner wrote.
    expect(readdirSync(seat.piHomeDir)).toEqual(["settings.json"]);
    expect(seat.settingsPath).toBe(join(seat.piHomeDir, "settings.json"));
  });

  it("gives each seat of a match its own three directories", () => {
    const matchDir = freshMatchDir();
    dirs.push(matchDir);
    const a = createSeatHome({ matchDir, seat: "A", serverUrl: "http://h/mcp", token: "tok-A" });
    const b = createSeatHome({ matchDir, seat: "B", serverUrl: "http://h/mcp", token: "tok-B" });

    expect([a.piHomeDir, b.piHomeDir]).toEqual([
      join(matchDir, "pi-home-A"),
      join(matchDir, "pi-home-B"),
    ]);
    expect([a.cwd, b.cwd]).toEqual([join(matchDir, "cwd-A"), join(matchDir, "cwd-B")]);
    expect([a.sessionDir, b.sessionDir]).toEqual([
      join(matchDir, "session-A"),
      join(matchDir, "session-B"),
    ]);
    // The two seats are dealt different tokens, and neither token is in a file.
    expect(a.env.SALIENT_TOKEN).toBe("tok-A");
    expect(b.env.SALIENT_TOKEN).toBe("tok-B");
    expect(readFileSync(b.settingsPath, "utf-8")).not.toContain("tok-B");
  });

  it("writes brief §6.3's settings.json, which leaves the seat the seven tools", () => {
    expect(readJson(seat.settingsPath)).toEqual({
      defaultTools: [],
      autoEnableCodemode: false,
      extensions: ["-builtin:codemode", "-builtin:tool-search", "-builtin:llama.cpp"],
      compaction: { enabled: true },
      quietStartup: true,
    });
  });

  it("hands the child the relocated config directory, the match's endpoint and the token", () => {
    expect(seat.env.PI_CODING_AGENT_DIR).toBe(seat.piHomeDir);
    expect(seat.env.SALIENT_URL).toBe("http://127.0.0.1:8787/mcp");
    expect(seat.env.SALIENT_TOKEN).toBe("seat-A-token-32-chars-long-xxxxxxx");
    // No version check, no telemetry, and long provider cache retention for the
    // conversation that is re-sent on every turn.
    expect(seat.env.PI_SKIP_VERSION_CHECK).toBe("1");
    expect(seat.env.PI_TELEMETRY).toBe("0");
    expect(seat.env.PI_CACHE_RETENTION).toBe("long");
  });

  it("makes every path absolute when the runner names the match directory relatively", () => {
    // `runs/seed-1` is a natural thing for a runner to pass, and a relative
    // `PI_CODING_AGENT_DIR` would be looked for inside the seat's empty cwd.
    const parent = freshMatchDir();
    dirs.push(parent);
    const matchDir = join(parent, "runs", "seed-1");
    const home = createSeatHome({
      matchDir: relative(process.cwd(), matchDir),
      seat: "B",
      serverUrl: "http://127.0.0.1:8787/mcp",
      token: "t",
    });

    expect(isAbsolute(home.piHomeDir)).toBe(true);
    expect(home.piHomeDir).toBe(join(matchDir, "pi-home-B"));
    expect(home.cwd).toBe(join(matchDir, "cwd-B"));
    expect(home.sessionDir).toBe(join(matchDir, "session-B"));
    expect(home.env.PI_CODING_AGENT_DIR).toBe(home.piHomeDir);
  });

  it("rewrites the same home rather than colliding with itself", () => {
    const matchDir = freshMatchDir();
    dirs.push(matchDir);
    const first = createSeatHome({ matchDir, seat: "A", serverUrl: "http://old/mcp", token: "t1" });
    const second = createSeatHome({ matchDir, seat: "A", serverUrl: "http://new/mcp", token: "t2" });

    expect(second.piHomeDir).toBe(first.piHomeDir);
    expect(second.env.SALIENT_URL).toBe("http://new/mcp");
    expect(second.env.SALIENT_TOKEN).toBe("t2");
  });
});

describe("the seat's token against a real match", () => {
  /** The match these tests play, and the endpoint its seat reaches it on. */
  let matches: MatchServer;
  let running: RunningServer;
  let matchId: string;
  let tokens: { A: string; B: string };
  /** Every directory these tests make, so they are all gone when the run ends. */
  const homes: string[] = [];
  let seat: SeatHome;

  beforeAll(async () => {
    matches = new MatchServer();
    running = await startServer({ matches, port: 0 });
    const created = matches.createMatch(135, DEFAULT_CONFIG);
    matchId = created.matchId;
    tokens = created.tokens;
    matches.openTurn(matchId);

    const matchDir = mkdtempSync(join(tmpdir(), "no-dice-seat-match-"));
    homes.push(matchDir);
    seat = createSeatHome({ matchDir, seat: "A", serverUrl: running.url, token: tokens.A });
  });

  afterAll(async () => {
    await running.close();
    for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a tool call made with the token the seat's environment carries", async () => {
    // The token the harness hands the child, used as the only credential, is
    // enough to play: the server answers it and counts the call for the seat.
    const client = new Client({ name: "seat-A-probe", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(running.url), {
      requestInit: { headers: { authorization: `Bearer ${seat.env.SALIENT_TOKEN}` } },
    });
    await client.connect(transport);
    const answered = await client.callTool({ name: "get_rules", arguments: {} });
    await client.close();

    expect(answered.isError).not.toBe(true);
    const recorded = matches.turnRecord(matchId, 1).A.tool_calls;
    expect(recorded.map((call) => call.tool)).toEqual(["get_rules"]);
    expect(recorded[0].error).toBe(false);
  });

  it("refuses the same call with any other token", async () => {
    const client = new Client({ name: "not-a-seat", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(running.url), {
      requestInit: { headers: { authorization: "Bearer a-token-this-match-did-not-deal" } },
    });

    // Rejected at the door, before a session opens: the server answers an
    // unknown token with a 401 and `unknown_token`, so the failure is pinned to
    // the token check rather than to "something went wrong".
    const failure = await client.connect(transport).then(
      () => null,
      (error: unknown) => error as Error & { code?: number },
    );
    expect(failure, "the server took a token it never dealt").toBeInstanceOf(Error);
    expect((failure as { code?: number }).code).toBe(401);
    expect((failure as Error).message).toContain("unknown_token");
  });
});
