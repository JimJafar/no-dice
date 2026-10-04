---
id: engine-resolve-turn
title: The engine resolves a turn
milestone: 01-engine
depends_on: [engine-validate-orders, engine-visibility-scoring]
---

Add `resolveTurn(state, orders, apSpentOnScouts, config)` returning
`{ state, events, wasted }`, porting the behaviour of `resolve` in
`salient/docs/reference/engine.js` (not its style) and using `validateOrders` for step 1.
The fixed sequence is: validate and drop orders beyond the action points left after scouts;
depart (troops available from a hex are those there at the start of the turn); clash on the
edge when both players move across the same edge in opposite directions, destroying the
smaller force and costing the larger the same number; arrive; fight in the hex, where the
owner adds the +1 home bonus, the larger strength wins and loses troops equal to the
smaller strength, the home bonus absorbs the owner's first loss, and on a tie the attackers
are destroyed and the hex holds; take neutral Nodes, where a force entering must exceed the
garrison and loses that many, and a smaller force is destroyed while wearing the garrison
down by its own size; set ownership (a hex with surviving troops belongs to their player, a
hex with none keeps its owner, and emptying a hex does not lose it); check for knockout;
then produce, Base +2 and each owned Node +1, only if the match continues. Where both
players enter the same neutral hex they fight with no bonus first and the survivor then
faces the garrison. Emit events `clash`, `battle`, `repelled` and `capture` with the fields
in brief §7. A knockout ends the match and is recorded as 93 to 0 with `winner: null` when
both Bases fall on the same turn, while the turn's board keeps the true position.
`resolveTurn` must not mutate its input state, and must not use floating point, a clock or
object key order.

## Acceptance
- [ ] The five combat rows from the rules give: 1v0 holds; 2v0 captured with 1 left; 4v3
      fails with no defenders left; 5v3 captured with 1 left; 3v5 fails with 3 defenders left
- [ ] Edge clashes, garrison wear, cut-off regions and production match the prototype
- [ ] A captured Base ends the match as 93 to 0, and both Bases falling on one turn is a draw

## Verification
```bash
pnpm test -- resolve
```
