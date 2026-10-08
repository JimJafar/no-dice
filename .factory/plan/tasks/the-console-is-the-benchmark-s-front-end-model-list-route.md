---
id: the-console-is-the-benchmark-s-front-end-model-list-route
title: The console lists the models Pi itself can seat
milestone: 11-seats-providers-and-starting-runs
depends_on:
  - the-console-is-the-benchmark-s-front-end-pi-model-catalog
type: code
---

The console knows the providers an operator registered. It says nothing about the models Pi knows
natively — `deepseek/deepseek-flash` and the rest — which are the cheapest seats to take, because
they need no registry entry, no base URL and no key variable typed. `listPiModels` now asks the
pinned Pi for that list; this task puts it behind a route and makes the credential check mean what a
seat will find.

**`GET /api/models`** in a new `packages/ui/src/models.ts`, answering
`{ models: [{ provider, id, reference, context, maxOut, thinking, images }] }` from `listPiModels()`
with no `env` option, so the child inherits the console's own environment. That is the honest
environment: the seats this console starts get exactly that one, which is why
`scripts/console-daemon.sh` pulls the key variables in before it execs the server. The page says the
list is the models *this console* has a key for, not the models the machine has keys for.

**It is a separate route from `/api/state` on purpose.** `/api/state` is read on every page load and
answers from memory; this costs a subprocess of about 0.7 s, so the two views that need it ask for it
themselves, once, and nothing polls it.

**No key value crosses it, and it names no key variable either.** The rows carry providers, model ids
and Pi's own figures. Pi's answer does not name variables, and listing which of this process's
environment variables happen to be set would tell a stranger on loopback more than the registry does.

**The credential check has to be asked in the condition a seat is in.** Today
`checkCredential` in `packages/ui/src/providers.ts` passes `seatModelsJson(model) ?? undefined`, and
`checkPiAuth` with no `models.json` runs `pi auth check` with the *inherited* `PI_CODING_AGENT_DIR` —
the operator's own `~/.pi/agent`. A seat gets an empty relocated directory instead
(`createSeatHome`), so for a model the registry does not name, the check can answer `ready` from an
OAuth login in the operator's own `auth.json` that the seat will never see, and the run the page
just encouraged then fails. Ask both branches in a fresh empty directory — which is what
`askWithModelsJson` already does when there is a `models.json` — so the answer means what the seat
will find. `packages/harness/src/pi-auth.test.ts` pins the old question; changing it is part of this
task, because the question changed. Measured on the pinned build: with `DEEPSEEK_API_KEY` set and
`PI_CODING_AGENT_DIR` at an empty directory, `pi auth check --provider deepseek --json` answers
`{"status":"ready","provider":"deepseek","authType":"api_key"}`.

A model the registry *does* name keeps its existing behaviour exactly: the check passes that entry's
`models.json` and asks about that provider.

A failure from Pi is a 500 carrying the line, drawn verbatim by the page. The README's console
paragraph names the model list alongside the provider routes, since the README describes what is
there.

## Acceptance

- A console started with `DEEPSEEK_API_KEY` in its environment answers `GET /api/models` with
  `deepseek/deepseek-flash`; one started with no key answers an empty list, and neither answer
  carries a key value.
- `POST /api/providers/check` for `deepseek/deepseek-flash` answers what Pi said with no registry
  entry naming `deepseek`, and it is asked with `PI_CODING_AGENT_DIR` at an empty directory, as a
  seat would be.
- The existing provider routes are unchanged, every existing API test still passes, and the README
  names the model list.

## Verification

```bash
pnpm test -- packages/ui/src packages/harness/src/pi-auth
tmp=$(mktemp -d); mkdir -p "$tmp/series" "$tmp/matches"; echo '{}' > "$tmp/providers.json"
DEEPSEEK_API_KEY=dummy node packages/ui/src/server.ts --port 8814 --series-root "$tmp/series" \
  --matches-root "$tmp/matches" --providers "$tmp/providers.json" > "$tmp/console.log" 2>&1 &
srv=$!; sleep 1
curl -fsS -H 'origin: http://127.0.0.1:8814' http://127.0.0.1:8814/api/models | tee "$tmp/models.json" \
  | grep -q 'deepseek-flash'
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const m = r.models.find((each) => each.reference === "deepseek/deepseek-flash");
if (!m || m.provider !== "deepseek" || m.id !== "deepseek-flash") throw new Error(JSON.stringify(r));
if (JSON.stringify(r).includes("dummy")) throw new Error("a key value crossed the route");
' "$tmp/models.json"
curl -fsS -X POST -H 'content-type: application/json' -H 'origin: http://127.0.0.1:8814' \
  -d '{"model":"deepseek/deepseek-flash"}' http://127.0.0.1:8814/api/providers/check \
  | grep -q '"status":"ready"'
kill "$srv"
env -u DEEPSEEK_API_KEY node packages/ui/src/server.ts --port 8815 --series-root "$tmp/series" \
  --matches-root "$tmp/matches" --providers "$tmp/providers.json" > "$tmp/quiet.log" 2>&1 &
srv=$!; sleep 1
! curl -fsS -H 'origin: http://127.0.0.1:8815' http://127.0.0.1:8815/api/models | grep -q 'deepseek-flash'
kill "$srv"
grep -q '/api/models' README.md
```
