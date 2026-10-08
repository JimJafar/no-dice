The console (`packages/ui`, the `no-dice-ui` bin) is now served on the tailnet: pm2 runs it as `no-dice-console` through `scripts/console-daemon.sh`, and `tailscale serve` publishes it at https://colin.akita-betelgeuse.ts.net:8765. Jim uses it from other machines; Colin is headless, so the console is the only way he picks a match, starts a run or reads results. It works, but it reads as a developer's tool: unstyled, one long page, CLI flag names, absolute paths and raw file names everywhere. This epic makes it the benchmark's front end.

## What Jim wants

1. **A designed, navigable app.** Separate views (tabs or pages) for Matches, Runs, Leaderboard, and Providers & models, instead of one long page. Plain words instead of flag names (`Pairs`, not `--max-pairs`); no absolute paths or raw log file names in the main views. Styled to match the replay viewer (same fonts and colours), and usable at laptop and phone width.

2. **Past matches, picked not opened.** Matches grouped by series, plus standalone matches. Each row: the two seats (model or bot), the winner, the score, the seed and the date. A click opens the replay in the console's own `/viewer/`. The viewer, opened from the console, offers a way back to it and never asks for a file.

3. **Leaderboard: headline first, detail on demand.** One row per model: model, provider, matches, won, lost, drawn, win rate. Clicking a row opens a detail modal with the further information: the per-series breakdown, the interval and the seat split; time taken (per match, and per turn); token counts (input, output, cache read) and cost; timeouts, passes and compactions; and the match stats from the rules evidence (lead changes, hex flips, Node hand changes, neutral captures, re-scouts). The modal links each match to its replay and each series to its report. The page adds no arithmetic of its own: every figure comes from the stats package, as the leaderboard's figures do today.

4. **Providers and models, managed.** List, add, edit and remove entries in the provider registry, refusing while a run is in flight (as adding does today). Also list the models Pi knows natively whose key variable is set in the console's environment (for example `deepseek/deepseek-flash`), so they can be seated without a registry entry. A model's credential can be checked from its row. No key value is ever shown, sent or stored by the page.

5. **Starting runs.** The seat pickers offer the bots, registry models and Pi's built-in models with a set key. Defaults suit a real benchmark (5 pairs, not the runner's 75), and the estimate shown is based on what the series under the root actually measured, not on a fixed figure.

6. **A series another process is playing is shown as in progress.** Today a series being played by the CLI shows as "0 of 5 pairs … stopped on max_pairs — its full length" with a Resume button, and resuming it would play the same matches twice. The runner should mark a series in progress while it plays (for example a lock file holding its pid) and the console should show it as running, with its progress, and offer no Resume while it is.

## Constraints

- Access stays as it is: loopback, or `tailscale serve` with a tailnet user; write routes keep the Origin check. No other auth.
- The series under `series/` include committed baselines (`series/deepseek-flash-vs-greedy`, and the Marvin series being played now). The console reads them and never deletes or rewrites them.
- Keep the existing API routes working (the factory and other scripts don't call them, but their tests pin the behaviour); add routes rather than reshape them where that is simpler.
