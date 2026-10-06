---
id: main-pi-seat-prompt-and-turn-timeout-are-tested
title: A Pi seat's system prompt and its turn timeout are pinned by tests
milestone: 06-first-real-series
depends_on: []
---

Two claims this project leans on are asserted only loosely.

**1. "The player prompt is the model's only system prompt."** In
`packages/harness/src/stub-model.test.ts` (line ~591) the test asserts `systemPrompts` has length 1
and that the one entry *contains* two phrases from `games/salient/prompts/player-system.md`. Pi 1.0
appends its own `<cwd>` section to the system prompt, so the entry is not the player prompt and the
`toContain` assertions cannot see what else Pi put on the end. Make the test say what it means:
strip the `<cwd>` section Pi appends — read the recorded request body to get its exact shape — and
assert the remainder is **equal** to the text of `games/salient/prompts/player-system.md` (if Pi
adds or removes a trailing newline, normalise that and say so in the comment). Keep the length-1
assertion: one system message, and its content is the player prompt plus Pi's own section and
nothing else.

Record the finding in `docs/pi-harness-notes.md` §6 ("The tool lock-down held for the whole
match"), which is where the lock-down claim lives: Pi 1.0.2 hands the model one system prompt,
the player file with a `<cwd>` section appended, so the seat is offered no other system text and
nothing of the repository's. That matters because the series compares models on identical prompts:
whatever Pi adds, it adds the same way to both seats, and the test is what keeps that from silently
becoming something else.

**2. A Pi seat whose turn runs out the runner's clock.** `packages/runner/src/model-seat.test.ts`
proves `provider_error` and `token_budget` — the reasons the seat itself reports — and the abort of
a seat still running after it submitted. It never proves the runner's own deadline on a Pi seat:
`turnTimeoutMs` firing on a seat that is busy and has not submitted. Add that test, following the
shape of the two pass-reason tests a little above line 293:

- a stub scripted with `sleepsPastDeadline(60_000)` from `@no-dice/harness`,
- `runMatch` with `config: { ...DEFAULT_CONFIG, turns: 1 }` and `turnTimeoutMs: 1_500`, the Pi seat
  in A and Greedy in B,
- assert `log.turns[0].players.A.passed === "timeout"` — not `no_submission`, which is what the
  server alone would guess — that `tool_calls` is empty, and that `wall_ms` is at least the
  timeout, and that the match still wrote a log with the bot's turn in it.

Both tests are Pi-process tests and carry the file's `SEAT_TIMEOUT_MS` like their neighbours.

## Acceptance
- [ ] The stub-model test asserts the recorded system prompt equals the player prompt once Pi's
      appended `<cwd>` section is stripped, and still asserts there is exactly one
- [ ] `docs/pi-harness-notes.md` §6 records what Pi 1.0 appends to the system prompt and
      why that is not a second prompt
- [ ] `model-seat.test.ts` has a case where a stub sleeps past `turnTimeoutMs` and the log records
      that seat's turn as `passed: "timeout"`

## Verification
```bash
pnpm test -- stub-model model-seat
# The prompt test has to name what it strips, and the notes have to record it.
test "$(grep -ci cwd packages/harness/src/stub-model.test.ts)" -gt 1
grep -qi cwd docs/pi-harness-notes.md
grep -q 'toBe("timeout")' packages/runner/src/model-seat.test.ts
```
