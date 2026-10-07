---
id: the-test-suite-s-cpu-bound-and-cli-bound
title: "The test suite's CPU-bound and CLI-bound tests time out on a loaded machine"
milestone: 08-ui-providers-and-leaderboard
depends_on: []
---
Two pre-existing test files rely on vitest's default 5000 ms per-test timeout while doing work that takes longer whenever the machine is busy, so `pnpm test` fails intermittently with `Error: Test timed out in 5000ms` even when nothing is wrong.

- `games/salient/bots/src/symmetry.test.ts` plays 25 seeded matches per `it`. Its header says the chunks were sized so each "finish[es] in a second or two rather than one test that has to be given a longer timeout to survive a slower machine" — that sizing no longer holds: the chunks measure 5.1–10.5 s when other workspaces share the box (load average 8–16 on 16 cpus).
- `packages/harness/src/pi-cli.test.ts` shells out to the `pi` CLI (`reports the pinned version…`, `has an mcp command…`, `exports RpcClient from its package root…`), which is over 5 s under the same load.

This is not caused by the leaderboard work: the same failure reproduces with `packages/ui/src/leaderboard.test.ts` excluded (`vitest run packages/ui/src/results.test.ts games/salient/bots/src/symmetry.test.ts` fails about 1 run in 4), and it appeared in files unrelated to that change. The new UI test file only adds a little load.

The fix belongs in the test config or in those two files: give the CPU-bound symmetry chunks and the `pi` CLI probes an explicit timeout that fits what they actually cost (the repo already does this — `packages/ui/src/results.test.ts` passes 120_000 for its real runs), or raise the default in `vitest.config.ts`. Assertions must not be relaxed, and the chunking must stay so a bad seed still names itself.

## Acceptance
- [ ] `games/salient/bots/src/symmetry.test.ts` no longer fails with `Test timed out in 5000ms` when the machine is busy, with its 300 seeds and per-turn mirror checks intact
- [ ] `packages/harness/src/pi-cli.test.ts` no longer times out on its `pi` CLI probes under load
- [ ] `pnpm test` passes repeatedly on a loaded machine (load average above 10 on 16 cpus)

## Verification
```bash
for i in 1 2 3 4 5 6; do pnpm exec vitest run packages/harness/src/pi-cli.test.ts games/salient/bots/src/symmetry.test.ts || exit 1; done — fails intermittently today with `Error: Test timed out in 5000ms` (probabilistic: it needs a loaded machine, so run it while other workspaces are busy)
```
