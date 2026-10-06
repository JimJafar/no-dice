---
id: management-ui-progress
title: The page shows a run's own output and its counters while it plays
milestone: 07-ui-run-console
depends_on: [management-ui-run-manager]
---

Make the in-flight run watchable. `GET /api/run` grows from the run's captured lines to a
snapshot the page polls about once a second while `state` is `running` — polling, not SSE or
a socket, since this is one operator on loopback and the runner's own granularity is a pair.

The lines are already the interesting part: `runCli`'s per-pair line is the seed, both seat orders,
both matches' results and the running win rate with its 95% interval, and its last lines are
the stop reason, the final figures and the paths of `series.json` and `report.md`. Show them
verbatim.

The counters come from the series' own record, not from reading those lines. `runSeries` writes
`<dir>/series.json` atomically before anything is played and again at every batch of 5 pairs
(`writeSeriesRecord` in `packages/runner/src/series-plan.ts`), so the snapshot reads that file for
the run in flight and reports `state.pairs_played`, `state.matches_played`, `state.matches_failed`,
`max_pairs`, the summed `cost_usd` and `tokens` of every played match entry, and `stop.reason` with
`stop.stopped_early` once the rules have decided. Pairs remaining is `max_pairs - pairs_played`.
Say on the page that the counters move at batch boundaries while the lines move per pair — that is
what the runner writes, and a progress bar that pretended to finer granularity would be a lie.
A single match has no record: its progress is its lines, and its end is the log path and the
result line.

When the run ends, the snapshot carries the stop reason, whether it stopped short of its pair
limit, the totals and the exit code, and the page keeps the last lines on screen rather than
clearing them.

## Acceptance
- [ ] While a bot-versus-bot series is in flight, `GET /api/run` returns its pair lines as they
      happen and counters equal to what that series' `series.json` says at the same moment
- [ ] When it ends the snapshot names the stop reason, whether it stopped early, the pairs,
      matches played and failed, and the token and cost totals, and the page keeps the
      CLI's final lines visible
- [ ] A client that disconnects mid-run does not stop it: the run reaches `done` and its logs are
      on disk

## Verification
```bash
pnpm test -- progress
rm -rf /tmp/nd-ui-prog && mkdir -p /tmp/nd-ui-prog
node packages/ui/src/server.ts --port 8797 --series-root /tmp/nd-ui-prog/series &
pid=$!; sleep 1
curl -fsS -X POST -H 'content-type: application/json' -d \
  '{"game":"salient","a":"bot:greedy","b":"bot:random","maxPairs":2,"name":"prog"}' \
  http://127.0.0.1:8797/api/run/series
seen=0
for i in $(seq 1 60); do
  run=$(curl -fsS http://127.0.0.1:8797/api/run)
  echo "$run" | grep -q 'seed [0-9]' && seen=1
  echo "$run" | grep -q '"state":"done"' && break
  sleep 1
done
test "$seen" -eq 1
echo "$run" | grep -q '"stopReason"'
test "$(ls /tmp/nd-ui-prog/series/prog/matches/*.json | wc -l)" -eq 4
test -f /tmp/nd-ui-prog/series/prog/report.md
kill $pid
```
