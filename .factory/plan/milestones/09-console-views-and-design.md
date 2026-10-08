---
title: The console is a designed app, not one long page
epic: the-console-is-the-benchmark-s-front-end
---

`packages/ui`'s page stops being five stacked sections read top to bottom and becomes an app with
four views — Matches, Runs, Leaderboard, Providers & models — reached from a nav bar and named in
the URL hash, so a reload or a link sent from another machine lands where the operator was. The
run poller keeps watching whatever view is showing, so a series started from Runs is still
moving when you come back to it.

The page then wears the replay viewer's design rather than the browser's: the same two font
families and the same palette (`#12161c` ink on `#eef1f5`, the `#1a2028`/`#232a33` panels,
`#2c6fd1` and `#e06f35` for the two seats), a viewport meta and a layout that works at 375 px as
well as at 1440 px, since Jim reads it on a laptop and sometimes on a phone through
`tailscale serve`. And it stops talking like a terminal: no `--max-pairs`, no absolute paths and
no `1234-greedy-subagent.json` in a heading, label, row or button.

Done when the four views are each reachable by hash and draw the sections they already own, the
console's stylesheet carries the viewer's fonts and colours with no fixed-width frame, every view
has a test that draws it and fails on a flag name, an absolute path or a log file name, and a
replay opened from the console offers a way back to the view it came from. The API routes and
their tests are unchanged.
