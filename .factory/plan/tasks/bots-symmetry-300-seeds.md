---
id: bots-symmetry-300-seeds
title: Two identical bots draw every match whatever the seat
milestone: 02-mcp-server-and-bots
depends_on: [match-runner-loop, bots-random-greedy]
---

Run the symmetry test brief §8 asks for: two copies of the Greedy bot, each seeing the board
in its own frame, must draw with equal scores on every one of 300 seeds. Drive it through the
server's in-process `call` function and the bots' decision functions rather than over HTTP,
so 300 matches of up to 25 turns fit inside the test timeout, and use seeds 1 to 300. This
is the milestone's fairness gate: the rules file records that identical bots in the prototype
split 25% to 69% by seat, and the only cause was the order in which they considered moves.
Since the server reports absolute hex labels to both seats, a seat imbalance means the
Greedy bot is ranking candidates in board coordinates instead of its own frame — fix the
bot's ordering, not the assertion. Assert the mirror position directly as well as the
scores: after every turn, seat A's board rotated by `(q,r) -> (-q,-r)` equals seat B's.

## Acceptance
- [ ] Greedy versus Greedy ends in a draw with equal scores for both seats after every turn
      on all 300 seeds
- [ ] After every turn the two boards are half-turn rotations of each other, owners swapped
- [ ] The whole run completes inside the test timeout

## Verification
```bash
pnpm test -- symmetry
```
