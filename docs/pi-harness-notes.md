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
server, and what happened to that model's reasoning output — are **not answered
here**; they need a real model in the seat and are recorded by
`scripts/measure-match.mjs` (task `pi-measure-match`) in the section at the end.

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

---

## Provider-dependent lines — not yet answered

To be filled in by the first real match (`scripts/measure-match.mjs`, task
`pi-measure-match`), against `marvin/subagent`:

- Are `tokens.cacheRead` figures non-zero over a whole match? (Marvin reports
  `cached_tokens: 0` on a cold single call, so only a match answers this. The
  stub, which reports its own cache reads, is not evidence either way.)
- Did the MCP connection and the tool lock-down hold against a real model
  rather than the stub?
- What happened to the model's `reasoning_content` output, and what
  `--thinking` level does that imply?
- Does a 25-turn match fit the `contextWindow` chosen for Marvin, or does
  compaction have to be re-decided?
