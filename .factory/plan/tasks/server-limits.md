---
id: server-limits
title: The server enforces every limit and the resubmission rule
milestone: 02-mcp-server-and-bots
depends_on: [server-scout-simulate]
---

Fill in the limits in `session.call` and add `submit_orders`, `read_notes` and
`write_notes`. Every limit is enforced here, never by trusting the caller, and a refused call
changes nothing. Per seat per turn: 12 tool calls not counting `submit_orders`, including
calls that return an error, after which every tool returns the error `tool_call_limit` and
only `submit_orders` is still accepted; 3 simulations, the 4th returning `simulate_limit`;
6 action points shared by scouts and orders, so a scout with none left is refused; notes of
at most 2,000 characters, longer text returning `notes_too_long` and leaving the notes
untouched. Once a seat's submission is accepted, every tool returns `already_submitted`
until the next `openTurn`. `submit_orders` takes `orders`, `intent` and `prediction`, the
last two required and 1 to 280 characters each; a call that fails schema validation returns
an error and is not a submission. If every order is valid the submission is accepted and
final. If any order is invalid on the first attempt, nothing is committed and the result
lists each invalid order with its reason; the seat may submit once more, and that second
submission is final whatever it contains — its invalid orders are wasted and still spend
their action points, so store the raw orders and let the engine's `resolveTurn` waste them
under the same action-point budget the rejection was computed with. A token resolves to one
match and one seat and can only ever act for that seat; a token from another match is
refused.

## Acceptance
- [ ] Each limit in brief §6.2 returns its error code and changes nothing: the 13th counted
      call, the 4th simulation, the scout with no action points, and notes over 2,000
      characters
- [ ] A first submission with an invalid order is rejected with a reason per order and
      commits nothing; the second submission is final, wastes its invalid orders and spends
      their action points; an accepted first submission cannot be replaced
- [ ] A seat A token cannot read or change seat B's state, notes or submission, and a token
      from another match is refused

## Verification
```bash
pnpm test -- limits
```
