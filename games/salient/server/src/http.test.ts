/**
 * The player's whole view of the server: seven tools over Streamable HTTP, and
 * nothing else listening.
 *
 * What these tests pin down is that the transport changes nothing about who a
 * call is for. The bearer token is the only identity a player has, so a token
 * reaches one seat of one match and no other, a request without one never
 * reaches a tool at all, and no tool takes a seat argument that could be pointed
 * at somebody else. The limits themselves are the business of
 * `limits.test.ts`; here what matters is that a call arriving over HTTP is
 * counted by the same session and answered in the same shape.
 *
 * Seed 135 is the map the other server tests use.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";

import { startServer, type RunningServer } from "./http.ts";
import { MatchServer } from "./server.ts";
import { TOOL_NAMES } from "./session.ts";
import type { RulesView, StateView } from "./view.ts";

/** One server holding every match these tests play, and the endpoint over it. */
let matches: MatchServer;
let running: RunningServer;
let url: string;
/** Every client a test opened, so they are all shut before the run ends. */
const clients: Client[] = [];

beforeAll(async () => {
  matches = new MatchServer();
  running = await startServer({ matches, port: 0 });
  url = running.url;
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
  await running.close();
});

/** A real MCP client holding one seat's token. */
const connect = async (token: string): Promise<Client> => {
  const client = new Client({ name: "salient-player", version: "0.0.0" });
  // Held from the moment it is made: a connection this server refuses still has
  // a transport to shut, and a test run that leaves one open never exits.
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
};

/** The JSON a tool answered: the session's own result, as its text content. */
const answer = async <T>(client: Client, tool: string, args: Record<string, unknown> = {}): Promise<T> => {
  const result = await client.callTool({ name: tool, arguments: args });
  const content = result.content as [{ type: string; text: string }];
  return JSON.parse(content[0].text) as T;
};

/** A `POST` of a raw JSON-RPC message, with or without a token and a session. */
const post = (body: unknown, token: string | null, sessionId?: string): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
    },
    body: JSON.stringify(body),
  });

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "raw-client", version: "0.0.0" },
  },
};

/** A match with its first turn open, and both seats' tokens in hand. */
const openedMatch = (seed = 135): { matchId: string; tokens: Record<"A" | "B", string> } => {
  const { matchId, tokens } = matches.createMatch(seed, DEFAULT_CONFIG);
  matches.openTurn(matchId);
  return { matchId, tokens };
};

describe("startServer", () => {
  it("listens on the loopback address, and on a free port when asked for one", async () => {
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(running.port).toBeGreaterThan(0);

    // `0` is how a runner avoids collisions: two of them asking for a free port
    // get different ones, and neither has to know about the other.
    const other = await startServer({ matches, port: 0 });
    try {
      expect(other.port).not.toBe(running.port);
    } finally {
      await other.close();
    }
  });

  it("answers a request for a path it is not serving", async () => {
    const { tokens } = openedMatch();
    const res = await fetch(`http://127.0.0.1:${String(running.port)}/elsewhere`, {
      headers: { authorization: `Bearer ${tokens.A}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("the tools", () => {
  it("are exactly the seven, and none of them takes a seat", async () => {
    const { tokens } = openedMatch();
    const client = await connect(tokens.A);

    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const tool of tools) {
      const schema = tool.inputSchema as { properties?: Record<string, unknown> };
      expect(schema.properties ?? {}).not.toHaveProperty("seat");
    }
  });

  it("give a client holding seat A's token seat A's match", async () => {
    const { tokens } = openedMatch();
    const client = await connect(tokens.A);

    const rules = await answer<RulesView>(client, "get_rules");
    expect(rules.bases.you).toBe("B6");
    expect(rules.constants.turns).toBe(DEFAULT_CONFIG.turns);

    const state = await answer<StateView>(client, "get_state");
    expect(state.turn).toBe(1);
    expect(state.hexes.find((hex) => hex.id === rules.bases.you)?.owner).toBe("you");
    // The seat's own Base is never reported as the enemy's, from either end.
    expect(state.hexes.find((hex) => hex.id === rules.bases.enemy)?.owner).not.toBe("you");

    const across = await connect(tokens.B);
    const theirRules = await answer<RulesView>(across, "get_rules");
    expect(theirRules.bases).toEqual({ you: rules.bases.enemy, enemy: rules.bases.you });
    expect((await answer<StateView>(across, "get_state")).hexes.find((hex) => hex.id === theirRules.bases.you)?.owner).toBe(
      "you",
    );
  });

  it("carry the session's refusals in the same shape, with isError set", async () => {
    const { matchId, tokens } = openedMatch();
    const client = await connect(tokens.A);

    // Notes over the length brief §6.2 allows are refused by the session, which
    // is where the limit lives, and the seat is told which limit it hit.
    const result = await client.callTool({ name: "write_notes", arguments: { notes: "x".repeat(2001) } });
    expect(result.isError).toBe(true);
    await expect(answer<{ notes: string }>(client, "read_notes")).resolves.toEqual({ notes: "" });
    const content = result.content as [{ type: string; text: string }];
    expect(JSON.parse(content[0].text)).toEqual({ error: "notes_too_long" });
    expect(matches.match(matchId).counters("A").toolCalls).toBe(2);
  });

  it("refuse a call that names a seat, because the token already decided it", async () => {
    const { matchId, tokens } = openedMatch();
    const client = await connect(tokens.A);

    // Every input schema is strict, so a seat argument is turned away at the
    // door — and a call that never reaches the session is never counted.
    const result = await client.callTool({ name: "get_state", arguments: { seat: "B" } });
    expect(result.isError).toBe(true);
    expect(matches.turnRecord(matchId, 1).A.tool_calls).toEqual([]);
  });
});

describe("one server, several matches", () => {
  it("keeps each token to its own match and its own seat", async () => {
    const first = openedMatch(135);
    const second = openedMatch(136);

    // Play the first match one turn further on, so the two are told different
    // things and a token that crossed over would show it.
    matches.resolveTurn(first.matchId);
    matches.openTurn(first.matchId);

    const inFirst = await connect(first.tokens.A);
    const inSecond = await connect(second.tokens.B);
    expect((await answer<StateView>(inFirst, "get_state")).turn).toBe(2);
    expect((await answer<StateView>(inSecond, "get_state")).turn).toBe(1);

    // What one seat writes stays in its own match, and out of the other's.
    await answer(inFirst, "write_notes", { notes: "first match" });
    expect(await answer<{ notes: string }>(inSecond, "read_notes")).toEqual({ notes: "" });
    expect(await answer<{ notes: string }>(inFirst, "read_notes")).toEqual({ notes: "first match" });
  });

  it("never lets one seat's session be driven by another seat's token", async () => {
    const { tokens } = openedMatch();
    const opened = await post(initialize, tokens.A);
    const sessionId = opened.headers.get("mcp-session-id");
    expect(sessionId).not.toBeNull();

    const hijacked = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_state", arguments: {} } },
      tokens.B,
      sessionId as string,
    );
    expect(hijacked.status).toBe(401);

    // Seat B's own session, opened with its own token, still answers.
    const client = await connect(tokens.B);
    expect((await answer<StateView>(client, "get_state")).turn).toBe(1);
  });
});

describe("the token", () => {
  it("is refused before any tool runs, whether it is missing or unknown", async () => {
    const { matchId } = openedMatch();

    const missing = await post(initialize, null);
    expect(missing.status).toBe(401);
    const unknown = await post(initialize, "not-a-token-any-issued-here");
    expect(unknown.status).toBe(401);

    // A token this server never issued cannot open a session at all.
    const refused = await connect("not-a-token-any-issued-here").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(StreamableHTTPError);
    expect((refused as StreamableHTTPError).code).toBe(401);

    // Nothing reached a tool: no call counted, nothing in the log's transcript.
    expect(matches.match(matchId).counters("A").toolCalls).toBe(0);
    expect(matches.turnRecord(matchId, 1).A.tool_calls).toEqual([]);
  });

  it("is refused when it is not a bearer token at all", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", authorization: "Basic no" },
      body: JSON.stringify(initialize),
    });
    expect(res.status).toBe(401);
  });
});
