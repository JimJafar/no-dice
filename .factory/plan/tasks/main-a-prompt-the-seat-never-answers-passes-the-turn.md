---
id: main-a-prompt-the-seat-never-answers-passes-the-turn
title: A prompt the seat never answers passes the turn instead of failing the match
milestone: 06-first-real-series
depends_on: [main-the-harness-explains-a-seat-that-stops-answering]
type: code
---

Today a `prompt` RPC command that comes back wrong while the seat's Pi process is alive ends the match.
`PiPlayer.playTurn` sends it through `this.command("the prompt", …)` (`packages/harness/src/pi-player.ts:471`),
and `command()` (`:547`) rethrows anything `seatIsGone()` (`:184`) does not recognise as a death — which
includes `RpcClient`'s `Timeout waiting for response to prompt` (a fixed 30 s in `send()`, which drops
the pending request and leaves the child running). The throw escapes `playTurn`, the runner writes no
log, and the series records the match as missing and replays it. Brief §6.3's table has no row for this
case, so add one and make the harness obey it.

Add a pass reason `prompt_timeout` — chosen so it cannot be read as brief §6.3's `timeout`, which is the
runner's turn cap — to `passReasonSchema` (`packages/log/src/log.ts:94`) and to `PassReason`
(`packages/harness/src/player.ts:60`); `VoidReason` is `Extract<PassReason, "harness_crash">`, so voids
stay voids. In `playTurn`, a prompt command that fails for any reason other than the process being gone
ends the turn as a pass carrying that reason rather than throwing: the turn still reports the tool calls
the seat had already made, and the match goes on. A seat whose process really has died stays exactly what
it is now — `MatchVoided("harness_crash")`, no log — which `packages/runner/src/model-seat.test.ts`
("a match voided by a seat whose Pi process died") already pins. The same care applies to the
`getSessionStats` call that follows the prompt in `playTurn`: it goes through the same client, so on a
seat that has stopped answering commands it can sit for its own 30 s and throw the same non-death error;
a turn that is already a pass must not be lost to a usage figure, so treat that failure as "the seat
cannot say" and keep the turn. The runner needs no change: `passReasonOf` (`packages/runner/src/match.ts:520`)
only overwrites with `timeout` when the runner's own deadline hit, and this turn comes back inside it.
Flip the reproduction test from the previous task to the new expectation, and add the row to brief
§6.3's turn-outcome table in `salient/docs/salient-build-brief.md` — the brief is the authority here,
and a reason it does not name is a reason a later reader will not trust.

## Acceptance
- [ ] A seat whose `prompt` command fails while its Pi child is alive ends that turn `passed: "prompt_timeout"`, keeps the tool calls it had made, and the match goes on and is written as a log that validates against `salient-log/1`
- [ ] A seat whose Pi process has died is still a `harness_crash` void with no log, and the existing void test still passes
- [ ] `prompt_timeout` is in `passReasonSchema`, in the harness's `PassReason`, and as a row in brief §6.3's turn-outcome table

## Verification
```bash
pnpm vitest run packages/harness packages/log packages/runner/src/model-seat.test.ts
grep -q "prompt_timeout" packages/log/src/log.ts && grep -q "prompt_timeout" salient/docs/salient-build-brief.md
```
