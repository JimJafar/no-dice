---
id: pi-model-seat-cli
title: no-dice match seats a model
milestone: 03-pi-harness
depends_on: [pi-turn-rules]
---

Let a seat be a model. `SeatSpec` in `packages/runner/src/match.ts` is a bot today; add a Pi
seat (`{ kind: "pi", model: "<provider>/<id>", thinking }`) and build a `PiPlayer` for it, so
`no-dice match --game salient --a anthropic/claude-x --b bot:greedy --seed 135` — the command
brief §1 asks for — plays. The log header then carries what the frozen format has room for:
`harness.pi_version` from `piCli().version`, and `players.<seat>` as
`{ kind: "pi", model, thinking, context_window }`, the window coming from Pi's own
`contextUsage.contextWindow`. `withHarness` currently writes zeros for `usage`, `cost_usd`,
`context_tokens` and `compacted`; take those from the seat's `TurnOutcome` instead, and let a
Pi seat report its own pass reason rather than having the runner guess between `timeout` and
`no_submission`.

Two rules only the runner can implement go in the turn loop, because only it can see
`matches.status(matchId)`: when a seat has an accepted submission but its agent is still
running, wait 10 seconds and then `abort()`; and a seat whose turn the runner aborts is aborted
through `Player.abort()`, the path task `pi-turn-rules` opened, and never by restarting the
seat. Before a match
starts, resolve the credentials the way brief §6.3 does — `pi auth check --provider <name>
--json` — and fail with one clear line rather than letting the first turn die on a provider
error. Give the Pi seat an option for extra `models.json` and extra environment so a test can
point it at the stub provider: the gate must keep running with no credentials.

## Acceptance
- [ ] A match with a stub-model seat and a Greedy seat plays all 25 turns and writes a log that
      validates against `salient-log/1`
- [ ] That log's header names the pinned pi version, the model, the thinking level and the
      context window, and each of its turns carries that seat's usage, cost and context size
- [ ] A seat that has submitted but is still running is aborted 10 seconds later (shortened in
      the test) and its turn is recorded as played, not passed

## Verification
```bash
pnpm test -- model-seat
```
