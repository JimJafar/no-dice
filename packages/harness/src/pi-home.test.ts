/**
 * A seat's Pi home, and whether the pinned Pi actually reads it.
 *
 * A Pi session inherits the developer's `~/.pi/agent` unless it is told not to:
 * its settings, extensions, skills, context files and logins. A match played
 * with those in play is a different match — the model would have `bash` and
 * `read` beside the seven game tools, and whatever skills the machine it ran on
 * happened to hold. So the interesting question is not only what files
 * `createSeatHome` writes, but whether the Pi this repo pins honours them:
 * whether a relocated `PI_CODING_AGENT_DIR` is where it looks for `mcp.json`,
 * whether `${SALIENT_TOKEN}` is substituted from the child's environment, and
 * whether the server it then reaches is the match's, named by the seat's own
 * file rather than by anything in a home directory.
 *
 * The first suite reads the files back. The second runs the pinned CLI against
 * a real Salient server on a real socket, and uses `pi mcp list` as the
 * assertion: it exits 1 when an enabled server is not connected, so a seat that
 * failed to reach its match, or reached it with the wrong token, fails the test
 * rather than reporting a server nobody connected to.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import {
  MatchServer,
  TOOL_NAMES,
  startServer,
  type RunningServer,
} from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { piCli } from "./pi-cli.ts";
import { createSeatHome, type SeatHome } from "./pi-home.ts";

/** Read a JSON file at an absolute path. */
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;

/** An empty directory to play a match in, which `createSeatHome` fills. */
const freshMatchDir = (): string => mkdtempSync(join(tmpdir(), "no-dice-seat-home-"));

/** The seven tools, in the order the server registers them. */
const SEVEN = [...TOOL_NAMES];

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
    // The config directory holds only the two files the runner wrote.
    expect(readdirSync(seat.piHomeDir).sort()).toEqual(["mcp.json", "settings.json"]);
    expect(seat.mcpConfigPath).toBe(join(seat.piHomeDir, "mcp.json"));
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
    expect(readFileSync(b.mcpConfigPath, "utf-8")).not.toContain("tok-B");
  });

  it("points one `salient` server at the match, with the token as a placeholder", () => {
    const config = readJson(seat.mcpConfigPath);
    const servers = config.mcpServers as Record<string, Record<string, unknown>>;

    expect(Object.keys(servers)).toEqual(["salient"]);
    expect(servers.salient).toEqual({
      url: "http://127.0.0.1:8787/mcp",
      headers: { Authorization: "Bearer ${SALIENT_TOKEN}" },
      // `direct` is what makes every game action an ordinary tool call the
      // server and the log can count; Pi's default would hide them in codemode.
      exposure: "direct",
      description: "Salient game tools for this match",
    });

    // The token is in the environment, never in a file that gets read, diffed
    // and committed.
    const written =
      readFileSync(seat.mcpConfigPath, "utf-8") + readFileSync(seat.settingsPath, "utf-8");
    expect(written).toContain("${SALIENT_TOKEN}");
    expect(written).not.toContain("seat-A-token-32-chars-long-xxxxxxx");
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

  it("hands the child the relocated config directory and the token", () => {
    expect(seat.env.PI_CODING_AGENT_DIR).toBe(seat.piHomeDir);
    expect(seat.env.SALIENT_TOKEN).toBe("seat-A-token-32-chars-long-xxxxxxx");
    // No version check, no telemetry, and long provider cache retention for the
    // conversation that is re-sent on every turn.
    expect(seat.env.PI_SKIP_VERSION_CHECK).toBe("1");
    expect(seat.env.PI_TELEMETRY).toBe("0");
    expect(seat.env.PI_CACHE_RETENTION).toBe("long");
  });

  it("rewrites the same home rather than colliding with itself", () => {
    const matchDir = freshMatchDir();
    dirs.push(matchDir);
    const first = createSeatHome({ matchDir, seat: "A", serverUrl: "http://old/mcp", token: "t1" });
    const second = createSeatHome({ matchDir, seat: "A", serverUrl: "http://new/mcp", token: "t2" });

    expect(second.piHomeDir).toBe(first.piHomeDir);
    const servers = readJson(second.mcpConfigPath).mcpServers as Record<string, { url: string }>;
    expect(servers.salient.url).toBe("http://new/mcp");
    expect(second.env.SALIENT_TOKEN).toBe("t2");
  });
});

describe("the seat home against the pinned Pi and a real match", () => {
  /** The match these tests play, and the endpoint its seat reaches it on. */
  let matches: MatchServer;
  let running: RunningServer;
  let matchId: string;
  let matchDir: string;
  let seat: SeatHome;
  let token: string;

  /**
   * How long a seat's `pi mcp list` gets: Pi takes a second or two to start, and
   * a seat that cannot reach its match takes Pi's own connection timeout — a
   * minute — before it reports the failure.
   */
  const SEAT_TIMEOUT_MS = 90_000;

  beforeAll(async () => {
    matches = new MatchServer();
    running = await startServer({ matches, port: 0 });
    const created = matches.createMatch(135, DEFAULT_CONFIG);
    matchId = created.matchId;
    token = created.tokens.A;
    matches.openTurn(matchId);

    matchDir = mkdtempSync(join(tmpdir(), "no-dice-seat-match-"));
    seat = createSeatHome({ matchDir, seat: "A", serverUrl: running.url, token });
  });

  afterAll(async () => {
    await running.close();
    rmSync(matchDir, { recursive: true, force: true });
  });

  /**
   * Ask the pinned Pi what MCP servers the seat has, running it exactly the way
   * a seat is run: from the seat's empty working directory, with the seat's
   * environment and nothing else added.
   *
   * Asynchronously on purpose. The match these seats reach is served from this
   * same process, so a blocking `spawnSync` would park the event loop, the
   * server would never answer the child, and the test would measure a
   * connection that could not have worked.
   */
  const mcpList = (env: Record<string, string>): Promise<{ status: number | null; stdout: string }> =>
    new Promise((settled, failed) => {
      const child = spawn(process.execPath, [piCli().path, "mcp", "list", "--json"], {
        cwd: seat.cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.resume();
      child.on("error", failed);
      child.on("close", (status) => settled({ status, stdout }));
    });

  /** The single server entry `pi mcp list --json` reported. */
  const listedServer = (stdout: string): Record<string, unknown> => {
    const listed = JSON.parse(stdout) as { servers: Record<string, unknown>[]; errors: unknown[] };
    expect(listed.errors).toEqual([]);
    expect(listed.servers).toHaveLength(1);
    return listed.servers[0];
  };

  it(
    "connects the seat to the match and offers it exactly the seven tools",
    async () => {
      const run = await mcpList(seat.env);

      // `pi mcp list` exits 1 when an enabled server is not connected, so a
      // seat that could not reach its match fails here rather than reporting a
      // server nobody connected to.
      expect(run.status).toBe(0);
      const server = listedServer(run.stdout);
      expect(server.name).toBe("salient");
      expect(server.state).toBe("connected");
      expect(server.enabled).toBe(true);
      expect(server.exposure).toBe("direct");
      expect(server.transport).toBe(running.url);
      expect((server.tools as string[]).slice().sort()).toEqual(SEVEN.slice().sort());
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "reads the seat's own mcp.json, so nothing from ~/.pi/agent is in play",
    async () => {
      const server = listedServer((await mcpList(seat.env)).stdout);

      // `global` scope: the config directory was relocated, so the file is read
      // without the project trust a `.pi/mcp.json` in the working directory
      // would need — and the seat's cwd is empty, so there is no project file.
      expect(server.scope).toBe("global");
      expect(server.source).toBe(seat.mcpConfigPath);
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "fails the seat whose token does not reach the server",
    async () => {
      // The same home, the same server, a token this match never dealt.
      const run = await mcpList({ ...seat.env, SALIENT_TOKEN: "a-token-this-match-did-not-deal" });

      expect(run.status).toBe(1);
      const server = listedServer(run.stdout);
      expect(server.state).not.toBe("connected");
      expect(server.tools).toEqual([]);
    },
    SEAT_TIMEOUT_MS,
  );

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

    await expect(client.connect(transport)).rejects.toThrow();
  });
});
