# Brief: Management UI

## Goal

A local web console for No Dice, so running a measurement does not mean remembering a
command line: start a match or a series from a form, choose seats from the bots and from the
providers that are configured, add a provider without editing JSON, watch a run's progress
while it plays, browse every finished match and open it in the replay viewer, and see a
leaderboard of how the models compare.

User: Jim, at his own machine, on loopback. This supersedes the "a web UI for launching
matches" line in brief §3 / `plan/spec.md` "out of scope for v0" — that line has to be
amended as part of this epic.

## In scope

- A new workspace package with a loopback-only Node HTTP server and a browser app, started
  from the repo root (a `no-dice ui` subcommand, or its own bin — planner's call).
- **Runs play in the UI's own process**, through the existing seams rather than by shelling
  out: `runCli` in `packages/runner/src/cli.ts` already takes injectable `stdout`/`stderr`, and
  `runSeries` already takes an `onPair` callback, so the progress the page shows is the very
  lines the terminal prints. No child `no-dice` process.
- **A run does not have to survive the UI stopping.** Closing the page must not stop a
  run; closing the *server* does, and the page says so. Reopening it finds the series on disk
  and offers to resume it — the same series directory, so `series-plan.ts` replays nothing
  that already has a log.
- **Start a run**: game (salient), seat A and seat B chosen from `bot:random`,
  `bot:greedy` or `<provider>/<model>` from the registry; seed / seed-base; `--max-pairs`,
  `--max-tokens`, `--max-cost`, `--concurrency`, series name. A model seat is **typed by hand**
  (`<provider>/<id>`, the provider picked from the registry) — no call to a provider's
  `/v1/models`. The form's validation reuses `packages/runner/src/args.ts`, so the UI cannot
  ask for a run the CLI would reject.
- **Providers**: list what `providers.json` holds, add an entry (baseUrl, api, `apiKeyEnv`
  name, reasoning, contextWindow, maxTokens, four token rates) validated by the same zod
  schema `providers.ts` uses, and a credential check that reports what `checkPiAuth` answers.
- **Progress**: while a run is in flight, the page shows the run's own
  output — the CLI's per-pair line (seed, both seat orders, both results, running win rate and
  its interval) — plus pairs played/remaining, matches played and failed, tokens and cost so
  far, and the stop reason when it ends.
- **Results**: every series under the series root with its `report.md` figures, and every
  finished match log, each openable in the existing viewer through its `?log=` path
  served by the same server. A series whose run is not in flight is offered as *resume*.
- **Leaderboard, two views over the same records** (Jim asked for both), computed with
  `@no-dice/stats` over the `series.json` records and the logs they name — no new arithmetic,
  and the same counted/missing rule `series-report.ts` already applies (a failed or voided
  match is *missing*, not a loss). The series root is a fixed directory, `series/` by default;
  a series started with `--dir` outside it is not listed.
  - *Per pairing*: one row per series — the two seats, win rate with its 95% Wilson interval,
    pairs and matches played, missing matches and why, the stop reason and whether it stopped
    early, and links to its report and its matches.
  - *Per model, pooled*: one row per model over the counted matches of every series under the
    root — win rate with its 95% interval, matches counted and missing, and the seat split, so
    a model that only wins from one seat is visible as that.

## Out of scope

- Anything beyond one user on one machine: auth, sessions, HTTPS, hosting.
  The server binds `127.0.0.1`.
- Live per-turn streaming of a match in progress (brief §3 stays out of scope). Progress is
  per pair and per match.
- Changing the engine, the MCP server, the Pi harness, `salient-log/1`, or the viewer's replay
  code. The viewer stays log-only — its `module-graph.test.ts` must keep passing.
- Ratings, leagues or Elo across models; the leaderboard is the win-rate arithmetic that
  already exists.
- New games, more than two seats, rules or prompt changes. The epic does amend the two places
  that say a launching UI is out of scope — `salient/docs/salient-build-brief.md` §3 and the
  table row in `docs/viewer-notes.md` — and nothing else in the docs.

## Constraints

- Node 22+, bare-Node TypeScript with file-named imports, no build step for the server side;
  the browser side is Vite like the viewer, with its own tsconfig project (the root
  `tsconfig.base.json` has no DOM lib).
- Prefer what is already in `pnpm-lock.yaml` (Vite, happy-dom, zod). No new framework unless
  the planner argues for one.
- **No key value anywhere in the repo, in a log, or in the browser.** `providers.json` names
  the environment variable only; the registry is read once per process, so an edit through the
  UI has to be reloaded and said.
- A real series is ~48 h and ~688 M tokens (`docs/pi-harness-notes.md` §7): the UI shows the
  ceilings it is starting a run under, and no test may play a real model match. Bot-versus-
  bot matches take ~1.3 s, so those are what a test may start.
- At most **one run in flight per UI process**, since `--concurrency` already bounds *pairs*
  and no provider's rate limit has been measured (`docs/pi-harness-notes.md` §7). A second
  start is refused with a line saying what is running; a queue is out of scope.
- The four gates in `.factory/project.yaml` keep passing; a new gate for building the UI app
  is expected, beside the existing `viewer-build`.

## Acceptance

1. Starting the UI from the repo root serves a page on `127.0.0.1` whose seat pickers list
   `bot:random`, `bot:greedy` and every provider in `providers.json`, and which takes a model
   id typed against one of them.
2. Starting a bot-versus-bot match from the page writes a `salient-log/1` file, and that match
   then appears in the finished list and opens in the viewer.
3. Starting a bot-versus-bot series shows its pair lines as they happen and ends with the
   stop reason and the final figures. Stopping the server mid-series and starting it again
   lists that series as resumable, and resuming it plays nothing already on disk.
4. Adding a provider through the page leaves a schema-valid entry in `providers.json` with no
   key value, and the credential check reports what Pi answers for it.
5. The per-pairing row for a series equals what `no-dice stats --series <dir>` prints for it,
   and the pooled per-model row for a single-series disk equals that series' win rate, interval
   and missing count.
6. `pnpm typecheck`, `pnpm test`, the reference replay and the viewer build pass,
   plus a new gate that builds the UI app.

## Open questions

None. Settled along the way: runs play in the UI's own process, and a run does not have to
survive the UI server being restarted (restarting resumes from disk); the leaderboard shows
both a per-pairing table and a pooled per-model table; model ids are typed by hand.
