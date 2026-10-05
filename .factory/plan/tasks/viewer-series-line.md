---
id: viewer-series-line
title: The viewer shows the series line beside the showcase match
milestone: 06-first-real-series
depends_on: [stats-showcase]
---

Brief §6.8's header row asks for a "series line" beside the match, and milestone 05 left it a
sentence: `render-header.ts`'s `SERIES_LINE` reads "No series in this log: a match log holds one
match, and series results come with showcase selection (milestone 06)". A `salient-log/1` log
still holds no series, so the series comes from the sidecar `stats-showcase` writes.

Extend the page with a fourth input: `?series=<url>` names a `showcase.json`, and the match
itself arrives the way it already does — `?log=<path>` or the file picker. `load.ts` grows a
series source beside `pickLogSource`/`readLogSource` (a file picked alongside the log counts
too, so a showcase log and its sidecar can both be picked), and `header.ts`/`render-header.ts`
swap the placeholder for the series line when one is loaded: model X versus the opponent, the
win rate with its 95% interval, the pairs played and the stop reason, plus that this match is
the one the series picked.

`showcase.json`'s shape is **declared in the viewer**, not imported: `module-graph.test.ts`
allows exactly one package specifier, `@no-dice/log`, and that rule is the reason the viewer
cannot drift from the engine. Parse the sidecar with a small zod schema of the viewer's own (the
viewer already depends on `@no-dice/log`, which depends on zod) and report a bad one as one
readable line under `#status` while the match still renders — a broken series line must not
blank a board.

Finish by updating the two deferred rows of `docs/viewer-notes.md` §3 ("The series line",
"Showcase selection") to say what the page does now, and leave the operator's route in the
notes: open the viewer, pick the showcase log and its `showcase.json`, and the header names the
series the match came from.

## Acceptance
- [ ] With a log and a `showcase.json` the header shows the series result line in place of the
      milestone 05 placeholder
- [ ] With no sidecar the placeholder stays, and a malformed one says what is wrong without
      stopping the board from rendering
- [ ] The viewer still imports no package but `@no-dice/log`, and still builds

## Verification
```bash
pnpm test -- series-line module-graph
pnpm --filter @no-dice/salient-viewer build
```
