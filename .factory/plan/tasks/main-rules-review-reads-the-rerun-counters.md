---
id: main-rules-review-reads-the-rerun-counters
title: The rules review's open sections are settled from the rerun's counters
milestone: 06-first-real-series
depends_on: [main-series-rerun-plays-the-marvin-series-again]
---

`docs/rules-review.md` has four sections that are `**Left open:**` on a missing measurement
rather than on a small sample — Home bonus, Final-turn lunge, Centre Node ping-pong and No
last-seen memory — and the section "The five counters, none of which survive the run" explains
why: run 1's logs and its `evidence.md` went with the task workspace that played them. The rerun
puts those five counters in the repository, so those sections can finally be answered.

Read the two kept files the previous task committed:
`reports/series/marvin-subagent-vs-greedy-rerun.md` (win rate and interval, seat split, margin,
knockouts, the per-model depth split, compaction turns, missing matches) and
`reports/series/marvin-subagent-vs-greedy-rerun-evidence.md` (the per-match table, the
turns 1-8 / 9-17 / 18-25 band totals for hex flips, neutral captures and Node hand changes, the
series means including lead changes per match and the largest single-turn swing, the
"Against the rules' bot figures" rows, the Node ping-pong section and the per-player Re-scouts
table).

What to change in `docs/rules-review.md`, and nothing else:

- Add both rerun files to the sources list at the top, and say plainly which run each figure in the
  file comes from. Run 1's report stays where it is and stays quoted where it is quoted: the two
  runs are separate samples, since run 1 was played by the harness before `749d236` turned a
  bare-name tool call from a `tool_surface` void into a refused call.
- Replace "The five counters, none of which survive the run" with what the rerun's counters are, in
  a table beside the rules' bot figures — 6.5 hexes flipped a turn late on without the home bonus
  and 1–2.4 with it, 3.2 lead changes a match without it and 1.4 with it.
- Rewrite each of the four open sections around the rerun's numbers, and re-decide its verdict.
  Home bonus takes flips per turn over 18-25 and lead changes per match; Final-turn lunge takes
  the largest single-turn swing with the turn it fell on and neutral captures per band; Centre Node
  ping-pong takes the ping-pong flag and Node hand changes per band; No last-seen memory takes the
  per-player re-scout row — scouts, re-scouts, distinct hexes, re-scouts per match. Each section
  ends in `**Decision:**` or `**Left open:**` again, and a `Left open:` names the specific figure
  that would close it, not "more data".
- Update the closing section "What would close the four open sections" to what is still outstanding
  after the rerun — a longer series (10 pairs is where `MIN_TEST_PAIRS` lets the interval
  test run), a second and more competitive pairing, and whether the rerun's own passes and
  provider errors still swamp the comparison.
- The review's last paragraph says two engine questions are deferred in prose with **no task filed
  behind them**: whether attacking a Node with the exact minimum is meant to be rewarded, and
  whether the simultaneous-turn rules need more depth. If the rerun's counters fire — the
  ping-pong flag set on any match, or Greedy above 50% with the interval excluding 50% — file those
  with `propose_task` and update that paragraph to point at them. If they do not fire, say so and
  keep the marker honest.

A rules decision is still Jim's: do not tick a box in `salient/docs/salient-rules-v0.md` or move a
question to "Decided" unless he made that decision, and do not change the engine, the rules, the
prompts or the stats code here. Keep the sample size honest — 5 pairs is 10 matches, so the interval
is wide and a one-sided pairing may still make the home-bonus reading uninformative.

## Acceptance
- [ ] Each of the four `Left open:` sections now quotes the rerun's counter for its question —
      flips per turn over 18-25 and lead changes per match, the largest single-turn swing and
      neutral captures, the ping-pong flag and Node hand changes, the per-player re-scout row —
      beside the rules' bot figures, and none of them says the counters have no surviving record
- [ ] Every section still ends in `**Decision:**` or `**Left open:**`, every open question in
      `salient/docs/salient-rules-v0.md` still has a section, and each verdict says which
      matches a change would force to be replayed
- [ ] The review says which run each figure comes from, and the two runs are described as
      separate samples across `749d236`

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
for (const s of review.split(/^### /m).slice(1)) {
  if (!/\*\*(Decision|Left open):\*\*/.test(s)) throw new Error(`section "${s.split("\n")[0]}" has no verdict`);
}
if (!/marvin-subagent-vs-greedy-rerun-evidence\.md/.test(review)) throw new Error("the review never cites the rerun evidence file");
if (!/marvin-subagent-vs-greedy-rerun\.md/.test(review)) throw new Error("the review never cites the rerun report");
const sections = review.split(/^### /m).slice(1);
const need = {
  "Home bonus": [/flips? per turn|flips? a turn|hex flips/i, /lead change/i, /18-25/],
  "Final-turn lunge": [/largest single-turn swing/i, /neutral/i],
  "Centre Node ping-pong": [/ping-pong/i, /[Nn]ode hand changes/],
  "No last-seen memory": [/re-scout/i, /distinct hex/i],
};
for (const [name, patterns] of Object.entries(need)) {
  const s = sections.find((each) => each.startsWith(name));
  if (!s) throw new Error(`no section for ${name}`);
  if (/no surviving record/.test(s)) throw new Error(`${name} still says the counters have no surviving record`);
  for (const re of patterns) if (!re.test(s)) throw new Error(`${name} does not quote ${re}`);
  const figures = s.match(/\d+\.\d+/g) ?? [];
  if (figures.length < 3) throw new Error(`${name} quotes too few figures from the rerun`);
}
'
```
