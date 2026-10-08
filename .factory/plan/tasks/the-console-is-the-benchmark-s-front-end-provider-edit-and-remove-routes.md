---
id: the-console-is-the-benchmark-s-front-end-provider-edit-and-remove-routes
title: The console can change and delete a provider
milestone: 11-seats-providers-and-starting-runs
depends_on:
  - the-console-is-the-benchmark-s-front-end-registry-update-and-remove
type: code
---

`packages/ui/src/providers.ts` answers the console's provider routes today — list, add, check — and
`addProviderEntry` is its only write. The view is meant to manage providers rather than only add
them, so two routes are wanted, and each takes the guards the add route already has.

- `POST /api/providers/update`, body `{"name": ..., "entry": ...}` → a new `updateProviderEntry`
  beside `addProviderEntry`, which calls the runner's `updateProvider`, hands what the file now
  holds to `reloadProviders` exactly as add does, and answers the rows as the file now stands.
- `POST /api/providers/remove`, body `{"name": ...}` → `removeProviderEntry`, same shape.

**Both go through `postedJson`**, so the Origin guard and the body cap apply as they do to every
write, and neither is reachable from a page on another domain.

**Both refuse while a run is in flight**, with the same 409 and the same sentence
the add route gives. The registry is what a seat is read out of, and a series that is halfway
through must not have the provider of its next pair changed or deleted under it. The refusal is the
route's answer, not the page's: a terminal and this console share one `providers.json`.

**Both refuse when the registry is the file the console was not given**, which is what
`providersWritable` already means for add, and both answer a bad request with the runner's own line
in `error` — an unknown name, an entry that fails the schema — so the page can draw the refusal
verbatim instead of inventing one.

**Neither route takes a key value.** An entry's key is a variable's name or null, as `addProvider`'s
is, and the schema refuses anything else before a byte is written.

`GET /api/state` keeps naming providers and their key variables and nothing else. Pi's own models are
a separate read (a later task), because answering them costs a subprocess and `/api/state` is read on
every page load.

The README's console paragraph says the view edits and removes as well as adds; the milestone's rule
is that the README describes what is there, not what is planned.

## Acceptance

- `POST /api/providers/update` changes one entry, the file on disk carries the new one, and the next
  `GET /api/providers` lists it; `POST /api/providers/remove` deletes it and the next list does not
  name it.
- Both answer 409 while the console has a run in flight, and 400 carrying the runner's line when the
  name is not in the registry, with the file unchanged.
- The README's console paragraph names edit and remove alongside add.

## Verification

```bash
pnpm test -- packages/ui/src/providers packages/ui/src/server
tmp=$(mktemp -d); mkdir -p "$tmp/series" "$tmp/matches"
cat > "$tmp/providers.json" <<'JSON'
{
  "one": {
    "baseUrl": "https://a.example/v1",
    "api": "openai-completions",
    "apiKeyEnv": "ONE_KEY",
    "reasoning": false,
    "contextWindow": 1000,
    "maxTokens": 100,
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
  }
}
JSON
node packages/ui/src/server.ts --port 8813 --series-root "$tmp/series" --matches-root "$tmp/matches" \
  --providers "$tmp/providers.json" > "$tmp/console.log" 2>&1 &
srv=$!; sleep 1
post() {
  curl -s -o "$tmp/last.json" -w '%{http_code}' -X POST \
    -H 'content-type: application/json' -H 'origin: http://127.0.0.1:8813' -d "$2" \
    "http://127.0.0.1:8813$1"
}
# A run in flight refuses both writes.
curl -s -o /dev/null -X POST -H 'content-type: application/json' -H 'origin: http://127.0.0.1:8813' \
  -d '{"game":"salient","a":"bot:greedy","b":"bot:random","maxPairs":"1"}' \
  http://127.0.0.1:8813/api/run/series
for route in update remove; do
  body='{"name":"one"}'
  [ "$route" = update ] && body='{"name":"one","entry":{"baseUrl":"https://c.example/v1","api":"openai-completions","apiKeyEnv":"ONE_KEY","reasoning":false,"contextWindow":1000,"maxTokens":100,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}}'
  code=$(post "/api/providers/$route" "$body")
  test "$code" = 409 || { echo "$route during a run answered $code"; cat "$tmp/last.json"; exit 1; }
done
sleep 6
# An unknown name is refused, and the file does not move.
code=$(post /api/providers/remove '{"name":"nope"}')
test "$code" = 400 || { echo "an unknown name answered $code"; exit 1; }
grep -q '"one"' "$tmp/providers.json"
# Then both writes land.
code=$(post /api/providers/update '{"name":"one","entry":{"baseUrl":"https://c.example/v1","api":"openai-completions","apiKeyEnv":null,"reasoning":true,"contextWindow":2048,"maxTokens":256,"cost":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0}}}')
test "$code" = 200 || { echo "update answered $code"; cat "$tmp/last.json"; exit 1; }
grep -q 'https://c.example/v1' "$tmp/providers.json"
curl -fsS -H 'origin: http://127.0.0.1:8813' http://127.0.0.1:8813/api/providers | grep -q 'https://c.example/v1'
code=$(post /api/providers/remove '{"name":"one"}')
test "$code" = 200 || { echo "remove answered $code"; exit 1; }
grep -q '"one"' "$tmp/providers.json" && { echo "the entry is still in the file"; exit 1; }
curl -fsS -H 'origin: http://127.0.0.1:8813' http://127.0.0.1:8813/api/providers | grep -q 'one' && { echo "the list still names it"; exit 1; }
kill "$srv"
grep -q '/api/providers/update' README.md
grep -q '/api/providers/remove' README.md
git diff --quiet providers.json
```
