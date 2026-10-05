---
id: series-run
title: A series plays its pairs, and a stop and a restart replay nothing
milestone: 04-series-runner-and-stats
depends_on: [series-plan]
---

Add `packages/runner/src/series.ts`: `runSeries(options)` drives `planSeries` and plays what
the plan says is missing, then writes `series/<name>/series.json`. The one design decision
that matters here is the seam: `runSeries` takes `playMatch`, defaulting to `runMatch` from
`./match.ts`, and every match goes through it. Brief §8's series tests are written "with
scripted results", and they have to be — one real bot-versus-bot match already takes about
1.3 s and a model match takes 19 minutes (`docs/pi-harness-notes.md` §7), so a 75-pair series
can never be a test fixture. A scripted `playMatch` gets the plan's path and `matchDir`,
writes a log there (a real `salient-log/1` file, so the resume test exercises the same
on-disk state a real run does) and hands back the result.

`series.json` is the series' memory and the report brief §6.5 asks for: the pairing, the seed
list, and for every pair its two matches with path, result type, winner, margin, cost and
token totals, plus the run's own state — pairs played, stop reason, whether it stopped early.
Write it atomically after every batch, the way `writeAtomically` in `match.ts` does it for a
log, so a series killed at any moment can be restarted from what is on disk. A match that
throws — `MatchVoided` from a seat reaching outside the seven tools, a provider that never
answered — leaves no log, is recorded as failed with its reason, and is played again on the
next run; a voided match must never be counted as one that was played.

This task is the resume half of brief §8: stopping and restarting a series replays nothing
that already has a log.

## Acceptance
- [ ] With a scripted `playMatch`, a run of 3 pairs leaves 6 logs and a `series.json` naming
      every pair, its results and the run's stop state
- [ ] Restarting the same series plays nothing whose log already exists and ends with the same
      set of logs (brief §8's resume test)
- [ ] A `playMatch` that throws leaves no log, is recorded as failed in `series.json`, and is
      played again by the next run

## Verification
```bash
pnpm test -- series-run
```
