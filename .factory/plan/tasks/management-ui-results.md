---
id: management-ui-results
title: Every finished series and match is listed, openable in the viewer, and resumable
milestone: 07-ui-run-console
depends_on: [management-ui-run-manager]
---

What is on disk, listed and reachable. `packages/ui/src/results.ts`:

- `GET /api/series` — every directory under the server's `--series-root` that holds a
  `series.json`, with its pairing, its stop reason and whether it stopped early, and its win rate
  with the 95% interval, counted and missing matches. Those figures come from `seriesReport(dir)`
  in `@no-dice/stats/series-report` — the same call `renderSeriesReport` makes when the CLI writes
  `report.md` — so the page and `no-dice stats` cannot disagree, and no arithmetic is written here.
  It reads every log of every series, which is fine for a local tool with a handful of series and
  is worth a comment where it happens. A series started with `--dir` outside the root is not
  listed, and the page says so.
- `GET /api/matches` — every finished match log under `<seriesRoot>/*/matches/` and under
  `--matches-root`, each with the URL that serves it.
- `GET /logs/<path>` — the log JSON, served from those two roots only, with the same
  refuses-to-escape check the static app serving already has.

The viewer is reached through this one server. Serve the built `games/salient/viewer/dist` at
`/viewer/` (redirect `/viewer` to `/viewer/`, and say what to build when the directory is not
there), and give the viewer a `vite.config.ts` with `base: "./"` so its built asset URLs resolve
under a sub-path instead of at the site root — that is a build setting outside `src`, so the
viewer stays log-only and its `module-graph.test.ts` and golden-frame test must keep passing
untouched. A match's link is then `/viewer/?log=/logs/<series>/matches/<file>.json`, which is the
`?log=` path `games/salient/viewer/src/load.ts` already fetches.

**Resume.** A series whose run is not in flight is offered as *resume*, from
`POST /api/run/resume` with the series directory in the body. It posts that record's own
pairing, `--dir <the series directory>` and `--max-pairs <record.max_pairs>` — the same
directory, so `planSeries` reads back the recorded seed list instead of drawing a new one and
skips every match whose log is already on disk. The record's ceilings are shown from its `stop`
fields so the operator can restate them; a resumed run that gives no ceiling has no ceiling, which
is a fact the page should state rather than hide.

## Acceptance
- [ ] A bot-versus-bot match started from the page appears in `GET /api/matches` and opens in the
      viewer at `/viewer/?log=/logs/…`, and the viewer's `module-graph.test.ts` and golden-frame
      test still pass with the `base: "./"` config
- [ ] `GET /api/series` lists every series under the root with the figures
      `no-dice stats --series <dir>` prints for it, and lists nothing whose directory is outside
      the root
- [ ] A series left half played by the server being closed is listed as resumable, and resuming it
      plays nothing whose log is already on disk

## Verification
```bash
pnpm test -- results
rm -rf /tmp/nd-ui-res && mkdir -p /tmp/nd-ui-res
node packages/ui/src/server.ts --port 8798 --series-root /tmp/nd-ui-res/series &
pid=$!; sleep 1
curl -fsS -X POST -H 'content-type: application/json' -d \
  '{"game":"salient","a":"bot:greedy","b":"bot:random","maxPairs":3,"name":"res"}' \
  http://127.0.0.1:8798/api/run/series
sleep 3
kill $pid; wait $pid 2>/dev/null
played=$(ls /tmp/nd-ui-res/series/res/matches/*.json 2>/dev/null | wc -l)
test "$played" -lt 6
node packages/ui/src/server.ts --port 8799 --series-root /tmp/nd-ui-res/series &
pid=$!; sleep 1
curl -fsS http://127.0.0.1:8799/api/series | grep -q '"resumable":true'
curl -fsS -X POST -H 'content-type: application/json' -d '{"dir":"/tmp/nd-ui-res/series/res"}' \
  http://127.0.0.1:8799/api/run/resume
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8799/api/run | grep -q '"state":"done"' && break; sleep 1; done
test "$(ls /tmp/nd-ui-res/series/res/matches/*.json | wc -l)" -eq 6
curl -fsS http://127.0.0.1:8799/api/matches | grep -q '/logs/'
curl -fsS 'http://127.0.0.1:8799/viewer/' | grep -qi 'salient replay viewer'
kill $pid
```
