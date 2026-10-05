---
title: Series runner and stats
---

It starts by moving `salient-log/1` to a package of its own, `@no-dice/log`, so the stats
package and the viewer can read a log without pulling in the runner and the MCP server.

`no-dice series` runs seat-swapped pairs on a fixed, recorded seed list in batches of 5
pairs, stops when the 99% Wilson interval for the win rate excludes 50% (a draw counting
half a win) or at `--max-pairs` (default 75) or at a cost or token ceiling, runs pairs
concurrently when asked, skips matches that already have a log, and writes `series.json`. The
stats package reports wins/losses/draws with a 95% Wilson interval, mean margin with a
bootstrap interval (knockouts counted as 93), knockouts and their turns, per-model passes by
reason, wasted orders, rejected submissions, tool errors, scouts and simulations per turn,
tokens and cost, the same error counts split into turns 1-8 / 9-17 / 18-25 with context size
and compaction turns, and the seat split. Done when the scripted adaptive-stop and resume
tests in brief §8 pass.
