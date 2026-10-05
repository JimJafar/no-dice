---
id: stats-match-metrics
title: One log becomes per-model counts, by turn and by depth
milestone: 04-series-runner-and-stats
depends_on: [log-package]
---

Add `packages/stats/src/match-metrics.ts`: read one `salient-log/1` (parse it with
`matchLogSchema` from `@no-dice/log`, never by hand) and return, per seat, the counts brief
§6.7 asks for — passes by reason (`passed`, which is one of `no_submission`, `timeout`,
`token_budget`, `provider_error`, `harness_crash`, `tool_surface`), wasted orders (the
`wasted` arrays, counted and grouped by their reason), rejected submissions
(`rejected_submission !== null`), tool errors (`tool_calls[].error`), scouts per turn (the
`scouts` arrays) and simulations per turn (`tool_calls` whose `tool` is `simulate` — the log
stores the bare name, without the `mcp__salient__` prefix), tokens (`usage.input`, `output`,
`cache_read`, `cache_write`) and `cost_usd` per turn, `wall_ms`, context size by turn
(`context_tokens`) and the turns on which compaction happened (`compacted`).

Then the part brief §6.7 calls the point of the whole exercise: the same error counts split
into **turns 1-8, 9-17 and 18-25**, with context size by turn and the compaction turns, so a
model that falls apart as the conversation grows is visible rather than averaged away. Every
turn of a played match falls in exactly one band.

One trap to handle explicitly: `context_tokens` is `0` on a turn where Pi has just compacted,
because Pi will not state a context size it has just rewritten (`docs/pi-harness-notes.md` §3,
measured). A zero on a `compacted: true` turn is "Pi could not say", not a context that
shrank to nothing: keep it out of any mean or minimum over context size, and report it as a
compaction turn. Test against a real log — a bot-versus-bot match from `runMatch` takes about
1.3 s and is a legitimate fixture — and against a synthetic log for the compaction and pass
reasons a bot match never produces.

## Acceptance
- [ ] Over a real bot-versus-bot log the counts equal what the log holds, checked in the test
      by counting the parsed turns independently
- [ ] The depth split covers turns 1-8, 9-17 and 18-25, and every played turn lands in exactly
      one band
- [ ] A turn with `compacted: true` and `context_tokens: 0` is reported as a compaction turn
      and is excluded from the context-size mean and minimum

## Verification
```bash
pnpm test -- match-metrics
```
