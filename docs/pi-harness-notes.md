# Pi harness notes

Answers to brief §6.3's **"Verify on first run"** list, recorded from a real run
rather than from Pi's documentation. Milestones 04 (series runner) and 06 (first
real series) quote these.

Everything under "the scripted match" comes from one run of
`packages/harness/src/pi-long-match.test.ts`:

```bash
pnpm test -- pi-long-match
```

Pi is `@earendil-works/pi-coding-agent` **1.0.2**, driven in RPC mode
(`pi --mode rpc`) as one child process per seat. The seat's model is
`StubModel` on loopback, which records every request body it is sent. The match
is seed **135** under `DEFAULT_CONFIG` (25 turns), seat A the Pi seat, seat B the
Greedy bot. The match ran its 25 turns out and ended by time, B winning 89–1.

The provider-dependent lines of the checklist — cache reads on Jim's Marvin
server, and what happened to that model's reasoning output — are answered by the
real match in section 7, played with `scripts/measure-match.mjs`.

---

## 1. The MCP connection stays up for all 25 turns of one RPC session

**Yes.** The seat's MCP traffic was watched by a loopback proxy in front of the
match server, and across the whole match it saw:

| | |
| --- | --- |
| MCP sessions opened (`initialize`, no `mcp-session-id`) | **1** |
| Distinct `mcp-session-id` values used | **1** |
| HTTP requests through the watched connection | 55 |
| Tool calls the seat made, all of them over that connection | 51 (3 on turn 1, 2 on each of turns 2–25) |

No reconnect, and no second session id. The other half of the checklist item —
no seat-token rotation — holds by construction and was checked at the end:
`MatchServer.resolveToken(tokenA)` still answers `{ matchId, seat: "A" }`. The
runner only re-tokens a seat whose attempt *replaces the connection*
(`packages/runner/src/match.ts`, `replacesConnection`), which is true of bot
seats and never of Pi seats; `PiPlayer` throws if it is handed a different token
mid-match rather than quietly reconnecting.

Nothing in the match would have noticed a reconnect, which is why this is
measured off the wire: the server keeps its MCP sessions private and the seat
has no reason to look.

## 2. `agent_settled` arrives exactly once per prompt

**Yes.** 25 prompts, 25 `agent_settled` events, out of 888 events on the stream
in total. `PiPlayer` stops reading a turn at the first one, so a second settle
for the same prompt would have been invisible from the turn record; it was
counted from an `onEvent` tap on the seat's RPC stream instead.

## 3. `getSessionStats()` answers with `contextUsage` on every turn

**Yes, every turn**, on a match that never compacted. The seat asks for stats
once per turn and turns them into the turn record's harness fields
(`packages/harness/src/pi-player.ts`). Measured over the 25 turns, with the
model entry declaring `contextWindow: 200000`:

| Turn | `contextUsage.tokens` |
| --- | --- |
| 1 | 1,400 |
| 25 | 8,600 |

The figure grows monotonically turn by turn — the conversation is kept, not
started again — and `compacted` was `false` on all 25 turns.

**Caveat worth carrying into milestone 04:** `contextUsage` is present but its
`tokens` is `null` immediately after a compaction, because Pi will not state a
context size it has just rewritten. A seat that compacts reports
`context_tokens: 0` for that turn (`PiPlayer` maps "Pi cannot say" to no figure).
Do not read that as a context that shrank to nothing.

## 4. Turn 25's model request still contains turn 1's `get_rules` result

**Yes**, and compaction had not run. The check is a substring check on a request
body the stub recorded, not an inference:

- The fingerprint is turn 1's `get_rules` answer as the server wrote it — the
  whole object, `rules`, `constants`, `bases` and `map`, 13,298 characters. The
  rules prose is also the seat's system prompt, so a phrase from it would prove
  nothing; the `bases` and `map` are this seed's and appear nowhere else in the
  request.
- That exact text is inside the **tool-result** content of the last request of
  turn 25 (76 model requests were made over the match: 4 on turn 1, 3 on each
  later turn).
- All 25 turn prompts — `Turn N of 25. Play your turn.` — are still in that one
  request.
- No `compaction_start` or `compaction_end` crossed the event stream, and no
  turn reported `compacted`.

At 8,600 tokens against a 200,000-token window, a stub match stays far from
Pi's compaction line. **A real model's system prompt and tool results are much
larger than this**, so the real question — does a 25-turn match fit the window —
is one for the Marvin run, not answered here.

## 5. Compaction: what Pi 1.0.2 actually emits over RPC

Forced by giving the stub model's `models.json` entry `contextWindow: 40000` and
playing the `outgrowsTheWindow()` script (`packages/harness/src/stub-model.ts`).

**RPC mode emits both halves of it.** Observed on the seat's event stream, in
order:

```jsonc
{ "type": "compaction_start", "reason": "threshold" }
{ "type": "compaction_end",
  "reason": "threshold",
  "result": {
    "summary": "…",                    // the summary that replaced the older turns
    "firstKeptEntryId": "…",           // the first entry kept verbatim
    "tokensBefore": 32000,             // what the conversation cost before
    "estimatedTokensAfter": 40781,     // Pi's estimate after the summary
    "usage": { "input": 100, "output": 100, "cacheRead": 1200, "cacheWrite": 0, … },
    "details": { "readFiles": [], "modifiedFiles": [] }
  },
  "aborted": false,
  "willRetry": false }
```

- `reason` is one of `"manual"`, `"threshold"`, `"overflow"`. A window smaller
  than the conversation is **`threshold`**; `overflow` is only reached when the
  provider reports the overflow or the answer was cut off.
- `willRetry` was `false` for threshold compaction: the turn is not replayed.
  The seat finished the turn it compacted in and was prompted for the next one
  normally.
- The seat's own turn record reported `compacted: true` for that turn, which is
  the flag milestone 04 counts compaction turns with.
- Compaction is not a one-off: with the script still overflowing the window, the
  seat compacted again on turn 2 — four events for two turns.
- The summarisation itself is a **separate model request** with no tools offered
  and a summarising system prompt ("You are a context summarization
  assistant…"). A scripted seat has to answer it with text: a summary that tries
  to call a tool makes compaction fail.

**A small window alone does not force compaction.** Pi's threshold is
`contextWindow - reserveTokens` with `reserveTokens` defaulting to 16,384, and
its cut point also has to fall somewhere: with `keepRecentTokens` defaulting to
20,000, a conversation that *reports* 32,000 tokens but contains only a few
thousand characters of text is left alone. A test that wants a compaction needs
bulk in the messages as well as in the reported usage.

## 6. The tool lock-down held for the whole match

**Yes.** All 76 requests of the match were offered exactly the seven tools, as
`mcp__salient__get_rules`, `…_get_state`, `…_scout`, `…_simulate`,
`…_submit_orders`, `…_read_notes`, `…_write_notes`, and every call the server
logged was one of the seven. No turn of a 25-turn match drifted into Pi's own
tools. This needs re-checking against a real model, which is the point of the
next section.

**The system prompt was one message: the player file, plus a `<cwd>` section Pi
appends itself.** Every model request a stub seat made carried exactly one
`system` message — the stub records every request body it answers, and
`packages/harness/src/stub-model.test.ts` reads them back. The text is
`games/salient/prompts/player-system.md` verbatim, then a blank line, then:

```text
<cwd>
/tmp/no-dice-stub-seat-XXXX/cwd-A
</cwd>
```

and nothing after it. That is not a second prompt. Pi takes the prompt it is
handed through `--system-prompt` and appends its own working directory to it,
the same way for both seats and for every request of a match; the seat is
offered no other system text, and none of the repository's — no `AGENTS.md`, no
built-in coding prompt — which is what `--no-builtin-tools --no-context-files
--no-skills --no-prompt-templates` are there for.

It matters because the series compares models on identical prompts: whatever Pi
adds, it adds the same way to both seats, and the only way to know that stays
true is to read the prompt off the request the stub recorded. The assertion that
pins it is in `packages/harness/src/stub-model.test.ts`: one `system` message,
and with the `<cwd>` section stripped its text **equals** the player file — not
"contains two phrases of it", which is what let Pi append anything unnoticed.
The player file ends in exactly one newline and Pi's separator is a blank line,
so the recorded prompt has three newlines before `<cwd>`; stripping the section
with the two of Pi's separator — and no more — leaves the file byte for byte,
and nothing has to be normalised.

---

## 7. The first run against a real provider: Marvin, seed 135

One match, played by the operator script this section records it from:

```bash
node scripts/measure-match.mjs --model marvin/subagent --seed 135 --out reports/pi-cost.md
```

Seat A is Pi with `marvin/subagent` at `--thinking medium`, seat B the Greedy
bot, seed **135**, `DEFAULT_CONFIG`'s 25 turns. It played all 25 and ended by
time, B winning **58–31**. The table is `reports/pi-cost.md`; the log it is
rendered from, `reports/135-marvin-subagent-greedy.json`, validates against
`salient-log/1`. That log is a megabyte of tool results and is not committed, so
the report's header carries its sha256
(`cd9fd73faa150836615bf57b8a0f8ad8c1f3e669d02c3c1b8e261553a2ce2842`) to tie the
table to the bytes it came from. Pi is the same 1.0.2 in the same RPC mode, with
the same seat home and the same seven tools as the scripted match above — only
the model behind the endpoint changed.

**What the provider entry rests on, measured versus decided.** The entry is
committed in `providers.json` at the repo root, which is the one file the runner
and `scripts/measure-match.mjs` both seat from
(`packages/runner/src/providers.ts` says what each field decides), and it was
checked against the server from this box:

- `/v1/models` answers, and lists `subagent` as a loaded alias of `Strata-IQ3S`.
  It reports **no context length**, no cost and no output cap, so
  `contextWindow: 131072` is a decision. The log's
  `players.A.context_window: 131072` is Pi reading that decision back, which is
  what makes the header's number trustworthy rather than circular.
- `maxTokens: 8192` is a decision for the same reason — the server advertises no
  output cap — and it is not a harmless one: it bounds the output of every model
  request, so it bounds the output-token figures §10's per-turn budget will be
  set from. The report's header prints it beside `contextWindow` for that reason.
  A match played under a different cap is a different match.
- `apiKey: "none"` passes Pi's credential check, and Marvin checks no key.
- `reasoning: true` is right: the endpoint streams a `reasoning_content` field,
  and it streams it whatever `reasoning_effort` says — asked with `medium` and
  with the field absent, the same reasoning arrives.
- The answer's `model` field names `qwen3.8-flash-next-iq3_s`, not `subagent`.
  Pi's transcript records `subagent`, the id it was given. Neither name
  identifies what answered, so nothing here treats either as an identity check.

### Are `tokens.cacheRead` figures non-zero over a whole match?

**Yes, and they are almost the whole match.** All 25 turns report a non-zero
`cache_read`; 4,301,838 of the match's 4,523,986 prompt tokens — **95.1%** —
came out of Marvin's prompt cache rather than off disk. `cache_write` stays 0
throughout: llama.cpp's KV cache is not reported as a write. The cold single
call that reports `cached_tokens: 0` is therefore not what a match looks like;
a match is the case the cache is for.

The share is not flat, and the shape of it is what a series budget has to be set
from. **Five of the 25 turns read under 90% of their prompt from the cache —
turn 1 at 6.6% (164.6 s), turn 2 at 72.2% (99.5 s), turn 3 at 63.2% (66.4 s),
turn 4 at 30.5% (135.1 s) and turn 17 at 66.9% (70.5 s) — and those five are the
five slowest turns of the match.** The other twenty sit at 98.6–99.6% cached and
14.4–52.0 s. Marvin evicts and re-evaluates the conversation on the odd turn,
including the first, and a series has to budget for those re-evaluations rather
than for the average. The report prints this sentence from the log rather than
from anyone's reading of the table, so it cannot drift from the figures above it.

### Did the MCP connection and the tool lock-down hold against a real model?

**The connection held as far as this run can see; the lock-down held on the
match that finished, and voided the one before it.**

What the Marvin run actually shows about the connection: every one of the 25
turns reached its tools — 2 to 7 calls a turn, 78 in all — no turn failed to get
an answer back, and the seat's home holds a single session file for the whole
match. What it does **not** show is the connection itself: no proxy sat between
Pi and the MCP server here, and neither the log nor the transcript records an
MCP session or a reconnect. "One connection, never re-established" is §1's
answer, measured against the stub through a loopback proxy, and it is carried
here by inference. If milestone 04 is to rely on it for a real provider, put the
same proxy around a real seat and re-measure it.

The lock-down, as the finished match used it: 78 calls, 6 of the seven names
(`read_notes` was never called), every one inside the seven, and the seat's
transcript declares exactly the seven `mcp__salient__*` tools — so
`defaultTools: []`, the disabled built-in extensions and `--no-builtin-tools`
held against a real model in the sense §6 means.

The lock-down, as the attempt before it found it: on turn 3 of the first
attempt the seat called `simulate` — the short name, not
`mcp__salient__simulate`. Pi answered `Tool simulate not found`, the harness
saw a tool name outside the seven and voided the match with `tool_surface`, as
brief §6.3 requires. That is the lock-down working, but it is also the first
real cost of it: `marvin/subagent` shortens a tool name often enough to matter —
it was the 11th call of that attempt, against 0 of 78 on the match that
finished, and two attempts are far too little to put a rate on it. A series of
150 matches against this model should expect to lose some of them this way, and
the game's prompt (`games/salient/prompts/player-system.md`) never names the
tools, which is where a fix would start if losing them is not acceptable.

### What happened to the model's reasoning output, and what level does that imply?

**Pi kept it, and it is most of what the seat costs in output.** 91 of the 93
assistant messages in the seat's transcript carry a `thinking` block, 101,408
characters in all, recorded at `thinkingLevel: medium`. Those blocks are inside
the `output` token counts: 61,748 output tokens over the match, 2,470 a turn,
against 222,148 input.

`--thinking` is not the lever for that. Marvin emits reasoning whether Pi asks
for it or not, so turning thinking off on the Pi side does not stop the tokens
arriving; the per-turn output budget of brief §10 is the only thing that can.
The level still belongs in the log header, because it is part of what the seat
was played at.

### Does a 25-turn match fit the `contextWindow` chosen for Marvin?

**Yes, with room, and compaction never fired.** Context went from 9,675 tokens
on turn 1 to 94,659 on turn 25 — **72.2%** of the 131,072 window, growing 3,541
tokens a turn on average. Pi's compaction threshold is
`contextWindow - 16,384 = 114,688`, which this match never reached; the log
records `compaction: true` in the header and `compacted: false` on all 25 turns.

So 131,072 stands as the window for a 25-turn match, and it is not comfortable:
at this growth rate the threshold falls around turn 31. A longer game, or a
model that writes longer notes, crosses it and has to be re-decided then rather
than now.

### What one match costs, and what §10 and §11 have to take from it

Seat A over 25 turns: **222,148 input, 61,748 output, 4,301,838 cache-read, 0
cache-write tokens**, and **1,128.6 s** of turn time — 18.8 minutes, 45.1 s a
turn, slowest 164.6 s. `cost_usd` is 0.000000 in every turn and in the totals,
because Marvin is Jim's own hardware: no key, no billing, and the entry prices
every token at 0. Tokens and wall time are the price, and the report prints them
in place of money.

- **Brief §10's per-turn output budget:** no turn of this match produced more
  than 4,559 output tokens, and the mean was 2,470. A budget of 8,000 would
  have bound on none of these turns and would still stop a seat that started
  rambling. `--per-turn-output` is the flag that enforces it; this run was
  played without one, deliberately, so the figures above are unbounded.
- **Brief §11's series ceiling:** one match is 4.59M tokens and 19 minutes of
  Marvin's time. A 150-match series is **~688M tokens and ~48 hours** of seat
  time at this rate — one seat, so a two-model matchup doubles it. That is the
  number the ceiling has to be set against, and it is wall time on Jim's
  hardware rather than money.

## 8. A seat that stops answering its next command

**The seat was alive, and the harness had nothing to report.** The first attempt
at seed 479473028 stops in the middle of a match. Its transcript is the earlier
of the two files in
`series/marvin-subagent-vs-greedy/sessions/479473028-marvin-subagent-greedy/session-A/`
— `2026-10-07T23-02-11-254Z_….jsonl`, 174 entries — and it ends:

- entry 168, `23:17:25.970Z` — turn 18's prompt.
- entry 171, `23:17:53.911Z` — the assistant message that called `submit_orders`,
  reporting 115,812 tokens.
- entry 172, `23:17:53.917Z` — the server's `{"accepted":true}`.
- entry 173, `23:18:03.972Z` — an assistant message with `stopReason: "error"`,
  `errorMessage: "This operation was aborted"`, no content, and every usage
  field zero. It lands 10.06 s after the accepted submit, which is brief §6.3's
  after-submission abort (`packages/runner/src/match.ts:87`,
  `AFTER_SUBMISSION_MS = 10_000`) doing what it is told to.
- nothing else. Turn 19's prompt is not in the file — not as a message, not as
  an error, not as a compaction.

The turn-19 `prompt` command then got no response at all, and `RpcClient`
threw `Timeout waiting for response to prompt`. That sentence is neither a death
nor a `MatchVoided`, so `runMatch` wrote no log and the series recorded the
attempt as failed with it as the reason (`reasonOf`,
`packages/runner/src/series.ts:303`) and replayed the seed. The rerun in the same
directory — `2026-10-08T00-28-27-458Z_….jsonl` — played all 25 turns, so this is
a state the session got into rather than a per-seed bug; its figures are quoted
below.

The last test of `packages/harness/src/pi-turn.test.ts` plays the whole thing
against `StubModel` — a 40,000-token window, a turn reporting 30,200 tokens, the
after-submission abort, and a summary held open past the client's timeout — and
asserts what the harness does with it today. It is the test the next task flips.

### Which Pi path the transcript and the pinned build point at

**A compaction the prompt has to wait behind.** In RPC mode a `prompt` command is
answered from one place (`dist/modes/rpc/rpc-mode.js:298-318` of the pinned
1.0.2): the `preflightResult` callback writes the success line, and the `.catch`
writes an error line only if that callback never ran. The command goes
unanswered exactly when `AgentSession.prompt()` neither reaches its preflight
nor throws.

`prompt()` (`core/agent-session.js:1481`) reaches `preflightResult?.("started")`
at line 1594, and before it, at line 1550, calls `_checkCompaction(lastAssistant,
false)` — the comment above that call reads "catches aborted responses". Inside
`_checkCompaction` (2293):

- `skipAbortedCheck` is `false`, so entry 173 is not skipped;
- `directContextTokens` is `calculateContextTokens` of an all-zero usage, so the
  branch at 2387 runs and `estimateContextTokens` (`core/compaction/compaction.js:110`)
  takes the last assistant message that carries real usage — entry 171, 115,812
  tokens — and adds a chars/4 estimate of what follows it;
- that is over the threshold §5 computed for this window, `131,072 − 16,384 =
  114,688`, so line 2409 calls `_runAutoCompaction("threshold", false)`;
- `_runAutoCompaction` (2423) emits `compaction_start` at 2442 and asks
  `_runDefaultCompaction` for the summary — the separate provider request §5
  describes, no tools offered, summarising system prompt — and appends the
  compaction entry at 2488 only once that request has returned.

So the answer to turn 19's `prompt` sits behind a provider request. The rerun
says how long this seat's summary takes: its one compaction entry —
`tokensBefore: 117,158`, and 77,023 tokens of its own usage — is stamped
`00:44:17.261Z`, **52.6 s** after the entry before it. `RpcClient.send()` waits
30,000 ms, hard-coded at `dist/modes/rpc/rpc-client.js:466` with no knob
anywhere in the pinned build, then deletes the pending request and rejects. The
child is untouched.

**The same request is harmless on the other path.** The rerun crossed the line a
turn earlier: its turn 16 ends at 113,298 context tokens and it compacted inside
turn 17, where the failed attempt's turn 17 ended at 112,047 and it crossed
inside turn 18. The log for the rerun
(`series/marvin-subagent-vs-greedy/matches/479473028-marvin-subagent-greedy.json`)
records that turn as `compacted: true`, `wall_ms: 95933`, `context_tokens:
43244`. Nothing was waiting on that summary: the mid-turn check has no RPC
command behind it, and the turn's own 300 s cap had room. It is only the
*preflight* check, the one `prompt()` runs before it answers, that puts a
provider request of that length in front of a command with a 30 s patience.

Why the failed attempt's summary should have been slow at all, when the rerun's
was slow in a place that did not matter: Marvin answers one request at a time
(`docs/series-notes.md` §3), and an abort cancels Pi's side of a request, not the
provider's. `vitest.config.ts` records the same shape for this file's own tests —
a seat starved hard enough "settles an aborted turn when the provider request
settles rather than when the abort lands". A summary that has to queue behind the
request the abort just gave up on is a summary that lands after 30 s. That part
is inference: nothing in the transcript or the log says what Marvin was doing
while the client waited.

**Why the seat was left in the state that does this.** The check that would have
compacted at the end of turn 18 is `_handlePostAgentRun`'s `_checkCompaction`
(line 1409), and the abort returns before it is reached. The check that did fire
mid-turn — `_compactBeforeNextAssistantResponse` (411, called from
`prepareNextTurnWithContext` at 528 before each next assistant response) — had
its summary cancelled by `abort()`'s `abortCompaction()` (1873, 2262), which is
why no compaction entry was appended. Turn 18 ends with 115,812 tokens of
context, an aborted answer that reports none of them, and no boundary: the one
state that makes the *next* prompt compact before it answers. Pi's own comment on
that preflight says as much — "For error messages or all-zero usage messages,
estimate from the last valid response. This ensures sessions that hit persistent
API errors … can still compact".

**The other path, which this transcript rules out.** `prompt()` opens with: if
`_isEmittingAgentSettled`, push the prompt onto `_deferredSettledActions` and
return (1482-1485). That leaves a `prompt` unanswered too — the deferred action
re-enters `prompt()` with the same `preflightResult`, so the answer arrives
whenever the deferred run gets there. The two throws in the same stretch,
"Cannot submit a prompt while compaction is in progress…" (1499) and "Agent is
already processing…" (1517), are answered, because `rpc-mode.js`'s `.catch`
answers them. Only the deferred path and the preflight-compaction path leave a
`prompt` hanging, and a deferred prompt still appends its user message when it
runs. The file has no such message, so the compaction path is what the bytes
support.

### What the rejection tells the harness, and what it does not

Three things: which command went unanswered, that no response arrived inside
30 s, and that the child had not exited. The client's death phrases —
`process exited`, `process error`, `Client not started` — are what `seatIsGone`
reads (`packages/harness/src/pi-player.ts:184`), and a timeout carries none of
them, which is why `command()` (547) rethrows it raw instead of voiding the
match.

It does not say why. The same sentence arrives from a seat compacting before its
prompt, from a prompt deferred behind an unsettled `agent_settled`, and from a
child whose event loop stopped reading stdin; the client draws no line between
"alive and busy" and "alive and stuck", and it says nothing about the provider.
The harness could ask — a compacting seat answers other commands, and the
reproduction test catches one making the summarising request *after* the
rejection, with its process still running — but nothing asks, and the error
carries no reason. So the turn has no `PassReason` and the match no
`MatchVoided`, and `runMatch` has nothing to write.

### What a prompt that arrives late does to a turn already passed

The rejection ends the harness's interest, not the seat's work.

- The response, when it comes, has no pending request to resolve: `handleLine`
  (`rpc-client.js:412-428`) dispatches any line whose `id` is not pending to the
  event listeners as an event, so a late
  `{ "type": "response", "command": "prompt", … }` is handed round as if it were
  an event and dropped, `PiPlayer`'s listener reading only `tool_execution_*`,
  `compaction_*`, `auto_retry_end`, `message_end` and `agent_settled`
  (414-464).
- `playTurn` has unsubscribed in its `finally` (479). If the match stops there —
  which is what it does today — the run's tool calls, its assistant
  `message_end` and its `agent_settled` reach nobody, and that turn's record —
  usage, tool calls, reason — is gone for good.
- If the harness goes on playing, they reach whoever's listener is installed at
  that moment. The listener a turn installs counts every `tool_execution_end`
  and every assistant `message_end` that arrives while it is installed, and
  there is no turn identity on the wire to sort them by, so a late run's calls
  and tokens land in the record of the turn now being played.
- The seat plays the turn against a match that has moved on. `get_state` answers
  with a later turn's board; a call that arrives while the server is not
  accepting is refused `turn_not_open` (`games/salient/server/src/session.ts:273`)
  and handed to the model as a tool error; one that arrives after the next
  `openTurn` is accepted as *that* turn's orders. The transcript then holds a
  seat answering turn 19 with turn 20's board, next to a log that says turn 19
  was not played.
- Today that window is narrow: the rejection escapes `runMatch`, whose `finally`
  (771-775) stops both seats and closes the match server, so the deferred prompt
  dies with the match. It is the fix that widens it — a turn reported
  `prompt_timeout` and a match that goes on playing is exactly the case
  where the seat is still compacting while the harness opens turn 20.

### What the fix does with a prompt that arrives late

`prompt_timeout` is now a pass reason — named so it cannot be read as brief
§6.3's `timeout`, which is the runner's own turn cap — and the fix answers the
question the section above leaves open: **the late run belongs to the turn that
asked for it**, and the seat is quiet before the next turn starts.

`playTurn` sends `abort` and waits for it, then gives a run that has not appeared
yet a moment to appear and waits out the one that has (`quietTheSeat`,
`packages/harness/src/pi-player.ts`). The abort alone does not close the window:
`session.abort()` answers as soon as the session *looks* quiet — `isIdle` is "no
run and no compaction" (`agent-session.js:1038-1040`) — and a prompt deferred
behind a cancelled compaction is quiet for a tick before its run starts
(`agent-session.js:1873-1884`). So the abort is answered, the run appears, and
without the wait its events reach the listener the next turn has installed. With
it, the run's tool calls are on the wedged turn's record; if it submits, that turn
is a played turn, since `prompt_timeout` is what the *command* says and a
submission the server accepted outranks it.

Both bounds are finite, and a run longer than the first wait is stopped rather
than handed on: `quietTheSeat` samples the seat's state for eight seconds — one
sample is a coin-flip on a loaded box, and `vitest.config.ts` records that box for
this suite — and `waitOutRun` waits 30 s for the next settle, sends `abort`, and
waits again. The second `session.abort()` finds `_isAgentRunActive` true and
answers only once the session has gone quiet, so that stop is what usually ends
the run. Nothing downstream covers for what survives both stops: the runner aborts
a seat only when the turn is *still pending* at its own deadline
(`packages/runner/src/match.ts:453-457`), and this turn is handed back long before
that deadline. A run that ignores an abort for the whole of the second wait is
therefore still running when the turn is returned, and the next turn absorbs its
calls and any orders it makes. What the tests pin is the case that happens — the
run that starts when the summary is cancelled.
`packages/harness/src/pi-turn.test.ts` plays a turn after
the wedge and finds it asked its own prompt, given its own tools and making its
own calls; `packages/runner/src/model-seat.test.ts` plays a three-turn match whose
wedged turn carries the late run's call and whose turn after it carries only its
own.

Two things follow for reading such a log:

- The wedged turn is quiet by the time its `getSessionStats` is asked, so it does
  carry provider figures — the session's cumulative ones, whose turn-by-turn delta
  in §3 is the late run's cost. A seat that cannot answer that command is the case
  with no figures at all, and `withHarness`
  (`packages/runner/src/match.ts:532-546`) writes noughts for it, which is what a
  bot's record carries: the reason is then the only thing telling a wedged Pi seat
  from a bot.
- A rejection that is not the client's own timeout is not `prompt_timeout` but
  `no_submission`: Pi answering the command to refuse it — "Agent is already
  processing…" is the likeliest — is a seat that answered, with nothing left
  waiting. The message itself is not in the log; the log has no field for why a
  harness passed a turn, and adding one is a schema change this does not need.
- That refusal is also the one case where "the late run belongs to the turn that
  asked for it" does not describe the record. Pi refuses a prompt because a run is
  already in flight, and that run belongs to the turn *before*; the stop and wait
  run for that branch too, so its calls and any orders it makes land on the turn
  that was refused. That is the turn the server plays those orders in, so the log
  and the server agree; it is not the turn that asked for the run.

### What the turn after a passed one asks the seat first

"Prompted again next turn" is only worth having if the seat can take the prompt,
and a seat that has just missed one may not be able to. The command the harness
gave up on is still inside Pi, and the stop that turn sent can have been answered
while a run was still starting — the window the section above describes. A
streaming seat does not wait for the next prompt, it refuses it:
`AgentSession.prompt()` throws "Agent is already processing…"
(`agent-session.js:1517`) and `rpc-mode.js` answers the command with that, which
on its own reads as `no_submission` — a seat that answered and sat the turn out,
which is not what happened. Queued messages are worse: they are answered inside a
run nobody asked for.

So the turn after a missed prompt starts by putting the seat back in order
(`recoverSeat`, `packages/harness/src/pi-player.ts`), with the three
commands `rpc-mode.js` answers without a provider round trip — which is the whole
reason they can be sent to a seat that has just failed to answer a `prompt`:

- `get_state` (`rpc-mode.js:345-360`) for `isStreaming`, `isCompacting` and
  `pendingMessageCount`;
- `abort` (`rpc-mode.js:327-330`) when it says the seat is running or compacting;
- `clear_queue` (`rpc-mode.js:331-332`) when it says anything is queued, which
  empties the steering and follow-up queues and returns them
  (`agent-session.js:1846-1854`).

Ask, act, ask again, up to three passes; a seat that says it is neither running
nor queued is left alone. Each command is waited on for five seconds rather
than the client's fixed 30 s, because three commands at 30 s each would make the
recovery longer than the turn it is preparing, and an unanswered or rejected
command is read as "nothing further to take away" rather than as a failure — a
recovery that threw on its first unanswered command would turn a survivable seat
into a lost turn. A seat whose process is gone rejects every command, and the
recovery does not report that: the next `prompt` is the command whose failure
means something, and it turns the death into a voided match, which is the only
thing that ends one.

Nothing in the recovery re-sends a prompt. The passed turn's prompt is
already in the seat's history, late or not, and brief §6.3 forbids asking a turn
twice. A seat that is still busy after being asked and stopped as many times as
the budget allows is asked anyway — and the recovery's verdict is kept, because
the refusal that follows is ambiguous on its own: `rpc-mode.js` answers the
command with Pi's "Agent is already processing…", which is the shape of a seat
that was asked and chose to sit the turn out. The rejection text alone only ever
reads as `prompt_timeout` when it is the client's own 30 s wait; when the
recovery has just said the seat was not quiet, this end has its own measurement
that the seat never took the question, and the turn is passed with
`prompt_timeout` rather than `no_submission` (`passReasonFor`, same file).
`PiPlayer.lastRecovery` carries
that verdict — quiet or not, and how many asks, stops and queue-clears it took —
because the log has no field for a recovery and adding one is a schema change
this does not need.

One case the recovery does not close, and does not try to. When it gives up with
the seat still busy, the turn is asked anyway, its prompt is refused, and the run
still going belongs to the turn before. Its `tool_execution_end` events are
recorded on this turn, and any `submit_orders` it makes is accepted by the server
for this turn, so `submitted` can be true for a turn whose prompt was never
taken. That is the shape the section above already accepts for a refused prompt,
for the same reason: the server plays those orders in this turn, so the log and
the server agree about what happened, and `prompt_timeout` — which the verdict
above now guarantees here — is what says the turn was never asked. Suppressing
the attribution would only make the two disagree.

`packages/harness/src/pi-turn.test.ts` pins both halves. A fake client proves the
bounds and the survivability — a seat that is stopped and asked again, a seat that
never answers, a seat that rejects every command including with a dead process's
exit text, a seat that stays busy through every pass — and a live seat plays the
durable version of the wedge: the abort cancels the summary the next prompt waits
behind without appending one, so a seat left over the compaction line is left
over it for the turn after that as well, and the suite shows two turns in a row
passed with `prompt_timeout`, each back inside the runner's 5-minute turn cap,
and the turn after them played. That last turn is bounded against the same cap,
so the recovery's worst case — three passes, two commands each, five seconds
each — cannot grow into a turn the runner cuts off. It also shows the rule the
recovery exists to keep: each turn's prompt reaches the model exactly once, and
the turn after a wedge carries its own calls and its own submission rather than
the wedged run's.

### What a `prompt_timeout` pass in a report says

The report's per-model table has a row for every reason `passReasonSchema`
allows, so `prompt_timeout` is in it as soon as the enum is, and the replay says
the same thing in words: "never took the prompt", which is a different sentence
from the "ran out of time" the turn cap is shown as. [The series notes
§4](series-notes.md) is the precedent for reading either: a pass count in that
table is a story about the machine the seat ran on before it is a story about the
model that sat in it.

About the seat, the reason says one narrow thing — the process was alive, the
harness asked it to play, and it never took the question. That is not the model
declining to play: a seat that answers the command and sits the turn out is
`no_submission`, one cut off while playing is `timeout`, and a dead child voids
the match rather than passing a turn. It says the seat was busy or stuck —
compacting, or still inside a run from the turn before — which is the state the
recovery above puts back in order before the next prompt. One such turn is
survivable and the turn after it is played; two in a row, which the durable test
shows, says the seat was not quiet across a whole turn boundary.

About the server it says more, because the wait that produces the reason is
fixed: the client gives up on `prompt` after 30 s, and a compaction or a long run
that outlasts 30 s is likelier on a loaded host than an idle one — the box
`vitest.config.ts` records for this suite is that host. So a per-model table with
several `prompt_timeout` rows measures that machine and that wait before it
measures the model: every turn it counts is a turn the match lost whatever the
model would have made of it. Two figures have to be read with the row. Those
turns are still turns — they are in `turns`, so they drag `tokens per turn` and
`cost per turn` down — and their tokens are the late run's, the cumulative
delta of §3, unless the seat could not answer `getSessionStats` either, in which
case the row sits beside noughts and reads like a bot's.
