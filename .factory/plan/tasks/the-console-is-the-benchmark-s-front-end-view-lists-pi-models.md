---
id: the-console-is-the-benchmark-s-front-end-view-lists-pi-models
title: The Providers view lists the models Pi already knows
milestone: 11-seats-providers-and-starting-runs
depends_on:
  - the-console-is-the-benchmark-s-front-end-model-list-route
  - the-console-is-the-benchmark-s-front-end-rows-edit-and-remove
type: code
---

The view is called Providers & models and today it holds only the registry: the rows, the add form,
the credential check. The models Pi knows natively are the ones an operator can seat without
adding anything, and the view has to show that they are there and that the console has a key for
them.

- `packages/ui/web/src/providers.ts` gains `fetchModels(fetchJson)` reading `/api/models`; `main.ts`
  reads it when the page opens, alongside `/api/providers`, and not on a poll — the route costs a
  subprocess, and a key does not appear while the console runs.
- `render-providers.ts` draws them under their own heading inside the same section: one row per
  model, named by its reference (`deepseek/deepseek-flash`), with what Pi said about it — context,
  output cap, thinking, images — spelled as Pi spelled them, and a Check credential button that goes
  through the check route that is already there and draws Pi's own answer.
- **The rows have no fields.** There is nothing to add and nothing to type: the model is seated by
  picking it in the Runs view, and the section says so in one clause rather than leaving an operator
  hunting for an Add button that does not exist.
- An empty list is its own line: the console was started without a key for any of Pi's own models. A
  failed read is another line, drawn verbatim, and neither takes the registry list off the page — the
  registry is what the operator came to edit.
- The section's heading becomes the view's name, Providers & models, since it now holds both lists.
- Every string the section draws goes through `expectPlainWords`: no flag names, no paths, no
  log file names. Pi's `1M` and `384K` are figures, not paths, and are quoted as Pi printed them.

## Acceptance

- The view lists each of Pi's models by its reference with Pi's own figures beside it, and a check on
  a row draws what Pi answered.
- An empty list and a failed read are each drawn as their own line, and neither removes the registry
  rows or the add form.
- The model rows hold no input fields, and every string the section draws passes `expectPlainWords`.

## Verification

```bash
pnpm test -- packages/ui/web
pnpm --filter @no-dice/ui build
pnpm typecheck
grep -q '/api/models' packages/ui/web/src/providers.ts
```
