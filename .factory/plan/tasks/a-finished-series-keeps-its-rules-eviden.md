---
id: a-finished-series-keeps-its-rules-eviden
title: "A finished series keeps its rules evidence in reports/series/, not only in the gitignored series directory"
milestone: 06-first-real-series
depends_on: []
---
`no-dice evidence --series <dir>` writes `series/<name>/evidence.md`, and `/series/` is gitignored (docs/series-notes.md §7 explains why: a real log is 0.9–1.1 MB). `report.md` survives a run only because someone copies it verbatim to `reports/series/<name>.md`; nothing copies `evidence.md`, so the five rules-evidence counters — lead changes, hex flips per turn with the 18-25 mean, Node hand changes and ping-pong, neutral captures, per-seat re-scouts — were gone with the series-real-run workspace before `docs/rules-review.md` could be written from them. Four of that review's eight sections are `Left open` for that reason alone, not sample size. The fix is small and in the same place the report copy is documented: after a series finishes, run `no-dice evidence --series series/<name>` and keep the markdown at `reports/series/<name>-evidence.md`, with the copy step recorded in docs/series-notes.md §7 and the `evidence` paragraph of README.md pointing at where the kept copy lives. Whether the runner itself should write the copy (it already writes `report.md` into the series directory) is Jim's call.

## Acceptance
- [ ] A finished series leaves `reports/series/<name>-evidence.md` in git, holding the five rules-evidence counters for its counted matches
- [ ] docs/series-notes.md §7 records the copy step next to the one that keeps `report.md`, so a resumed or extended run does it too
- [ ] README.md's `evidence` paragraph says where the kept copy lives, not only the gitignored path

## Verification
```bash
grep -q 'evidence\.md' docs/series-notes.md && grep -q 'reports/series/.*evidence' README.md
```
