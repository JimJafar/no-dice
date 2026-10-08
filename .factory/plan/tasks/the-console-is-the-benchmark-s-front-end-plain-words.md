---
id: the-console-is-the-benchmark-s-front-end-plain-words
title: The views speak in plain words, with no flag names, paths or log file names
milestone: 09-console-views-and-design
depends_on: [the-console-is-the-benchmark-s-front-end-four-views]
---

The page is a CLI wearing a `<form>`. `render-start.ts` labels its fields `--seed, for a
match`, `--seed-base`, `--max-pairs`, `--max-tokens`, `--max-cost`, `--concurrency`, `--name` and
`--game`, and states a ceiling as `code(ceiling.flag)` plus a value; `results.ts` opens the
Matches view with "Series under `/home/…/series`, matches under `/home/…/matches`" and labels a
match by its log file name; `render-leaderboard.ts` prints `board.seriesRoot` in three sentences;
`progress.ts` puts `run.dir` in the run's headline. Say the same things in words: **Pairs**,
**Pairs at once**, **Cost ceiling**, **Token ceiling**, **Seed base**, **Series name**, **Game**.
A series is named by the name it was given; a match by its two seats, its seed and the date the
log's header carries — the URL a link uses is unchanged, only the label over it.

The absolute paths come out of headings, labels, rows and buttons. Where the reader needs to know
that only part of the disk is in view, say it in words ("this console lists the series and matches
in the folders it was started with; a series started somewhere else is not here") and leave the
path to the one line where the path *is* the fact — a series record that will not parse, a run
whose directory the runner refused. The run's own output block keeps the CLI's lines exactly as
the CLI wrote them: they are that run's output, and rewriting them would be a second account of
the same run.

This is the page's wording only. `/api/series`, `/api/matches`, `/api/leaderboard` and
`/api/providers` keep their shapes, because their tests pin them and `seriesRoot` and friends are
what the server actually read.

## Acceptance
- [ ] No view heading, label, row or button prints a CLI flag name, an absolute path or a `.json` log file name; the start form says "Pairs", "Pairs at once", "Cost ceiling" and "Token ceiling".
- [ ] A match row is labelled by its two seats, its seed and its date, and a series by its name; every link still points at the URL it pointed at before.
- [ ] Each of the four views has a test that draws it and fails if the drawn text names a flag, an absolute path or a log file name, and the server-side route tests are unchanged and still pass.

## Verification
```bash
pnpm test -- render-start render-leaderboard render-providers results progress
pnpm test -- server results leaderboard providers runs
git diff --quiet packages/ui/src
pnpm typecheck
```
