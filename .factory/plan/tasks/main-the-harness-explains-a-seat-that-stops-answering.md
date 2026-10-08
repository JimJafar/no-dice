---
id: main-the-harness-explains-a-seat-that-stops-answering
title: Why a seat stops answering its prompt after an abort is written down, and pinned by a test
milestone: 06-first-real-series
depends_on: []
type: code
---

In the Marvin series (seed 479473028, `marvin/subagent` in seat A, 2026-10-07 ~23:18 UTC) turn 18 was
submitted at 23:17:53.917, the runner's after-submission watcher aborted the seat 10 s later, and the
turn-19 `prompt` RPC command then got no response at all: `RpcClient` threw
`Timeout waiting for response to prompt`, `PiPlayer.command()` (`packages/harness/src/pi-player.ts:547`)
rethrew it because `seatIsGone()` (`:184`) only recognises `/process exited|process error|Client not
started/`, and the whole match failed and had to be replayed. Diagnose it before changing anything.

Facts to work from, all checked on this box:

- The transcript is kept: `series/marvin-subagent-vs-greedy/sessions/479473028-marvin-subagent-greedy/session-A/`,
  the earlier of the two files (`2026-10-07T23-02-11-254Z_…jsonl`, 174 entries). Its last entry is
  the 23:18:03.972 assistant message with `stopReason: "error"`, `errorMessage: "This operation was
  aborted"` and every usage figure zero — and the file ends there, so turn 19's prompt never reached
  the session's message list. The wedge is before Pi accepts the prompt, not inside the run.
- The rerun of the same seed (the later file in that directory, 00:28) played all 25 turns, so this is
  a state the session got into, not a deterministic per-seed bug.
- `RpcClient.send()` (pinned `@earendil-works/pi-coding-agent` 1.0.2, see
  `/usr/local/lib/node_modules/.../dist/modes/rpc/rpc-client.js` for the shape) has a hard 30 s response
  timeout, and on timeout it deletes the pending request and rejects — the child stays alive, and a
  response that arrives later is dispatched to `onEvent` listeners as if it were an event.
- Pi's RPC mode answers a `prompt` command **only** from the `preflightResult` callback
  (`dist/modes/rpc/rpc-mode.js`, `case "prompt"`), so any path out of `AgentSession.prompt()` that
  neither calls it nor throws leaves the command unanswered forever. Candidates, all in
  `dist/core/agent-session.js`: `prompt()` defers silently into `_deferredSettledActions` while
  `_isEmittingAgentSettled` is true (`:1514`, and `_emitAgentSettled()` runs in the `finally` of the
  aborted `_runAgentPrompt`); it throws `Agent is already processing…` when `isStreaming` is still true;
  it throws while a compaction is in progress; and it awaits `_checkCompaction(lastAssistant, false)`
  before it answers, which can itself want the provider.
- `vitest.config.ts`'s own comment already measured the related shape: a Pi seat starved hard enough
  "settles an aborted turn when the provider request settles rather than when the abort lands" — the
  aborted provider request stays in flight, and Marvin (llama-swap) answers one request at a time
  (`docs/series-notes.md` §3).

Deliver two things. First, a new section in `docs/pi-harness-notes.md` (numbered after §7, in the file's
existing voice) that states which of those paths the transcript and the pinned code actually imply, what
the harness can and cannot tell from the rejection alone, and what a late-arriving deferred prompt would
do to a turn already passed. Second, a stub-model test in `packages/harness/src/pi-turn.test.ts` — the
file already drives `PiPlayer` against `StubModel`, which can hold a reply open with `delayMs`
(`sleepsPastDeadline`) — that gets a seat into the state where the next turn's `prompt` command fails
while its Pi child is demonstrably alive, and asserts what the harness does with it **today**: `playTurn`
rejects with a non-death error and the match is not loggable. That test is the thing the next task flips,
so it must be a real reproduction, not a mock of the error string.

## Acceptance
- [ ] `docs/pi-harness-notes.md` has a new numbered section naming the mechanism, citing the transcript's last entries and the pinned Pi code paths by file and symbol
- [ ] A test in `packages/harness/src/pi-turn.test.ts` reproduces a `prompt` command failing while the Pi child is alive, and asserts today's outcome (the turn rejects, the match cannot be logged)
- [ ] No behaviour change: the reproduction test documents the bug rather than fixing it, and the four gates pass as they did

## Verification
```bash
pnpm vitest run packages/harness/src/pi-turn.test.ts
# The new section names the pass reason the next task adds, so the diagnosis and the fix agree.
grep -q "prompt_timeout" docs/pi-harness-notes.md
```
