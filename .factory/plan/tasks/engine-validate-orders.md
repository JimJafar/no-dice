---
id: engine-validate-orders
title: The engine validates orders and spends action points
milestone: 01-engine
depends_on: [engine-board]
---

Add `validateOrders(state, seat, orders, apAvailable)` returning
`{ accepted, wasted: [{ order, reason }] }`, matching the validation inside `resolve` in
`salient/docs/reference/engine.js`. Reasons to cover: unknown hex, source hex not owned,
destination is blocked, hexes are not adjacent, troop count not a positive integer, not
enough troops in the source hex (several orders may leave one hex as long as they total no
more than the troops there at the start of the turn), and no action points left. Each order
that is examined costs one action point, including an invalid one, because in a final
submission a wasted order still spends its point. This function is what the MCP server will
call for `simulate` and for validating submissions, so keep it pure and free of any
assumption about the other seat.

## Acceptance
- [ ] Each invalid-order case in brief §8 returns its reason and costs its action point
- [ ] Orders that together exceed the troops present at the start of the turn are wasted
      with "not enough troops in source hex"
- [ ] Orders beyond the action-point limit are wasted with "no action points left"

## Verification
```bash
pnpm test -- validate
```
