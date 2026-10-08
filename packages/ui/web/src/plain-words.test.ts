/**
 * The plain-words rule itself.
 *
 * A guard that never bites is worse than no guard, because it reads like a
 * checked rule. So the three things it looks for are each shown to bite, and
 * the wording that is allowed — a model named with a slash in it, a URL in a
 * link's `href`, a date, a rate — is shown not to.
 */
import { describe, expect, it } from "vitest";

import { breachesOf, expectPlainWords } from "./plain-words.ts";

/** Text the front end is allowed to draw: names, figures, dates, one slash. */
const PLAIN = `Series — alpha — bot:greedy vs deepseek/deepseek-flash, 4 of 4 pairs
win rate 64.3% (95% CI 38.7% – 83.7%), stopped on max_pairs — its full length
bot:greedy vs bot:random — seed 1234, played 7 Oct 2026 — from alpha
Pairs at once: 2. Cost ceiling: $12.50. Token ceiling: 900,000. Seed base: 1234.
This console lists the series and matches in the folders it was started with.`;

describe("the plain-words rule", () => {
  it("lets a view that speaks in words pass", () => {
    expect(breachesOf(PLAIN)).toEqual([]);
    expect(() => expectPlainWords("example", PLAIN)).not.toThrow();
  });

  it("bites on a flag name", () => {
    expect(breachesOf("Token ceiling (--max-tokens): 900,000")).toEqual(["names a CLI flag: --max-tokens"]);
  });

  it("bites on an absolute path", () => {
    expect(breachesOf("Series under /home/operator/no-dice/series")).toEqual([
      "shows an absolute path: /home/operator/no-dice/series",
    ]);
  });

  it("bites on a log file name", () => {
    expect(breachesOf("1234-greedy-random.json")).toEqual(["shows a log file name: 1234-greedy-random.json"]);
  });

  it("says what it drew when it bites, so the failure is readable", () => {
    expect(() => expectPlainWords("example", "matches under /repo/matches")).toThrow(/the example view/);
    expect(() => expectPlainWords("example", "matches under /repo/matches")).toThrow(/\/repo\/matches/);
  });
});
