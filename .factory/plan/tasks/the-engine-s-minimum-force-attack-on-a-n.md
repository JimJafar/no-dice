---
id: the-engine-s-minimum-force-attack-on-a-n
title: "The engine's minimum-force attack on a Node is measured, and the ping-pong it allows is decided"
milestone: 06-first-real-series
depends_on: [main-rules-review-reads-the-rerun-counters]
---
The rerun's rules evidence (`reports/series/marvin-subagent-vs-greedy-rerun-evidence.md`) sets the ping-pong flag — a Node changing owner on three or more turns with at least two consecutive — on **1 of 10 counted matches**: seed 313966722, hex E5, turns 5, 19, 20. The kept bot-vs-bot counters (`reports/series/greedy-vs-random-evidence.md`) set the same flag at the same 1-in-10 rate (seed 1003578858, hex H6, turns 14, 21, 22), so the pattern is not a model quirk. `salient/docs/salient-rules-v0.md`'s open question "Centre Node ping-pong" says the bots do this because they attack with the exact minimum; `docs/rules-review.md`'s Centre Node ping-pong section defers the engine question to this task.

Decide whether attacking a Node with the exact minimum is meant to be rewarded under the resolution rules (`games/salient/engine/src/resolve.ts`, steps 5-7: the owner adds the +1 home bonus; a force entering a neutral Node must exceed its garrison of 3 and loses that many, a smaller force is destroyed and wears the garrison down by its own size). Measure first: play a Greedy-vs-Greedy series of at least 10 pairs and run `no-dice evidence` over it, so the bot ping-pong rate and Node hand changes per band sit beside the rerun's 1 of 10 and 7.60 a match, using the counter that already exists (`isPingPong` in `packages/stats/src/rules-evidence.ts`). Then record the answer in the rules: either the recapture is intended and the open question closes as accepted, or a rule change — garrison, or a defence term on a hex taken this turn — breaks the consecutive recapture. A rules change is Jim's decision, and it forces the tracked baseline series under `series/marvin-subagent-vs-greedy/` to be replayed at its seeds. No rules text changes without him.

## Acceptance
- [ ] A Greedy-vs-Greedy series of at least 10 pairs is played and its `evidence.md` kept under `reports/series/`, giving the bot ping-pong flag rate and Node hand changes per turn band on the same counter the rerun used
- [ ] An engine test states the decided behaviour for a Node taken and retaken on consecutive turns, and passes
- [ ] `salient/docs/salient-rules-v0.md`'s Centre Node ping-pong question records the decision Jim makes, with the measured rate beside it; if a rule changed, the symmetry test still draws on 300 maps and the tracked baseline series is replayed at its seeds

## Verification
```bash
test -f games/salient/engine/src/node-ping-pong.test.ts && pnpm exec vitest run games/salient/engine/src/node-ping-pong.test.ts
```
