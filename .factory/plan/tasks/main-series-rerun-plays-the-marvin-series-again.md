---
id: main-series-rerun-plays-the-marvin-series-again
title: The Marvin series is played again and its report and evidence are kept
milestone: 06-first-real-series
depends_on: []
---

The first real series lost its logs, so the five counters `packages/stats/src/rules-evidence.ts`
computes — lead changes, hex flips per turn, Node hand changes and ping-pong, neutral captures,
per-seat re-scouts — have no surviving record, and four sections of `docs/rules-review.md` are
`Left open` on that rather than on sample size. Play the series again, to the same specs as the
standing report, and keep both generated tables in a tracked path this time.

**The run is Jim's, not yours.** It is 5 h 27 m 44 s of wall time for five pairs at
`--concurrency 1` (63.5, 74.8, 56.4, 62.7, 70.3 minutes a pair, `docs/series-notes.md` §3), it is
17,379,888 tokens, and Marvin answers **one request at a time**, so it cannot start and finish
inside one agent turn. It must not be started inside a task workspace either: `series/` is caught
by the anchored `/series/` rule in `.gitignore` and the workspace, and everything untracked in it,
is deleted when the task finishes — which is exactly how run 1's logs were lost. So call
`ask_human` and ask Jim to run it himself in a checkout that will outlive this task, and to report
back the absolute path of the series directory it wrote and the wall time it took. While it plays,
nothing else on this box should send Marvin requests: run 1's 34 `timeout` and 18 `provider_error`
passes were largely other agents sharing that one-server queue.

The command, from the repository root — the same pairing, ceiling and concurrency as
`reports/series/marvin-subagent-vs-greedy.md`:

```bash
pnpm exec no-dice series --game salient --a marvin/subagent --b bot:greedy \
  --name marvin-subagent-vs-greedy --max-pairs 5 --max-tokens 60000000 --concurrency 1
```

`--seed-base` is left at its default (`DEFAULT_SEED_BASE = 0` in
`packages/runner/src/series-plan.ts`), so the rerun draws the same five seeds as run 1 — 572152369,
708123, 479473028, 313966722, 1003578858 — and plays the same ten maps. It is a **new** series under
that name, not a resume: run 1's `series.json` is gone, so `planSeries` draws a fresh list. Expect
**10 counted matches, not 8**: `749d236` made a bare-name tool call a refused call instead of a
`tool_surface` void, so the two matches run 1 lost should produce logs now. If any match is still
missing, keep the count and the reason in the record rather than fixing anything mid-run. If Jim
would rather have the adaptive interval test run (`MIN_TEST_PAIRS = 10` pairs), the same command at
`--max-pairs 10` resumes from the logs on disk, so starting at 5 costs nothing.

When the run is finished, do the rest yourself:

- `pnpm exec no-dice evidence --series <the directory Jim gives you>` — it only reads
  `series.json` and the logs, so it runs fine from the task workspace against an absolute path
  outside the repository, and writes `<dir>/evidence.md`.
- Copy `<dir>/report.md` to `reports/series/marvin-subagent-vs-greedy-rerun.md` and
  `<dir>/evidence.md` to `reports/series/marvin-subagent-vs-greedy-rerun-evidence.md`, verbatim,
  the way run 1's report was kept. They carry absolute paths from the machine that played them;
  that is what the generators write, so leave them.
- **Do not overwrite `reports/series/marvin-subagent-vs-greedy.md`.** `docs/rules-review.md`
  quotes its figures, and the two runs are separate samples — run 1 was played by the pre-`749d236`
  harness. The `-rerun` suffix is what keeps them apart.

Nothing outside those two new files changes in this task: no code, no rules, no harness, no prompt,
and nothing under `series/` is committed. The notes and the rules review read the new files in the
tasks that follow.

## Acceptance
- [ ] `reports/series/marvin-subagent-vs-greedy-rerun.md` is committed and carries the rerun's
      win rate with its 95% interval, the seat split, the margin interval and the missing matches
- [ ] `reports/series/marvin-subagent-vs-greedy-rerun-evidence.md` is committed and carries all
      five counters: the per-match table, the band totals, the series means, the Node
      ping-pong section and the Re-scouts table
- [ ] `reports/series/marvin-subagent-vs-greedy.md` is unchanged, and nothing under `series/`
      is tracked

## Verification
```bash
set -e
node -e '
const fs = require("node:fs");
const report = "reports/series/marvin-subagent-vs-greedy-rerun.md";
const evidence = "reports/series/marvin-subagent-vs-greedy-rerun-evidence.md";
for (const p of [report, evidence]) if (!fs.existsSync(p)) throw new Error(`${p} is not there`);
const r = fs.readFileSync(report, "utf8");
for (const need of [/marvin\/subagent/, /win rate/i, /95%/, /seat/i, /stopped/i, /missing/i]) {
  if (!need.test(r)) throw new Error(`${report} says nothing about ${need}`);
}
if (/series-real-run\/series\//.test(r)) throw new Error(`${report} is the old run 1 report, not the rerun`);
const e = fs.readFileSync(evidence, "utf8");
for (const heading of ["## Per match", "## Over the series", "## Per match, on average", "## Node ping-pong", "## Re-scouts", "## Missing matches"]) {
  if (!e.includes(heading)) throw new Error(`${evidence} has no ${heading} table`);
}
if (!/hexes flipped a turn late on \(turns 18-25\)/.test(e)) throw new Error(`${evidence} has no comparison against the rules bot figures`);
if (/series-real-run\/series\//.test(e)) throw new Error(`${evidence} is run 1 evidence, not the rerun`);
const standing = fs.readFileSync("reports/series/marvin-subagent-vs-greedy.md", "utf8");
if (!/series-real-run\/series\//.test(standing)) throw new Error("the standing run 1 report was overwritten; it must stay as it was generated");
'
test -z "$(git ls-files series/)" || { echo "something under series/ is tracked"; exit 1; }
```
