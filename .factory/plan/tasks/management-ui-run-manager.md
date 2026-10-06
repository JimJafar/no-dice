---
id: management-ui-run-manager
title: A run plays inside the UI's own process, one at a time
milestone: 07-ui-run-console
depends_on: [management-ui-skeleton]
---

`packages/ui/src/runs.ts`: the run slot the whole console hangs off. At most **one run in flight
per process** — `--concurrency` already bounds *pairs*, and no provider's rate limit has been
measured (`docs/pi-harness-notes.md` §7) — so a second start is refused with one line naming what
is running (`a series of bot:greedy vs bot:random in series/x, started 12:03`), and a queue is out
of scope.

Start it through the existing seams, not by shelling out. The form's payload becomes a `no-dice`
argv (`["series", "--game", "salient", "--a", "bot:greedy", "--b", "bot:random", "--max-pairs",
"2", "--name", "smoke"]`), which is first handed to `parseArgs` from `@no-dice/runner/args`: if it
answers `{ ok: false, error }`, the API answers 400 with that exact line and nothing starts, which
is what makes "the form cannot ask for a run the CLI would reject" true for free — `--max-pairs
75.5`, `--a bot:sad`, a missing `--b`, and `--name` given with `--dir` all come back in the CLI's
own wording. Then the run is played by `runCli(argv, { stdout, stderr, cwd })` from
`@no-dice/runner/cli`, awaited by the manager and not by the request handler, with `stdout` and
`stderr` pushing each line into the run's buffer and `cwd` the repo root, so a relative `--out` or
`--dir` lands where the CLI would put it. There is no child `no-dice` process, and the pair lines
the page shows are the very lines the terminal prints: `runCli` already drives `runSeries`'s
`onPair` callback, so nothing here re-implements `pairLine`.

Keep what the run wrote. `parseArgs` hands back the resolved `dir` for a series and `out` for a
match, so the manager records the directory and log path the results page will point at. Both paths
are the manager's to fix, not the CLI's default: a series is given `--dir <seriesRoot>/<name>` as
an absolute path (the name checked to be one path segment, which is what `args.ts`'s private
`isName` means for `--name`, and `<a>-vs-<b>` built with the exported `seatSlug` when the form left
it blank), and a match with no path of its own is given `--out` built from the exported
`defaultOutName(command)` under the server's `--matches-root`. Otherwise a UI-started run would
land under whatever directory the server was started in, while the results page lists the roots the
server was given. The snapshot `GET /api/run` returns is
`{ state: "idle" | "running" | "done" | "failed", lines, dir, out, startedAt, endedAt, exitCode }`;
the counters come in the next task. Routes: `POST /api/run/match`, `POST /api/run/series`,
`GET /api/run`.

Nothing a test starts here may play a real model match — one is ~19 minutes and 4.59M tokens —
so every test is bot-versus-bot, which takes ~1.3 s per match. A run must also survive the *page*
going away and die with the *server*: the run is a promise in this process, so a closed HTTP
connection changes nothing, and a test that closes the server mid-run leaves the series on disk
half played, which is what the resume half of this milestone starts from.

## Acceptance
- [ ] `POST /api/run/match` for `bot:greedy` vs `bot:random` plays the match inside the UI's own
      process, ends as `done`, and leaves a `salient-log/1` file at the path the snapshot names
- [ ] A second start while one is in flight is refused with a line naming the run in flight, and
      the first run is unaffected
- [ ] `--max-pairs 75.5`, an unknown seat spec and a missing `--b` each come back as `parseArgs`'s
      own message with nothing started, and closing the HTTP client mid-run does not stop it

## Verification
```bash
pnpm test -- runs
rm -rf /tmp/nd-ui-run && mkdir -p /tmp/nd-ui-run
node packages/ui/src/server.ts --port 8796 --matches-root /tmp/nd-ui-run/matches \
  --series-root /tmp/nd-ui-run/series &
pid=$!; sleep 1
body='{"game":"salient","a":"bot:greedy","b":"bot:random","seed":135}'
curl -fsS -X POST -H 'content-type: application/json' -d "$body" http://127.0.0.1:8796/api/run/match
curl -s -X POST -H 'content-type: application/json' -d "$body" http://127.0.0.1:8796/api/run/match | grep -qi 'running'
curl -s -X POST -H 'content-type: application/json' \
  -d '{"game":"salient","a":"bot:greedy","b":"bot:random","maxPairs":"75.5","name":"x"}' \
  http://127.0.0.1:8796/api/run/series | grep -qi 'whole number'
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8796/api/run | grep -q '"state":"done"' && break; sleep 1; done
test "$(ls /tmp/nd-ui-run/matches/*.json | wc -l)" -eq 1
grep -q '"format": "salient-log/1"' /tmp/nd-ui-run/matches/*.json
kill $pid
```
