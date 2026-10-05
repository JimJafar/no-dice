---
id: viewer-panels
title: The side panels show what each seat did
milestone: 05-replay-viewer
depends_on: [viewer-skeleton, viewer-golden-fixture]
---

`src/panels.ts`: one panel per seat, from `turns[n].players.A` / `.B`. Intent and prediction
as sentences; the tool-call trace for the turn, in the log's order, one line per call with
the tool name as the player called it, a compact form of the args, whether it errored and the
`ms`, with the hexes it scouted listed alongside; then the three small boxes — troops from
`after.troops`, Nodes held (count the `map` hexes whose terrain is `node` and whose cell owner
is the seat), and actions used as `orders.length + scouts.length` of `config.action_points`.
Add the context-size meter brief §6.8 suggests: `context_tokens` against
`players.<seat>.context_window`, and a bot seat, whose window is 0, shows no meter at all
rather than an empty one.

Marks on the turn strip and in the panel: a turn whose `rejected_submission` is not null (with
the reasons from its `wasted` entries), a turn that `passed` (with the reason from
`passReasonSchema`), and a turn where `compacted` is true. The mock-ups' "Called it" /
"Missed" verdict tag stays out — how predictions are scored is undecided
(`salient/docs/salient-mockups.md`, "What is placeholder"), so the panel shows the prediction and no
judgement of it.

The golden fixtures make no tool calls, so the tool-trace and mark tests build their own log:
take the golden-01 fixture in the test and edit the turn records (add `tool_calls`, a
`rejected_submission`, a `passed` reason, a `compacted` turn), which is also the check that
the panels read the log rather than assume scripted bots.

## Acceptance
- [ ] At turn 11 of golden-01 the A panel reads 22 troops, 2 Nodes held and 6 of 6 actions,
      and B's reads 24, 1 and 6 of 6
- [ ] A log with a rejected first submission, a pass and a compaction marks each on the right
      turn and names the pass reason and the rejection reasons
- [ ] A turn with tool calls lists them in the log's order with the errored one marked, and a
      bot seat shows no context meter

## Verification
```bash
pnpm test -- viewer
```
