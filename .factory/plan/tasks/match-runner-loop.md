---
id: match-runner-loop
title: A bot-versus-bot match is played and written as one log
milestone: 02-mcp-server-and-bots
depends_on: [bot-player-mcp, log-format-schema]
---

Add `runMatch(options)` to `packages/runner` following the loop in brief §6.4: start the MCP
server in-process on a free localhost port, `createMatch(seed, config)`, start both players
with their own token (the per-seat Pi folders of §6.4 arrive in milestone 03), then for each
turn until `config.turns` or a knockout: `openTurn`, prompt both players together with
`Promise.all`, wait for both to settle or for the turn timeout, treat a player that never
submitted as a pass with the reason from brief §6.3 (`no_submission` or `timeout`), take
`turnRecord` plus each player's usage, cost, context size and wall time, `resolveTurn`, and
append the turn. Then stop both players and write the log atomically: write to
`<out>.tmp` and `rename` it into place, because the series runner treats an existing log as
a finished match. Build the header exactly as `@no-dice/runner/log` describes, with
`harness` recording `tool_call_cap: 12`, `simulate_cap: 3`, `resubmissions: 1`,
`turn_timeout_s: 300`, `output_token_budget: null`, `context: "continuous"` and
`pi_version: null` for bots, and each `players` entry as `{ kind: "bot", bot }`. Use
`cellsFor` with the supplied sets from the engine's `score()` for `start.cells` and every
`after.cells`, plus the `troops` totals. Bots have no tokens or cost, so those fields are 0,
and each bot is seeded from the match seed and its seat so a rerun repeats exactly. Take `created` from an injected clock so two runs can be compared byte for byte, and bump
`games/salient/engine/package.json` to `0.1.0` so `engine_version` in the header means
something.

## Acceptance
- [ ] A Greedy-versus-Random match over HTTP MCP writes one file that validates against the
      `salient-log/1` schema
- [ ] Replaying the logged orders through the engine reproduces every logged board, score and
      result
- [ ] The same seed and the same bots give byte-identical logs on two runs, and the same
      match run over an in-memory linked transport gives the same log as over HTTP

## Verification
```bash
pnpm test -- match
```
