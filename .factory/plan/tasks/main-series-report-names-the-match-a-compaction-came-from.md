---
id: main-series-report-names-the-match-a-compaction-came-from
title: The series report names the match each compaction turn came from
milestone: 06-first-real-series
depends_on: [main-series-notes-record-what-the-run-lost]
---

The report's "Compaction turns:" line cites a seed and a turn — `seed 479473028 turn 15` — and a
seed names a **pair**, not a match. In the first real series that made the line unreadable:
seeds 479473028 and 313966722 each lost one match to `tool_surface` and kept the other, so the
turns come from the match that has a log, while the line reads as though it cited the voided one.
Make the line name the match.

In `packages/stats/src/series-report.ts`:

- `SeriesTurnRef` (§ near line 218) gains the seat model X played in that match, and
  `SeriesContext.byTurn`'s rows carry it too, since they name a match the same way.
- `contextOf` (line ~531) takes parts that carry `seat` as well as `seed` — its caller already
  holds a `CountedMatch`, which has `seed` and `seat` (line ~364) — and threads it into
  `byTurn`, `compactionTurns` and `unstatedTurns`.
- The line it prints (line ~931) names both: `seed 479473028, X in seat A, turn 15`, in the same
  words the "Missing matches" list already uses for a match. Keep the order the record gives
  the matches in, so the line is stable across runs.

Anything else that reads `SeriesTurnRef` or `SeriesContext` follows from the type change; the
stats tests are the place to pin it. Add a case to `packages/stats/src/series-report.test.ts`
where one pair has a played match and a voided one, and assert the compaction line names the seat
of the match it came from — the existing case at line 833 (`"Compaction turns: seed 101 turn 18."`)
only ever has one match per seed, which is exactly why the ambiguity was missed.

Do not regenerate the committed report: the series directory is gone, so
`reports/series/marvin-subagent-vs-greedy.md` stays as it was generated, with the explanatory
sentence the previous task added. Say in `docs/series-notes.md` §7 that a report
regenerated from now on names the match, so the kept copy and a fresh one differ there.

## Acceptance
- [ ] A series report's compaction line names the match each turn came from (seed and the seat
      model X played), not only the seed
- [ ] A test covers a pair whose second match is missing and asserts the line points at the
      match that has a log
- [ ] `docs/series-notes.md` §7 says the kept report predates the change and a regenerated one
      names the match

## Verification
```bash
pnpm test -- series-report
```
