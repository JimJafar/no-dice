---
title: MCP server, bots and the match log
---

The seven Salient MCP tools over Streamable HTTP with every limit enforced server-side
(12 tool calls, 3 simulations, 6 action points, one resubmission, 2,000-character notes,
seat tokens), the Random and Greedy bots driving that surface through real MCP calls, and a
match runner that plays bot versus bot and writes one `salient-log/1` file. Done when a
bot-versus-bot match produces a log that the engine reproduces turn by turn, the no-leaks,
seat-isolation, limits and resubmission tests in brief §8 pass, and the log format is
frozen so the series runner and the viewer can be built in parallel. Tasks are written once
milestone 01 is reviewed.
