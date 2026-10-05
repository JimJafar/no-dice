---
id: server-match-state
title: The server holds a match and answers the runner
milestone: 02-mcp-server-and-bots
depends_on: [log-format-schema]
---

Create `games/salient/server` (`@no-dice/salient-server`, depending on
`@no-dice/salient-engine` and `@no-dice/runner`) with a `MatchSession` in `src/session.ts`
that owns the match: the engine's `MatchState` from `generateMap(seed, config)`, per-seat
notes, per-turn counters (tool calls, simulations, action points spent on scouts), the hexes
each seat has scouted this turn, each seat's submission, the tool-call transcript for the
turn, and the previous turn's events. Every player-facing tool call goes through one
`call(matchId, seat, tool, args)` function so the limits of brief §6.2 live in exactly one
place; this task builds the dispatch and the counters, a later task fills in the limit
errors. Add the admin surface brief §6.2 lists, as plain in-process functions and not MCP
tools: `createMatch(seed, config) -> { matchId, tokens: { A, B } }` with random opaque
tokens mapped to one match and one seat, `openTurn(matchId)` resetting the per-turn
counters and starting to accept calls, `status(matchId) -> { submitted: { A, B } }`,
`resolveTurn(matchId) -> { events, result? }` which calls the engine's `resolveTurn` with
each seat's accepted orders and the action points that seat spent on scouts, treating a seat
that never submitted as a pass, and `turnRecord(matchId, turn)` returning the per-seat data
the log needs. The engine keys hexes `"q,r"` while the tools and the log use labels like
`B6`, so put that translation in one module (`src/labels.ts`) and use it everywhere.

## Acceptance
- [ ] `createMatch` returns two distinct opaque tokens that each resolve to the same match
      and to different seats
- [ ] `openTurn` resets the per-turn counters, and `resolveTurn` resolves a turn where one
      seat passed without changing what the other seat ordered
- [ ] `turnRecord` output validates against the `salient-log/1` per-player turn schema

## Verification
```bash
pnpm test -- session
```
