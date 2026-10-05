---
id: stats-showcase
title: A finished series names the match to render
milestone: 06-first-real-series
depends_on: [stats-rules-evidence]
---

Brief §6.7's last paragraph, which `stats-series-report` deliberately left out because it needs
a real series to pick from: `packages/stats/src/showcase.ts` decides which one match of a
finished series gets rendered.

The rule, made exact:

1. **Who won.** The series winner comes out of `seriesReport`. A series whose win-rate interval
   straddles 50% has no winner; then rank every counted match instead, and say so in the output.
2. **Keep** the counted matches won by that winner whose `result.margin` lies between the 25th
   and 75th percentile of that winner's own margins — the middle half. Knockouts are margin 93
   and fall outside it on their own. If the filter leaves nothing (a short series), widen to all
   of the winner's matches and say that it did.
3. **Rank** what is left by brief §6.7's excitement score: lead changes, plus the largest
   single-turn swing, plus how late the final lead change came. All three come from
   `rules-evidence.ts`, so the score is a sum of counts of the same unit (turns and points) and
   is reproducible; tie-break by the later final lead change, then by the smaller margin.

Write `<series>/showcase.json`: the chosen match's path (under the gitignored `series/`
directory — the path is what the viewer is handed, not a copy), its excitement score with the
three components, and the one-line series result the header will show (X versus opponent, win
rate with its 95% interval, pairs played, the stop reason). Add `no-dice showcase --series <dir>`
to the CLI to print the choice and write the file, and make it idempotent: running it twice on
the same series writes the same file.

## Acceptance
- [ ] The chosen match is won by the series winner and its margin lies in the middle half of that
      winner's margins, or the output says the filter was widened
- [ ] The ranking is brief §6.7's excitement score, computed from `rules-evidence.ts`, and the
      output names the match and its three score components
- [ ] `showcase.json` carries the series line and the match path, and a series with no clear
      winner still yields a choice

## Verification
```bash
pnpm test -- showcase
```
