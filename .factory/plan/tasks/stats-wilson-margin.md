---
id: stats-wilson-margin
title: The stats package turns results into a win rate and a margin
milestone: 04-series-runner-and-stats
depends_on: [log-package]
---

Create `packages/stats` as `@no-dice/stats` — `package.json` with `@no-dice/log` as its only
dependency, `tsconfig.json` copied from `packages/runner/tsconfig.json`, exports for
`./wilson` and `./margin` — and put the two numbers the whole milestone turns on in it. The
series runner will call these for its stopping test at 99% and the report will call them again
at 95%, so they are written once, here, and not reimplemented in the runner.

`packages/stats/src/wilson.ts`: a win rate over a list of match outcomes where **a draw counts
as half a win** (brief §6.5), returning wins, losses, draws, `n` and the rate, and
`wilsonInterval({ successes, n, z })` returning the interval for a possibly fractional
`successes` count. Take `z` from the confidence rather than hard-coding it: 95% is 1.96 and
the stopping test needs 99% (2.5758), and brief §6.5 is explicit that the two are different
on purpose because checking after every batch makes a false early stop likelier.

`packages/stats/src/margin.ts`: the margin of one match, with **a knockout counted as 93**
(brief §6.7; the engine already scores a knockout as every point on the board —
`pointsOnBoard` in `games/salient/engine/src/resolve.ts` — so a logged knockout's `margin` is
93 on a full map, and a draw where both Bases fell is 0; read the log's own `result`, do not
recompute it). Then `bootstrapMargin(margins, { samples, seed })` giving the mean and a
percentile interval, with a seeded generator so the same margins always give the same
interval — follow the `mulberry32` convention in `games/salient/engine/src/rng.ts` rather
than importing the engine, and do not use `Math.random()`: a published report has to
reproduce its own numbers.

## Acceptance
- [ ] The 99% Wilson interval for 18 wins in 20 matches excludes 0.5 and the one for 10 wins
      in 20 includes it; at 95% the same function gives the narrower report interval
- [ ] A draw counts half a win: 10 wins, 4 draws and 6 losses over 20 matches gives 0.6
- [ ] A knockout's margin is 93 whatever the logged score says, and the bootstrap interval is
      identical across runs for a fixed seed and different for a different seed

## Verification
```bash
pnpm test -- wilson
pnpm test -- margin
```
