---
id: server-scout-simulate
title: The server answers a scout and a simulation without leaking
milestone: 02-mcp-server-and-bots
depends_on: [server-view-tools]
---

Add `scout` and `simulate` to `session.call`. `scout` takes `{ hex }`, costs 1 action point
from the six the seat shares with its orders, and returns that hex and its six neighbours in
the same shape as `get_state` hexes, as they stood when the turn opened — the real board, not
the board after either seat's submission, because nothing is committed until
`resolveTurn`. The scouted hexes count as known for the rest of the turn, so they appear in
`get_state` and can be ordered from or simulated. A hex off the board is an error and spends
no action point. `simulate` takes `{ orders, assumed_enemy_orders }` (the second optional)
and costs one of the three simulations, not an action point. Validate the caller's orders
with the engine's `validateOrders` against the action points it would have left, without
spending them. Build a shadow board for the run: every hex the caller does not know is set to
neutral with no troops, so a move into or out of an unknown hex cannot be modelled and no
hidden detail survives the copy. Assumed enemy orders are validated like real ones and must
start from a hex the caller knows the enemy owns. Run the engine's real `resolveTurn` on the
shadow board and return `accepted`, `wasted`, `changed_hexes` (only hexes whose owner or
troop count moved, in the `"you"`/`"enemy"` shape) and `your_score_after` — the caller's own
projected score only, since the enemy's depends on hexes it has not seen.

## Acceptance
- [ ] A scout spends one action point, returns the hex and its neighbours as they stood at the
      start of the turn even after the other seat has submitted, and those hexes then appear
      in `get_state` for the rest of the turn
- [ ] `simulate` returns `accepted`, `wasted`, `changed_hexes` and only the caller's own
      projected score, and spends no action point
- [ ] A hidden enemy stack next to the visible area is absent from the scout, the simulation
      input and the simulation output, and assumed enemy orders from an unknown hex are
      refused

## Verification
```bash
pnpm test -- simulate
```
