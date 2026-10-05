---
id: series-plan
title: A series fixes its seed list and its seat-swapped pairs
milestone: 04-series-runner-and-stats
depends_on: []
---

Add `packages/runner/src/series-plan.ts`: `planSeries(options)` turns a pairing into the whole
list of matches it will play, on disk, before anything is played. Brief §6.5's rules are the
spec: for each seed, **two matches with the seats swapped** (model X in seat A, then X in
seat B), a **fixed, recorded seed list** that a rerun of the same pairing reuses instead of
drawing again, and the layout `series/<name>/matches/<seed>-<seat-map>.json` with Pi's saved
conversations under `series/<name>/sessions/`. Reuse `seatSlug` from `packages/runner/src/args.ts`
for the file names — it already folds a `<provider>/<model-id>` into something a filesystem
accepts — and pass each match a `matchDir` of `series/<name>/sessions/<seed>-<seat-map>/`,
because `runMatch` otherwise puts a Pi seat's home beside the log, inside `matches/`.

The plan reads the series directory before it decides anything: a pair whose two logs exist is
skipped, and a pair with **one** log on disk plays only the missing match, since brief §6.5
says a pair is never left half played. The seed list is written to `series/<name>/series.json`
on the first run (`seeds`, plus `seed_base` and `max_pairs` it was drawn for) and read back
from there afterwards, so a resumed series and a series started again next week sit on the
same maps; growing `--max-pairs` appends to the recorded list rather than replacing it. Keep
this module free of any match playing — it returns paths and seat orders, which is what makes
the next two tasks testable without a model.

## Acceptance
- [ ] The same pairing planned twice yields the identical seed list, read back from
      `series/<name>/series.json` rather than drawn again
- [ ] Every pair is two matches on one seed with the seats swapped, at
      `series/<name>/matches/<seed>-<a>-<b>.json` and `<seed>-<b>-<a>.json`, each with its own
      `matchDir` under `series/<name>/sessions/`
- [ ] A pair with both logs on disk is skipped and a pair with one log plans only the missing
      match

## Verification
```bash
pnpm test -- series-plan
```
