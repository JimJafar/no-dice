---
id: main-viewer-fog-keeps-a-plain-hidden-hex-blank
title: A plain hidden hex is drawn blank, and the notes say why
milestone: 06-first-real-series
depends_on: []
---

The plan's `viewer-fog` criterion says "every hidden hex shows its terrain and a `?` instead of a
troop count". `render-board.ts`'s `markOf` does something narrower on purpose: a hidden Base gets
`?` in its circle, a hidden Node gets `?` in its diamond, and a hidden **plain** hex gets no
mark at all. A review found the two disagree, and the disagreement was never written down.
Settle it in favour of the drawing, and record the decision.

The drawing is the one the mock-up has. `salient/docs/mockups/fog-of-war-view.html` draws
27 hexes on the fog background: 24 of them carry only their label, and exactly three carry a `?`
— A's Base (`B6`) and the two Nodes on A's half (`D6`, `D9`). Its key spells the symbol out: "`?`
Hidden Base or Node". The spec's fourth success criterion is the mock-up, and
`docs/viewer-notes.md` §4 already records the fog frame matching it hex for hex. The rule the
symbol follows is a substitution, not a label: where the spectator frame shows a number, the
fog frame shows `?` in the same symbol; a plain hex with no troops in the spectator frame
shows nothing there either, and the fog background — a distinct hatch — is what says "this seat
does not know who stands here". Putting a `?` on all 24 would claim a troop count where the frame
has no count to hide, and would move the page away from the mock-up for nothing.

So:

- Keep `markOf` as it is.
- Pin the choice with a test, which today's does not: in
  `games/salient/viewer/src/render-board.test.ts`, for **every** non-blocked hidden hex of the
  turn-11 B fog frame, assert the exact mark — a plain hidden hex has no mark element and no
  text beyond its label, a hidden Base has `.bs` reading `?`, a hidden Node has `.nd b` reading
  `?`. The existing test only asserts "no digit" for all 27 and `?` for the three, so a plain
  hidden hex could grow a mark, or a Base lose its `?`, and nothing would notice.
- Record the decision in `docs/viewer-notes.md`, next to the fog-frame bullet of §4: the plan's
  criterion said a `?` on every hidden hex, the mock-up puts one only where a number was, the page
  follows the mock-up, and the reason is the substitution above. Name the counts (24 plain, 3 with
  a `?`) and the key's wording so the next reader does not have to re-derive it.

Do not touch `viewer-fog`'s task file, and do not change `fog.ts`: which hexes are hidden is not
in question, only what a hidden one is drawn as.

## Acceptance
- [ ] A test asserts the drawn mark of every non-blocked hidden hex of the turn-11 B fog frame:
      no mark for a plain hex, `?` inside the Base circle and the Node diamond
- [ ] `docs/viewer-notes.md` records that the plan's criterion said `?` on every hidden hex, that
      the page follows the mock-up instead, and why
- [ ] The fog frame still draws the mock-up's 27 hidden hexes and still builds

## Verification
```bash
pnpm test -- render-board golden-frame
node -e '
const notes = require("node:fs").readFileSync("docs/viewer-notes.md", "utf8");
if (!/Hidden Base or Node/.test(notes)) throw new Error("docs/viewer-notes.md does not quote the mock-up key that limits ? to a Base or Node");
if (!/(criterion|plan)[^\n]{0,200}(hidden hex|\?)/.test(notes)) throw new Error("docs/viewer-notes.md does not record the criterion it departs from");
'
pnpm --filter @no-dice/salient-viewer build
```
