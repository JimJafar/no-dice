---
id: the-console-is-the-benchmark-s-front-end-pickers-offer-three-kinds
title: A seat can be a bot, a registered provider, or one of Pi's models
milestone: 11-seats-providers-and-starting-runs
depends_on:
  - the-console-is-the-benchmark-s-front-end-model-list-route
  - the-console-is-the-benchmark-s-front-end-form-opens-on-five-pairs
type: code
---

The Runs view builds its two seat pickers out of `/api/state`, which names the bots and the registered
providers. A third kind is now seatable — one of Pi's own models, with the key already in the
console's environment — and it is the kind that should need the least typing: nothing.

- `SeatChoices` in `packages/ui/web/src/render-start.ts` gains `models: { reference, context, maxOut,
  thinking, images }[]`, filled by `main.ts` from `/api/models` — read once per page load with the
  other rare reads, never on a poll.
- Each picker holds all three kinds in one control, grouped so it is visible which kind a choice is:
  the bots, the registered providers, Pi's models. A bot seats as `bot:greedy`; a registered provider
  still needs its model id typed into the box beside it, exactly as today; one of Pi's models seats as
  its reference with **nothing typed anywhere**.
- `seatOf` in `start.ts` decides a bot from a provider by the `bot:` prefix. A Pi model's reference is
  already `<provider>/<id>`, so it goes through unchanged — but the picker has to know not to show a
  model-id box for it, and that is a third case rather than a variation on the second. Say which of
  the three a choice is in one place, and let the seat line under the picker read from it.
- The line under the picker keeps saying what will be sent. For a Pi model it says the reference and
  nothing else: no path, no key variable, no `models.json`.
- If `/api/models` could not be read, the picker offers the two kinds `/api/state` gave and the page
  says the model list could not be read. The form still starts a run — a Pi that failed to answer is
  not a reason an operator cannot seat a bot.
- The reference the picker holds is the label the estimate is looked up by, so the two views have to
  use the same string.

## Acceptance

- Choosing a Pi model in seat A sends `deepseek/deepseek-flash` with nothing typed in any box.
- A registered provider still asks for its model id, a bot still sends `bot:greedy`, and all three
  kinds are offered in each picker.
- A model list that could not be read leaves the form working with the other two kinds
  and says so, and every string the section draws passes `expectPlainWords`.

## Verification

```bash
pnpm test -- packages/ui/web
pnpm --filter @no-dice/ui build
pnpm typecheck
node --input-type=module -e '
const { seatOf } = await import("./packages/ui/web/src/start.ts");
if (seatOf("deepseek/deepseek-flash", "") !== "deepseek/deepseek-flash") {
  throw new Error("a Pi model seat needs something typed");
}
'
```
