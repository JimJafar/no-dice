---
id: viewer-headline
title: The turn gets a one-line headline from its events
milestone: 05-replay-viewer
depends_on: [viewer-skeleton, viewer-golden-fixture]
---

`src/headline.ts`: the sentence above the board, generated from `turns[n].events` and the
cut-off count, in the shape the mock-up's turn 11 sentence has — "A takes the centre Node,
5 against 3, and cuts off five of B's hexes". The clauses it can join, in that order: a
`capture` of a Node or Base that a `battle` at the same hex preceded reads as "<seat> takes
the <terrain>, <A> against <B>"; a `capture` with no battle is simply "<seat> takes the
<terrain>"; a `clash` is the two seats meeting on the edge between two labels; a `repelled`
is an attack turned back, naming the seat that was repelled and the size of the force; and the
supply clause counts the `cut_off` cells the turn leaves for each seat, which is what makes
the mock-up's frame legible at all. Name the terrain rather than the hex code when the hex is
a Base or a Node, and the hex label otherwise. A turn with no events says what the seats did
instead — that a seat passed, with its reason, or that nothing changed — because an empty line
above the board reads as a broken viewer.

## Acceptance
- [ ] Turn 11 of golden-01 yields a headline naming the Node capture, the 5 against 3 fight
      and the five cut-off hexes
- [ ] A turn with no events, and a knockout turn, each get a sentence rather than an empty line
- [ ] A `clash` and a `repelled` each read as themselves, with the seats and numbers the log
      gives

## Verification
```bash
pnpm test -- viewer
```
