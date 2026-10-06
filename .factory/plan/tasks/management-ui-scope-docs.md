---
id: management-ui-scope-docs
title: The two places that call a launching UI out of scope are amended
milestone: 07-ui-run-console
depends_on: [management-ui-start-page, management-ui-results]
---

Two documents say a launching UI is out of scope, and this epic made one, so they have to stop
saying it. Nothing else in the docs changes.

`salient/docs/salient-build-brief.md` §3 lists "A web UI for launching matches" among the things
v0 leaves out. Replace that bullet with what actually exists and what still does not: a
loopback-only console (`packages/ui`, `no-dice-ui`) that starts a match or a series in its own
process, lists finished results and resumes an interrupted series, for one user on one
machine — and hosting, auth, sessions, HTTPS and more than one user stay out, as does live
per-turn streaming of a match in progress, since the console's progress is per pair and per match.

`docs/viewer-notes.md` §3 has one table row covering "A calibrated win-probability bar,
own-orientation boards, more than two players, a web UI for launching matches". Split the UI out
of that row and say where it lives instead, leaving the other three still listed as out of scope.
The rest of that file still describes a log-only viewer, and it must stay true: the console serves
the viewer's build and hands it a `?log=` URL, and the viewer still reads a log and nothing else.

## Acceptance
- [ ] Brief §3 no longer lists a launching UI as out of scope, and names the limits that replaced
      it (loopback only, one user, no auth or hosting, no live per-turn streaming)
- [ ] The `docs/viewer-notes.md` row no longer counts a launching UI as out of scope, points at
      `packages/ui`, and still lists the other three as out of scope
- [ ] No other file under `docs/` or `salient/docs/` is touched, and every gate still passes

## Verification
```bash
grep -qi 'packages/ui' salient/docs/salient-build-brief.md
grep -qi 'packages/ui' docs/viewer-notes.md
! grep -qi '^- A web UI for launching matches' salient/docs/salient-build-brief.md
test -z "$(grep -rli 'no-dice-ui' docs salient/docs | grep -v -e '^docs/viewer-notes\.md$' -e '^salient/docs/salient-build-brief\.md$')"
pnpm test -- viewer
```
