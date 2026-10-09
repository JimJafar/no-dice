---
id: the-console-is-the-benchmark-s-front-end-model-detail-modal
title: Opening a leaderboard row shows that model's detail
milestone: 12-matches-and-leaderboard-detail
depends_on: [the-console-is-the-benchmark-s-front-end-leaderboard-headline, the-console-is-the-benchmark-s-front-end-model-detail-route]
---

Fill in the control the headline rows carry: clicking one asks
`GET /api/model-detail?label=…` and draws the answer in a panel over the Leaderboard
view, in a new module `packages/ui/web/src/render-model-detail.ts` with a happy-dom test
of its own. The read belongs to the click — nothing on page load asks for it, and nothing
polls it — because that route walks the series root and reads each series' logs again for
the rules counters.

The panel opens with the model's pooled figures said in words — matches, won, lost,
drawn, win rate and its interval, how many of those matches were played from each seat,
and the missing note, which is the figures the headline table gave up to make room for
provider and won/lost/drawn. Then one block per series that counted a match for it: that
series' name and pairing, its win rate with its own interval, the seat split, turns, time
per match and per turn, tokens (input, output, cache read) and cost, timeouts, passes and
compactions, and the five rules counters — lead changes, hex flips per turn, Node hand
changes, neutral captures and re-scouts — said as that series' figures, since they count
both seats and not just this model's. Each block links its matches to their replays
through `viewerUrlFor(url, "leaderboard")`, so the viewer's way back lands the reader on
the leaderboard they came from, and links the series' report and, when the console says
they are there, the kept report and evidence copies; a kept copy the answer says is
missing is not offered as a link. A series whose report or evidence failed is a block
carrying that line.

The panel closes on its own control and on Escape, and puts focus back on the row that
opened it. A read that fails leaves the table standing and says the line, as every other
failed read does. No figure is worked out here — the route composes them — and the text
the panel draws breaks none of the three rules in `web/src/plain-words.ts`: no directory,
no log file name, no flag name.

## Acceptance

- Opening a headline row shows that model's pooled figures and one block per series it
  played in, each with its interval, seat split, time per match and per turn, tokens and
  cost, timeouts, passes, compactions and the five rules counters.
- Each block links its matches to their replays and links the report and the kept copies
  that exist; a block for a series that could not be read says so in one line.
- The panel closes by its control and by Escape and returns focus to the row; no detail is
  read before a row is opened and nothing is polled; the drawn text passes
  `plain-words.ts`; the four gates and `pnpm --filter @no-dice/ui build` pass.

## Verification
```bash
grep -q 'model-detail' packages/ui/web/src/render-model-detail.ts
grep -q 'renderModelDetail\|openModelDetail' packages/ui/web/src/render-leaderboard.ts
pnpm test -- model-detail plain-words
pnpm --filter @no-dice/ui build
pnpm typecheck
```
