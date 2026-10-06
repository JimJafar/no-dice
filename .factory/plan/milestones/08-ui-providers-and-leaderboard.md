---
title: Providers and the leaderboard from the page
epic: management-ui
---

The two remaining halves of the console. **Providers**: the page lists what `providers.json`
holds (base URL, api, the *name* of the key environment variable, reasoning, `contextWindow`,
`maxTokens`, the four token rates — never a key value), adds an entry through the same zod schema
`packages/runner/src/providers.ts` already parses it with, and reports what `checkPiAuth` answers
for it. That package has to grow two things it does not have: the entry/registry schema is
currently module-private, and `providerRegistry()` caches the file once per process, so an
edit through the UI has to be written atomically, reloaded, and said.

**Leaderboard**: two views over the same records, computed with `@no-dice/stats` over the
`series.json` records under the series root and the logs they name — no new arithmetic, and the
same counted/missing rule `series-report.ts` already applies (a failed or voided match is
*missing*, not a loss). *Per pairing*: one row per series, equal to what
`no-dice stats --series <dir>` prints for it, with links to its report and its matches. *Per
model, pooled*: one row per model over the counted matches of every series under the root — win
rate with its 95% interval, matches counted and missing, and the seat split, so a model that only
wins from one seat is visible as that. A series started with `--dir` outside the root is not
listed. Done when both tables agree with the CLI to the digit, adding a provider leaves a
schema-valid entry with no key value anywhere, and the four existing gates plus `ui-build` pass.
