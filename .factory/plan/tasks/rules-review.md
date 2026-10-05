---
id: rules-review
title: Each open rules question is closed with a decision or left open with evidence
milestone: 06-first-real-series
depends_on: [series-real-run, stats-rules-evidence, stats-showcase]
---

Write `docs/rules-review.md`: one `###` section per open question in
`salient/docs/salient-rules-v0.md` ("Open questions") — all eight, including Cost growth, which
milestone 03 already answered — each with the numbers from the real series and then a verdict.

The evidence is `reports/series/<pairing>.md` (win rate, interval, seat split, margin,
knockouts, per-model rows, the turns 1-8 / 9-17 / 18-25 split, missing matches) and
`series/<name>/evidence.md` from `no-dice evidence` (lead changes, hex flips per turn with the
mean over 18-25, Node ping-pong, neutral captures, re-scouts, compaction turns). Quote the
model's number beside the number the rules quote for the bots, so the comparison is the point of
the section rather than an aside.

How each question is settled, so none is dodged:

- **Home bonus** — flips per turn late on and lead changes per match, against the rules' 6.5 and
  3.2 for bots.
- **Final-turn lunge** — whether the last turn's swing and neutral-capture count stand out from
  the turn before it.
- **Centre Node ping-pong** — the ping-pong flag over the series' matches.
- **No last-seen memory** — re-scouts per seat per match: a seat that re-scouts the same hexes
  over and over is paying tool calls for memory the engine could hand it.
- **Compaction** — how many matches compacted, and whether compaction turns carry worse error
  counts in the depth split; `docs/pi-harness-notes.md` §7 found a 25-turn Marvin match reaches
  94,659 of its 131,072 window and never compacts, so a series that never compacts is evidence
  too.
- **Cost growth** — closed by §7 already: 4.59M tokens a match, 95.1% of the prompt from cache,
  and the five cache-miss turns are the five slowest.
- **Own-orientation boards** — out of scope for v0 (brief §3). Say that, and what it would cost.
- **Guessing check** — the win rate against Greedy is the answer: if Greedy wins often, the
  simultaneous-turn rules need more depth.

Each section ends with either `Decision: …` — what changes in the engine or config, and which
matches would have to be replayed — or `Left open: …` with the evidence that would settle it.
**A rules decision is Jim's.** Where the numbers point one way, recommend it and ask him before
touching the rules document; tick a box in `salient/docs/salient-rules-v0.md` only for a
decision he made, and move it to "Decided" with the date and the reason. A decision that changes
the engine is not implemented here: propose it as the next epic.

## Acceptance
- [ ] `docs/rules-review.md` has a section for every open question in the rules document, each
      quoting figures from the real series rather than from bot matches
- [ ] Every section ends in `Decision:` or `Left open:` with what would settle it
- [ ] Any decision Jim made is recorded in `salient/docs/salient-rules-v0.md` with its date, and
      the review says which matches a change would force to be replayed

## Verification
```bash
node -e '
const fs = require("node:fs");
const rules = fs.readFileSync("salient/docs/salient-rules-v0.md", "utf8");
const review = fs.readFileSync("docs/rules-review.md", "utf8");
const questions = [...rules.matchAll(/^- \[ \] \*\*(.+?)\.\*\*/gm)].map((m) => m[1]);
if (questions.length < 8) throw new Error(`only ${String(questions.length)} open questions parsed`);
for (const q of questions) {
  const re = new RegExp(`^### .*${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
  if (!re.test(review)) throw new Error(`docs/rules-review.md has no section for "${q}"`);
}
const sections = review.split(/^### /m).slice(1);
for (const s of sections) {
  if (!/\*\*(Decision|Left open):\*\*/.test(s)) throw new Error(`section "${s.split("\n")[0]}" has no verdict`);
}
'
```
