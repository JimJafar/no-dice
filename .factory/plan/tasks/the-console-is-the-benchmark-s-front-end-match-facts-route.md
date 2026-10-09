---
id: the-console-is-the-benchmark-s-front-end-match-facts-route
title: A route answers what each finished match was
milestone: 12-matches-and-leaderboard-detail
depends_on: []
---

`GET /api/matches` answers `name`, `path`, `url`, `viewerUrl` and `series` for every
finished log, and nothing else: the console cannot say who played, who won, on what
seed, or when, because the only thing it reads of a log is its name. Add a new
module, `packages/ui/src/match-facts.ts`, and a new route, `GET /api/match-facts`,
leaving `/api/matches` exactly as it is — its rows are pinned field by field in
`packages/ui/src/results.test.ts` and `packages/ui/src/server.test.ts`, and the
milestone's rule is that a view which needs more asks a new route.

Walk the same two roots `matchRows` walks (`packages/ui/src/results.ts`) so the facts
line up one for one with the rows the listing already gives — the same `url`, the same
`viewerUrl`, the same `series` (a series' directory name, or `null` for a log that is
only under the matches root) — and read each log through the stats package's own reader
(`readLogOf`, which tries the paths a record names and parses with `matchLogSchema`)
rather than a second parser. Each row carries: `seed`, `created`, the two seats as
`playerLabel` spells a seat, `winner` as the winning seat's label or `null` for a draw,
`score` as `{A, B}`, the result's `type`, `turn` and `margin`, beside the three URLs.
A log that is not there or will not parse is one entry in `unreadable` with the line it
failed on, exactly as an unreadable series record already is, and every other log is
still listed.

One fact worth knowing before writing it: a series record already names each played
match's seed, winner, result type and margin, but not its final score and not the day it
was played — those two are only in the log header and its `result.score`. So the facts
cannot come from `series.json` alone, and the route reads the logs.

The cost is the reason this is its own route: it reads every log of every series under
the roots, about a megabyte each (`docs/pi-harness-notes.md` §7). One pass, one read
per log, and a route the page asks at the listings' clock — opened, and when a run ends
— never on a poll. Do not try to read only the head and tail of a file to save that: the
key order is the writer's, not the format's.

## Acceptance

- `GET /api/match-facts` answers one row per finished log under either root, each
  naming its two seats, the winner's label (`null` for a draw), the final score, the
  seed and the `created` timestamp, beside the `url`, `viewerUrl` and `series`
  `/api/matches` already gives for that same log.
- For one disk, the fact rows and the `/api/matches` rows are the same logs with the
  same URLs in the same order, and a log under the matches root alone has `series: null`.
- A log that is missing or will not parse is in `unreadable` with the line it failed on
  and changes nothing else; the four gates pass.

## Verification
```bash
grep -q '/api/match-facts' packages/ui/src/server.ts
pnpm test -- match-facts
tmp=$(mktemp -d); mkdir -p "$tmp/matches"
node packages/ui/src/server.ts --port 8816 --matches-root "$tmp/matches" > "$tmp/console.log" 2>&1 &
srv=$!; sleep 1
curl -fsS -H 'origin: http://127.0.0.1:8816' http://127.0.0.1:8816/api/match-facts > "$tmp/facts.json"
curl -fsS -H 'origin: http://127.0.0.1:8816' http://127.0.0.1:8816/api/matches > "$tmp/list.json"
kill "$srv"
node -e '
const fs = require("fs");
const facts = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).matches ?? [];
const urls = new Set((JSON.parse(fs.readFileSync(process.argv[2], "utf8")).matches ?? []).map((m) => m.url));
if (facts.length === 0) throw new Error("no match facts at all");
for (const m of facts) {
  if (!urls.has(m.url)) throw new Error("a fact whose url the listing does not give: " + JSON.stringify(m));
  if (!m.seats || !m.seats.A || !m.seats.B) throw new Error("a row without two seats: " + JSON.stringify(m));
  if (typeof m.score?.A !== "number" || typeof m.score?.B !== "number") throw new Error("a row without a score: " + JSON.stringify(m));
  if (!Number.isInteger(m.seed)) throw new Error("a row without a seed: " + JSON.stringify(m));
  if (!m.created || Number.isNaN(Date.parse(m.created))) throw new Error("a row without a date: " + JSON.stringify(m));
  if (!("winner" in m) || !m.viewerUrl) throw new Error("a row without a winner or a replay link: " + JSON.stringify(m));
}
if (!facts.every((m) => m.series === null || typeof m.series === "string")) throw new Error("a row that says nothing about its series");
' "$tmp/facts.json" "$tmp/list.json"
pnpm typecheck
```
