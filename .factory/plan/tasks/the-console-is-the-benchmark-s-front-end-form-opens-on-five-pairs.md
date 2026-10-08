---
id: the-console-is-the-benchmark-s-front-end-form-opens-on-five-pairs
title: The start form opens at the benchmark defaults, with the rest folded away
milestone: 11-seats-providers-and-starting-runs
depends_on: []
type: code
---

The form opens blank, which means it opens at the runner's defaults: 75 pairs, 150 matches, one at a
time. That is about two days of a machine, and the page already says so — which is the wrong
answer to "what happens when I press Start". It should open at the benchmark's defaults and fold away
the knobs nobody touches on a first run.

- `DEFAULTS` in `packages/ui/web/src/start.ts` stays what it is — the runner's own 75 pairs,
  concurrency 1, seed base 0, no ceilings — because the ceilings block quotes it when a field is
  blank, and that quote has to stay true. Add a separate export, `OPEN_VALUES`: the values the form
  *opens with*, which are five pairs, one pair at a time, both ceilings blank, seed base blank.
- `render-start.ts` **prefills** the Pairs and Pairs at once boxes with those values instead of
  leaving them blank with a placeholder, so what the page shows is what it sends. The placeholders
  that remain say what a blank means, not what the default is.
- The ceilings block needs no new rule: with Pairs holding 5 it reports `Pairs: 5` as a value from the
  form, and an operator who clears the box gets `Pairs: 75 — the runner's default, the field is
  blank`, which is the existing honesty and stays exactly as it is.
- **An advanced block that starts closed** holds the seed base and the two ceilings. It is a
  disclosure drawn by `render-start.ts` and opened by a click — no reload, no navigation — and its
  label says in the page's words what is inside. Pairs, Pairs at once, Series name and, for a match,
  its seed stay in the open: they are what a first run is about.
- **Turn timeout is stated, not edited.** The runner gives every turn five minutes
  (`TURN_TIMEOUT_MS` in `packages/runner/src/match.ts`) and no flag changes it, so the advanced block
  says that in one line rather than offering a box. Making it editable would mean a
  flag on the command line, a cap threaded through every match, and a log header whose turn cap
  follows it — a different change, and the plan has asked whether it is wanted.
- The estimate paragraph under the button stays where it is; a later task replaces what it says.

## Acceptance

- The form opens with 5 in Pairs, 1 in Pairs at once and both ceiling boxes blank, and the ceilings
  block reads the pair limit as a value from the form.
- The seed base and the two ceilings sit behind an advanced block that starts closed and opens on a
  click without a reload, and that block states in one line how long a turn gets.
- Clearing the Pairs box leaves the block stating the runner's 75 as the runner's default, and the
  payload the form sends omits the field.

## Verification

```bash
pnpm test -- packages/ui/web
node --input-type=module -e '
const { DEFAULTS, OPEN_VALUES } = await import("./packages/ui/web/src/start.ts");
if (DEFAULTS.maxPairs !== 75 || DEFAULTS.concurrency !== 1) {
  throw new Error("DEFAULTS has to stay the runner defaults the ceilings block quotes");
}
if (String(OPEN_VALUES.maxPairs) !== "5" || String(OPEN_VALUES.concurrency) !== "1") {
  throw new Error(JSON.stringify(OPEN_VALUES));
}
for (const ceiling of ["maxCost", "maxTokens", "seedBase"]) {
  const value = OPEN_VALUES[ceiling];
  if (value !== "" && value !== null && value !== undefined) {
    throw new Error(`the form opens with a ${ceiling}: ${JSON.stringify(value)}`);
  }
}
'
pnpm --filter @no-dice/ui build
pnpm typecheck
```
