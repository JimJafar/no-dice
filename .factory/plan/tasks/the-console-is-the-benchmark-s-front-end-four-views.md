---
id: the-console-is-the-benchmark-s-front-end-four-views
title: The console opens on one of four views, not one long page
milestone: 09-console-views-and-design
depends_on: []
---

`packages/ui/web/index.html` is five stacked `<section>`s — `#start`, `#progress`, `#results`,
`#providers`, `#leaderboard` — and `render-frame.ts`'s `SECTION_IDS`/`frameSections` look those
five up and `clear()` everything under each `<h2>`. Wrap them in four views and put a nav bar on
the page: **Matches** (what `#results` holds today), **Runs** (`#start` and `#progress` — starting
a run and watching it is one job), **Leaderboard** and **Providers & models** (`#providers`). Keep
the five section ids and their `<h2>`s exactly where they are, inside the view that now holds
them: every renderer module owns its section through `clear()`, and moving a section's
contents is how this task is done, not rewriting one.

The visible view is named by the URL hash — `#matches`, `#runs`, `#leaderboard`, `#providers` —
so a reload, a back button or a link sent from another machine lands where the operator was;
`#matches` is the view when the hash names nothing, since reading what has been played is what
the console is now for. Put the hash-to-view rule in a new `web/src/views.ts` with a happy-dom
test, and have it set `hidden` on the view wrappers rather than removing them, so the one-second
`/api/run` poller in `main.ts` keeps a running series' lines and counters current while a
different view is on screen.

## Acceptance
- [ ] The page has a nav bar with four links; exactly one view is visible; the hash names it, and opening the console with no hash shows Matches.
- [ ] A run started from Runs keeps its lines and pair counters current while another view is showing, and switching back to Runs shows them without a reload.
- [ ] Every section is still drawn by the module that owns it, and `pnpm typecheck`, `pnpm --filter @no-dice/ui build` and the four gates pass.

## Verification
```bash
pnpm test -- views
pnpm --filter @no-dice/ui build
pnpm typecheck
grep -q 'id="view-matches"' packages/ui/web/index.html
grep -q 'id="view-runs"' packages/ui/web/index.html
grep -q 'id="view-leaderboard"' packages/ui/web/index.html
grep -q 'id="view-providers"' packages/ui/web/index.html
grep -q 'hash' packages/ui/web/src/views.ts
```
