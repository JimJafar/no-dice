---
id: pi-stub-model
title: A scripted stub model plays Pi without an API key
milestone: 03-pi-harness
depends_on: [pi-seat-config]
---

Add a scripted model the harness tests can play against, so every later task in this
milestone is testable in the gate with no provider credentials and no cost. Put it in
`packages/harness/src/stub-model.ts`: a local HTTP server on `127.0.0.1` speaking enough of
OpenAI Chat Completions for Pi (`POST /v1/chat/completions`, SSE `chat.completion.chunk`
lines, ending with `data: [DONE]`), plus the `models.json` entry that points a seat's Pi home
at it — `{"providers":{"stub":{"baseUrl":"http://127.0.0.1:<port>/v1","api":"openai-completions","apiKey":"stub","models":[{"id":"stub-1","name":"Stub","input":["text"],"contextWindow":200000,"maxTokens":2048,"reasoning":false,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]}}}`.
This was verified on this machine with Pi 1.0.2: with that file in `PI_CODING_AGENT_DIR` and
`PI_OFFLINE=1`, `pi --model stub/stub-1 --print "hi"` answers from the local stub. A tool
call is a delta carrying `tool_calls: [{ index: 0, id, type: "function", function: { name,
arguments } }]` with `finish_reason: "tool_calls"`; report `usage` with
`prompt_tokens_details.cached_tokens` so cache reads are visible to the harness.

The stub takes a script — a list of replies chosen per request — and records every request
body it received, so a test can assert what the model was actually offered (the tool names in
`tools`, the system prompt) and what it was shown later (whether an early turn's tool result
is still in the request). Give the script builders for the cases this milestone has to prove:
call a named tool then submit, never submit, call a tool outside the seven, sleep past a
deadline, and fail with a provider error.

## Acceptance
- [ ] A Pi session started against the stub calls a Salient tool and the match server records
      that call for the right seat
- [ ] The stub's recorded request shows the model was offered exactly the seven
      `mcp__salient__*` tools and the player system prompt as its only system prompt
- [ ] No test in the milestone needs a provider credential, and the stub binds to loopback only

## Verification
```bash
pnpm test -- stub-model
```
