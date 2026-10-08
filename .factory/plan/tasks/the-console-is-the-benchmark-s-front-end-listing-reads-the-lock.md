---
id: the-console-is-the-benchmark-s-front-end-listing-reads-the-lock
title: The console's listing knows a series another process is playing
milestone: 10-a-series-that-is-playing-reads-as-playing
depends_on: [the-console-is-the-benchmark-s-front-end-series-lock]
---

`seriesEntries` in `packages/ui/src/results.ts` decides `resumable` from one fact only: whether
*this* console has a run in that directory (`runs.inFlightSeries()`). A series being played by
`no-dice series` in a terminal is therefore listed as finished and resumable, and
`POST /api/run/resume` starts a second run over the matches the first is playing. The lock from
the previous task is the missing fact; read it.

For every series under the root, read `<dir>/series.lock` through
`@no-dice/runner/series-lock` and put three things on the row:

- `playing`: `{ pid, startedAt }` when the lock names a live process, `null` otherwise;
- `stale`: the same shape when the lock names a process that is gone, `null` otherwise;
- `progress`: the record's own counters — pairs played, matches played and failed, tokens and
  cost so far — read with `readRunCounters` from `./progress.ts`, which already reads exactly
  those out of `series.json`. Non-null **only** for a playing series: a finished row already
  carries the report's `pairs`, `counted` and `missing`, and a row holding a second account of how
  far a finished series got is how the two drift apart.

`resumable` is false when the lock is live, and still true for a stale one. Keep the run
slot's `inFlight` in the decision as well: it covers the moment after a console run has been
started and before its lock exists, and it is the console's own word about its own run.

`resumeRecordOf(dir)` — what `POST /api/run/resume` reads before it starts anything — refuses a
series whose lock is live, in one line naming the pid that holds it. The runner refuses the same
run now too, but a console that started it would show its operator a run whose only output is an
error line.

Then give the page something it can ask often. `GET /api/series` reads every match log of every
series (`seriesReport`), which is why nothing polls it; a page that wants a pair count moving
needs a route that reads only `series.lock` and `series.json`. Add `GET /api/playing`: one entry
per series under the root that has a `series.lock`, each with `name`, `dir`, `pid`, `startedAt`,
`stale` and `progress`. A series whose match logs this console cannot read still answers there —
that is the difference between the two routes, and it is worth a test.

`seriesEntries` grows its lock reading in its signature; `packages/ui/src/leaderboard.ts` and the
test that calls `results.seriesEntries(at, null)` directly both go through it, so update them in
step rather than leaving a second walk behind.

## Acceptance
- [ ] While a bot-versus-bot series plays in another process, `GET /api/series` lists it with
      `playing` naming that pid, `progress` equal to what its `series.json` says at that moment,
      and `resumable: false`; once that process has ended the row is `playing: null` and resumable
- [ ] A lock left by a process that is gone is listed as `stale`, is not listed as playing, and
      leaves the series resumable
- [ ] `POST /api/run/resume` for a series whose lock is live is refused with one line naming the
      run, and `GET /api/playing` answers that series' counters from `series.json` and
      `series.lock` alone — including for a series whose match logs `GET /api/series` cannot report

## Verification
```bash
pnpm test -- packages/ui/src/results packages/ui/src/runs packages/ui/src/leaderboard
rm -rf /tmp/nd-lock-ui && mkdir -p /tmp/nd-lock-ui/series
node packages/ui/src/server.ts --port 8801 --series-root /tmp/nd-lock-ui/series >/tmp/nd-lock-ui/console.log 2>&1 &
srv=$!; sleep 1
node packages/runner/src/cli.ts series --game salient --a bot:greedy --b bot:greedy \
  --max-pairs 25 --dir /tmp/nd-lock-ui/series/term >/tmp/nd-lock-ui/run.log 2>&1 &
run=$!
seen=0
for i in $(seq 1 120); do
  curl -fsS http://127.0.0.1:8801/api/series > /tmp/nd-lock-ui/listing.json
  if node -e '
    const row = JSON.parse(require("fs").readFileSync("/tmp/nd-lock-ui/listing.json", "utf8")).series[0];
    const ok = row.playing && row.playing.pid > 0 && row.stale === null && row.resumable === false &&
      row.progress && row.progress.pairsPlayed > 0 && row.progress.pairsPlayed < row.maxPairs;
    process.exit(ok ? 0 : 1);
  '; then seen=1; break; fi
  sleep 0.2
done
test "$seen" -eq 1
curl -fsS http://127.0.0.1:8801/api/playing | grep -q '"pid"'
code=$(curl -s -o /tmp/nd-lock-ui/resume.log -w '%{http_code}' -X POST \
  -H 'content-type: application/json' -d '{"dir":"/tmp/nd-lock-ui/series/term"}' \
  http://127.0.0.1:8801/api/run/resume)
case "$code" in 4??) ;; *) echo "resume answered $code"; exit 1;; esac
wait $run
test ! -e /tmp/nd-lock-ui/series/term/series.lock
curl -fsS http://127.0.0.1:8801/api/series | grep -q '"playing":null'
curl -fsS http://127.0.0.1:8801/api/series | grep -q '"resumable":true'
# A lock whose process is gone is stale, and still resumable.
printf '{"pid":999999,"started_at":"2026-01-01T00:00:00.000Z"}' > /tmp/nd-lock-ui/series/term/series.lock
curl -fsS http://127.0.0.1:8801/api/series | grep -q '"stale":{"pid":999999'
curl -fsS http://127.0.0.1:8801/api/series | grep -q '"resumable":true'
kill $srv
```
