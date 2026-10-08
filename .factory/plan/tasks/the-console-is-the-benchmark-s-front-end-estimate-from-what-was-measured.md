---
id: the-console-is-the-benchmark-s-front-end-estimate-from-what-was-measured
title: The console estimates a run from the series it has already played
milestone: 11-seats-providers-and-starting-runs
depends_on: []
type: code
---

The Runs view quotes a fixed figure — a model match measured about 19 minutes and 4.59M tokens, from
`docs/pi-harness-notes.md` §7 — for every seat, however many matches have been played since that
one measurement was written down. The repo has played matches since then, and the stats package
already reports turns, tokens, cost and wall time per model per series. The estimate should come
from those, and say which series it came from.

Add `packages/ui/src/estimate.ts` and a route, `GET /api/estimate?a=<seat>&b=<seat>&pairs=<n>&concurrency=<n>`.

**One walk, and the figures are the stats package's.** `seriesEntries(roots, inFlight)` and
`reportsOf(walk)` — the same walk the results and leaderboard routes do — and the numbers come out of
each report's `models[]` row for that seat: `matches`, `metrics.turnCount`, `metrics.tokens.total`,
`metrics.costUsd`, `metrics.wallMs`. No new arithmetic in the stats package, and none in the browser.
The walk reads every match log under the root, which is seconds rather than milliseconds; the page is
told in the task that follows it not to ask on every keystroke.

**A seat is measured by the series that played it.** For each seat's label, the reports that count are
the ones under the root carrying a model row with that label. The answer names them by the name
the results listing gives a series — the series directory's name, `deepseek-flash-vs-greedy` — and
never by a path, because the page may not print one.

**Time is time in the seats, not elapsed time.** `wallMs` is summed per seat, and a match's two seats
play in turn, so a match's time is the two seats' figures added and running pairs at a time does not
divide it. The route names which of the two it is answering in the field name itself, and the page's
sentence uses that word.

**The answer shape**, one entry per seat:

```json
{
  "pairs": 5,
  "matches": 10,
  "concurrency": 1,
  "seats": [
    {
      "label": "deepseek/deepseek-flash",
      "measured": {
        "series": ["deepseek-flash-vs-greedy"],
        "matches": 10,
        "perMatch": { "turns": 25, "tokens": 14755955, "costUsd": 0.3154, "seatMs": 935106 }
      },
      "run": { "turns": 250, "tokens": 147559550, "costUsd": 3.154, "seatMs": 9351065 }
    },
    {
      "label": "nowhere/ghost",
      "measured": null,
      "fallback": {
        "perMatch": { "tokens": 4590000, "seatMs": 1140000 },
        "line": "the only model match measured on this repo's record, the first Marvin match"
      }
    }
  ]
}
```

`matches` is `pairs × 2`, because a pair is played twice with the seats swapped — the one piece of
arithmetic that has always been the page's to state.

**The fallback is quoted, not computed, and it is cited.** When no match under the root played
that seat, the route says so and gives the documented figure — about 19 minutes and 4.59M tokens for
one model match — with what it was measured on named in words, since a browser has no use for a path
into the repo. That figure is duplicated today in `packages/ui/web/src/start.ts` as a hard-coded
sentence; the task that follows this one takes the page off it, and this route becomes the only place
the figure lives. A run whose seats are both bots is answered from the bots' own measured rows — the
greedy bot's figures are real, 0 tokens and a few milliseconds a turn — and quoting them is more
honest than quoting a model's.

A seat the query does not parse as a seat is a 400; a root that cannot be walked is the same line the
results routes give.

## Acceptance

- Over the repo's own `series/`, `GET /api/estimate?a=deepseek/deepseek-flash&b=bot:greedy&pairs=5&concurrency=1`
  names `deepseek-flash-vs-greedy`, says how many matches it counted, and gives turns, tokens, cost and
  seat time per match and for the run's 10 matches.
- A seat no series under the root has played is answered as unmeasured, quoting the documented
  figure and saying in words what it was measured on.
- The figures come from `seriesReport`'s model rows through one walk, no answer carries a path, and
  the route is the only place the documented figure is spelled out.

## Verification

```bash
pnpm test -- packages/ui/src/estimate
tmp=$(mktemp -d); echo '{}' > "$tmp/providers.json"
node packages/ui/src/server.ts --port 8816 --providers "$tmp/providers.json" > "$tmp/console.log" 2>&1 &
srv=$!; sleep 2
curl -fsS -H 'origin: http://127.0.0.1:8816' \
  "http://127.0.0.1:8816/api/estimate?a=deepseek/deepseek-flash&b=bot:greedy&pairs=5&concurrency=1" \
  > "$tmp/estimate.json"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (r.matches !== 10) throw new Error(JSON.stringify(r));
if (JSON.stringify(r).includes("/home/") || JSON.stringify(r).includes("series/")) {
  throw new Error("the answer carries a path");
}
const a = r.seats.find((s) => s.label === "deepseek/deepseek-flash");
if (!a || !a.measured) throw new Error(JSON.stringify(a));
if (!a.measured.series.includes("deepseek-flash-vs-greedy")) throw new Error(JSON.stringify(a.measured));
if (a.measured.matches !== 10) throw new Error(JSON.stringify(a.measured));
if (a.measured.perMatch.turns !== 25 || !(a.measured.perMatch.tokens > 1e7)) {
  throw new Error(JSON.stringify(a.measured.perMatch));
}
if (a.run.turns !== 250 || !(a.run.costUsd > 0) || !(a.run.seatMs > 1e6)) {
  throw new Error(JSON.stringify(a.run));
}
' "$tmp/estimate.json"
curl -fsS -H 'origin: http://127.0.0.1:8816' \
  "http://127.0.0.1:8816/api/estimate?a=nowhere/ghost&b=bot:greedy&pairs=5&concurrency=1" \
  > "$tmp/fallback.json"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const a = r.seats.find((s) => s.label === "nowhere/ghost");
if (!a || a.measured !== null) throw new Error(JSON.stringify(a));
if (!(a.fallback.perMatch.tokens > 1e6) || a.fallback.line.length < 20) {
  throw new Error(JSON.stringify(a.fallback));
}
' "$tmp/fallback.json"
kill "$srv"
```
