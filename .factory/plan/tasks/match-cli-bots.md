---
id: match-cli-bots
title: no-dice match plays a match from the command line
milestone: 02-mcp-server-and-bots
depends_on: [match-runner-loop]
---

Add `packages/runner/src/cli.ts` exporting `runCli(argv)` and a `no-dice` `bin` entry in
`packages/runner/package.json`, implementing the command brief §1 asks for:
`no-dice match --game salient --a <spec> --b <spec> --seed <n> [--out <path>]`. `--game`
accepts only `salient` for now. A seat spec is `bot:random`, `bot:greedy` or
`<provider>/<model-id>`; a model spec must exit non-zero with a message saying the Pi
harness arrives in milestone 03, so nobody mistakes a missing feature for a crash. `--seed`
is required and must be a whole number; `--out` defaults to
`matches/<seed>-<a>-<b>.json` under the current directory, and the directory is created if
it is not there. Unknown flags, a missing value and a bad seed exit non-zero naming exactly
what is wrong, and a successful run prints the log path and one line with the result type,
winner and score. Keep argument parsing in its own module so milestone 03's `series`
subcommand and milestone 04's flags sit beside it.

## Acceptance
- [ ] `runCli(["match","--game","salient","--a","bot:greedy","--b","bot:random","--seed","135","--out",p])`
      writes a log at `p` that validates and prints the result
- [ ] An unknown flag, a missing `--seed` and a non-integer seed each exit non-zero with a
      message naming the problem
- [ ] `--a anthropic/claude` exits non-zero and says the Pi harness lands in milestone 03

## Verification
```bash
pnpm test -- cli
```
