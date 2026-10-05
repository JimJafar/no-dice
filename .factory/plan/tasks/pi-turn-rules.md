---
id: pi-turn-rules
title: A seat that fails a turn passes it and stays in the match
milestone: 03-pi-harness
depends_on: [pi-player-rpc]
---

Implement brief §6.3's turn-outcome table in the harness, using the stub model to produce each
case: `agent_settled` with an accepted submission is a normal turn; `agent_settled` with none
is a pass with reason `no_submission`; a turn that runs past its timeout gets `abort` and
passes with `timeout`; output tokens over the per-turn budget get `abort` and pass with
`token_budget` (the budget is an option, default `null` for off, because Jim has not set a
number yet); a provider failure that survives Pi's retries — `auto_retry_end` with
`finalError` — passes with `provider_error`. Match-level failures are different: if the Pi
process exits mid-match, or a `tool_execution_start` names anything outside the seven
`mcp__salient__*` tools, the match is voided with `harness_crash` or `tool_surface` and no log
is presented as a played match. `passReasonSchema` in `@no-dice/runner/log` already lists all
six reasons.

Give `Player` an `abort()` and use it in the runner instead of the stop-and-restart that
`match.ts` does today: brief §6.3 keeps the seat's session alive after an abort, and restarting
a Pi seat would throw away the conversation that the whole match is meant to be. Never retry a
turn — the model would see the position twice. A seat that passed is prompted again next turn
on the same session, with the failed turn still in its history. Detect compaction while
reading events: Pi 1.0.2 emits `compaction_start` (with a `reason`) and `compaction_end` in the
RPC stream, and `contextUsage.tokens` drops across the compaction; set `compacted` on the
turn's record from either signal.

## Acceptance
- [ ] A stub that never submits passes with `no_submission` and is prompted on the next turn by
      the same Pi session
- [ ] A stub that overruns a short timeout is aborted, passes with `timeout`, and still carries
      the aborted turn in its conversation next turn
- [ ] A tool outside the seven, and a Pi process killed mid-match, each void the match with
      `tool_surface` and `harness_crash` respectively

## Verification
```bash
pnpm test -- pi-turn
```
