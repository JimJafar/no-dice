---
title: The UI starts a run and shows it
epic: management-ui
---

A new workspace package, `packages/ui` (`@no-dice/ui`): a bare-Node `node:http` server bound to
`127.0.0.1` and a Vite browser app with no framework, started from the repo root by its own
`no-dice-ui` bin. It starts a match or a series **in its own process** — `runCli(argv, { stdout,
stderr, cwd })` from `packages/runner/src/cli.ts`, whose argv is validated first by
`parseArgs` from `packages/runner/src/args.ts`, so the form cannot ask for a run the CLI would
reject — and shows the run's own output: the CLI's per-pair lines as they happen, plus pairs
played/remaining, matches played and failed, tokens and cost so far, and the stop reason and
final figures when it ends. Those counters come from the series' own `series.json`, which the
runner rewrites atomically at every batch boundary, so the page never invents a number.

Done when: the page's seat pickers list `bot:random`, `bot:greedy` and every provider in
`providers.json` and take a model id typed against one of them; a bot-versus-bot
match started from the page writes a `salient-log/1` file that then appears in the finished list
and opens in the existing viewer at `/viewer/?log=/logs/…` served by the same server; a
bot-versus-bot series shows its pair lines as they happen and ends with its stop reason and
figures; and a series interrupted by the server being closed is listed as resumable on restart,
and resuming it plays nothing already on disk. At most one run is in flight per process, and a
second start is refused with a line saying what is running. Closing the page never stops a run;
closing the server does, and the page says so.
