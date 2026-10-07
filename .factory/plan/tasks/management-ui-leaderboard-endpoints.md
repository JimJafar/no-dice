---
id: management-ui-leaderboard-endpoints
title: The console answers a leaderboard for the series under its root
milestone: 08-ui-providers-and-leaderboard
depends_on: [management-ui-leaderboard-rows, management-ui-provider-endpoints]
---

`GET /api/leaderboard`, answered by a new `packages/ui/src/leaderboard.ts`:
`{ seriesRoot, series, models, unreadable }` — the per-pairing rows and the pooled per-model rows
from `pooledModelRows` in `@no-dice/stats/leaderboard`, over the same records
`GET /api/series` lists. **No arithmetic in this file at all**: it moves the stats package's
numbers into JSON, because the epic's acceptance is that both tables agree with
`no-dice stats` to the digit and a second account of a win rate is how two tables drift apart.

**One read, not two.** `seriesReport` reads `series.json` and every log it names — about a
megabyte each for a real match (`docs/pi-harness-notes.md` §7) — so the leaderboard must not
walk the series root a second time. Factor the walk out of `results.ts` as
`seriesEntries(roots, inFlight)`, returning each series' report (or the one line its record
failed on) beside its name and directory; `seriesRows` maps that to its rows as it does today,
and `leaderboardRows` calls it once and hands the reports to `pooledModelRows`. A cache keyed on
each `series.json`'s mtime remains the way to grow this, as the header of `results.ts` already
says; it is not needed here and is not added.

**What is in scope, and what says it is not.** Only directories under the console's
`--series-root`. A series started with `--dir` somewhere else is real work this page will never
show, and the answer carries the root so the page can say so in as many words — the same rule
and the same wording `results.ts` already applies. A directory under the root whose record cannot
be read is listed in `unreadable` with the line it failed on, and contributes nothing to the
pooled rows, which is said rather than left to a reader who cannot tell a missing series from a
model that never played it.

Two small things the rows need: `SeriesRow` gains `reportUrl`, the `/logs/<name>/report.md` URL
the existing `/logs/` route already reaches, and `static.ts`'s content-type map gains
`.md` as `text/plain; charset=utf-8`, so that link opens as the report it is instead of
downloading as `application/octet-stream`. The route is a read, so it takes `GET`/`HEAD`
only and needs no `Origin` check.

It comes after the provider routes for a plain reason: both add routes to `server.ts` and
rewrite that file's header paragraph, and one of them has to be the one that finds the other
already there.

## Acceptance
- [ ] `GET /api/leaderboard` answers one row per series under the root with the figures
      `no-dice stats --series <dir>` prints for it, and one row per model pooled over every one
      of those series, with win rate, 95% interval, matches counted and missing, and the seat split
- [ ] A series whose directory is outside the root appears in neither view, and a series under
      the root whose record cannot be read is listed with the line it failed on and adds nothing
      to the pooled rows
- [ ] The leaderboard reads each series once, `GET /logs/<series>/report.md` is served as text,
      and the pooled row for a model over one series equals that series' own report figures

## Verification
```bash
pnpm test -- leaderboard results
rm -rf /tmp/nd-lb-api && mkdir -p /tmp/nd-lb-api/series
node packages/ui/src/server.ts --port 8795 --series-root /tmp/nd-lb-api/series &
pid=$!
sleep 1
curl -fsS -X POST -H 'content-type: application/json' -d \
  '{"game":"salient","a":"bot:greedy","b":"bot:random","maxPairs":2,"name":"g-vs-r"}' \
  http://127.0.0.1:8795/api/run/series > /dev/null
for i in $(seq 1 120); do curl -fsS http://127.0.0.1:8795/api/run | grep -q '"state":"done"' && break; sleep 1; done
curl -fsS http://127.0.0.1:8795/api/run | grep -q '"state":"done"'
node packages/runner/src/cli.ts series --game salient --a bot:random --b bot:greedy --max-pairs 1 \
  --dir /tmp/nd-lb-api/outside/sneaky > /dev/null
lb=$(curl -fsS http://127.0.0.1:8795/api/leaderboard)
echo "$lb" | grep -q '"g-vs-r"'
echo "$lb" | grep -q 'bot:greedy'
! echo "$lb" | grep -q 'sneaky'
node packages/runner/src/cli.ts stats --series /tmp/nd-lb-api/series/g-vs-r > /tmp/nd-lb-api/stats.txt
rate=$(node -e 'const lb=JSON.parse(process.argv[1]); const row=lb.models.find((m)=>m.label==="bot:greedy"); console.log((row.result.winRate.rate*100).toFixed(1)+"%")' "$lb")
grep -qF "$rate" /tmp/nd-lb-api/stats.txt
node --input-type=module -e '
const { seriesReport } = await import("./packages/stats/src/series-report.ts");
const dir = "/tmp/nd-lb-api/series/g-vs-r";
const report = await seriesReport(dir);
const lb = JSON.parse(process.argv[1]);
if (lb.seriesRoot !== dir.slice(0, dir.lastIndexOf("/"))) throw new Error("the answer does not name the root it read");
const pair = lb.series.find((row) => row.dir === dir);
if (!pair) throw new Error("the series is not in the leaderboard");
if (pair.winRate !== report.result.winRate.rate || pair.counted !== report.counted || pair.missing !== report.missing.total) {
  throw new Error("the pairing row is not the report figure");
}
if (!pair.reportUrl || !pair.reportUrl.endsWith("/report.md")) throw new Error("the row has no link to its report");
const model = report.models.find((row) => row.label === "bot:greedy");
const pooled = lb.models.find((row) => row.label === "bot:greedy");
if (!model || !pooled) throw new Error("bot:greedy has no row");
if (pooled.matches !== model.matches || pooled.result.winRate.rate !== model.result.winRate.rate) {
  throw new Error("the pooled row is not the report figure");
}
if (pooled.seatSplit.A.winRate.n + pooled.seatSplit.B.winRate.n !== pooled.matches) throw new Error("the seat split does not add up");
if (lb.unreadable.length !== 0) throw new Error("a readable series was listed as unreadable");
' "$lb"
curl -fsS http://127.0.0.1:8795/logs/g-vs-r/report.md | grep -qi 'Series report'
curl -fsSI http://127.0.0.1:8795/logs/g-vs-r/report.md | grep -qi 'content-type: text/plain'
kill $pid
```
