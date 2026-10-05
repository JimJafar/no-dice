---
id: pi-seat-config
title: A seat gets an isolated Pi home whose only tools are the seven
milestone: 03-pi-harness
depends_on: [pi-pin-version]
---

Add `packages/harness/src/pi-home.ts`: given a match directory, a seat, the server URL and
the seat's bearer token, it writes the three directories brief §6.3 isolates a seat with —
`pi-home-<seat>/` (the config dir), an empty `cwd-<seat>/` to run in, and `session-<seat>/`
— and returns their paths plus the environment the child process needs. `PI_CODING_AGENT_DIR`
moves Pi's whole config directory, so the user's own `~/.pi/agent` settings, extensions,
skills and logins are out of the match. Write `$PI_CODING_AGENT_DIR/mcp.json` with one server
named `salient` at the match's URL, `"headers": {"Authorization": "Bearer ${SALIENT_TOKEN}"}`,
`"exposure": "direct"` and a description, and `$PI_CODING_AGENT_DIR/settings.json` with
`defaultTools: []`, `autoEnableCodemode: false`,
`extensions: ["-builtin:codemode","-builtin:tool-search","-builtin:llama.cpp"]`,
`compaction: { "enabled": true }` and `quietStartup: true`. Do not pass `--no-extensions`:
that switches off the built-in MCP extension and with it the game tools.

All of this was checked against 1.0.2 on this machine: a `mcp.json` under
`PI_CODING_AGENT_DIR` is read as a global server with no project trust, `${SALIENT_TOKEN}` is
substituted from the child's environment, and `pi mcp list --json` then reports
`state: "connected"` with exactly the seven tool names. `pi mcp list` exits 1 when an enabled
server is not connected, which makes it a usable assertion rather than a note.

## Acceptance
- [ ] With the seat home written and the real Salient MCP server running, `node <cli> mcp list
      --json` reports one connected `salient` server whose tool list is exactly the seven
- [ ] The seat's token reaches the server: the server accepts a call made with that token
- [ ] `pi mcp list --json` names the seat's own `mcp.json` as the server's source, so nothing
      from the developer's `~/.pi/agent` is in play

## Verification
```bash
pnpm test -- pi-home
```
