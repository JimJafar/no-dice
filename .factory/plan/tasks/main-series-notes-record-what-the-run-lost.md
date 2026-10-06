---
id: main-series-notes-record-what-the-run-lost
title: The record of the first real series says what was lost and what a re-run does
milestone: 06-first-real-series
depends_on: []
---

A review of the build against the full acceptance criteria found that `docs/series-notes.md`
and `reports/series/marvin-subagent-vs-greedy.md` claim things that are no longer true, and
leave three causes unrecorded. Fix the two documents; change no code.

**The series is gone, so there is nothing to resume.** Checked on this box:
`/home/jim/.software-factory/workspaces/no-dice/series-real-run/series/` does not exist. The
whole `series/marvin-subagent-vs-greedy/` directory — `series.json`, `report.md` and the ten
match logs — was written inside the `series-real-run` task's own workspace, is caught by the
anchored `/series/` rule in `.gitignore`, and was deleted when that task merged. Only the two
committed documents survived. So §6 ("Resuming it, and extending it") is wrong: with no
`series.json` to read, `planSeries` (`packages/runner/src/series-plan.ts`) falls back to
`options.seedBase ?? DEFAULT_SEED_BASE` and draws a fresh seed list, and the command in §1
starts a **new** series in a new directory rather than playing the two voided matches. Rewrite
§6 to say that, keep the mechanics it gets right (a log on disk skips a match, `series.json`
holds the pairing and the seeds, `no-dice stats --series …` reprints a report), and say what it
would take to keep a series across tasks — the logs are gitignored on purpose, so a series that
has to outlive its task has to be copied somewhere tracked, or replayed.

**Record the main cause of the 53 passes.** §3 and §4 read the 34 `timeout` passes and the
18 `provider_error` passes as cache eviction between the two seats of a pair. That is real but
secondary: Jim's account is that the factory's **own builder agent was sending requests to the
same Marvin server while the series ran**, and Marvin answers one request at a time. Every seat
turn therefore queued behind the builder's requests as well as behind the other seat's, which is
what pushed turns past the runner's 300 s cap and, when Pi's own retries ran out inside that
queue, what produced the `provider_error` passes. Say that plainly in §3 or §4, with the
consequence for the figures: the series' per-turn times and pass counts measure a contended
server, not a seat playing alone, and §7's 18.8-minute match is the uncontended number.

**Record that a repeat plays under different rules.** Commit `749d236` ("harness: a seat that
calls one of its seven tools by the bare name is refused, not voided") changed
`PiPlayer`: a call to one of the seven by its bare name (`submit_orders` for
`mcp__salient__submit_orders`) is now recorded as a refused call and the turn goes on; only a
call to something outside the seven still voids the match. Add that to §5, with what it means:
the two matches this series lost to `tool_surface` would not be lost now, so a re-run of the
same command is not a continuation of this series and its `tool_surface` row is not comparable
with this one.

**In the report's "Missing matches" section, say why in words.** It currently gives only
`failed: tool_surface` and two paths to logs that no longer exist. Add a short note under the
list: the seat called `submit_orders` without Pi's `mcp__salient__` prefix, Pi answered that no
such tool exists, and the harness took a tool name outside the seven as a seat that reached
outside the game and voided the match, leaving no log; the paths name files that the task
workspace no longer holds.

**Explain the compaction line.** The report's "Compaction turns:" line cites
`seed 479473028 turn 15`, `seed 313966722 turn 15` and `seed 313966722 turn 20`, and both of
those seeds are in the missing list. A seed names a *pair*, and each of those pairs lost one
match and kept the other, so those turns come from the match that has a log. Add one sentence
under the line saying that, and that the generator names only the seed (the task that fixes the
generator is separate; do not change code here).

## Acceptance
- [ ] `docs/series-notes.md` §6 says a re-run of the §1 command starts a new series, and why
      (the series directory was gitignored and went with the task workspace)
- [ ] The notes record the builder agent sharing the single-request Marvin server as the main
      cause of the 34 `timeout` and 18 `provider_error` passes, and record commit `749d236`'s
      bare-name rule change and what it does to a repeat
- [ ] The report's "Missing matches" section says in words that the seat called `submit_orders`
      without the `mcp__salient__` prefix, and the "Compaction turns" line's seeds are explained

## Verification
```bash
node -e '
const fs = require("node:fs");
const notes = fs.readFileSync("docs/series-notes.md", "utf8");
const report = fs.readFileSync("reports/series/marvin-subagent-vs-greedy.md", "utf8");
const need = (text, re, what) => { if (!re.test(text)) throw new Error(what); };
need(notes, /new series/i, "docs/series-notes.md never says a re-run starts a new series");
need(notes, /builder agent/i, "docs/series-notes.md does not record the builder agent on Marvin");
need(notes, /749d236/, "docs/series-notes.md does not record commit 749d236 changing the bare-name rule");
const missing = report.split(/^## /m).find((section) => section.startsWith("Missing matches"));
if (!missing || !/mcp__salient__/.test(missing)) throw new Error("the report Missing matches section does not name the missing mcp__salient__ prefix");
const lines = report.split("\n");
const at = lines.findIndex((line) => line.startsWith("Compaction turns:"));
if (at < 0) throw new Error("the report has no Compaction turns line");
const under = lines.slice(at + 1, at + 4).join("\n");
if (!/pair/i.test(under)) throw new Error("nothing under the Compaction turns line says a seed names a pair");
'
```
