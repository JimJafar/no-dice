---
id: main-a-seat-that-missed-a-prompt-is-played-again-next-turn
title: A seat that missed a prompt is put back in order and played again next turn
milestone: 06-first-real-series
depends_on: [main-a-prompt-the-seat-never-answers-passes-the-turn]
type: code
---

Passing the turn is only half of it: brief §6.3 says a seat that passes "stays in the match and is
prompted again next turn, with the failed turn still in its history", and a wedged session may not be
ready for that prompt. Two hazards, both from what the previous task's diagnosis found. `RpcClient.send()`
gives up on a command after 30 s but Pi keeps it: `AgentSession.prompt()` parks a prompt arriving during
`_emitAgentSettled` in `_deferredSettledActions` and runs it afterwards, so a run can start under a turn
the harness has already passed — and if the harness re-sent the prompt it would be asking the model about
the same position twice, which is exactly what brief §6.3's "never retry a single turn" forbids. And the
next turn's `prompt` can fail the same way, which after the previous task is a pass rather than a
lost match, but must not turn into a match that hangs.

So `PiPlayer` grows a bounded recovery between the pass and the next turn, using the RPC commands that
answer without a provider round trip: `get_state` reports `isStreaming`, `isCompacting` and
`pendingMessageCount`, and `abort` and `clear_queue` are handled directly by `rpc-mode.js`'s
`handleCommand`. Ask the seat whether it is still busy, take away anything queued, and give it a
short, explicit budget — every one of those calls goes through the same client that just failed to
answer, so each must be bounded and its failure must be survivable, never fatal. Never re-send a turn's
prompt. If the seat still will not take a prompt next turn, that turn passes with the same reason too:
the match finishes and is logged whatever the seat does, and only a dead process ends it early.

Put the tests in `packages/harness/src/pi-turn.test.ts`, which already drives `PiPlayer` against
`StubModel` and can count what the stub was asked (`stub.requestCount`). The one that matters most
shows the passed turn and the turn after it in one match: the wedged turn's late activity must not be
recorded as the next turn's orders, and the stub must be asked once per turn the match plays.

## Acceptance
- [ ] After a turn passed as `prompt_timeout`, the next turn's prompt is answered and that turn is played normally, with the stub asked exactly once per played turn
- [ ] The harness never sends one turn's prompt twice, and a run that starts late from the dropped command is not recorded as the next turn's submission
- [ ] A seat that stays unresponsive passes turn after turn with `prompt_timeout` and the match still ends and is logged, with no turn hanging past the runner's own bound

## Verification
```bash
pnpm vitest run packages/harness/src/pi-turn.test.ts
```
