---
id: the-console-is-the-benchmark-s-front-end-page-shows-a-playing-series
title: The page shows a series another process is playing as playing
milestone: 10-a-series-that-is-playing-reads-as-playing
depends_on: [the-console-is-the-benchmark-s-front-end-listing-reads-the-lock]
---

The Matches view draws every series the same way whatever its state: `seriesFigures` in
`packages/ui/web/src/results.ts` ends the line with `stopped on <reason> — its full length`, and
`resumeButton` is on the row. For a series a terminal is playing right now that is doubly wrong —
the record carries no `stop` field while a run is in flight (`writeRecord(null)` clears it), so the
row invents a stop, and the button offers to play the same matches twice.

Carry the new fields across the wire: `SeriesRow` and `parseSeriesListing` in that file declare the
listing themselves (a browser bundle may not import `packages/ui/src/results.ts`), so they gain
`playing`, `stale` and `progress`. Do not write a second parser for `progress` — it is the
same `RunCounters` shape `parseRun` in `./progress.ts` already reads off `/api/run`.

Then draw the state:

- A playing row says the series is being played, by another process on this machine, with the
  progress its record carries: pairs played of its pair limit, matches played and failed,
  tokens and cost so far. It draws **no** stop line — nothing has stopped — and it offers **no**
  Resume button. When that process has ended the row goes back to the finished line and the
  Resume is there again.
- A stale row says the run that left the lock has gone, and is resumable as an interrupted series
  is today.
- The words are plain: `expectPlainWords` walks `textContent` plus `title`,
  `placeholder` and `aria-label`. A pid is not a flag or a path, but it is a fact about the machine
  that nobody in a browser can act on, so it stays out of what is drawn.

The row's numbers have to move without the operator reloading. `main.ts` reads the listings on a
refresh and at a run's end, and polls only `/api/run`, once a second, while *its own* run is in
flight — a terminal's run is in neither path. Poll `GET /api/playing` (the route from the previous
task, which reads `series.json` and `series.lock` and no match log) on the run poller's cadence,
but only while its answer names at least one playing series, and write only that row's counters:
re-rendering the whole section every second would re-read every match log header for nothing. When
the poll names a series the listing does not show as playing, re-read the listing once, so the row
loses its Resume button without a reload.

## Acceptance
- [ ] A row whose lock is live says the series is being played, shows pairs played of its pair
      limit and the matches, tokens and cost so far, and offers no Resume; once that process has
      ended the same series is listed as stopped and offers one
- [ ] A playing row draws no stop line, and a row whose lock names a process that is gone says the
      run has gone and is resumable
- [ ] The playing row's counters change with no page reload, the poll asks only the cheap route,
      and every string the Matches view draws passes `expectPlainWords`

## Verification
```bash
pnpm test -- packages/ui/web
grep -rq '/api/playing' packages/ui/web/src
pnpm --filter @no-dice/ui build
pnpm typecheck
```
