# Viewer notes

How to run the replay viewer, what it is fed, what v0 leaves out, and how its
turn-11 frame was checked against the mock-up. The milestone's done-means is
`games/salient/viewer/src/golden-frame.test.ts`: golden log 01 at turn 11
renders the spectator mock-up, and that test asserts the frame as a whole rather
than one part of it.

Related: [the build brief, §6.8 and §8](../salient/docs/salient-build-brief.md) ·
[the mock-ups](../salient/docs/salient-mockups.md) ·
[the pi harness notes](pi-harness-notes.md)

---

## 1. Running it

```bash
pnpm install
pnpm --filter @no-dice/salient-viewer dev
```

Vite serves the page at `http://localhost:5173/`. It opens with no log and says
so: the viewer reads a log from a file picker, from a drop anywhere on the page,
or from `?log=<url>`, and has nothing to draw until one of the three arrives.

The five fixtures sit under Vite's root, so the dev server serves them and
`?log=` names one:

```
http://localhost:5173/?log=/fixtures/golden-01-time-win.json
```

`?log=` is an ordinary `fetch`, so any static server will do for a log of your
own — a match the runner wrote, or a series' `matches/` directory. The fixtures
are served by `dev` only: `build` copies nothing out of `fixtures/`, so a
`preview` page needs the log served beside it.

```bash
pnpm --filter @no-dice/salient-viewer build
pnpm --filter @no-dice/salient-viewer preview   # the built page, on 4173
# …with the log served beside it, or anywhere the page can reach:
#   http://localhost:4173/?log=/matches/135-greedy-random.json
```

A log the page cannot take is reported as one readable line — not JSON at all,
or JSON that is not a `salient-log/1` log, with the offending field paths named.
A `?log=` path nothing serves is the same message rather than a 404, because a
Vite page answers an unknown path with its own HTML. The prototype's golden logs
under `games/salient/golden/` are the usual mistake: they carry no `format`
field, so they are rejected rather than half-read.

The viewer reads the log and nothing else. It never imports the engine, never
calls the match server and never recomputes a turn; `src/module-graph.test.ts`
fails if a module under `src` reaches anything but `@no-dice/log`.

## 2. Where the fixtures come from

`scripts/golden-to-log.mjs` writes them. The five matches under
`games/salient/golden/` are still in the prototype's shape, so the converter
replays each one through the shipped engine — its own `map` and `start` into a
`MatchState`, each turn's orders through `resolveTurn`, `score()` for both seats,
`cellsFor` for the supply — and writes a `salient-log/1` file:

```bash
node scripts/golden-to-log.mjs          # rewrites games/salient/viewer/fixtures/
pnpm test -- golden-to-log              # regenerates and compares, byte for byte
```

Replaying rather than translating fields is what makes `cut_off` exist: the
prototype's cells hold three numbers and no supply at all. `created` is a fixed
timestamp and the margin is unsigned, which is what makes regenerating the five
byte-identical to what is committed.

**The intent, prediction and tool-trace lines are not what those seats wrote.**
The prototype's bots left nothing behind — no intent sentence, no prediction, no
tool calls — so the converter generates the two sentences as templates built
from that seat's orders, and leaves the tool-call list empty. The panel then
says what an empty trace means ("The log holds no tool calls for this turn.")
rather than inventing the mock-up's bracketed trace. The same goes for scouts,
wasted orders, passes, usage, cost, context tokens and wall time: all zero or
empty, because a scripted bot has none of them. A real Pi log carries every one,
and the panels show them — the context meter, the marks for a refused
submission, a pass and a compaction, and the trace with its arguments and its
timings are all driven by those fields, not by the fixture.

## 3. What v0 leaves out

| Left out | Why |
| --- | --- |
| The series line | A `salient-log/1` log holds one match and no series. The header says so in a sentence rather than leaving the mock-up's `Match [n] of [N]` brackets as an unexplained gap. |
| Showcase selection | Milestone 06. Which matches a series shows, and in what order, is not decided, so the viewer has no list of logs to choose from. |
| The "Called it" / "Missed" verdict tag | How predictions are scored is undecided (`salient/docs/salient-mockups.md`, "What is placeholder"). The panel shows the prediction and no judgement of it. |
| Live streaming of a match in progress | Brief §3, out of scope for v0. The viewer loads a finished log file. |
| Video export of a replay | Brief §3, out of scope for v0. The frame keeps the mock-up's 1920 × 1080 geometry so a recording is still possible, but nothing records it. |
| A calibrated win-probability bar, own-orientation boards, more than two players, a web UI for launching matches | Brief §3, out of scope for v0. |
| The mock-up's six-symbol key beside the board | The symbols are on the board itself, and the chart carries its own two-line legend. A legend for the board is not in the plan's tasks. |
| A context meter on a bot seat | Not a missing feature: a bot seat keeps no conversation and has no window to measure against, so the panel draws no meter rather than one reading zero. |

Nothing the mock-up draws above or beside the board is missing from the page now.
The headline was the last of them: `src/headline.ts` builds the turn's sentence
from its events and the supply the turn leaves, `render-headline.ts` puts it in
the `#headline` row above the board, and `main.ts` redraws it with every frame.
What it says for the turn the mock-up was drawn from is compared in section 4.

## 4. Comparing the frame with the mock-up

The comparison was made by eye: the dev page at
`?log=/fixtures/golden-01-time-win.json`, scrubbed to turn 11, beside
`salient/docs/mockups/spectator-view.png` (and `fog-of-war-view.png` for the fog
frame). What the eye checked is pinned by `golden-frame.test.ts`, which loads the
fixture through the same `parseLog` the page uses, steps the frame index to turn
11 and asserts the drawn frame — the header, the headline, the board, both panels
and the chart — so the comparison does not have to be repeated by eye next time.

**What matched.**

- The header: `43` and `33`, `TURN 11 OF 25`, the bar in three segments of 43,
  17 and 33 points with the tick at half of 93, and the line "A leads by 10.
  17 of the 93 points are not scoring."
- The board: the same 705 × 629 px box, and all 79 labelled hexes at the same
  `left`/`top` and with the same background class and the same mark — numbers,
  Base circles, Node diamonds, and the `1` on the dark disc over F1's hatch. The
  five hatched hexes are F1, G1, H1, H2 and G3, all B's.
- The fight outline: one, behind F6, at 318 px / 274 px.
- The arrows: twelve, A's six then B's six, each naming the same order. The six
  along a row are at the mock-up's pixel and rotation exactly.
- The panels: 22 troops / 2 Nodes / 6 of 6 actions, and 24 / 1 / 6 of 6.
- The chart: 25 slots for a 25-turn match, bars of 4, 8, 8, 4, 12, 4, 4, 12, 16,
  8 and 40 px for turns 1 to 11, turn 10 below the line and turn 11 marked `+10`.
- The fog frame: 27 playable hexes drawn as fog — the mock-up's 27, hex for
  hex — the 12 blocked hexes unchanged, a `?` inside A's Base and inside the two
  Nodes of A's that B cannot see, and both Bases and all 7 Nodes still on the
  board.

**The fog frame's `?`: the mock-up's rule, not the plan's.** The plan's
`viewer-fog` criterion says "every hidden hex shows its terrain and a `?`
instead of a troop count", which reads as a `?` on all 27. The mock-up is
narrower and its key spells the narrower rule out — "Hidden Base or Node"
beside the `?` swatch — with markup to match: of its 27 hidden hexes, 24 carry
only their label and exactly 3 carry a `?`, A's Base `B6` and A's two Nodes on
that half, `D6` and `D9`. The page follows the mock-up, because the mock-up is
what the brief's fourth done-means holds the viewer to and the criterion is the
looser of the two. The rule the symbol follows is a substitution, not a label:
where the spectator frame shows a number, the fog frame shows `?` in the same
symbol; a plain hex with no troops in the spectator frame shows nothing there
under fog either, and the fog hatch — a background of its own, not a team
hatch — is what says "this seat does not know who stands here". Putting a `?` on
all 24 would claim a troop count where the frame has no count to hide, and would
move the page away from the mock-up for nothing. `render-board.test.ts` pins the
mark of every non-blocked hidden hex of that frame — no mark element and no
text beyond the label on the 24, `?` inside the Base circle and inside the Node
diamond on the 3 — so the decision outlives the argument that settled it.

**What did not, and why.**

- The intent and prediction sentences. The mock-up's are hand-written for the
  frame — "Attack F6 from F5 with 5 to take their node…", "Their 3 at F6 will
  hit G5." The fixture's are generated from its orders: "6 orders: 5 from F5 to
  F6, 2 from F5 to G4, …" and "The largest move, 5 troops, heads for F6: expect
  B to answer there." Nothing about the frame is wrong here; the sentences are
  simply not the same sentences, and the test pins the fixture's.
- The tool-call trace: the mock-up's bracketed placeholder against the panel's
  "The log holds no tool calls for this turn." The scripted bots made none.
- The seat names: `[Model A]` and `[Model B]` against `raider` and `striker`,
  which is what the fixture's `players` say.
- The series line: the mock-up's brackets against the sentence that says a match
  log holds no series.
- The verdict tag: not drawn, so the prediction stands on its own.
- The headline: the mock-up's "A takes the centre Node, 5 against 3, and cuts
  off five of B's hexes" against what `headline()` generates for the same turn,
  "B takes K2, A takes G4, A takes the Node, 5 against 3, and cuts off five of
  B's hexes" — it names every capture the turn logged, not only the one the
  mock-up chose to feature, and names a Node by its terrain because the log has
  no word "centre" in it. The line sits above the board in the mock-up's 24 px
  Barlow style, and `golden-frame.test.ts` pins the generated sentence.
- Six arrows, the diagonal ones, are a few pixels off the mock-up's markup:
  five sit 4 px right and 2 px up, and `A: 2 from F5 to G4` sits 4 px left and
  2 px up. The mock-up placed those by hand a little off its own geometry; the
  viewer puts every arrow at the midpoint of its two hex centres, at the angle
  that edge runs, which is where the mock-up's six row arrows already are. The
  test pins all twelve pixels and rotations, so a geometry change shows up there
  rather than in the comparison.
- Blocked hexes carry their labels. The mock-up leaves its 12 unlabelled, though
  the log names them, and the rules and the orders use those names.
- The page has controls the mock-up does not — Back, a scrub slider, Forward,
  Play, and the three view-mode buttons — because a mock-up is one frozen frame
  and a replay is not. They are drawn in the palette's own style rather than
  invented for the comparison.
- The page's rows sit 12 px apart rather than the mock-up's 24. The mock-up stacks
  three rows in its 1080 px frame and leaves 72 px spare in the middle one; the
  page stacks five — the view toggle, the headline and the replay controls are
  extra — and at 24 px of gap the 629 px board box is pushed out of the frame.
  Every row's own height, and everything inside every row, is still the mock-up's:
  the 104 px header, the 705 × 629 px board and the 112 px chart are unchanged.
