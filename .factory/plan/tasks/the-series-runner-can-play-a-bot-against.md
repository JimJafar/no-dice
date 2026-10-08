---
id: the-series-runner-can-play-a-bot-against
title: "The series runner can play a bot against itself"
milestone: 06-first-real-series
depends_on: []
---
`planSeries` in `packages/runner/src/series-plan.ts` throws when both seats fold to the same slug ("a series of "greedy" against itself cannot be planned"), because a match is named `<seed>-<seatA>-<seatB>.json` and both seat orders of a mirrored pairing give the same name.

This task needed a Greedy-vs-Greedy series of 10 pairs to measure the bot ping-pong rate. It was played by calling `runMatch` for each of the 20 matches with hand-named log paths (`<seed>-greedy-greedy-<seat>.json`) and writing the record with the runner's own `writeSeriesRecord`; `no-dice evidence` then counted it normally. That path is recorded in `docs/series-notes.md` §7.

A supported fix would name the two matches of a mirrored pair by the seat the pairing's first seat played — e.g. `1003578858-greedy-greedy-A.json` and `-B.json` — which is the same naming the record's `seat` field already carries, and would let `no-dice series --a bot:greedy --b bot:greedy` run. It touches brief §6.5's naming, the resume rule (a log on disk), the report's seat-map wording, and the existing refusal test in `packages/runner/src/series-plan.test.ts`, so it is a decision rather than a cleanup.

## Acceptance
- [ ] `no-dice series --game salient --a bot:greedy --b bot:greedy --max-pairs 1` plays both matches of its pair and leaves two logs
- [ ] `no-dice stats` and `no-dice evidence` report that series over both matches, and a resumed run plays nothing that is already on disk

## Verification
```bash
cd /home/jim/.software-factory/workspaces/no-dice/the-engine-s-minimum-force-attack-on-a-n && node packages/runner/src/cli.ts series --game salient --a bot:greedy --b bot:greedy --max-pairs 1 --dir /tmp/mirror-check 2>&1 | grep -v "cannot be planned"
```
