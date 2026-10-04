# Salient reference prototype

This is the throwaway JavaScript used to test the v0 rules. It is a reference for behaviour, not the code to ship. It needs Node 18 or later and has no dependencies.

Related: [build brief](../salient-build-brief.md) · [rules](../salient-rules-v0.md)

## Files

| File | What it does |
| --- | --- |
| `engine.js` | Map generation, visibility, order validation, turn resolution, scoring with supply |
| `bots.js` | A Random bot and three Greedy variants: `expander`, `striker`, `raider` |
| `run.js` | Plays one match between two bots; run directly, it plays 300 maps per pairing and prints the results |
| `replay-check.js` | Replays golden logs through the engine and checks every board, score and result |

## Run it

```sh
node run.js                               # bot pairings over 300 seeded maps
node run.js HOME=0                        # the same without the home bonus
node replay-check.js ../golden/*.json     # all five golden logs must print "ok"
```

## Where it differs from the brief

- **No MCP, no Pi.** Bots are called in-process with a view object.
- **No scouting.** The engine accepts a count of action points spent on scouts, but the bots never scout.
- **Board orientation.** `run.js` gives seat B the board rotated half a turn so both bots see their Base on the same side. This is what makes the symmetry test pass. Real players get true coordinates and seat-swapped pairs instead.
- **Knockout score.** `engine.js` reports the position's true score on the final turn; `run.js` records the result as 93 to 0.
- **Log shape.** The golden logs use `[from, to, troops]` triples and short keys. The brief defines the full log format.

## Golden logs

| File | Seed | Players | Result | Covers |
| --- | --- | --- | --- | --- |
| `golden-01-time-win.json` | 135 | raider v striker | A wins 49 to 41 | Fights, captures, supply cuts. The mock-ups show its turn 11 |
| `golden-02-knockout-by-A.json` | 92 | striker v random | Knockout by A on turn 23 | Edge clashes, repelled attacks, Base capture |
| `golden-03-knockout-by-B.json` | 108 | random v striker | Knockout by B on turn 19 | Base capture from the other seat |
| `golden-04-mirror-draw.json` | 7 | expander v expander | Draw, 42 to 42 | Symmetry: scores are equal after every turn |
| `golden-05-random-chaos.json` | 189 | random v random | B wins 36 to 25 | Many repelled attacks and garrison wear |
