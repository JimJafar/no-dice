---
id: server-http-mcp
title: The seven tools are reachable over Streamable HTTP with a seat token
milestone: 02-mcp-server-and-bots
depends_on: [server-limits]
---

Put the session behind a real MCP server so a player process can reach it and nothing else
can. Add `@modelcontextprotocol/sdk` (1.32.0 is on the registry; its peer allows
`zod ^3.25 || ^4.0`, so use the workspace's zod 4). In `games/salient/server/src/http.ts`,
serve the Streamable HTTP transport on `127.0.0.1` on a port the caller asks for — pass `0`
and read back the port, which is how the match runner avoids collisions. Register the
server under the name `salient` so the tools appear as `get_rules`, `get_state`, `scout`,
`simulate`, `submit_orders`, `read_notes`, `write_notes` and nothing else, with zod schemas
for their inputs. Each HTTP request carries `Authorization: Bearer <token>`; map the token
to `(matchId, seat)` and build one `McpServer` and one transport per MCP session, so two
seats of the same match never share a session. A request with no token or an unknown token
is refused with 401 before any tool runs, and a tool call never takes a seat argument — the
token decides the seat. Export `startServer(...) -> { url, close() }`; tests must close the
client and the server so vitest exits.

## Acceptance
- [ ] A real MCP client holding seat A's token lists exactly the seven tools and gets seat
      A's `get_state` over HTTP
- [ ] One server hosting two matches keeps them apart: each token sees only its own match
      and its own seat
- [ ] A request with a missing or unknown token is refused before any tool call, and the
      test process exits cleanly

## Verification
```bash
pnpm test -- http
```
