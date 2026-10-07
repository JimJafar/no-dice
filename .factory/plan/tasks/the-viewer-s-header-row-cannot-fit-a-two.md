---
id: the-viewer-s-header-row-cannot-fit-a-two
title: "The viewer's header row cannot fit a two-line series line"
milestone: 06-first-real-series
depends_on: []
---
`games/salient/viewer/src/viewer.css` fixes `.header` at `height:104px`, and `.centre` stacks counter (18px) + bar (20px) + summary (~20px) + `.series` (18px per line) with 3×10px gaps — 106px of content for a one-line series line, 124px for two. The series line the showcase sidecar produces ("anthropic/claude-opus-4-1 vs openai/gpt-5 — win rate 90.0% (95% …) over 10 counted matches, 5 pairs, stopped on max_pairs. This is the match the series picked: seed 572152369, with … in seat A.") wraps to two or three lines at the mock-up's 15px in the 760px `.centre` column, so it spills past the fixed row.

The frame cannot simply absorb it: `.frame` is the mock-up's fixed 1920×1080, and the six visible rows plus their 12px gaps leave the `flex:1` `.stage` about 637px against a 705×629px board box — roughly 8px of slack (see the comment at the top of viewer.css and docs/viewer-notes.md §4). Growing the header by 20px pushes the board over the headline and replay-control rows.

So the fix is a frame decision, not a CSS tweak: either give the series line a row of its own and shrink the board box, clamp `.series` to two lines and shorten the sentence until the seed clause survives, or widen `.centre` and drop the series line's font. docs/viewer-notes.md §4 currently records the deviation ("the header row is the frame's one tight spot"); the placeholder line in `render-header.ts` is kept to one line for this reason.

## Acceptance
- [ ] A header drawn with a long pairing label (two `provider/model` names) shows its whole series line, including the seed clause, without overlapping the headline or replay-control rows
- [ ] The 705×629 board box stays inside the 1920×1080 frame at every frame of a loaded log
- [ ] docs/viewer-notes.md §4 says what the header row's height is now and why

## Verification
```bash
! grep -q '^\.header{[^}]*[^-]height:104px' games/salient/viewer/src/viewer.css
```
