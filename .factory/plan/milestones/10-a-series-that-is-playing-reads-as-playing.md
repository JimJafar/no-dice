---
title: A series another process is playing reads as playing
epic: the-console-is-the-benchmark-s-front-end
---

A series being played by `no-dice series` at a terminal is listed today as
"0 of 5 pairs … stopped on max_pairs — its full length" with a Resume button, and resuming it
plays the matches that are already on disk a second time while the first run is still playing
them. The runner has to say that a series is in flight, and the console has to believe it.

`runSeries` in `packages/runner/src/series.ts` takes a lock beside the record it already owns —
`<dir>/series.lock` holding the pid, written before the first match and removed when the run
ends — and the listing in `packages/ui/src/results.ts` reads that lock instead of only the
console's own run slot: a series whose lock names a live process is *running*, with the progress
its `series.json` already carries (pairs played, matches played and failed, tokens and
cost so far), and no Resume is offered for it. A lock left by a process that is gone is stale,
and says so rather than showing a series that finished days ago as still playing.

Done when a bot-versus-bot series started at the terminal shows in the console as running with
its pair count moving, offers no Resume while it does, and offers one again once the terminal's
process has ended; when a stale lock is reported as stale; and when the runner's own series tests
still pass with the lock written and removed around every run.
