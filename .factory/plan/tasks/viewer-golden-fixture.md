---
id: viewer-golden-fixture
title: The golden logs are available as salient-log/1 files
milestone: 05-replay-viewer
depends_on: [viewer-skeleton]
---

The five logs under `games/salient/golden/` are still the prototype shape — no `format`
field, `orders` as `[from, to, troops]` triples, terrain under `t`, `cfg` as
`{turns, ap, radius}`, cells as `[owner, troops, garrison]` — so the viewer has nothing it
is allowed to load, and brief §8's viewer test has no input. Add
`scripts/golden-to-log.mjs`: take one golden log, replay it through the engine exactly the
way `games/salient/engine/src/golden-replay.test.ts` does (load its own `map` and `start`
into a `MatchState`, `resolveTurn` with each turn's orders and no scouts, `score()` for both
seats, then `cellsFor` from `@no-dice/log` for `cut_off`), and write a `salient-log/1` file.
Run it over all five and write the results to `games/salient/viewer/fixtures/`, where Vite
can serve them (`?log=/golden-01-time-win.json` in dev). Import the engine by relative path
from `scripts/`, the way `scripts/measure-match.test.mjs` imports the harness stub by path,
so the root package keeps its two workspace dependencies.

Header facts the converter has to supply, since the golden logs do not carry them:
`format: "salient-log/1"`, `ruleset: "v0"`, `engine_version` read from the engine's
`package.json` (`0.1.0`), a **fixed** `created` timestamp so regenerating is byte-identical,
`seed` from the log, `config` from the log's `cfg` plus `DEFAULT_CONFIG` with the engine's
names renamed to the log's (`startingTroops` → `start_troops`, and so on), `harness` with
`pi_version: null` and every cap 0 because these were scripted bots with no harness,
`players` from the log's `players` (`{ "kind": "bot", "bot": "raider" }`), `map` with
`terrain` instead of `t`, `bases`, and `start.score` from the engine's `score()` on the start
position.

Per-turn player records: the golden logs record only orders, so `orders` come from the log
and `wasted`, `scouts` are empty, `passed` and `rejected_submission` are null, `usage`,
`cost_usd`, `context_tokens` and `wall_ms` are 0, `compacted` is false and `notes_after` is
`""`. `intent` and `prediction` are template sentences generated from that seat's orders —
say in the script's comment that they are generated, not logged, which is what the mock-ups
already call them. `after.troops` is each seat's troops summed over its owned cells, and
`result.margin` is `Math.abs(score.A - score.B)` as `games/salient/server/src/session.ts`
writes it, **not** the golden log's signed margin (golden-03 logs `-93`, golden-05 `-11`).

Checked against the engine in this workspace, for golden-01 turn 11: scores 43 and 33; five
`cut_off` cells, all owned by B — F1, G1, H1, H2, G3; events `capture K2 by B from null`,
`capture G4 by A from B`, `battle at F6 A 5 B 3 owner B`, `capture F6 by A from B terrain
node`; troops 22 and 24; Nodes held 2 and 1. The map has 91 hexes, 79 playable, 7 Nodes, 2
Bases, so the board is worth 93 points.

## Acceptance
- [ ] All five fixtures validate against `matchLogSchema`, and regenerating them produces the
      committed files byte for byte
- [ ] golden-01's fixture at turn 11 has scores 43 and 33, exactly five `cut_off` cells (F1,
      G1, H1, H2, G3, all owned by B) and a `battle` at F6 followed by a `capture` of F6 by A
- [ ] The two knockout fixtures keep 93-0 and carry an unsigned `margin`

## Verification
```bash
ls games/salient/viewer/fixtures/golden-0{1,2,3,4,5}*.json
pnpm test -- golden-to-log
```

The test regenerates all five into a temp directory and compares them with the committed
fixtures, so a fixture cannot drift from the script that writes it.
