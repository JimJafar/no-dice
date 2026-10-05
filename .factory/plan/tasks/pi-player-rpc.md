---
id: pi-player-rpc
title: A Pi session plays one turn of a match
milestone: 03-pi-harness
depends_on: [pi-stub-model]
---

Add `packages/harness/src/pi-player.ts`: a `PiPlayer` implementing the `Player` interface of
brief §6.4 beside `BotPlayer`, so the runner's loop cannot tell a model seat from a bot seat.
`start` writes the seat home (task `pi-seat-config`) and spawns the pinned CLI through
`RpcClient`, which `@earendil-works/pi-coding-agent` 1.0.2 exports from its root: it takes
`{ cliPath, cwd, env, args }`, prepends `--mode rpc` itself, spawns `node <cliPath>`, and
exposes `onEvent`, `prompt`, `abort`, `getSessionStats`, `getState` and `stop`. Use it rather
than hand-rolling the JSONL: `rpc.md` warns that Node's `readline` also splits on U+2028 and
U+2029, which are legal inside JSON strings, and closing the child's stdin shuts Pi down, so
a piped command sequence never runs. Pass the lock-down flags from brief §6.3 —
`--no-builtin-tools --no-context-files --no-skills --no-prompt-templates --no-themes
--system-prompt <player-system.md> --model <provider>/<id> --thinking <level> --session-dir
<dir>` — and the environment `PI_CODING_AGENT_DIR`, `SALIENT_TOKEN`, `PI_SKIP_VERSION_CHECK=1`,
`PI_TELEMETRY=0`, `PI_CACHE_RETENTION=long`. `playTurn` writes exactly
`Turn <n> of 25. Play your turn.` and reads events until `agent_settled`, recording each
`tool_execution_start`/`tool_execution_end` pair as a `toolCallSchema` record with the
`mcp__salient__` prefix stripped and the JSON text of the result parsed back into a value.

Grow `TurnOutcome` with what `turnPlayerSchema` in `@no-dice/runner/log` already has room for
and `match.ts` currently fills with zeros: per-turn `usage`, `cost_usd`, `context_tokens` and
`compacted`. Those come from `getSessionStats()`, whose `tokens`, `cost` and `contextUsage`
are cumulative over the session, so a turn's figures are the difference from the previous
turn's totals; `contextUsage.tokens` is `null` immediately after a compaction until a fresh
assistant answer arrives, so treat that as "unknown", not as zero. Pi takes a second or two to
start and the stub answers at once, so give these tests a generous vitest timeout rather than
the default.

## Acceptance
- [ ] Against the stub model and the real match server, a `PiPlayer` plays a turn and the tool
      calls the server recorded are the ones the player reports, in the same order
- [ ] The outcome carries non-zero per-turn usage, cost and context size, and a second turn on
      the same session reports the difference rather than the running total
- [ ] The session is not restarted between turns: one Pi process plays turns 1 and 2 and its
      saved session directory grows

## Verification
```bash
pnpm test -- pi-player
```
