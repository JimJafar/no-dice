---
id: management-ui-leaderboard-page
title: The page draws both leaderboard views over the same records
milestone: 08-ui-providers-and-leaderboard
depends_on: [management-ui-leaderboard-endpoints, management-ui-provider-page]
---

The last section of the console, in `packages/ui/web`, with the same split as the others:
`leaderboard.ts` fetches `GET /api/leaderboard` and parses it into declared shapes (the page
declares what it reads rather than bundling the server module, as `results.ts` already does), and
`render-leaderboard.ts` draws two tables into `#leaderboard`. `main.ts` reads it at the same
moments it reads the listings — on page open and when a run it was watching ends — and not on the
one-second poll, because that answer walks every match log of every series.

**Per pairing**, one row per series: the pairing spelled as `--a` and `--b` spell it, pairs and
matches, counted and missing, the win rate with its 95% interval, the stop reason and whether it
stopped short of its pair limit, a link to its `report.md` (the row's `reportUrl`) and links to
its matches — the `/api/matches` rows the page already holds, which carry `series` and the
`viewerUrl` that opens each in the replay viewer.

**Per model, pooled**, one row per model: matches counted, matches missing, the win rate with its
95% interval, and the seat split — seat A's rate and seat B's rate beside the pooled one — so a
model that only ever wins from one seat is visible as that rather than as a good model. The row
also names the series it was pooled from, and repeats in one clause that a missing match is
attributed to the pairing, not counted against this model: it is a match that never happened, not
a loss.

**The page adds no arithmetic.** Percentages and wording only; every count, rate and interval is
the console's, which is the stats package's. A series outside the root and a record that could not
be read are each said in a line, the way the results section says them — a leaderboard that
quietly omits a series reads as a model that never played it.

It follows the Providers page because both rewire `main.ts` — which section is read when, and
which module owns which heading — and the leaderboard is the one that goes in second.

## Acceptance
- [ ] `#leaderboard` draws both tables from `GET /api/leaderboard`: one row per series with its
      report and its matches linked, and one row per model with win rate, 95% interval, matches
      counted and missing, and the seat split
- [ ] No figure in the section is worked out by the page, and a missing match is drawn as missing
      rather than as a loss
- [ ] A series outside the root and a series whose record cannot be read are each named on the
      page, and `pnpm --filter @no-dice/ui build` and `pnpm typecheck` still pass

## Verification
```bash
pnpm test -- leaderboard
pnpm --filter @no-dice/ui build
pnpm typecheck
grep -q '/api/leaderboard' packages/ui/web/src/leaderboard.ts
grep -q 'reportUrl' packages/ui/web/src/render-leaderboard.ts
grep -q 'viewerUrl' packages/ui/web/src/render-leaderboard.ts
grep -q 'seatSplit' packages/ui/web/src/render-leaderboard.ts
grep -qi 'outside' packages/ui/web/src/render-leaderboard.ts
grep -q 'leaderboard' packages/ui/web/src/main.ts
```
