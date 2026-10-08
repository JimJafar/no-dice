---
id: the-console-is-the-benchmark-s-front-end-viewer-round-trip
title: A replay opened from the console can get back to it
milestone: 09-console-views-and-design
depends_on: [the-console-is-the-benchmark-s-front-end-four-views]
---

`viewerUrlOf` in `packages/ui/src/results.ts` builds `/viewer/?log=/logs/<series>/matches/<file>.json`,
and the console serves the viewer's built `dist` at `/viewer/` (`VIEWER_ROOT` in `server.ts`). That
is the whole trip today: the viewer has no way back, and when the log it was handed fails to
read, `main.ts` leaves the `#load` box on screen — its file picker and its "choose a match log,
drop one anywhere" hint — at a person who never meant to pick a file.

Make the link carry where it came from. `viewerUrlOf` grows a second argument for the view
the link sits in, so a replay opened from Matches comes back to Matches; percent-encode the value
if it carries a `#`, and keep the `?log=` prefix exactly as it is, because the existing
tests pin it. In the viewer, put the decision in a small `src/back.ts` exporting
`backHref(search): string | null` — the URL to go back to, or `null` when the query names none —
and have `main.ts` mount a "Back to the console" link in the `#load` box and the header only
when that is non-null. A viewer opened on its own, on the dev server or from a file, names no
`back` and so shows nothing new.

Then stop the page asking a console-opened viewer for a file: when the query carries
`?log=`, the picker and the hint are not offered — the line says what it is reading, and a
failure says what is wrong with the log it was given, with the back link beside it. A viewer
opened without `?log=` keeps the picker, which is how a log from somewhere else gets in.
Nothing here may import the engine or another workspace package: `module-graph.test.ts` walks every
file under the viewer's `src` and fails on it.

## Acceptance
- [ ] Every replay link the console draws carries the view it was clicked from, and the viewer opened from that link shows a back link that returns to it.
- [ ] A viewer opened with `?log=` never offers the file picker, including when the log fails to load; one opened without `?log=` still does.
- [ ] The viewer still imports nothing but its own modules and `@no-dice/log`, and both builds and the four gates pass.

## Verification
```bash
pnpm test -- back load results module-graph
grep -q 'back=' packages/ui/src/results.ts
grep -q 'backHref' games/salient/viewer/src/main.ts
pnpm --filter @no-dice/salient-viewer build
pnpm --filter @no-dice/ui build
pnpm typecheck
```
