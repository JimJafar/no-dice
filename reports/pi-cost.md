# Pi cost report: marvin/subagent versus Greedy

- **Seat A:** `kind: pi`, model `marvin/subagent`, thinking `medium`
- **Seat B:** `kind: bot`, `greedy` — it runs no provider, so every figure below is seat A's
- **Provider:** `https://marvin.akita-betelgeuse.ts.net:8033/v1` (`api: openai-completions`, `apiKey: "none"`, `reasoning: true`)
- **contextWindow: 131,072 tokens — a decision, not a lookup.** Marvin's `/v1/models` reports no context length for `subagent`, so this is the window the run was played with; the log's `players.A.context_window` carries the same figure because it is Pi's reading of the seat's own `models.json`.
- **maxTokens: 8,192 — also a decision, not a lookup.** Marvin reports no output cap either, so this is the cap the run's model requests were made under, and it bounds the output-token figures below; a run under a different cap is a different run.
- **Seed:** 135 — **turns played:** 25 of 25
- **Result:** `time`, seat B, A 31 – B 58
- **Pi:** 1.0.2 in RPC mode, one session per seat — **engine:** 0.1.0 — **created:** 2026-10-05T13:50:40.210Z
- **Log:** `reports/135-marvin-subagent-greedy.json` — sha256 `cd9fd73faa150836615bf57b8a0f8ad8c1f3e669d02c3c1b8e261553a2ce2842`
- **Report:** `reports/pi-cost.md`
- **Seat transcript:** `reports/135-marvin-subagent-greedy-match/session-A` (1 session file)

**`cost_usd` is 0 in every turn and in the totals, and that is not a measurement failure:** the provider is Marvin, Jim's own llama-swap server: no API key, no billing, and its models.json entry prices input, output, cache-read and cache-write tokens at 0. Tokens and wall time are what this provider charges in.

## Seat A, turn by turn

| Turn | input | output | cache_read | cache_write | cost_usd | context | % window | wall_s | tool calls | passed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 42569 | 2077 | 2999 | 0 | 0.000000 | 9675 | 7.4 | 164.6 | 7 | - |
| 2 | 17261 | 4463 | 44832 | 0 | 0.000000 | 14904 | 11.4 | 99.5 | 5 | - |
| 3 | 17424 | 1812 | 29860 | 0 | 0.000000 | 17395 | 13.3 | 66.4 | 3 | - |
| 4 | 52152 | 2500 | 22851 | 0 | 0.000000 | 20742 | 15.8 | 135.1 | 4 | - |
| 5 | 1013 | 4337 | 93361 | 0 | 0.000000 | 26064 | 19.9 | 49.3 | 4 | - |
| 6 | 971 | 3144 | 140618 | 0 | 0.000000 | 30180 | 23.0 | 37.8 | 4 | - |
| 7 | 838 | 4559 | 96470 | 0 | 0.000000 | 35579 | 27.1 | 52.0 | 3 | - |
| 8 | 2377 | 3794 | 230617 | 0 | 0.000000 | 41167 | 31.4 | 49.0 | 4 | - |
| 9 | 924 | 3766 | 128776 | 0 | 0.000000 | 45856 | 35.0 | 41.9 | 3 | - |
| 10 | 969 | 2317 | 140790 | 0 | 0.000000 | 49141 | 37.5 | 28.4 | 2 | - |
| 11 | 977 | 2641 | 151548 | 0 | 0.000000 | 52758 | 40.3 | 30.6 | 3 | - |
| 12 | 1006 | 2031 | 161223 | 0 | 0.000000 | 55795 | 42.6 | 24.0 | 2 | - |
| 13 | 986 | 1994 | 170973 | 0 | 0.000000 | 58779 | 44.8 | 23.5 | 3 | - |
| 14 | 936 | 1075 | 178276 | 0 | 0.000000 | 60789 | 46.4 | 14.4 | 2 | - |
| 15 | 970 | 2288 | 186096 | 0 | 0.000000 | 64047 | 48.9 | 26.7 | 3 | - |
| 16 | 954 | 1509 | 194554 | 0 | 0.000000 | 66510 | 50.7 | 18.8 | 2 | - |
| 17 | 67554 | 1926 | 136481 | 0 | 0.000000 | 69480 | 53.0 | 70.5 | 3 | - |
| 18 | 1430 | 1745 | 283391 | 0 | 0.000000 | 72653 | 55.4 | 22.8 | 2 | - |
| 19 | 1031 | 1304 | 220783 | 0 | 0.000000 | 74992 | 57.2 | 17.3 | 3 | - |
| 20 | 1103 | 2160 | 228180 | 0 | 0.000000 | 78253 | 59.7 | 26.7 | 2 | - |
| 21 | 1220 | 3171 | 321581 | 0 | 0.000000 | 82648 | 63.1 | 37.0 | 4 | - |
| 22 | 1114 | 1087 | 250088 | 0 | 0.000000 | 84852 | 64.7 | 14.8 | 2 | - |
| 23 | 1213 | 1708 | 258053 | 0 | 0.000000 | 87773 | 67.0 | 21.5 | 3 | - |
| 24 | 1278 | 1577 | 356220 | 0 | 0.000000 | 90628 | 69.1 | 21.0 | 3 | - |
| 25 | 3878 | 2763 | 273217 | 0 | 0.000000 | 94659 | 72.2 | 35.1 | 2 | - |

| **Total** | **222148** | **61748** | **4301838** | **0** | **0.000000** | - | - | **1128.6** | **78** | **0** |
| **Mean per turn** | **8886** | **2470** | **172074** | **0** | **0.000000** | - | - | **45.1** | **3.1** | - |

Seat B played all 25 turns and costs nothing by construction: no provider, so `usage`, `cost_usd` and `context_tokens` stand at 0 in its turn records.

## What one match costs

- **Tokens:** 4,585,734 in seat A — 222,148 input, 61,748 output, 4,301,838 read from the provider's prompt cache, 0 written to it.
- **Wall time:** 1128.6 s of seat-A turns out of 1129.7 s for the whole run, which includes the runner's start-up and both seats' processes. The two seats are asked for a turn together, so seat B's turns run inside the same wall time.
- **Money:** 0.000000 US dollars, because the provider is Jim's own hardware. The token counts above are the transferable figure: a paid provider at the same counts costs whatever its rates say.
- **Prompt tokens:** 4,523,986 over the match. The conversation is re-sent on every model call, so this is what a series multiplies, and the cache-read share of it — 95.1% — is what softens the cost of doing that.

## What this run answers

- **Cache reads (`tokens.cacheRead`):** 25 of 25 turns report a non-zero `cache_read`, 4,301,838 tokens in all, which is 95.1% of the 4,523,986 prompt tokens the match sent. Marvin's prompt cache **does** reach the harness over a whole match.
- **Where the cache missed:** 5 of 25 turns read under 90.0% of their prompt from the cache — turn 1 at 6.6% (164.6 s), turn 2 at 72.2% (99.5 s), turn 3 at 63.2% (66.4 s), turn 4 at 30.5% (135.1 s), turn 17 at 66.9% (70.5 s), which are the 5 slowest turns of the match. The other 20 sit at 98.6–99.6% cached and 14.4–52.0 s. A series budgets for those re-evaluations, not for the average.
- **The tool lock-down, as the seat used it:** 78 tool calls over 25 turns, 6 distinct tool names — `get_rules`, `get_state`, `scout`, `simulate`, `submit_orders`, `write_notes`. Every one is inside the seven, and the match was not voided for `tool_surface`.
- **The tool lock-down, as the session recorded it:** 7 tools declared in the seat's transcript — `mcp__salient__get_rules`, `mcp__salient__get_state`, `mcp__salient__read_notes`, `mcp__salient__scout`, `mcp__salient__simulate`, `mcp__salient__submit_orders`, `mcp__salient__write_notes`. Exactly the seven, so `defaultTools: []`, the disabled built-in extensions and `--no-builtin-tools` held against a real model.
- **Reasoning output:** 91 of 93 assistant messages in the transcript carry a `thinking` block, 101,408 characters in all, so Marvin's `reasoning_content` reached Pi and was kept as thinking — and thinking is inside the `output` token counts above. The seat was asked at thinking level `medium` and the messages record `medium`.
- **Which model answered:** the transcript names `subagent`, the id the seat was given. Marvin's own answer names the llama-swap model behind the alias instead, so neither name is an identity check on `subagent`; the seat is identified by `--model` and the log's `players.A.model`.
- **Context growth:** 9675 tokens on turn 1, 94659 at the largest, 94659 on turn 25 — 3541 a turn on average, against a 131072-token window, so the match reached 72.2% of it. Compaction ran on 0 turns.
- **Turns that did not play:** none — every turn ended with an accepted submission.

## Guards this run was played under

- `--max-tokens 10000000` — a ceiling on the match's total tokens, checked against the totals above. Not crossed.
- `--max-cost 0.000000` — a ceiling on the match's cost, checked the same way. Not crossed.
- `--per-turn-output none` — brief §6.3's per-turn output budget, the one ceiling the runner enforces while a match is still playing. The log's header records `output_token_budget: null`.
- **Outcome:** no ceiling crossed, so the run exits 0.

_Written by `scripts/measure-match.mjs` from the log at `reports/135-marvin-subagent-greedy.json`._
