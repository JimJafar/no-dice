---
id: stats-rules-evidence
title: The stats package counts what the rules' open questions ask about
milestone: 06-first-real-series
depends_on: []
---

The rules' open questions (`salient/docs/salient-rules-v0.md`, "Open questions") are stated as
numbers measured on bot matches — "about 6.5 hexes a turn late on", "the lead changed 3.2 times
a match", "the centre Node changed hands on alternate turns" — and the series report does not
produce any of them, so the rules review has nothing to compare a real match against. Add
`packages/stats/src/rules-evidence.ts`: per match, from the log alone and with no engine and no
replay, compute

- **lead changes** — turns where the side ahead changed, walking `start.score` and
  `turns[].after.score` (a tie is not a lead, so A → tie → B is one change, not two),
- **the largest single-turn swing** in `score.A - score.B`, and **the turn of the final lead
  change** (0 if there was none) — the three inputs brief §6.7's excitement score is built from,
- **hex ownership flips per turn** from the `after.cells` deltas, with the mean over turns 18-25
  so it is comparable with the rules' "6.5 hexes a turn late on",
- **Node hand changes**, and a **ping-pong flag** for a Node that changed owner on three or more
  turns with at least two of them consecutive — the centre Node question,
- **captures of neutral hexes** per turn band, the "single troops trading empty hexes" the home
  bonus question is about,
- **re-scouts per seat** — scouts of a hex label that seat already scouted earlier in the match,
  which is what the last-seen-memory question turns on (`turns[].players.<seat>.scouts` is a
  list of hex labels per turn).

Compaction turns and context size are already `match-metrics`'; do not compute them twice.

Then `no-dice evidence --series <dir>`: the same figures totalled and averaged over a series'
counted matches, printed and written to `<series>/evidence.md`, reading `series.json` the way
`series-report.ts` does (a reader's schema, no dependency on `@no-dice/runner`). This is the
input the rules review writes from, and the showcase ranking reads.

## Acceptance
- [ ] From one log: lead changes, the largest single-turn swing, the turn of the final lead
      change, and hex flips per turn with the mean over turns 18-25
- [ ] Node hand changes with a ping-pong flag, captures of neutral hexes, and per-seat re-scout
      counts
- [ ] `no-dice evidence --series <dir>` totals those over a series' counted matches and writes
      `evidence.md` beside `report.md`

## Verification
```bash
pnpm test -- rules-evidence
```
