---
id: the-console-is-the-benchmark-s-front-end-matches-grouped-by-series
title: The Matches view groups its logs by series and says what each match was
milestone: 12-matches-and-leaderboard-detail
depends_on: [the-console-is-the-benchmark-s-front-end-match-facts-route]
---

The Matches view is the console's front view, and today it draws one flat list of logs:
each row is a link whose label the browser worked out by reading that log's header
itself, with `— from <series>` stuck on the end. Draw it from `GET /api/match-facts` instead, in `packages/ui/web/src/results.ts`: one block per series, in the order the
listing gives, each headed by what that series is (its pairing, and its name where a
name is a fact the reader needs), and one block for the logs whose `series` is `null`,
headed in words that say these were played on their own and belong to no series.

A row says the two seats, who won, the score, the seed and the day — in the shape
`bot:greedy beat bot:random 43–33 · seed 1234 · 7 Oct 2026`, with a drawn match said as
drawn rather than as won by nobody. Keep `matchLabel` and `dateOf` in that file as the
one place a match is worded, so these rows and the leaderboard's replay links cannot
drift apart; the browser-side header reader (`createMatchHeaderSource`) stays only
for the links the leaderboard draws, which the facts route does not label. The row links
to the replay at the `viewerUrl` the console answers, which already carries the
`back=#matches` the viewer uses for its way back, so opening a match and coming back
lands the reader on the group they opened it from.

Nothing here is arithmetic: winner, score, seed and date arrive in the route's row, and
the only figure the page turns into a string is a rate into a percentage. A facts read
that fails leaves the listing standing and says why on the status line, the way every
other failed read does.

## Acceptance

- The Matches view lists its logs under one heading per series plus one heading for the
  matches that belong to no series, and every row names its two seats, the winner, the
  score, the seed and the day.
- A row's link opens that log in `/viewer/`, and the viewer offers the way back to the
  Matches view; a facts read that failed says so in one line and leaves the rest of the
  page standing.
- The text the view draws breaks none of the three rules in `web/src/plain-words.ts`,
  and the four gates and `pnpm --filter @no-dice/ui build` pass.

## Verification
```bash
grep -q 'match-facts' packages/ui/web/src/results.ts
pnpm test -- results plain-words
pnpm --filter @no-dice/ui build
pnpm typecheck
```
