---
id: bot-player-mcp
title: A bot plays a turn through real MCP calls
milestone: 02-mcp-server-and-bots
depends_on: [server-http-mcp, bots-random-greedy]
---

Create `packages/harness` (`@no-dice/harness`) with the `Player` interface brief §6.4
defines — `start({ serverUrl, token })`, `playTurn(turn) -> TurnOutcome`, `stop()` — and a
`BotPlayer` that implements it by driving a decision function through an ordinary MCP
client, so a bot sees exactly what a model sees and the server counts its calls the same
way. Use `StreamableHTTPClientTransport` with the seat's bearer token for real matches, and
support `InMemoryTransport.createLinkedPair()` for tests that want the same code path
without a socket. On turn 1 the bot calls `get_rules` once and keeps the map; every turn it
calls `get_state`, decides, and calls `submit_orders`. It never calls `scout` or `simulate`.
If the first submission is rejected it drops the orders the server refused and resubmits
once, which is the same deal a model gets. `TurnOutcome` carries what the runner needs for
the log: the tool calls it made in order with their arguments, results and milliseconds, the
final orders, intent and prediction, any rejected submission, and whether it submitted at
all. Keep the harness game-agnostic: the decision function and the tool names come in as
arguments, since milestone 03 adds a `PiPlayer` beside it.

## Acceptance
- [ ] A `BotPlayer` plays a turn end to end over a real MCP connection, and the tool calls
      the server recorded match the ones the player reports
- [ ] The bot never calls `scout` or `simulate`
- [ ] A rejected first submission leads to exactly one resubmission with the refused orders
      dropped

## Verification
```bash
pnpm test -- bot-player
```
