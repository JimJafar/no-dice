---
id: main-server-hides-a-stack-one-hex-beyond-the-ring
title: A stack one hex past the visible ring stays out of every answer
milestone: 06-first-real-series
depends_on: []
---

`server-view-tools` and `server-scout-simulate` both promise that an enemy stack hidden *just
outside* a seat's view is never revealed. Every test that was written uses a stack a long way
off: in `view.test.ts` and `scout-simulate.test.ts` the hidden stack is B's pair on I6, several
hexes from anything seat A can see. A leak at the edge of the ring — the hexes a seat can almost
see — is the one that matters, and nothing covers it. Add those tests. Tests only: the server
is believed to behave, and the point is to find out whether it does. If a test fails, the fix
is in the server, not in the test.

**The geometry, checked against the engine on seed 135 with `DEFAULT_CONFIG`.** The corridor
`B6 C6 D6 E5 F5 G5 H5 I5 J5 J6` is walkable end to end (D6 is a Node with a garrison of 3, so a
stack taking it has to arrive with more than 3). March both seats along it with `submit_orders` and
`resolveTurn`/`openTurn`, as `bothSeatsAdvanced` in both test files already does:

| turn | seat A | seat B |
| --- | --- | --- |
| 1 | `B6 → C6` with 4 | `J6 → J5` with 4 |
| 2 | `C6 → D6` with 4 | `J5 → I5` with 4 |
| 3 | `D6 → E5` with 1 | `I5 → H5` with 1 |
| 4 | nothing | `H5 → G5` with 1 |

That leaves A holding B6, D6 and E5, and B's pair split between I5 (3) and **G5 (1)**. A's visible
set is then `A6 A7 B5 B6 B7 C5 C6 C7 D5 D6 D7 E4 E5 E6 F4 F5`: **G5 is hidden, and F5 — a hex A
can see — is next to it.** That is the edge case. Assert the visible set itself in the test, so the
geometry is pinned and a future map change makes the test complain rather than quietly stop testing
anything.

Then:

- `view.test.ts` — `get_state` for seat A does not list G5 at all (not as `enemy`, not as `null`,
  not with 0 troops), and no other field of the answer mentions it. Seat B's own `get_state` does
  list it, which is the control that shows the hex is really occupied.
- `scout-simulate.test.ts` — seat A scouts **F4**, whose ring is `E4 E5 F3 F4 F5 G3 G4`: G5 is next
  to two hexes in that ring and is not in it. The scout answer contains no G5. Then `simulate`:
  with A's own orders, the projection's `changed_hexes` says nothing about G5, and
  `assumed_enemy_orders` from G5 (`{ from: "G5", to: "F5", troops: 1 }`) is refused, because the
  caller may only assume orders from a hex it knows the enemy owns. The existing refusal test uses
  I6; this one is the hex the caller can nearly see.

Keep the two files' existing style: a `call`/`stateOf`/`scout`/`simulate` helper, hex labels at the
server's edge, and a comment naming the ring so the next reader can see why G5 was chosen.

## Acceptance
- [ ] `view.test.ts` has a case where an enemy stack sits one hex beyond the caller's visible ring
      (G5, with F5 visible) and `get_state` leaves it out entirely, while the owner's own
      `get_state` shows it
- [ ] `scout-simulate.test.ts` has a case with the stack next to a scouted ring (scouting F4) where
      the scout answer, the simulation's `changed_hexes` and every other field leave G5 out, and an
      `assumed_enemy_orders` from G5 is refused
- [ ] Both cases assert the visible ring they were built on, so the geometry cannot rot silently

## Verification
```bash
pnpm test -- view simulate
grep -q "G5" games/salient/server/src/view.test.ts
grep -q "G5" games/salient/server/src/scout-simulate.test.ts
```
