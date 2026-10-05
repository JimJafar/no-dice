---
id: pi-measure-match
title: One real match is played and its cost per turn is measured
milestone: 03-pi-harness
depends_on: [pi-long-match-checks]
---

Play the match this milestone exists for: Jim's model against the Greedy bot, 25 turns, one
seed, and report what it really costs. The provider is Jim's Marvin server —
`https://marvin.akita-betelgeuse.ts.net:8033/v1`, model `subagent`, **no API key** — which is
the same `models.json` mechanism task `pi-stub-model` built: a provider named `marvin` with
`"api": "openai-completions"`, a dummy `"apiKey": "none"` (the documented pattern for a keyless
server), and the model entry written out by hand. Checked from this box against Pi 1.0.2: the
server answers `/v1/models` and lists `subagent` as loaded; a tool call comes back as
`finish_reason: "tool_calls"` with `function.name` and `function.arguments`; `usage` carries
`prompt_tokens_details.cached_tokens`; the model also streams a `reasoning_content` field, so
set `"reasoning": true` on the model entry and confirm what Pi does with it before choosing the
seat's `--thinking` level; and `/v1/models` reports no context length, so the `contextWindow`
in `models.json` is a decision, not a lookup — start at 131072 and record it in the log header.
The response's `model` field names the underlying llama-swap model
(`qwen3.8-flash-next-iq3_s`), not `subagent`, so do not trust it as an identity check.

Add `scripts/measure-match.mjs` — an operator script, not a shipped `no-dice` subcommand — that
runs the match through the runner, then prints a per-turn table of input, output, cache-read
and cache-write tokens, cost, context size, wall time and tool calls, with the match totals
underneath, and writes the same table to the path `--out` names (by convention
`reports/pi-cost-<model>-<seed>.md`) beside the log. Guard the run with `--max-tokens` and
`--max-cost`; on Marvin the money cost is zero because it is Jim's own hardware, so tokens and
wall time are the scarce quantities this report has to make visible, and `cost_usd` stays 0 with
a line saying why. These are the numbers brief §10 and §11 wait on: the per-turn output-token
budget, the series cost ceiling, and whether context growth fits the window or compaction has to
be re-decided. Finish the provider-dependent lines of the first-run checklist in
`docs/pi-harness-notes.md` while the run is in front of you — whether `tokens.cacheRead` is
non-zero for this server (it reports `cached_tokens: 0` on a cold single call, so a whole match
is the real test), and whether the MCP connection and the tool lock-down held against a real
model rather than the stub.

Run one match, not a series: a series is milestone 04's, and the point here is to learn the
price before paying it 150 times.

## Acceptance
- [ ] A full `marvin/subagent`-versus-Greedy match is played and its log validates against
      `salient-log/1`, with `players.a.model` naming `marvin/subagent`
- [ ] The report gives tokens, cost and context size for every turn and totals for the match,
      and states what one match costs in tokens and wall time
- [ ] `docs/pi-harness-notes.md` records whether cache reads and the tool lock-down held for
      Marvin, and what happened to the model's reasoning output

## Verification
```bash
node scripts/measure-match.mjs --model marvin/subagent --seed 135 --out reports/pi-cost.md
node -e '
const rows = require("node:fs").readFileSync("reports/pi-cost.md", "utf8").split("\n");
const turns = rows.filter((r) => /^\|\s*[0-9]+\s*\|/.test(r));
if (turns.length < 25) throw new Error(`only ${String(turns.length)} turn rows`);
if (!rows.some((r) => /cache/i.test(r))) throw new Error("no cache columns");
'
```
