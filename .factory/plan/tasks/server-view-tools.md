---
id: server-view-tools
title: The server shows a player what it is allowed to see
milestone: 02-mcp-server-and-bots
depends_on: [server-match-state]
---

Implement `get_rules` and `get_state` behind `session.call`, to the schemas in brief §6.2.
`get_rules` takes no input and returns the player-facing rules as text, the constants,
`bases: { you, enemy }` and the static map: all 91 hexes with their terrain, and neighbours
for every passable hex. Blocked hexes are listed without neighbours and never appear in
another hex's list. The rules text comes from a new
`games/salient/prompts/player-system.md`: the rules file's sections from "Board and map"
through "Scoring and match end", followed by the instruction block brief §6.3 gives. Both
seats get byte-identical text; only `bases` differs. `get_state` takes no input and returns
`turn`, `turns_total`, `scores: { you, enemy }`, `action_points_left`,
`limits: { tool_calls_left, simulations_left }`, the hexes the player knows this turn and
`last_turn`. A hex is known if it is visible (owned, or next to an owned hex) or was scouted
this turn; unknown hexes are left out entirely, since terrain is already in `get_rules`.
Owners are `"you"`, `"enemy"` or `null` — never `A` or `B`. Hexes come in one fixed order
(row, then column) identical for both seats. Repeat `neighbours` only for hexes the player
owns with troops on them, and `garrison` only on neutral Nodes. `last_turn` is
`{ your_orders, wasted, events }` with the events limited to hexes that seat could see when
that turn began.

## Acceptance
- [ ] `get_rules` returns 91 map entries with terrain, neighbours on passable hexes only, no
      neighbours on blocked hexes, and the rules' constants
- [ ] `get_state` lists only known hexes, in the same order for both seats, with owners as
      `"you"`/`"enemy"`/`null`, `neighbours` only where that seat can move from the hex and
      `garrison` only on neutral Nodes
- [ ] With an enemy stack hidden just outside the visible ring, neither seat's `get_state`
      reveals it and no returned field names the other seat

## Verification
```bash
pnpm test -- view
```
