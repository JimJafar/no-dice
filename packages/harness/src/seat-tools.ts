/**
 * The Pi extension that gives a seat its game tools, under the game's own names.
 *
 * Pi's built-in MCP support would offer the same tools, but always as
 * `mcp__<server>__<tool>`, and a model that shortens or mangles that prefix
 * (`submit_orders`, `mcpsalient_write_notes`) wastes the call. So the seat is
 * started with this file (`pi -e`) instead of an `mcp.json`: it connects to the
 * match's server once, asks it for its tools, and registers each one under the
 * name the server gives it — `get_state`, `submit_orders` — with the server's
 * own description and input schema. A call is forwarded as it is, and the
 * server's answer comes back as the content blocks it sent, so the log reads a
 * model's tool calls exactly as it reads a bot's.
 *
 * Nothing here knows the game: the tools are whatever the server lists. The
 * endpoint and the seat's bearer token come from the child's environment
 * (`SALIENT_URL`, `SALIENT_TOKEN`), so the token is never in a file.
 *
 * It runs inside the seat's Pi process, not the runner's.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** The environment variable the match's endpoint is read from. */
export const URL_VAR = "SALIENT_URL";
/** The environment variable the seat's bearer token is read from. */
export const TOKEN_VAR = "SALIENT_TOKEN";

/** Where this file is, for the `-e` flag the seat is started with. */
export const SEAT_TOOLS_EXTENSION: string = new URL(import.meta.url).pathname;

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export default async function seatTools(pi: ExtensionAPI): Promise<void> {
  const url = process.env[URL_VAR];
  const token = process.env[TOKEN_VAR];
  if (url === undefined || token === undefined) {
    throw new Error(`the seat's tools need ${URL_VAR} and ${TOKEN_VAR} in its environment`);
  }

  // One connection for the whole match, made before the session starts so the
  // first prompt already has its tools. Pi waits for an async factory.
  const client = new Client({ name: "no-dice-seat", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const { tools } = await client.listTools();
  // An open connection would keep the process alive after its session ends.
  pi.on("session_shutdown", async () => {
    await client.close();
  });

  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description ?? tool.name,
      parameters: { ...tool.inputSchema, properties: tool.inputSchema.properties ?? {} } as never,
      async execute(_toolCallId, params, signal) {
        const answered = await client.callTool(
          { name: tool.name, arguments: (params ?? {}) as Record<string, unknown> },
          undefined,
          { signal },
        );
        const content = (answered.content as Content[]).filter(
          (part) => part.type === "text" || part.type === "image",
        );
        return { content, details: undefined, isError: answered.isError === true };
      },
    });
  }
}
