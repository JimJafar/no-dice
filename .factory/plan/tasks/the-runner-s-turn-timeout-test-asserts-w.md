---
id: the-runner-s-turn-timeout-test-asserts-w
title: "The runner's turn-timeout test asserts wall_ms on a timer boundary and flakes under load"
milestone: 03-pi-harness
depends_on: []
---
`packages/runner/src/match.test.ts` > "passes a seat that is still playing at the timeout, and keeps the match going" asserts `turn.players.B.wall_ms >= 1_000` where `turnTimeoutMs: 1_000`. The seat never answers, so the harness aborts at the timeout and `wall_ms` is `Math.round` of the elapsed time. Node timers can fire marginally early relative to `performance.now()`, so the recorded value lands on 999 and the assertion fails.

It reproduced once (999 vs 1000) in a full `pnpm test` run, and passed in every isolated run of that file and in the following full runs. It became more likely because the suite now carries four more tests that spawn Pi processes (`packages/harness/src/pi-player.test.ts`), which adds CPU contention to the parallel run — but the assertion itself is the weak point, not the new tests. It is not caused by any behaviour change in the runner.

The fix belongs in the test, not the runner: either give the assertion the tolerance a timer boundary needs (e.g. `toBeGreaterThanOrEqual(turnTimeoutMs - 25)`), or make the fake seat's playTurn sleep clearly past the deadline so the measured wall time is unambiguously over it. Do not lower `turnTimeoutMs` or drop the assertion — the point of the test is that a seat still playing at the deadline is passed with brief §6.3's `timeout` reason and its wall time recorded.

## Acceptance
- [ ] `pnpm test` passes repeatedly, including when the whole suite runs in parallel on a loaded machine
- [ ] The test still asserts that a seat caught mid-turn is passed with `passed: "timeout"` and a wall time that reflects the timeout, not a smaller one
- [ ] No test is skipped, deleted or weakened to reach that

## Verification
```bash
Not a deterministic repro: the failure is a boundary flake. Reproduce by looping the full suite, e.g. `for i in 1 2 3 4 5 6 7 8 9 10; do pnpm test >/dev/null || exit 1; done` — it has failed once at `expected 999 to be greater than or equal to 1000` in packages/runner/src/match.test.ts:457. A good fix makes that assertion insensitive to a millisecond of timer drift, so the loop passes every time.
```
