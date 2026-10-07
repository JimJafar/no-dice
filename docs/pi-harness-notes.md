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
