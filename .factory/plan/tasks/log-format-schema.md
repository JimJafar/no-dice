---
id: log-format-schema
title: The match log format is frozen
milestone: 02-mcp-server-and-bots
depends_on: []
---

Create the `packages/runner` workspace package (`@no-dice/runner`, `type: module`, depends
on `zod@^4`) and write the `salient-log/1` format from brief §7 as zod schemas in
`packages/runner/src/log.ts`, exported through the subpath `@no-dice/runner/log`. That
module must import nothing from `node:*` and nothing from the engine, because the viewer
(milestone 05) and the stats package import it in a browser. Cover the header (`format`,
`ruleset`, `engine_version`, `created`, `seed`, `config`, `harness` with `pi_version`,
`context`, `compaction`, `tool_call_cap`, `simulate_cap`, `resubmissions`,
`turn_timeout_s`, `output_token_budget`, `players` with `kind: "pi"` or `kind: "bot"`,
`map`, `bases`, `start`, `turns`, `result`), the per-turn per-player record (`tool_calls`,
`scouts`, `rejected_submission`, `orders`, `wasted`, `intent`, `prediction`, `passed`,
`notes_after`, `usage`, `cost_usd`, `context_tokens`, `compacted`, `wall_ms`), the shared
turn fields (`events`, `after` with `cells`, `score`, `troops`), the four event shapes
(`clash` with `between`/`A`/`B`, `battle` with `at`/`A`/`B`/`owner`, `repelled` with
`at`/`by`/`n`, `capture` with `at`/`by`/`from`/`terrain`), and `result` with `type`
`time` or `knockout`, a nullable `winner` and a `margin`. `cells[i]` is
`[owner, troops, garrison, cut_off]` aligned with `map[i]`, owner `0` neutral, `1` A,
`2` B. Every hex in the log is named by its board label (`B6`), never by the engine's
`"q,r"` key. Export the inferred types, plus `cellsFor(hexes, suppliedA, suppliedB)` which
turns an array of `{owner, troops, garrison}` plus the two supplied sets from
`score()` into cells — the caller computes supply, so this module stays engine-free.
Nothing else in the milestone may invent log fields after this lands.

## Acceptance
- [ ] A fixture written straight from brief §7 validates, and a log is rejected with a
      readable error when `cells` does not match `map` in length, when an event type is
      unknown, when `format` is missing, or when a hex is named `"4,0"` instead of `F6`
- [ ] `cellsFor` round-trips an engine board: owners as 0/1/2, troops, garrison, and
      `cut_off` 1 for a hex its owner holds out of supply
- [ ] `@no-dice/runner/log` typechecks and runs with no `node:*` and no engine import

## Verification
```bash
pnpm test -- log
```
