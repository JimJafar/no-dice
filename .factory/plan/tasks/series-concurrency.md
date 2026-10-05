---
id: series-concurrency
title: A series runs more than one pair at a time
milestone: 04-series-runner-and-stats
depends_on: [series-stop]
---

Add `--concurrency <n>` to `runSeries`: a bounded pool over **whole pairs**, default 1. Brief
§6.5 asks for it ("run several matches at once, limited by provider rate limits"), and the
measurement makes it necessary rather than nice — one model-versus-Greedy match is 19 minutes
of seat time, so a 150-match series is about 48 hours end to end if pairs are played one after
another. Inside a pair the two matches run together (they are the same seed with the seats
swapped, so they share nothing but the seed); pairs are the unit the pool schedules, so a pair
is never split across a batch boundary and the stopping test is still evaluated only at batch
boundaries, exactly as it is when concurrency is 1.

Keep the accounting honest under concurrency: `series.json` is written from the batch once
every match in it has finished, so a stop mid-batch still leaves a complete record, and a
match that throws is recorded as failed without taking its batch's other matches down with it.
Default stays 1 because each Pi seat is a child process with its own home and its own MCP
connection, and the provider's rate limits are unknown until milestone 06 runs a real series —
the flag exists so the operator can raise it, not so the default can overload Marvin.

## Acceptance
- [ ] With `--concurrency 2` and a scripted `playMatch` that records when each match starts and
      finishes, more than one pair is in flight and the same set of logs results as at 1
- [ ] The same scripted results stop at the same pair count whatever the concurrency is
- [ ] A scripted failure in one match of a batch is recorded as failed and the batch's other
      matches are still played and recorded

## Verification
```bash
pnpm test -- series-concurrency
```
