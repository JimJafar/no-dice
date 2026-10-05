---
id: the-page-draws-the-turn-s-headline-above
title: "The page draws the turn's headline above the board"
milestone: 05-replay-viewer
depends_on: []
---
`games/salient/viewer/src/headline.ts` builds the mock-up's one-line headline from `turns[n].events` and the cut-off counts, and `headline.test.ts` covers the sentence, but the viewer-headline task never mounted it: `index.html` has no element for it, `main.ts`'s `redraw` never calls `headline()`, and `viewer.css` has no class for it. Brief §6.8 asks for "a one-line headline for the turn, generated from the events", and `salient/docs/mockups/spectator-view.png` draws it directly above the board ("A takes the centre Node, 5 against 3, and cuts off five of B's hexes"), so the spectator frame the milestone is meant to reproduce is missing one line. For golden-01 turn 11 the generated sentence is "B takes K2, A takes G4, A takes the Node, 5 against 3, and cuts off five of B's hexes" — it names every capture the turn logged, and names a Node by its terrain, which is expected and recorded in `docs/viewer-notes.md` §3. The fix is a `#headline` element between `#view-toggle`/`#stage` and the board, a `render-headline.ts` (or a line in `main.ts`) that fills it from `headline(log, view.frame)`, CSS in the mock-up's 24 px Barlow style, and a test that the frame at turn 11 shows that sentence and hides it at no frame. `docs/viewer-notes.md` §3 currently lists this as "not in the page yet" and should be updated when it is drawn.

## Acceptance
- [ ] The page shows the turn's generated headline above the board, and it changes with the frame
- [ ] Turn 11 of golden-01 reads "B takes K2, A takes G4, A takes the Node, 5 against 3, and cuts off five of B's hexes"
- [ ] Frame 0 and a turn with no events each get their sentence rather than an empty line

## Verification
```bash
grep -q 'id="headline"' games/salient/viewer/index.html && grep -q 'headline(' games/salient/viewer/src/main.ts && pnpm test -- viewer
```
