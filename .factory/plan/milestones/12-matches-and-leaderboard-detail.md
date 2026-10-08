---
title: Past matches picked, and a leaderboard that opens up
epic: the-console-is-the-benchmark-s-front-end
---

The Matches view lists what has been played, grouped by the series it came from, with the
standalone matches under their own heading. A row says the two seats, the winner, the score, the
seed and the date, and clicking it replays it in `/viewer/`. `/api/matches` today carries only
`name`, `path`, `url`, `viewerUrl` and `series`, so the row's facts come from elsewhere: the
log header's `created`, the seed and the result are in the log itself and in the series
record, and the stats package already walks every log in a series. Existing routes keep their
shapes — the tests pin them — so this is a new route rather than a reshaped one.

The Leaderboard view leads with one row per model — model, provider, matches, won, lost,
drawn, win rate — which is `pooledModelRows` from `@no-dice/stats/leaderboard` almost as it
stands. Clicking a row opens the detail: the per-series breakdown with that series' interval and
the seat split, time taken per match and per turn, tokens and cost, timeouts, passes and
compactions from its `ModelRow.metrics`, and the rules-evidence
counters — lead changes, hex flips per turn, Node hand changes, neutral captures, re-scouts —
from `seriesEvidence` in `@no-dice/stats/rules-evidence`. The modal links each match to its
replay and each series to the report and the evidence kept under `reports/series/`. The page adds no arithmetic of its own: the server composes
the figures from the stats package, each series block carries that series' own rows rather than
a total the console sums, and `seriesEvidence` re-reads every log in a series, so it belongs to
the click and not to the page load.

Done when a match row names its two seats, winner, score, seed and date and opens that match in
the viewer with a way back; when the leaderboard's headline table is one row per model with the
seven columns above; when opening a row shows the figures listed here with links to the replays
and the reports; and when no figure on the page is computed in the browser.
