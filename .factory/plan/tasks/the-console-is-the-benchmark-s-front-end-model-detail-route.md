---
id: the-console-is-the-benchmark-s-front-end-model-detail-route
title: A route answers everything one model's detail needs
milestone: 12-matches-and-leaderboard-detail
depends_on: [the-console-is-the-benchmark-s-front-end-kept-report-routes]
---

Add a new module, `packages/ui/src/model-detail.ts`, and a new route,
`GET /api/model-detail?label=<label>`, where the label is a model as the log headers
spell it (`marvin/subagent`, `bot:greedy`). It answers, for one model, everything the
detail the leaderboard opens shows, so that the page draws figures rather than works
them out.

The headline figures come from `pooledModelRows` over one `seriesEntries` walk — the
same walk `packages/ui/src/leaderboard.ts` already pays for, via `reportsOf` — so the
per-series blocks need no second report read either: each series' own `ModelRow`
for that label is already in those reports. Each block carries that series' name, its
`result` with its own 95% interval, its `seatSplit`, and its `metrics`: `turnCount`,
`wallMs` with the per-match figure divided out *here* (`perTurn.wallMs` is already a
mean, per-match is not), `tokens` (input, output, cache read, cache write, total),
`costUsd` with `perTurn.costUsd` and `perTurn.tokens`, `passedTurns` and `passes` by
reason — which is where a timeout is counted — and `context.compactionTurns.length`.
Beside them go the rules' counters from `seriesEvidence(dir)`: lead changes, hex flips
per turn, Node hand changes, neutral captures and re-scouts, taken from that answer's
`totals` and `means`, and said as the series' figures, since they count both
seats. Each block links its own matches to their replays — from the log paths the report
already read, turned into addresses by `logUrlOf` and `viewerUrlOf` in
`packages/ui/src/results.ts`, which costs no second read of any log — and to its
reports: the runner's copy at `/logs/<series>/report.md`, and the kept copies at
`/reports/<name>.md` and `/reports/<name>-evidence.md`, each with whether that kept copy
is actually on disk, so the page never offers a link to a report that was never written.

The shape, so the page and the route agree on one naming: the answer is `label` and
the pooled row as `pooledModelRows` answers it (`matches`, `seats`, `result` with its
`winRate` counts and interval, `seatSplit`, `missing`, `missingNote`), plus `series: []`
of blocks, each `{ name, dir, result, seatSplit, figures, rules, matches, links }` where
`figures` is `{ turnCount, wallMs, wallMsPerMatch, perTurn, tokens, costUsd, passedTurns,
passes, compactions }` and `rules` is the five counters or `{ error: "<line>" }`.

**This is a click, not a page load.** `seriesEvidence` reads every log of a series
again, about a megabyte each (`docs/pi-harness-notes.md` §7), so one opening costs
one walk of the series root plus one evidence read per series that model played in.
Nothing on this route is answered anywhere else, and no figure is left for the browser
to compute. A series whose record or evidence this console cannot read is a block
carrying the line it failed on, not a block that has gone missing — the same rule the
leaderboard's `unreadable` rows follow. A label no report on this disk names is refused
with one line.

## Acceptance

- `GET /api/model-detail?label=<label>` answers the pooled headline figures (matches,
  won, lost, drawn, win rate and interval, seat counts, missing matches and their note)
  and one block per series that counted a match for that label, each with that series'
  interval, seat split, turns, time per match and per turn, tokens and cost, timeouts,
  passes, compactions and the five rules counters.
- Each block names its replay links and its report links, and says whether each kept copy
  under the reports root exists.
- A series whose report or evidence cannot be read is a block carrying that line; a label
  no report names is one refusal line; the four gates pass.

## Verification
```bash
grep -q '/api/model-detail' packages/ui/src/server.ts
pnpm test -- model-detail
tmp=$(mktemp -d); mkdir -p "$tmp/matches"
node packages/ui/src/server.ts --port 8818 --matches-root "$tmp/matches" > "$tmp/console.log" 2>&1 &
srv=$!; sleep 1
curl -fsS -H 'origin: http://127.0.0.1:8818' \
  'http://127.0.0.1:8818/api/model-detail?label=bot%3Agreedy' > "$tmp/detail.json"
curl -sS -H 'origin: http://127.0.0.1:8818' \
  'http://127.0.0.1:8818/api/model-detail?label=nobody%2Fnever-played' > "$tmp/none.txt"
kill "$srv"
node -e '
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const rate = d.result && d.result.winRate;
if (!rate || !("wins" in rate) || !("losses" in rate) || !("draws" in rate)) throw new Error("no won/lost/drawn: " + JSON.stringify(d).slice(0, 300));
if (typeof d.matches !== "number" || !d.seats || typeof d.missingNote !== "string") throw new Error("no pooled row");
if (!Array.isArray(d.series) || d.series.length < 2) throw new Error("expected bot:greedy in two series, got " + JSON.stringify(d.series));
for (const b of d.series) {
  if (!b.name || !b.result || !b.result.interval || !b.seatSplit) throw new Error("a block with no interval or seat split: " + JSON.stringify(b).slice(0, 300));
  const f = b.figures || {};
  for (const k of ["turnCount", "wallMs", "wallMsPerMatch", "tokens", "costUsd", "passedTurns", "passes", "compactions"]) {
    if (f[k] === undefined) throw new Error("a block with no " + k + " in " + b.name);
  }
  if (Math.abs(f.wallMsPerMatch * b.matches.length - f.wallMs) > 1) throw new Error("per-match time is not the series time over its matches in " + b.name);
  if (!f.passes || !("timeout" in f.passes)) throw new Error("a block with no timeout count in " + b.name);
  const r = b.rules || {};
  for (const k of ["leadChanges", "flipsPerTurn", "nodeHandChanges", "neutralCaptures", "reScouts"]) {
    if (r[k] === undefined) throw new Error("a block with no " + k + " in " + b.name);
  }
  if (!Array.isArray(b.matches) || b.matches.length === 0 || !b.matches.every((m) => m.url && m.viewerUrl)) throw new Error("a block with no replay links in " + b.name);
  if (!b.links || !b.links.reportUrl || !b.links.keptReportUrl || !b.links.keptEvidenceUrl || b.links.keptReport !== true) throw new Error("a block with no kept report link: " + JSON.stringify(b.links));
}
' "$tmp/detail.json"
grep -qi 'never played\|no model\|not a model' "$tmp/none.txt"
pnpm typecheck
```
