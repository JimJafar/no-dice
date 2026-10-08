---
id: the-console-is-the-benchmark-s-front-end-design
title: The console wears the replay viewer's design and works at phone width
milestone: 09-console-views-and-design
depends_on: [the-console-is-the-benchmark-s-front-end-four-views]
---

`packages/ui/web/index.html` has no stylesheet and no viewport meta at all, so the console is
browser-default black on white next to a viewer that is `#12161c` with `#eef1f5` ink. Give it
`packages/ui/web/src/console.css`, linked from `index.html` the way the viewer links
`/src/viewer.css` (Vite bundles it into `web/dist`), and carry the viewer's design over rather
than inventing a second one: the same Google Fonts link the viewer's `index.html` already has
(`IBM Plex Sans` 400/500/600 for text, `Barlow Semi Condensed` 500/600/700 for headings, buttons
and table numerals with letter-spacing), the same palette — `#12161c` page, `#eef1f5` ink,
`#1a2028`/`#232a33` panels, `#aab3bf`/`#c9d1dc` secondary text, `#2c6fd1` and `#e06f35` for the
two seats — and the same feel for tables, forms, buttons and the status line. The run's own
output lines stay monospace, because they are the CLI's lines.

Add `<meta name="viewport" content="width=device-width,initial-scale=1">` — the viewer has none,
because the viewer is a fixed 1920 × 1080 frame and the console is not — and make the layout
hold at 375 px: the nav wraps, and a wide table scrolls inside its own container instead of
pushing the page sideways. Do not touch `games/salient/viewer/src/viewer.css` or
`scripts/viewer-frame-budget.test.mjs`: that frame's budget is measured, and this page is not
that frame.

## Acceptance
- [ ] The console page loads `web/src/console.css`, and that file carries the viewer's two font families and its `#12161c`/`#eef1f5`/`#2c6fd1`/`#e06f35` palette.
- [ ] The page has a viewport meta and at least one `@media` rule; at 375 px and at 1440 px no view's table forces the page itself to scroll sideways, and the nav bar reaches every view.
- [ ] `games/salient/viewer/src/viewer.css` and `scripts/viewer-frame-budget.test.mjs` are unchanged and their test still passes, and `pnpm --filter @no-dice/ui build` emits the CSS into `web/dist`.

## Verification
```bash
for c in 12161c eef1f5 2c6fd1 e06f35; do grep -q "$c" packages/ui/web/src/console.css || exit 1; done
grep -q 'IBM Plex Sans' packages/ui/web/src/console.css
grep -q 'Barlow Semi Condensed' packages/ui/web/index.html
grep -q 'name="viewport"' packages/ui/web/index.html
grep -q '@media' packages/ui/web/src/console.css
git diff --quiet games/salient/viewer/src/viewer.css scripts/viewer-frame-budget.test.mjs
pnpm test -- viewer-frame-budget
pnpm --filter @no-dice/ui build
pnpm typecheck
```
