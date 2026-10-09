---
id: the-console-is-the-benchmark-s-front-end-kept-report-routes
title: The console serves the report and the rules evidence it keeps
milestone: 12-matches-and-leaderboard-detail
depends_on: []
---

`docs/series-notes.md` §7 keeps two copies of every finished series outside the
gitignored `series/` directory, so they outlive a workspace: `reports/series/<name>.md`,
the report, and `reports/series/<name>-evidence.md`, the rules evidence, each named after
the series' own directory name. The console serves only what is under the two roots it
already has, so the report a reader can reach from the page is the runner's copy at
`/logs/<series>/report.md` — a file that is gone the moment the workspace is — and the
evidence is not reachable at all. The leaderboard's detail has nothing durable to link
until the console is given a third root.

Add `--reports-root <dir>` to `packages/ui/src/args.ts`, defaulting to `reports/series`
and resolved relative to `cwd` exactly as `--series-root` and `--matches-root` are; it
joins the flag list, the `USAGE` text and the test that pins that usage line. Carry
it on `UiOptions` and `UiConfig` in `packages/ui/src/server.ts` (and on `UiRoots` if the
module that later stats these files takes one), and serve it at `/reports/` through the
same `resolveStatic` refusal the `/logs/` route uses — `.md` is already in `contentTypeOf`,
so a report arrives as text a browser shows. A kept copy that is not there is answered
with one line in the console's own words, the way a series interrupted before it wrote
its report already is; nothing is added to `/api/series` or `/api/leaderboard`, because
these two URLs follow from the series' name and the route that is asked can say whether
the file exists.

## Acceptance

- `no-dice-ui --reports-root <dir>` serves `<dir>/<name>.md` at `/reports/<name>.md` and
  `<dir>/<name>-evidence.md` at `/reports/<name>-evidence.md`, as text a browser shows,
  and with no flag the root is `reports/series` under the console's working directory.
- A request that climbs out of that root — percent-decoded, dot segments, or a symlink
  planted inside it — is refused the way the `/logs/` route refuses one, and a kept copy
  that is not there is one readable line rather than a stack.
- Every route that existed before answers exactly as it did, and the four gates pass.

## Verification
```bash
grep -q -- '--reports-root' packages/ui/src/args.ts
grep -q 'REPORTS_PREFIX' packages/ui/src/server.ts
pnpm test -- args static results
tmp=$(mktemp -d); mkdir -p "$tmp/series" "$tmp/matches"
node packages/ui/src/server.ts --port 8817 --series-root "$tmp/series" --matches-root "$tmp/matches" > "$tmp/console.log" 2>&1 &
srv=$!; sleep 1
curl -fsS -H 'origin: http://127.0.0.1:8817' http://127.0.0.1:8817/reports/deepseek-flash-vs-greedy.md | grep -q 'salient'
curl -fsS -H 'origin: http://127.0.0.1:8817' http://127.0.0.1:8817/reports/deepseek-flash-vs-greedy-evidence.md | grep -q 'salient'
curl -sS -H 'origin: http://127.0.0.1:8817' http://127.0.0.1:8817/reports/no-such-series.md | grep -qi 'no '
curl -fsS -H 'origin: http://127.0.0.1:8817' http://127.0.0.1:8817/reports/%2e%2e%2fpackage.json > "$tmp/escape.txt" 2>&1 || true
grep -q 'no-dice' "$tmp/escape.txt" && echo "a climb out of the reports root served a file" && exit 1
kill "$srv"
pnpm typecheck
```
