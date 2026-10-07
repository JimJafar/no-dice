---
id: a-starved-pi-seat-whose-turn-the-runner
title: "A starved Pi seat whose turn the runner aborts makes the match unloggable"
milestone: 08-ui-providers-and-leaderboard
depends_on: []
---
Under heavy cpu starvation the full suite fails in `packages/runner/src/model-seat.test.ts` ("a Pi seat that runs past the runner's turn timeout > passes its turn as a timeout, and the match is still played and logged") with:

    Error: match <id> cannot be logged: seat A played stub/stub-1 without Pi ever reporting a context window

thrown by `headerFor` (`packages/runner/src/match.ts:705`). This is unrelated to the timeout work in the current task: the file is untouched by it, and it is not a `Test timed out` failure.

Cause: that test runs the match with `turnTimeoutMs = 1_500`, so the runner aborts the seat's turn before Pi has completed one. Pi's `contextUsage` session stats — the only source `runMatch` has for `windows[seat]` — arrive with a completed turn, so a starved Pi that never finishes one leaves `windows.A` null and the header cannot be written. Real matches use `turn_timeout_s: 300`, so it only appears when Pi's startup is starved.

Measurements on this 16-cpu box: the file passes 3/3 when run alone at load average ~17; in full-suite runs at load ~21-23 it failed 2 of 3; the full suite passed at that same load with `--maxWorkers=4` (101 s) and failed with the configured 6 workers (74 s). So either the log header needs a window that does not depend on a completed turn (e.g. taken from the seat's model spec / Pi's own startup info), or the runner must let a seat report its window before the header is written, or the suite's worker cap needs re-measuring now that the suite is 85 files / 1118 tests rather than the 1064 tests the `vitest.config.ts` comment measured.

Do not fix it by relaxing the test's assertions (`passed === "timeout"`, `tool_calls === []`, `wall_ms >= turnTimeoutMs`, log on disk) or by letting `headerFor` invent a context window — the throw exists so a log never carries a window no seat ran with.

## Acceptance
- [ ] `pnpm exec vitest run` passes repeatedly while 16 cpu hogs keep the load average above 20, with no "cannot be logged: seat A played stub/stub-1 without Pi ever reporting a context window"
- [ ] The turn-timeout test in `packages/runner/src/model-seat.test.ts` still asserts `passed === "timeout"`, `tool_calls === []`, `wall_ms >= turnTimeoutMs` and a parseable match log on disk
- [ ] A real Pi seat's log header still records the context window Pi reported, and a seat that never reported one is still refused rather than guessed at

## Verification
```bash
for i in 1 2 3; do for j in $(seq 1 16); do node -e 'const t=Date.now()+300000;let x=0;while(Date.now()<t){x+=Math.sqrt(x+1)*Math.random()}' >/dev/null 2>&1 & done; pnpm exec vitest run 2>&1 | tee /tmp/model-seat-load-$i.log | grep -q 'cannot be logged' && exit 1; done; true
```
