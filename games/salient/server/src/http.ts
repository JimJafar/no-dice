/**
 * The seven player tools over Streamable HTTP, which is the only way a player
 * process reaches them.
 *
 * The listener is bound to the loopback address and to one path, and every
 * request has to carry `Authorization: Bearer <token>`. The token is the whole
 * of the player's identity: it maps to one seat of one match, so no tool takes a
 * seat argument and no call can name a seat it was not dealt one for. A request
 * without a token this server issued is answered at the door — the body is never
 * read, no session is opened, nothing is counted and no tool runs.
 *
 * One `McpServer` and one transport are built per MCP session, and the session
 * remembers whose it is. Two seats of the same match therefore never share a
 * session, and a session id is no use to a seat that did not open it: the token
 * it presents has to belong to the same seat.
 *
 * The tools answer exactly what `MatchSession` answers, as JSON text: the same
 * result a caller in-process gets, and the same `{ "error": <code> }` when a
 * limit refuses the call, with `isError` set so a client can tell the two apart
 * without parsing.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpListener, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { hexLabelSchema, orderSchema } from "@no-dice/log";

import type { MatchServer, TokenOwner } from "./server.ts";
import { TOOL_NAMES, type ToolName, type ToolOutcome } from "./session.ts";

/** The loopback address brief §6.2 binds the server to. Not a choice. */
const HOST = "127.0.0.1";

/** Where the MCP endpoint lives. */
const DEFAULT_PATH = "/mcp";

/**
 * The server is registered as `salient`, which is what makes the tools read as
 * `mcp__salient__get_state` and so on once a player is wired up to it.
 */
const SERVER_NAME = "salient";
/** Reported in `initialize`. The rules the match is played under are the engine's. */
const SERVER_VERSION = "0.0.0";

/** What one MCP session holds: the match and seat it answers for, and its pair. */
interface McpSession {
  owner: TokenOwner;
  mcp: McpServer;
  transport: StreamableHTTPServerTransport;
}

/** What `startServer` takes. */
export interface StartServerOptions {
  /** The matches in play, and the seat tokens that reach them. */
  matches: MatchServer;
  /** Port to bind. `0` asks the OS for a free one, which is how a runner avoids collisions. */
  port?: number;
  /** Path the MCP endpoint is served on. */
  path?: string;
}

/** What `startServer` hands back once the listener is up. */
export interface RunningServer {
  /** The URL a player points its MCP client at, with the port actually bound. */
  url: string;
  /** The port actually bound, which is the interesting part of `url`. */
  port: number;
  /** Close every MCP session, then the listener. */
  close(): Promise<void>;
}

/**
 * The input schema of each tool, as brief §6.2 describes it.
 *
 * None of them takes a seat, and each is strict, so a call that tries to name
 * one is refused rather than quietly obeyed. The lengths brief §6.2 sets on
 * notes and on the two submission notes are left to the session, which is where
 * they are counted and where refusing them is logged; a schema here would turn
 * the call away before the seat was ever told why.
 */
const TOOL_INPUTS: Record<ToolName, z.ZodTypeAny> = {
  get_rules: z.strictObject({}),
  get_state: z.strictObject({}),
  scout: z.strictObject({ hex: hexLabelSchema }),
  simulate: z.strictObject({
    orders: z.array(orderSchema),
    assumed_enemy_orders: z.array(orderSchema).optional(),
  }),
  submit_orders: z.strictObject({
    orders: z.array(orderSchema),
    intent: z.string(),
    prediction: z.string(),
  }),
  read_notes: z.strictObject({}),
  write_notes: z.strictObject({ notes: z.string() }),
};

/** What each tool says it does, in the player's own words. */
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_rules: "The rules, the constants and the whole map. Call it once, on turn 1.",
  get_state: "The turn as your seat can see it: the score, what you have left to spend, the hexes you know, last turn.",
  scout: "One action point for a hex and the hexes touching it, as they stood when the turn opened.",
  simulate: "What your orders would do, worked out on what you know. Changes nothing.",
  submit_orders: "The orders to play this turn, with your intent and your prediction of the enemy.",
  read_notes: "What your seat last wrote to itself.",
  write_notes: "Replace what your seat writes to itself. Notes outlive the turn.",
};

/** The session's answer, as the tool result a player reads. */
const toolResult = (outcome: ToolOutcome): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(outcome.result) }],
  ...(outcome.ok ? {} : { isError: true }),
});

/** The bearer token a request carries, or `null` when it carries none. */
const bearerToken = (header: string | string[] | undefined): string | null => {
  const value = Array.isArray(header) ? header[0] : header;
  const matched = value === undefined ? null : /^Bearer (.+)$/i.exec(value.trim());
  return matched === null ? null : matched[1];
};

/** A short JSON answer of our own, for a request that never reaches MCP. */
const reply = (res: ServerResponse, status: number, body: Record<string, string>): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

/**
 * The seven tools of the matches `matches` is playing, bound to the seat `token`
 * belongs to. The token, not the caller, is what fixes the seat: no tool takes a
 * seat argument, and a token this server never issued reaches nothing.
 *
 * `startServer` builds one of these per HTTP session. A caller that wants the
 * same tools with no socket between them — a test that runs a match over
 * `InMemoryTransport.createLinkedPair()` — connects one of these to the other
 * end of a linked pair instead, which is why the tool surface lives here rather
 * than inside the listener.
 */
export function playerToolServer(matches: MatchServer, token: string): McpServer {
  const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const name of TOOL_NAMES) {
    mcp.registerTool(
      name,
      { description: TOOL_DESCRIPTIONS[name], inputSchema: TOOL_INPUTS[name] },
      async (args) => toolResult(matches.callAs(token, name, args)),
    );
  }
  return mcp;
}

/**
 * Serve the seven tools of every match `options.matches` is playing, on a free
 * port of the loopback address, and hand back the URL and a way to shut it down.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { matches } = options;
  const path = options.path ?? DEFAULT_PATH;
  /** Every MCP session open now, by the id its client sends back on each request. */
  const sessions = new Map<string, McpSession>();

  /** Open the session a request with no session id asks for. */
  const openSession = async (token: string, owner: TokenOwner): Promise<McpSession> => {
    const mcp = playerToolServer(matches, token);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { owner, mcp, transport });
      },
    });
    // Set before `connect`, which chains it to its own handler: the session
    // leaves the map whether the client sent DELETE or its connection died.
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
    };
    await mcp.connect(transport);
    return { owner, mcp, transport };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const asked = new URL(req.url ?? "/", `http://${HOST}`).pathname;
    if (asked !== path) {
      req.resume();
      reply(res, 404, { error: "not_found" });
      return;
    }

    // The door before anything else: an unknown token, or no token, gets an
    // answer and nothing more. The body is drained unread, no session is
    // opened, and no tool is reached to be counted against a seat.
    const token = bearerToken(req.headers.authorization);
    const owner = token === null ? null : matches.resolveToken(token);
    if (token === null || owner === null) {
      req.resume();
      reply(res, 401, { error: "unknown_token" });
      return;
    }

    const id = req.headers["mcp-session-id"];
    if (typeof id === "string") {
      const session = sessions.get(id);
      if (session === undefined) {
        req.resume();
        reply(res, 404, { error: "unknown_session" });
        return;
      }
      // A session id is only good to the seat that opened it: presenting another
      // seat's token with it is a way of asking that seat to play the turn.
      if (session.owner.matchId !== owner.matchId || session.owner.seat !== owner.seat) {
        req.resume();
        reply(res, 401, { error: "not_your_session" });
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    // No session id: only an `initialize` opens one, and the transport turns
    // anything else away before a session exists.
    const session = await openSession(token, owner);
    try {
      await session.transport.handleRequest(req, res);
    } finally {
      // A request that never initialized leaves a server and a transport
      // nothing will ever use again.
      if (session.transport.sessionId === undefined) await session.mcp.close();
    }
  };

  const listener: HttpListener = createServer((req, res) => {
    void handle(req, res).catch(() => {
      // A request this layer cannot answer gets an answer of its own, and a
      // response the transport already started writing is left as it stands.
      if (!res.headersSent) reply(res, 500, { error: "server_error" });
      else if (!res.writableEnded) res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(options.port ?? 0, HOST, () => {
      listener.off("error", reject);
      resolve();
    });
  });

  const bound = listener.address() as AddressInfo;
  return {
    url: `http://${HOST}:${String(bound.port)}${path}`,
    port: bound.port,
    close: async () => {
      const open = [...sessions.values()];
      sessions.clear();
      // Closing the server closes its transport, and the listener is then shut
      // with its keep-alive sockets, so nothing is left holding the process.
      await Promise.all(open.map((session) => session.mcp.close()));
      await new Promise<void>((resolve) => {
        listener.closeAllConnections();
        listener.close(() => resolve());
      });
    },
  };
}
