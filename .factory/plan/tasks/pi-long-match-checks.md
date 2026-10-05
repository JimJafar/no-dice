---
id: pi-long-match-checks
title: One Pi session survives a whole 25-turn match
milestone: 03-pi-harness
depends_on: [pi-model-seat-cli]
---

Finish the "Verify on first run" list from brief §6.3 by running a full scripted match —
`packages/harness/src/pi-long-match.test.ts`, a stub-model seat against a Greedy seat — and
answer the items the earlier tasks cannot: the MCP connection stays up for all 25 turns of one
RPC session (the server's per-turn records show calls in every turn, with no reconnect and no
seat token rotation), `agent_settled` arrives exactly once per prompt, `getSessionStats()`
answers with `contextUsage` on every turn, and turn 25's model request still contains turn 1's
`get_rules` result while compaction has not run — the stub keeps every request body, so this
is a substring check, not a hope. Then force compaction by giving the stub model a small
`contextWindow` in its `models.json` entry and record what Pi actually emits: 1.0.2's event
list names `compaction_start` (with a `reason`) and `compaction_end`, and the brief asks which
event, if any, RPC mode emits, so confirm it from the stream rather than from the docs and
write the answer, together with the other checklist results, in `docs/pi-harness-notes.md` for
milestones 04 and 06 to quote.

## Acceptance
- [ ] A scripted 25-turn match runs on one Pi process and one MCP session, and the server holds
      a record for every turn
- [ ] With compaction off, the 25th request the model is sent still carries turn 1's tool results
- [ ] With a small context window, compaction is detected, the turn's `compacted` flag is set,
      and `docs/pi-harness-notes.md` records the event that announced it

## Verification
```bash
pnpm test -- pi-long-match
```
