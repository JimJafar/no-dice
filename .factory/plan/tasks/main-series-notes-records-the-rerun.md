---
id: main-series-notes-records-the-rerun
title: The series notes record the rerun alongside the run that was lost
milestone: 06-first-real-series
depends_on: [main-series-rerun-plays-the-marvin-series-again, main-series-notes-record-what-the-run-lost]
---

`docs/series-notes.md` is the operational record of "what was actually run", and after the rerun it
still describes only run 1. Add the rerun to it, so the next person to sit down in front of Marvin
knows which series exist, which numbers are where, and what each run cost. Change no code and no
report: this is the notes file only.

Record, in the file's existing voice and section style:

- **The rerun's command**, verbatim, with the ceiling (`--max-tokens 60000000`), the
  concurrency (1) and the pair limit, and the fact that it was run by Jim outside this
  repository because a series played inside a task workspace is deleted with it.
- **That it is a new series, not a continuation**: run 1's `series/` directory is gone, so
  `planSeries` drew a fresh seed list from the default `seed_base` 0 and landed on the same five
  seeds — 572152369, 708123, 479473028, 313966722, 1003578858 — and so the same ten maps. Say that
  the two runs are separate samples, since run 1 was played before `749d236` made a bare-name tool
  call a refused call rather than a `tool_surface` void.
- **The wall time**, start to finish and per pair, and how it compares with run 1's
  5 h 27 m 44 s and 63.5–74.8 minutes a pair. If the rerun ran while anything else was using
  Marvin, say so: run 1's 34 `timeout` and 18 `provider_error` passes are read against a contended
  single-request server, and the notes are where that caveat lives.
- **How many matches went missing and why**, which should be none now; if any did, name the seed,
  the seat and the reason the way §5 does for run 1.
- **Where the kept copies live**: `reports/series/marvin-subagent-vs-greedy-rerun.md` and
  `reports/series/marvin-subagent-vs-greedy-rerun-evidence.md`, both copied verbatim from the
  series directory, and that `no-dice evidence --series <dir>` is what wrote the second one.
  §7's rule — `series/` is gitignored, so what outlives a run is what was copied somewhere tracked —
  is the reason both are there.
- **How to extend it**: the same command at a higher `--max-pairs` resumes from the logs on disk in
  the directory Jim ran it in, and say where that directory is, since it is outside the repository
  and nothing in git protects it.

## Acceptance
- [ ] `docs/series-notes.md` has a section for the rerun with its command, ceiling, concurrency,
      wall time and missing matches, and names the two kept files under `reports/series/`
- [ ] The notes say the rerun is a new series on the same five seeds, and that the two runs
      are separate samples across `749d236`
- [ ] The run 1 sections keep their figures and stay labelled as run 1

## Verification
```bash
node -e '
const fs = require("node:fs");
const notes = fs.readFileSync("docs/series-notes.md", "utf8");
const need = (re, what) => { if (!re.test(notes)) throw new Error(what); };
need(/rerun|re-run|second run|run 2/i, "docs/series-notes.md does not record a rerun");
need(/marvin-subagent-vs-greedy-rerun\.md/, "the notes do not name the rerun report");
need(/marvin-subagent-vs-greedy-rerun-evidence\.md/, "the notes do not name the rerun evidence file");
need(/no-dice evidence/, "the notes do not say how the evidence file was produced");
need(/572152369/, "the notes do not record that the rerun played the same five seeds");
need(/749d236/, "the notes do not record the harness boundary between the two runs");
need(/--max-tokens 60000000/, "the notes do not record the rerun ceiling");
need(/5 h 27 m 44 s/, "the notes lost run 1 wall time");
'
```
