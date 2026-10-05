---
title: Pi player harness
---

One headless Pi session per seat per match, locked down to the seven Salient tools, driven
in RPC mode with one prompt per turn, with the pass/void/timeout rules from brief §6.3 and
per-turn usage, cost and context size recorded in the log. Done when the "Verify on first
run" checklist passes, a model plays a full 25-turn match against Greedy and writes a log,
a model that never submits passes and is still prompted next turn, and the real token, cost
and context growth per match is measured and reported. This is the riskiest milestone: the
installed `pi` is 0.87.1 with no MCP support, so the first task installs and pins a 1.0.x
and re-checks the flags. Everything in it except the last task plays a scripted stub model
over a local endpoint, so the lock-down, the RPC loop and the pass/void rules are proven in
the gate with no credentials; only the measured real match needs Jim's model IDs and API keys.
