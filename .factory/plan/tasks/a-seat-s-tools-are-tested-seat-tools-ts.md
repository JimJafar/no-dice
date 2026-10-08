---
id: a-seat-s-tools-are-tested-seat-tools-ts
title: "A seat's tools are tested: seat-tools.ts registers the game's tools under their own names"
milestone: 06-first-real-series
depends_on: []
---
main's two harness commits deleted coverage and never replaced it: 0a78f80 removed 1 test from packages/harness/src/pi-turn.test.ts and 2b83df8 removed 4 from packages/harness/src/pi-home.test.ts (the whole "pi mcp list against a real match" suite that pinned a seat's tool wiring), while the module that replaced that mechanism — packages/harness/src/seat-tools.ts, shipped in 2b83df8 — has no test file at all. The suite therefore fell from 1121 tests to 1117, which is what the `tests` gate (gates.tests.expect.minTests: previous in .factory/project.yaml) is now pinned against.

The tests already exist, written and reviewed once: restore them with `git cat-file blob c9d259aeb0ce3571225e1ed6eb9f3d1420e9cc0a > packages/harness/src/seat-tools.test.ts` (that blob is on the branch sf/main-series-rerun-plays-the-marvin-series-again, commit 900484f; it was dropped from that task only because that task is data-only). It is 243 lines, 7 tests, 575 ms: a real MatchServer behind startServer on a loopback port, driven through a recorded Pi extension API (no Pi child process). It pins that the extension registers the match's tools under the game's own names with no `mcp__` prefix; registers each with the server's own description and input schema (compared against tools/list over the socket); forwards a call to the match and answers with the server's own content blocks, the match counting it for the seat whose token it was given; hands back a refused call (scout Z1 -> unknown_hex) as an errored answer rather than an exception; closes the connection on session_shutdown so the seat's process can exit; refuses to start a seat with no SALIENT_URL/SALIENT_TOKEN, naming both; and fails to start a seat whose token the match does not know (unknown_token).

Nothing about seat-tools.ts itself needs to change — it passes as it stands.

## Acceptance
- [ ] packages/harness/src/seat-tools.test.ts exists and its 7 tests pass
- [ ] pnpm test reports 1124 passing tests, restoring the count main's harness commits dropped
- [ ] pnpm typecheck is clean

## Verification
```bash
set -e; test -f packages/harness/src/seat-tools.test.ts; npx vitest run packages/harness/src/seat-tools.test.ts 2>&1 | grep -q "Tests  7 passed"
```
