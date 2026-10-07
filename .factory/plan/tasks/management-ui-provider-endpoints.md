---
id: management-ui-provider-endpoints
title: The console lists a provider, adds one, and asks Pi about its credential
milestone: 08-ui-providers-and-leaderboard
depends_on: [management-ui-provider-registry-write]
---

The server half of the Providers section. New `packages/ui/src/providers.ts`, routed from
`packages/ui/src/server.ts`:

- `GET /api/providers` — every entry as `providers.json` holds it: `baseUrl`, `api`,
  `apiKeyEnv` (the *name*, or `null` for an endpoint that checks none), `reasoning`,
  `contextWindow`, `maxTokens` and the four `cost` rates, in registry order. **No key value is
  ever in the answer, and none exists to send**: the registry holds only variable names, and the
  route must not go and read `process.env[apiKeyEnv]` to be helpful. `/api/state` keeps its
  name-and-key-variable answer for the seat pickers; this is the detail view, reachable only
  on loopback like everything else this server does.
- `POST /api/providers` — `{ name, entry }`. There is no second validator here: the entry goes
  through `providerEntrySchema` exported by the previous task, so a field the schema does not
  name — including `apiKey` — is refused with zod's own line naming the field, and the file is
  left byte-identical. A good entry goes to `addProvider`, which writes it atomically, and the
  route then calls `reloadProviders(path)` so the next run this process starts seats on it and
  `/api/state` names it in the seat picker without a restart. The answer is the registry as it
  now stands on disk.
- `POST /api/providers/check` — `{ model }`, a `<provider>/<id>` typed by the operator as
  `--a` has always typed it. It calls
  `checkPiAuth({ model, modelsJson: seatModelsJson(model) ?? undefined })` — the exact call
  `packages/runner/src/cli.ts` makes before a run — and answers `{ ok, provider, reason,
  message }`. It plays no match and opens no connection: `pi auth check` reads configuration
  only, which is what makes it testable with no credential on the machine.

Both POSTs go through the same `originIsOurs` guard and the same `readBody` size cap the run
POSTs use, and answer 405 for any other method. A registry that does not parse is the same one
line `/api/state` already gives it, so the injected `registry` source keeps working.

**Which file is written.** `UiOptions.providersFile`, default `PROVIDERS_FILE`, is the file the
route writes and reloads, and `no-dice-ui` gains a `--providers <file>` flag for it (added to
`parseUiFlags` with the existing one-value, never-twice discipline, and resolved like the two
roots). `startServer` calls `reloadProviders(providersFile)` before it listens, so the file the
page writes is the file every run this process starts seats on — a console that wrote a
registry the runner never read would be a console that lied about what a run was seated on.

`packages/ui/package.json` gains `"@no-dice/harness": "workspace:*"` for `checkPiAuth`. `ui` is a
leaf of the workspace, so this adds no cycle, and
`main-workspace-packages-have-no-dependency-cycle` keeps it that way.

## Acceptance
- [ ] `GET /api/providers` answers each entry's base URL, api, key-variable *name*, reasoning,
      context window, max tokens and four rates, and nothing it answers carries a key value
- [ ] `POST /api/providers` with an entry the schema refuses is a 400 naming the field and
      leaves the registry file byte-identical; with a good entry the file holds it, the next
      `GET` lists it, and `/api/state` offers it as a seat
- [ ] `POST /api/providers/check` answers what `checkPiAuth` said for a `<provider>/<id>` —
      ready for a keyless entry, not ready with Pi's reason for one whose `apiKeyEnv` is not
      exported — and a cross-origin POST to either write route is refused

## Verification
```bash
pnpm test -- providers
rm -rf /tmp/nd-prov-api && mkdir -p /tmp/nd-prov-api/series
cp providers.json /tmp/nd-prov-api/providers.json
node packages/ui/src/server.ts --port 8796 --series-root /tmp/nd-prov-api/series \
  --providers /tmp/nd-prov-api/providers.json &
pid=$!
sleep 1
curl -fsS http://127.0.0.1:8796/api/providers | grep -q '"baseUrl":"https://marvin'
curl -fsS http://127.0.0.1:8796/api/providers | grep -q '"apiKeyEnv":null'
curl -fsS http://127.0.0.1:8796/api/providers | grep -q '"contextWindow":131072'
! curl -fsS http://127.0.0.1:8796/api/providers | grep -qiE '"(api_?key|token|secret)[":]'
code=$(curl -sS -o /tmp/nd-prov-api/bad.json -w '%{http_code}' -X POST -H 'content-type: application/json' \
  -d '{"name":"evil","entry":{"baseUrl":"not a url","api":"openai-completions","apiKey":"sk-nope","reasoning":false,"contextWindow":1,"maxTokens":1,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}}' \
  http://127.0.0.1:8796/api/providers)
test "$code" = 400
grep -qi 'apiKey' /tmp/nd-prov-api/bad.json
cmp -s /tmp/nd-prov-api/providers.json providers.json
curl -fsS -X POST -H 'content-type: application/json' \
  -d '{"name":"acme","entry":{"baseUrl":"https://acme.example.com/v1","api":"openai-completions","apiKeyEnv":"ACME_API_KEY","reasoning":false,"contextWindow":200000,"maxTokens":4096,"cost":{"input":3,"output":15,"cacheRead":0.3,"cacheWrite":3.75}}}' \
  http://127.0.0.1:8796/api/providers | grep -q '"acme"'
grep -q 'ACME_API_KEY' /tmp/nd-prov-api/providers.json
node -e 'JSON.parse(require("node:fs").readFileSync("/tmp/nd-prov-api/providers.json","utf8"))'
curl -fsS http://127.0.0.1:8796/api/state | grep -q '"acme"'
curl -fsS -X POST -H 'content-type: application/json' -d '{"model":"acme/m1"}' \
  http://127.0.0.1:8796/api/providers/check | grep -q '"ok":false'
curl -fsS -X POST -H 'content-type: application/json' -d '{"model":"marvin/subagent"}' \
  http://127.0.0.1:8796/api/providers/check | grep -q '"ok":true'
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'origin: http://evil.example' \
  -H 'content-type: application/json' -d '{"name":"x","entry":{}}' http://127.0.0.1:8796/api/providers)
test "$code" = 403
kill $pid
git diff --exit-code providers.json
```
