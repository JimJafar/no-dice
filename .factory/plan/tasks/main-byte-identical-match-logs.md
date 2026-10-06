---
id: main-byte-identical-match-logs
title: Two runs on one seed write the same bytes
milestone: 06-first-real-series
depends_on: []
---

`match-runner-loop`'s third criterion is "the same seed and the same bots give
byte-identical logs on two runs". The test that claims it cheats: `withoutTimings` in
`packages/runner/src/match.test.ts` (line 67) rewrites every `"ms"` and `"wall_ms"` to 0 before
comparing, so the logs are equal except for the numbers no run can repeat. Make them actually
repeatable.

Two clocks are in play, and both have to be injectable:

- `wall_ms` — `playSeat` in `packages/runner/src/match.ts` takes `performance.now()` at the start
  of a seat's turn and again at the end (lines ~424 and ~449).
- `ms` — `MatchSession.call` in `games/salient/server/src/session.ts` does the same
  around every tool call (lines ~263 and ~272), and that number goes into the log's `tool_calls`.

Add a monotonic timer to `RunMatchOptions` beside the existing `clock` — `timer?: () => number`,
milliseconds, defaulting to `performance.now` — and thread it into `playSeat`. Give
`MatchServer` the same optional timer (its `createMatch` builds a `MatchSession`; an optional
argument leaves every other caller working) and have `runMatch` pass its own timer to the
`new MatchServer()` at line 616, so the server's `ms` comes off the same source. Keep the
`Math.max(0, Math.round(...))` shaping where it is, so a real run is unchanged.

Then change the determinism test (line ~205) to inject a timer that advances a fixed step per call
— a closure counter, made fresh for each run, so both runs see the same sequence — and compare the
two files' **raw text**, with no `withoutTimings` on either side. Keep the negative half of the
test: another seed still has to differ. The linked-versus-HTTP comparison below it becomes a raw
comparison too — the same calls go through the same `MatchSession`, so the same timer sequence
lands on it either way. Delete `withoutTimings`: a helper no test needs is a way of forgetting
this was fixed.

One thing to watch: the timer is called once per tool call and twice per seat-turn, so the two runs
only line up if they make the same calls, which a bot-versus-bot match on one seed does. If a
timeout or a retry ever changes that count, the comparison will say so loudly — that is the
point of the test, not a bug in it.

## Acceptance
- [ ] `runMatch` takes an injected monotonic `timer`, and both `wall_ms` and the server's per-call
      `ms` are measured off it
- [ ] The determinism test compares the two logs' raw text with no field blanked, and still shows a
      different seed differs
- [ ] A real run with no injected timer behaves as before (`pnpm test -- match` and the reference
      replay gate both pass)

## Verification
```bash
pnpm test -- match
grep -q "timer?:" packages/runner/src/match.ts
grep -q "timer" games/salient/server/src/session.ts
! grep -q "withoutTimings" packages/runner/src/match.test.ts
```
