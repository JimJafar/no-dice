---
id: the-console-is-the-benchmark-s-front-end-rows-edit-and-remove
title: Each provider row can be edited and removed from the page
milestone: 11-seats-providers-and-starting-runs
depends_on:
  - the-console-is-the-benchmark-s-front-end-provider-edit-and-remove-routes
type: code
---

`packages/ui/web/src/render-providers.ts` draws each provider as a row — name, base URL, key
variable, a Check credential button — with one add form under the list. The view is meant to manage
providers, so each row gets an edit and a remove, and both have to survive what the console answers:
a refusal while a run is in flight, a schema line, an entry that has already gone.

- **Edit** uncovers that row's fields prefilled with what the registry holds: base URL, API, key
  variable name, reasoning, context window, max output, and the four rates. The name is shown and is
  not editable, and the row says why in one clause — it is the name a seat is written with, so
  changing it means removing this provider and adding the other. Saving posts the row's name and
  the edited entry to `/api/providers/update`.
- **Remove** asks once, in the page. The first click turns that row's own control into a confirm and
  a cancel, and nothing is sent until the confirm; a second row's remove does not answer for the
  first. No browser dialog: the frame draws its own lines everywhere else, and a dialog cannot be
  styled or tested from here.
- **After either succeeds the list is re-read** from `/api/providers` and redrawn, as an add already
  is, so what is on the page is what is on disk. After either fails the row stays where it was, with
  whatever was typed in it still there, and the refusal is drawn verbatim — including the console's
  line about a run in flight, which is the answer an operator most needs to read whole.
- **No field holds or asks for a key value.** The key box names a variable, and its placeholder says
  what leaving it blank means, as the add form's does.
- Every string this section draws goes through `expectPlainWords` in
  `scripts/console-design.test.mjs`: no flag names, no paths, no log file names.

The add form and the credential check stay as they are. This task changes the rows, not the routes.

## Acceptance

- Every provider row has an edit control that opens that row's fields prefilled from the
  registry, with the name shown but not editable, and saving posts the update and re-reads the list.
- Every row has a remove control that asks once before it sends anything; a refusal leaves the row,
  the fields and the file alone and draws the console's line as it came.
- No field in the section takes a key value, and every string it draws passes `expectPlainWords`.

## Verification

```bash
pnpm test -- packages/ui/web
pnpm --filter @no-dice/ui build
pnpm typecheck
grep -q '/api/providers/update' packages/ui/web/src/providers.ts
grep -q '/api/providers/remove' packages/ui/web/src/providers.ts
```
