---
id: engine-golden-replay
title: The engine replays the five golden logs exactly
milestone: 01-engine
depends_on: [engine-resolve-turn]
---

Copy the five files from `salient/docs/golden/` to `games/salient/golden/` (leave the
 originals in `docs/`) and write a replay test over the copies, following
`salient/docs/reference/replay-check.js`. Those logs use the older shape: no `format` field,
`orders` as `[from, to, troops]` triples, terrain under `t`, `cfg` with `turns`, `ap` and
`radius`, `map` as `{id,q,r,t}`, `start.cells` and per-turn `after.cells` as
`[owner, troops, garrison]` with owner 0 neutral, 1 A, 2 B. Load each log's map and start
position into engine state, apply its orders turn by turn, and assert every hex's owner,
troops and garrison, both scores after every turn, and the final result type and winner.
The five logs cover: seed 135 time win A 49-41 (supply cuts; its turn 11 is the mock-up
frame), seed 92 knockout by A on turn 23, seed 108 knockout by B on turn 19, seed 7 mirror
draw 42-42 with equal scores after every turn, and seed 189 random chaos B 36-25. Add a
determinism test: the same seed and the same orders resolved twice give byte-identical
JSON, and `resolveTurn` leaves its input state untouched.

## Acceptance
- [ ] All five golden logs replay with every logged board, score and result reproduced
- [ ] The mirror-draw log has equal scores for both seats after every turn
- [ ] Re-running a seeded match twice produces byte-identical output and does not mutate the
      input state

## Verification
```bash
pnpm test -- golden
```
