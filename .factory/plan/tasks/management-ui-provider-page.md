---
id: management-ui-provider-page
title: The page shows a provider's entry, adds one, and checks its credential
milestone: 08-ui-providers-and-leaderboard
depends_on: [management-ui-provider-endpoints]
---

The browser half, following the split every other section of this console already uses —
`packages/ui/web/src/providers.ts` fetches and parses, `packages/ui/web/src/render-providers.ts`
draws, and the test is a `// @vitest-environment happy-dom` unit test over the renderer and the
parser, the way `render-results.test.ts` and `results.test.ts` are written.

The Providers section draws, for every entry `GET /api/providers` answers: the name, the base
URL, the api, the *name* of the key environment variable (or "no key checked"), whether it
streams reasoning, `contextWindow`, `maxTokens` and the four token rates. There is no field on
this page, and no request from it, that carries a key value: the form asks for the variable's
name, and the page never learns what is in it.

An add form beside the list — name, base URL, api, key variable name, reasoning, context window,
max tokens, and the four rates — posting to `POST /api/providers`. The page does not decide what
a valid entry is: it posts and shows whatever comes back, with the server's zod line rendered
verbatim, and re-reads the list on a success. A provider name already in the registry is refused
by the server, and the page shows that line rather than quietly replacing the entry.

A credential check per row: a small input for a model id and a button posting
`{ model: "<provider>/<id>" }` to `POST /api/providers/check`, rendering `ok`, Pi's `reason` and
`message` as they came back. It is the same question `no-dice series` asks before it plays a
turn, so an operator can find out that a key is missing without starting a run.

`render-frame.ts` stops drawing its own two-field provider list: like `#start`, `#progress` and
`#results`, the section belongs to its own module from here on, and a frame that redrew it would
be a frame that wiped the check the operator just asked for. `/api/state`'s name-only answer
still feeds the seat pickers in `render-start.ts`, unchanged.

`README.md`'s "The providers a model seat can be seated on" section gains two sentences: the
console (`no-dice-ui`) lists that same file and adds entries to it, and no key value is ever
in it or on the page.

## Acceptance
- [ ] The Providers section shows every entry's base URL, api, key-variable name, reasoning,
      context window, max tokens and four rates, and no field or request on the page carries a
      key value
- [ ] Adding an entry through the form leaves it schema-valid in the registry file and in the
      list; an entry the server refuses shows the server's own line and adds nothing
- [ ] A credential check renders what `checkPiAuth` answered for a `<provider>/<id>`, and
      `pnpm --filter @no-dice/ui build` and `pnpm typecheck` still pass

## Verification
```bash
pnpm test -- providers
pnpm test -- web
pnpm --filter @no-dice/ui build
pnpm typecheck
grep -q '/api/providers' packages/ui/web/src/providers.ts
grep -q 'apiKeyEnv' packages/ui/web/src/render-providers.ts
grep -q 'contextWindow' packages/ui/web/src/render-providers.ts
! grep -nE '(^|[^A-Za-z])(apiKey|secret|token)([^A-Za-z]|$)' packages/ui/web/src/providers.ts packages/ui/web/src/render-providers.ts
grep -qi 'no-dice-ui' README.md
! grep -qE 'providers-none|list\(\s*"providers"' packages/ui/web/src/render-frame.ts
```
