---
id: management-ui-start-page
title: The page starts a run with seats picked from the bots and the registry
milestone: 07-ui-run-console
depends_on: [management-ui-run-manager]
---

The browser half of starting a run, in `packages/ui/web`. Follow the viewer's split of
pure logic from rendering — a `start.ts` that turns the form's values into the payload and a
`render-start.ts` that draws it — so the interesting part is testable under happy-dom with
`// @vitest-environment happy-dom` at the top of the test file, which is what the viewer's
`render-*.test.ts` files do and what `vitest.config.ts`'s existing `packages/**/*.test.ts` pattern
already picks up. No framework: DOM and `fetch`, like the viewer.

The form: game (only `salient`, the same list `args.ts` exports as `GAMES`), seat A and seat B, and
the limits — seed for a match, seed base, `--max-pairs`, `--max-tokens`, `--max-cost`,
`--concurrency`, and a series name. **Each seat picker lists `bot:random`, `bot:greedy` and every
provider in `providers.json`**, taken from `GET /api/state`; choosing a provider turns the seat
into a text input for the model id, and the seat is sent as `<provider>/<id>`. There is no call to
a provider's `/v1/models` — the id is typed by hand, which is what `--a marvin/subagent` has always
meant at the terminal.

The page does not decide what a valid run is: it posts and shows whatever comes back. A 400 is
rendered as the server's line verbatim — which is `parseArgs`'s line — and nothing is started.
Beside the Start button the page states the ceilings the run is being started under, with the
runner's defaults named when the fields are blank (75 pairs, concurrency 1, no ceiling): a
real series is ~48 h and ~688 M tokens (`docs/pi-harness-notes.md` §7), so starting one by
accident is the failure this page has to make impossible to do blindly. The progress section from
the previous task renders under it, and the page says plainly that closing the page does not
stop a run and closing the server does.

No key value reaches the page at any point: `/api/state` carries provider names and the *names* of
their key variables only.

## Acceptance
- [ ] The seat pickers list `bot:random`, `bot:greedy` and every provider named in
      `providers.json`, and a model seat typed as `subagent` against `marvin` is sent as
      `marvin/subagent`
- [ ] A payload the server rejects is shown as the server's own line and starts nothing, and the
      ceilings the run will start under — including the defaults when the fields are blank — are
      shown before Start is pressed
- [ ] The page states that closing it does not stop a run and closing the server does, and
      `pnpm --filter @no-dice/ui build` and `pnpm typecheck` still pass

## Verification
```bash
pnpm test -- web
pnpm --filter @no-dice/ui build
pnpm typecheck
grep -q 'marvin/subagent' packages/ui/web/src/start.test.ts
grep -q '/api/state' packages/ui/web/src/*.ts
```
