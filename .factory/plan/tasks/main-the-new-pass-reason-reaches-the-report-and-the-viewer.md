---
id: main-the-new-pass-reason-reaches-the-report-and-the-viewer
title: The new pass reason is read out in the report and in the viewer
milestone: 06-first-real-series
depends_on: [main-a-prompt-the-seat-never-answers-passes-the-turn]
type: code
---

`prompt_timeout` is only useful if a report and the replay say what it means. Most of this
arrives on its own, and the parts that do not are the ones that silently read wrong.

`@no-dice/stats` builds its pass counts from the schema rather than from a list of its own —
`zeroCounts(passReasonSchema.options)` in `packages/stats/src/match-metrics.ts:228`, and
`packages/stats/src/series-report.ts:606`, `:622` and the per-model table at `:951` — so the report grows
a `prompt_timeout` column the moment the enum does. Its tests pin the expected objects literally
(`packages/stats/src/match-metrics.test.ts:48`, `:526`, `:605`, `:621`, `:637`), so they need the new key
and a case where a turn carries it. The viewer does not derive anything: `PASS_TEXT` in
`games/salient/viewer/src/marks.ts:41` and in `games/salient/viewer/src/headline.ts:159` are
`Record<PassReason, string>`, so `pnpm typecheck` fails until both carry the new member — and the words
matter, because `timeout` is already shown as "ran out of time" and a reader must not be able to confuse
the two. Say what happened in the seat's own terms: the harness asked it to play and it never took the
question. Extend `marks.test.ts` and `headline.test.ts` the way the other reasons are covered.

Then write the reading, not just the label: a short paragraph in `docs/pi-harness-notes.md` (the section
the diagnosis task started) saying what a `prompt_timeout` pass in a report's per-model table says about
the seat and about the server it played on — `docs/series-notes.md` §4 is the precedent for reading pass
counts as a server story before they are a model story.

## Acceptance
- [ ] The series report's per-model pass table carries `prompt_timeout`, and the stats tests pin both the key and a turn that produces it
- [ ] The viewer marks and headlines a `prompt_timeout` turn in words that cannot be confused with `timeout`, and `marks.test.ts` and `headline.test.ts` cover it
- [ ] `docs/pi-harness-notes.md` says how to read a `prompt_timeout` pass in a report

## Verification
```bash
pnpm typecheck
pnpm vitest run packages/stats games/salient/viewer
```
