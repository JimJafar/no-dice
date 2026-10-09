---
id: the-console-is-the-benchmark-s-front-end-leaderboard-headline
title: The Leaderboard leads with one row per model
milestone: 12-matches-and-leaderboard-detail
depends_on: []
---

The Leaderboard view's per-model table currently leads with Model, Matches counted,
Matches missing, Win rate pooled, Seat A, Seat B, Pooled from and a whole column of
prose about what "missing" means, and it sits *below* the per-pairing table. Turn it into
the headline the milestone asks for: **model, provider, matches, won, lost, drawn,
win rate**, one row per model, drawn above the per-pairing table, in the order
`pooledModelRows` already puts them in. The seat split, the list of series it was
pooled from and the missing note leave this table — they come back in the detail a row
opens — and the per-pairing table stays where it is, below, unchanged.

No figure moves: `won`, `lost` and `drawn` are already in the answer, in
`result.winRate` of each pooled row, so `packages/ui/web/src/leaderboard.ts`'s parser
grows those three counts and `packages/ui/src/leaderboard.ts` is not touched. The one
thing that is not already there is the provider, and splitting the label is wording
rather than a figure: put it in one tested helper in the web package — `bot:<name>` is
provider `bot`, `<provider>/<id>` splits at the first slash, and a label with no slash in
it says the log never named a provider — and use that same helper here and in the detail,
so the two can never spell a model differently. A model nobody prices still gets a row.

A row is now also a way in: give each row one control that opens that model's detail,
reachable by keyboard and naming the model it opens, and have it call one function that
the next task fills in. Keep the table inside its `.table-scroll` box, so seven columns
still work at phone width.

## Acceptance

- The per-model table's columns are exactly model, provider, matches, won, lost, drawn,
  win rate, one row per model, above the per-pairing table, in `pooledModelRows`' order.
- Every figure in it is read out of the console's answer — no count is summed and no rate
  is worked out in the page — and the provider column comes from one helper that is tested
  on `bot:greedy`, `marvin/subagent`, `deepseek/deepseek-flash` and a label with no slash.
- Each row can be opened by click and by keyboard and names the model it opens; the table
  still scrolls inside its box at phone width; the four gates and
  `pnpm --filter @no-dice/ui build` pass.

## Verification
```bash
grep -q '"Won"' packages/ui/web/src/render-leaderboard.ts
grep -q 'seatPartsOf' packages/ui/web/src/leaderboard.ts
git diff --quiet packages/ui/src/leaderboard.ts
pnpm test -- leaderboard plain-words
pnpm --filter @no-dice/ui build
pnpm typecheck
```
