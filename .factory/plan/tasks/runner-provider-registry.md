---
id: runner-provider-registry
title: A model seat runs on a provider the repo names
milestone: 06-first-real-series
depends_on: []
---

Close the gap between milestone 03's measured match and a real series: today only an operator
script knows how to reach a provider that is not one of Pi's built-ins.

`seatSpec(SeatArg)` in `packages/runner/src/match.ts` builds `{ kind: "pi", model, thinking }`
and never sets `modelsJson`, so a seat on such a provider starts with no `models.json` entry,
and `checkPiAuth` (`packages/harness/src/pi-auth.ts`) stops the run with "give the seat the
provider's key in its environment, or name the provider in its models.json". `no-dice match`
and `no-dice series` therefore seat built-in providers only. The one provider this box has
actually played on — Marvin — is named in a table inside `scripts/measure-match.mjs`:
`baseUrl https://marvin.akita-betgeuse.ts.net:8033/v1`, `api: "openai-completions"`,
`apiKey: "none"` (the documented pattern for a keyless server), `reasoning: true`,
`contextWindow: 131072` and `maxTokens: 8192` (both **decisions**, because `/v1/models`
reports neither), and every token rate 0.

Move that entry into a committed registry the CLI reads — one JSON file, by convention
`providers.json` at the repo root — mapping a provider name to the `models.json` entry a seat
gets, and have `seatSpec` attach the resulting `modelsJson` when the provider is listed. A key
is never in the file: the registry names the **environment variable** holding it, and the value
is read when the seat starts; a keyless provider keeps `"apiKey": "none"`. A provider the
registry does not name falls through to Pi's built-in lookup exactly as it does now, so
`--a anthropic/<id>` with `ANTHROPIC_API_KEY` exported keeps working. `contextWindow`,
`maxTokens` and the token rates have to be in a committed file because they decide what the
log header records (`players.<seat>.context_window`), what `--max-cost` means (0 on unpriced
hardware, which is why `--max-tokens` exists) and what a rerun has to match to be the same
match. Point `scripts/measure-match.mjs` at the same registry instead of its own copy.

Add whichever providers Jim names for the series (their exact IDs, base URLs, context windows
and rates) to the same file; the entry for Marvin is already known and is the one the tests can
exercise offline.

## Acceptance
- [ ] A `--a <provider>/<id>` seat whose provider is in the registry is given that provider's
      `models.json` entry, and no test needs a network, a key or a live provider
- [ ] A provider the registry does not name is still seated through Pi's built-in lookup,
      unchanged
- [ ] The provider entry a real run plays on — base URL, key variable, `contextWindow`,
      `maxTokens`, token rates — lives in one committed file that `scripts/measure-match.mjs`
      also reads

## Verification
```bash
pnpm test -- providers
```
