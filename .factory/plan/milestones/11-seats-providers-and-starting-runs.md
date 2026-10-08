---
title: Seats, providers and starting a run
epic: the-console-is-the-benchmark-s-front-end
---

The Providers & models view manages rather than appends. `packages/runner/src/providers.ts` has
`addProvider` and nothing else, so it gains the update and the removal, and the view gains
edit and remove per row alongside the add form and the credential check that already exists
(`checkPiAuth` in `packages/ui/src/providers.ts` asks the pinned Pi CLI for one line with a
relocated `PI_CODING_AGENT_DIR`). Writes keep refusing while a run is in flight, and the console
still never touches `~/.pi/agent/models.json` — `providers.json` is the only file it writes.

The view also lists the models Pi knows natively whose key variable is set in the
console's environment. That is `node <pinned cli> --list-models` run with `PI_CODING_AGENT_DIR`
pointed at an empty temporary directory, the way `askWithModelsJson` already runs it: with an
empty directory the catalog is Pi's built-in one and only the models with a usable key come back
(measured 0.7 s with `DEEPSEEK_API_KEY=dummy`: `deepseek deepseek-flash`, `deepseek
deepseek-v4-pro`). The empty directory is not a detail — without it the operator's own
`~/.pi/agent/models.json` entries appear too, and a seat cannot reach those, because
`createSeatHome` relocates `PI_CODING_AGENT_DIR` for every seat it starts.

The Runs view then starts a run a person meant. The seat pickers offer all three kinds — a
scripted bot, a provider from the registry, one of Pi's own models, which needs no key variable
named because Pi already has it — and the form's defaults are the benchmark's, not the CLI's:
five pairs, one pair at a time, no ceiling, with turn timeout, seed base and the ceilings behind
an advanced block that starts closed. The estimate stops quoting the fixed 11 minutes and 100 000
tokens per match from `docs/pi-harness-notes.md` §7 and works from what the series under the
root actually measured — the turns, tokens, cost and wall time the stats package already reports
per model — and says which matches it measured, falling back to the documented figure, cited,
when nothing under the root has been played yet.

Done when a provider can be added, edited and removed from the view with the credential check
reporting what Pi said, when the model list is Pi's built-in models with a usable key and each
one can be seated without a path or a key variable being typed, when the form opens with
five pairs and no ceiling and the estimate names the series it measured, and when every
existing API test still passes.
