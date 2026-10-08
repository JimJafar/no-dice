---
id: the-console-is-the-benchmark-s-front-end-series-lock
title: A series in flight holds a lock on its own directory
milestone: 10-a-series-that-is-playing-reads-as-playing
depends_on: []
---

`runSeries` (`packages/runner/src/series.ts`) already owns one file in the series directory —
`series.json`, written by `planSeries` and rewritten at every batch of 5 pairs — and nothing
outside that process knows a run is in there. A second `no-dice series --dir <same dir>`, or
the console's Resume, starts a second run over the same matches while the first is still playing
them. Give the run a lock.

Put the lock in a new `packages/runner/src/series-lock.ts`, exported from the runner as
`./series-lock` in `packages/runner/package.json` — the console reads it through that subpath, the
same way `packages/ui/src/progress.ts` already imports `@no-dice/runner/series-plan`. The file is
`<dir>/series.lock`, one line of JSON: `{"pid": <number>, "started_at": "<ISO timestamp>"}`. The
pid is what decides live or stale; `started_at` is there so a human reading a lock left by a
killed run can tell which run left it.

- **Take it with an exclusive create** (`open(path, "wx")`) so two runs cannot both claim it.
  Take it in `runSeries` after `planSeries` has returned — the directory exists by then, and
  `planSeries` has already written the seed fields, which a refused run must leave as it found
  them — and before the first match and before the first record write.
- **A lock naming a live process means the run is refused**, before anything is played, with one
  line naming the pid that holds it. Probe with `process.kill(pid, 0)`: `ESRCH` is gone,
  `EPERM` is alive but not this user's, and anything else is alive. A throw here is `runCli`'s
  error line and exit code 1, which is how the terminal learns it.
- **A lock whose process is gone is stale**: unlink it, retry the exclusive create once, and
  take the run. Two runs racing to steal one stale lock cannot both win — the loser's `wx` fails,
  it re-reads a live lock, and it is refused. Say in the module header what this cannot rule out:
  pid reuse on a long-lived machine, which is why the lock is one small file the operator can read
  rather than a fact nobody can check.
- **Release it in a `finally`**, so a run that throws — an unreadable log, a stop, anything —
  leaves no lock behind, and so a run refused on a bad `--concurrency` or `--max-cost` (checked
  before `planSeries` today) leaves none either.

Add `/series/*/series.lock` to `.gitignore`, after the `!/series/deepseek-flash-vs-greedy/`
negations, so a lock left in a kept baseline series by a killed run is never committed.

## Acceptance
- [ ] While a `runSeries` plays, `<dir>/series.lock` names its pid; when the run ends, throws, or
      is refused on a bad flag, no lock is left
- [ ] A second `runSeries` into the same directory while the lock names a live process is refused
      without playing a match or rewriting the record; a lock naming a process that is gone is
      taken over and the run plays
- [ ] `@no-dice/runner/series-lock` is exported, the runner's own series tests still pass, and a
      lock under a kept series directory is git-ignored

## Verification
```bash
pnpm test -- packages/runner/src/series
rm -rf /tmp/nd-lock && mkdir -p /tmp/nd-lock
node packages/runner/src/cli.ts series --game salient --a bot:greedy --b bot:greedy \
  --max-pairs 25 --dir /tmp/nd-lock/s1 >/tmp/nd-lock/one.log 2>&1 &
run=$!
for i in $(seq 1 60); do [ -e /tmp/nd-lock/s1/series.lock ] && break; sleep 0.1; done
test -e /tmp/nd-lock/s1/series.lock
grep -q "$run" /tmp/nd-lock/s1/series.lock
# A second run into the same directory while the first plays is refused.
node packages/runner/src/cli.ts series --game salient --a bot:greedy --b bot:greedy \
  --max-pairs 25 --dir /tmp/nd-lock/s1 >/tmp/nd-lock/two.log 2>&1
test "$?" -ne 0
grep -qi 'series.lock\|another run\|already running' /tmp/nd-lock/two.log
wait $run
test ! -e /tmp/nd-lock/s1/series.lock
# A lock left by a process that is gone is taken over.
printf '{"pid":999999,"started_at":"2026-01-01T00:00:00.000Z"}' > /tmp/nd-lock/s1/series.lock
node packages/runner/src/cli.ts series --game salient --a bot:greedy --b bot:greedy \
  --max-pairs 25 --dir /tmp/nd-lock/s1 >/tmp/nd-lock/three.log 2>&1
test "$?" -eq 0
test ! -e /tmp/nd-lock/s1/series.lock
grep -q '/series/\*/series.lock' .gitignore
```
