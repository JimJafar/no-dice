---
id: the-console-is-the-benchmark-s-front-end-estimate-names-its-matches
title: The Runs view says what its estimate was measured on
milestone: 11-seats-providers-and-starting-runs
depends_on:
  - the-console-is-the-benchmark-s-front-end-estimate-from-what-was-measured
  - the-console-is-the-benchmark-s-front-end-pickers-offer-three-kinds
type: code
---

The route now answers what the series under the root measured; the page still quotes a sentence written
before any of them were played. This task puts the measured answer on the Runs view and takes the
fixed one off.

- `start.ts` gains a read of `GET /api/estimate`, asked with the seats the pickers hold and the pair
  count the form holds — the form's value when it has one, and the runner's own 75 when the box is
  blank, which is what a blank means and what the ceilings block already says.
- `MEASURED_MATCH` and `MEASURED_SERIES` go away. The browser stops holding that figure altogether:
  the route is the only place it is spelled out, and the page draws what the route answered.
- `render-start.ts` draws the estimate as the route gave it: which series it measured and how many
  matches it counted, then turns, tokens, cost and time in the seats, per match and for the run. When
  the route says a seat has never been played under the root, the page quotes the documented figure and
  says what it was measured on, in words, and says plainly that it is not a measurement of the model in
  that seat.
- **The page may round, and may not compute.** "About 15 minutes and 14.8M tokens a match" is the
  route's figure made readable, and the sentence says *about*. Adding, multiplying or averaging a
  figure here is what milestone 12 forbids in general and this task forbids now: the arithmetic already
  happened once, in the route, over the logs.
- **The read is asked when a seat changes or the pair count changes, not on every keystroke.** The
  route walks every match log under the root, which is seconds. A seat picker's change asks; typing in
  a model-id box does not; the pair box asks when the operator leaves it, not per character.
- A failed read leaves the last estimate standing and says the estimate could not be read. An operator
  who cannot get an estimate should still be able to press Start — the ceilings block, not the
  estimate, is what bounds the run.
- Every string the section draws goes through `expectPlainWords`: series names are fine, paths and flag
  names are not.

## Acceptance

- The Runs view's estimate names the series it measured and the matches it counted, and gives turns,
  tokens, cost and time in the seats per match and for the run.
- A seat nothing under the root has played is estimated from the documented figure, cited in words,
  and the page says that figure is not a measurement of that model.
- The estimate is re-asked when a seat or the pair count changes and not on every keystroke, no figure
  in `packages/ui/web/src` spells out the documented measurement, and every string the section draws
  passes `expectPlainWords`.

## Verification

```bash
pnpm test -- packages/ui/web
pnpm --filter @no-dice/ui build
pnpm typecheck
grep -q '/api/estimate' packages/ui/web/src/start.ts
! grep -rq '4\.59M' packages/ui/web/src
```
