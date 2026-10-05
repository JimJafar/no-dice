---
id: bots-random-greedy
title: The Random and Greedy bots decide from what a player can see
milestone: 02-mcp-server-and-bots
depends_on: [server-view-tools]
---

Create `games/salient/bots` (`@no-dice/salient-bots`) with the two baseline bots of brief
§6.6 as pure decision functions over exactly what the tools return: the `get_rules` map and
constants plus the `get_state` hexes. A bot never scouts and never receives hidden state.
`randomBot(seed)` makes up to 6 random legal moves a turn from a seeded `mulberry32`, moving
from hexes it owns that have troops, to a passable neighbour, in the seat's own frame.
`greedyBot()` ports the `expander` style from `salient/docs/reference/bots.js` with its
weights (`guard 0, margin 0, wNode 30, wPlain 14, wFoeNode 26, wFoePlain 12, wMarch 4,
strike 99, wStrike 0`): take neutral Nodes it can afford with garrison + 1 troops, claim open
hexes, attack enemy hexes where it has enough troops, hold its own Nodes that have an enemy
stack next to them, keep a guard on its Base against a visible enemy stack nearby, and march
interior troops to the front. The reference bot is handed a board already rotated so its Base
is on one side (`viewFor` in `reference/run.js`); our server reports absolute labels to both
seats, so the Greedy bot has to rank candidates in a seat-relative frame of its own — rotate
`(q,r) -> (-q,-r)` for seat B before sorting, and rotate the orders back. The rules file
records why this matters: identical bots in the prototype split 25% to 69% by seat purely
because of the order they considered moves in. Both bots return `{ orders, intent,
prediction }` with `orders` as `{ from, to, troops }` and both texts between 1 and 280
characters.

## Acceptance
- [ ] `randomBot` given the same seed and the same view returns the same orders, never more
      than 6, each one legal in that view
- [ ] `greedyBot` takes an affordable neutral Node, attacks where it has enough troops, and
      marches interior troops toward the front
- [ ] Ranking is seat-relative: rotating the whole view by `(q,r) -> (-q,-r)` and swapping
      seats gives the rotated mirror of the same orders

## Verification
```bash
pnpm test -- bots
```
