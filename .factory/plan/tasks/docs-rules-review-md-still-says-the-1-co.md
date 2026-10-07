---
id: docs-rules-review-md-still-says-the-1-co
title: "docs/rules-review.md still says the §1 command continues the first series"
milestone: 06-first-real-series
depends_on: []
---
`docs/rules-review.md` ("What would close the four open sections", step 1, ~line 344) tells the reader that `no-dice series … --max-pairs 10` "continues this series from its recorded seeds ([series-notes §6](series-notes.md)) and replays the two voided matches". That is no longer true and series-notes §6 now says so: the whole `series/marvin-subagent-vs-greedy/` directory (series.json, report.md, the ten logs) was written in the `series-real-run` task's workspace, is caught by the anchored `/series/` rule in `.gitignore`, and was deleted when that task merged — `/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/` does not exist. With no `series.json`, `planSeries` (packages/runner/src/series-plan.ts) falls back to `options.seedBase ?? DEFAULT_SEED_BASE` and draws a fresh list, so the command starts a NEW series in a new directory and plays all ten matches. Docs only, no code. The "read that as two series stitched together" paragraph below it is still the right warning but for a different reason (nothing is stitched; it is a replay under the post-`749d236` harness rule).

## Acceptance
- [ ] docs/rules-review.md step 1 says the command starts a new series rather than continuing the first, and points at series-notes §6 for why
- [ ] The 'two series stitched together' paragraph no longer claims the five played pairs are on disk to be stitched to five new ones
- [ ] No code changes; the command lines quoted stay as they are

## Verification
```bash
node -e 'const t=require("node:fs").readFileSync("docs/rules-review.md","utf8"); if (/continues this series from its recorded seeds/.test(t)) throw new Error("docs/rules-review.md still claims the same command continues the first series");'
```
