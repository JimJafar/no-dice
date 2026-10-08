/**
 * The tools a seat's Pi process ends up with.
 *
 * `seat-tools.ts` runs inside the seat, not the runner: it reaches the match,
 * asks the server what its tools are, and registers each one under the name the
 * server gives it. That naming is the point — Pi's built-in MCP support would
 * prefix every one with `mcp__salient__`, and a seat that shortens the prefix
 * wastes the call — so the names are pinned here, along with the two things a
 * seat cannot survive without: the calls arriving at its own match as
 * its own seat, and a seat that cannot reach its match failing to start rather
 * than playing a turn with no tools.
 *
 * The match is real — `MatchServer` behind `startServer` on a loopback port —
 * so the tools are listed and called over a socket exactly as a seat calls them.
 * Pi itself is not run: what this file can be asked is what the extension
 * registers and forwards. That Pi loads the extension and offers the tools to
 * the model is shown by the seat itself, in `pi-player.test.ts`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import {
  MatchServer,
  startServer,
  TOOL_NAMES,
  type RunningServer,
} from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import seatTools, { TOKEN_VAR, URL_VAR } from "./seat-tools.ts";

/** What a tool answer hands back: the server's own content blocks, and whether it errored. */
type ToolContent = { type: string; text?: string; data?: string; mimeType?: string }[];

/** One tool the extension registered, in the shape Pi is handed. */
type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<{ content: ToolContent; details: unknown; isError: boolean }>;
};

/**
 * The slice of Pi's extension API the extension uses: `registerTool` once per
 * tool the server lists, and `on("session_shutdown")` to let go of the match.
 * `emit` runs what was subscribed, the way Pi does when the session ends.
 */
const fakePi = () => {
  const tools: RegisteredTool[] = [];
  const handlers = new Map<string, (() => void | Promise<void>)[]>();
  return {
    tools,
    registerTool: (tool: RegisteredTool): void => void tools.push(tool),
    on: (event: string, handler: () => void | Promise<void>): void => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    emit: async (event: string): Promise<void> => {
      for (const handler of handlers.get(event) ?? []) await handler();
    },
  };
};

/** Run `body` with the seat's endpoint and token in its environment. */
const asSeat = async <T>(url: string, token: string, body: () => Promise<T>): Promise<T> => {
  const saved = { url: process.env[URL_VAR], token: process.env[TOKEN_VAR] };
  process.env[URL_VAR] = url;
  process.env[TOKEN_VAR] = token;
  try {
    return await body();
  } finally {
    for (const [name, value] of [
      [URL_VAR, saved.url],
      [TOKEN_VAR, saved.token],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

/** The tool the extension registered under `name`. */
const toolNamed = (pi: ReturnType<typeof fakePi>, name: string): RegisteredTool => {
  const found = pi.tools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`the seat was never given ${name}`);
  return found;
};

/** The error `body` threw, or `null` when it settled. */
const failureOf = async (body: () => Promise<unknown>): Promise<Error | null> =>
  body().then(
    () => null,
    (error: unknown) => error as Error,
  );

/** The text of a tool answer's first content block, read as JSON. */
const firstText = (content: ToolContent): Record<string, unknown> => {
  expect(content[0]?.type).toBe("text");
  return JSON.parse(content[0]?.text ?? "") as Record<string, unknown>;
};

describe("the seat's tools against a real match", () => {
  /** The match the extension reaches, and the seat whose token it was given. */
  let matches: MatchServer;
  let running: RunningServer;
  let matchId: string;
  let tokens: { A: string; B: string };
  /** The seat's Pi process: one extension, one connection, as in a real match. */
  let seat: ReturnType<typeof fakePi>;

  beforeAll(async () => {
    matches = new MatchServer();
    running = await startServer({ matches, port: 0 });
    const created = matches.createMatch(135, DEFAULT_CONFIG);
    matchId = created.matchId;
    tokens = created.tokens;
    matches.openTurn(matchId);

    seat = fakePi();
    await asSeat(running.url, tokens.A, () => seatTools(seat as unknown as ExtensionAPI));
  });

  afterAll(async () => {
    await seat.emit("session_shutdown");
    await running.close();
  });

  it("registers the match's tools under the game's own names", async () => {
    // The names a model is offered, and so the names it answers with.
    expect(seat.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    expect(seat.tools.map((tool) => tool.label)).toEqual([...TOOL_NAMES]);
    // Nothing of Pi's MCP prefix survives into a seat's tool list: this is the
    // whole reason the extension exists.
    expect(seat.tools.map((tool) => tool.name).filter((name) => name.includes("mcp__"))).toEqual(
      [],
    );
  });

  it("registers each tool with the server's own description and input schema", async () => {
    // The server's `tools/list` is what the extension was handed, so it is what
    // a seat should be able to call with: no invented description, no schema
    // narrowed on the way through.
    const probe = new Client({ name: "the-tools-as-the-server-gives-them", version: "0.0.0" });
    await probe.connect(
      new StreamableHTTPClientTransport(new URL(running.url), {
        requestInit: { headers: { authorization: `Bearer ${tokens.A}` } },
      }),
    );
    const listed = await probe.listTools();
    await probe.close();

    expect(listed.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const given of listed.tools) {
      const registered = toolNamed(seat, given.name);
      expect(registered.description, `${given.name}'s description`).toBe(given.description);
      const schema = given.inputSchema as { properties?: unknown; required?: unknown };
      expect(registered.parameters.properties, `${given.name}'s properties`).toEqual(
        schema.properties ?? {},
      );
      if (schema.required !== undefined) {
        expect(registered.parameters.required, `${given.name}'s required`).toEqual(schema.required);
      }
    }
  });

  it("forwards a call to the match and answers with the server's own content", async () => {
    const answered = await toolNamed(seat, "get_state").execute("call-1", {});

    expect(answered.isError).toBe(false);
    expect(answered.content).toHaveLength(1);
    const state = firstText(answered.content);
    expect(state.turn).toBe(1);

    // The call reached this match, as the seat whose token the extension was
    // given, and the match counted it like any other player's call.
    const counted = matches.turnRecord(matchId, 1).A.tool_calls;
    expect(counted.map((call) => call.tool)).toEqual(["get_state"]);
    expect(counted[0].error).toBe(false);
  });

  it("hands back a call the match refused as an answer, not as a failure", async () => {
    // A hex off the board: the session refuses it, and the seat is told so in
    // the same shape as any other answer. An exception here would end the
    // seat's turn instead of letting it try again.
    const refused = await toolNamed(seat, "scout").execute("call-2", { hex: "Z1" });

    expect(refused.isError).toBe(true);
    expect(firstText(refused.content)).toEqual({ error: "unknown_hex" });
    expect(matches.turnRecord(matchId, 1).A.tool_calls.at(-1)).toMatchObject({
      tool: "scout",
      error: true,
    });
  });

  it("lets go of the match when the seat's session ends", async () => {
    // A second seat on the same match, so this one's shutdown is its own.
    const other = fakePi();
    await asSeat(running.url, tokens.B, () => seatTools(other as unknown as ExtensionAPI));
    const get = toolNamed(other, "get_state");
    await get.execute("before", {});

    await other.emit("session_shutdown");

    // An open connection would keep the seat's process alive after its session,
    // and a runner waiting on it would wait forever.
    const after = await failureOf(() => get.execute("after", {}));
    expect(after, "the seat still reaches its match after its session ended").toBeInstanceOf(Error);
  });

  it("refuses to start a seat whose environment has no endpoint or token", async () => {
    const saved = { url: process.env[URL_VAR], token: process.env[TOKEN_VAR] };
    delete process.env[URL_VAR];
    delete process.env[TOKEN_VAR];
    try {
      const failure = await failureOf(() => seatTools(fakePi() as unknown as ExtensionAPI));

      // The names of the variables, because the seat's Pi reports this message
      // and a runner reading a dead seat has to know which is missing.
      expect(failure, "a seat with no endpoint and no token started anyway").toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(URL_VAR);
      expect((failure as Error).message).toContain(TOKEN_VAR);
    } finally {
      if (saved.url !== undefined) process.env[URL_VAR] = saved.url;
      if (saved.token !== undefined) process.env[TOKEN_VAR] = saved.token;
    }
  });

  it("fails to start a seat whose token the match does not know", async () => {
    // The connection is made before the session starts, so a seat that cannot
    // reach its match dies here rather than playing a turn with no tools.
    const failure = await asSeat(running.url, "a-token-this-match-did-not-deal", () =>
      failureOf(() => seatTools(fakePi() as unknown as ExtensionAPI)),
    );

    expect(failure, "a seat reached a match with a token it was never dealt").toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("unknown_token");
  });
});
