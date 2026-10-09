// @vitest-environment happy-dom
/**
 * The plain-words rule itself.
 *
 * A guard that never bites is worse than no guard, because it reads like a
 * checked rule. So the three things it looks for are each shown to bite, and
 * the wording that is allowed — a model named with a slash in it, a URL, a
 * date, a rate — is shown not to. The slash cases are the ones worth pinning:
 * a provider's base URL and a model's name both have one in them and belong on
 * the page, and an absolute path does not.
 */
import { describe, expect, it } from "vitest";

import { breachesOf, expectPlainWords, wordsOf } from "./plain-words.ts";

/** Text the front end is allowed to draw: names, figures, dates, slashes in names. */
const PLAIN = `Series — alpha — bot:greedy vs deepseek/deepseek-flash, 4 of 4 pairs
win rate 64.3% (95% CI 38.7% – 83.7%), stopped on max_pairs — its full length
bot:greedy vs bot:random — seed 1234, played 7 Oct 2026 — from alpha
bot:greedy beat bot:random 43–33 · seed 1234 · 7 Oct 2026
Pairs at once: 2. Cost ceiling: $12.50. Token ceiling: 900,000. Seed base: 1234.
marvin — https://marvin.example.ts.net:8033/v1 (openai-completions)
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

  it("bites on an absolute path however it is glued to what is around it", () => {
    // A rule that only fires after a space is a rule a comma defeats. The shapes
    // here are the ones a sentence writes itself into.
    for (const text of ["under,/repo/series", "root ->/repo/series", "root=/repo/series", "/repo/series"]) {
      expect(breachesOf(text), text).toEqual(["shows an absolute path: /repo/series"]);
    }
  });

  it("does not bite on a slash that is part of a name, or on a URL", () => {
    // The page says these out loud: a model's name, and the endpoint an
    // entry is. Neither is a path into the machine.
    for (const text of [
      "bot:greedy vs marvin/subagent",
      "deepseek/deepseek-flash",
      "https://marvin.example.ts.net:8033/v1",
      "cost 1 / 2",
      "packages/ui/web/src",
    ]) {
      expect(breachesOf(text), text).toEqual([]);
    }
  });

  it("bites on a log file name", () => {
    expect(breachesOf("1234-greedy-random.json")).toEqual(["shows a log file name: 1234-greedy-random.json"]);
  });

  it("says what it drew when it bites, so the failure is readable", () => {
    expect(() => expectPlainWords("example", "matches under /repo/matches")).toThrow(/the example view/);
    expect(() => expectPlainWords("example", "matches under /repo/matches")).toThrow(/\/repo\/matches/);
  });
});

describe("the words a drawn element says", () => {
  it("includes the hints and explanations, which are labels a textContent check never sees", () => {
    // A placeholder is where a flag name goes back into the page first, because
    // it is the one label someone types from the command line straight over.
    const el = document.createElement("section");
    const input = document.createElement("input");
    input.placeholder = "one path segment, as --a takes it";
    const button = document.createElement("button");
    button.title = "Play the matches under /repo/series/alpha";
    const table = document.createElement("table");
    table.setAttribute("aria-label", "matches of /repo/matches");
    el.append(input, button, table, document.createTextNode("Pairs: 75"));

    const said = wordsOf(el);
    expect(said).toContain("one path segment, as --a takes it");
    expect(said).toContain("Play the matches under /repo/series/alpha");
    expect(said).toContain("matches of /repo/matches");
    // One line per kind of breach, and the failure message shows the whole text.
    expect(breachesOf(said)).toEqual(["names a CLI flag: --a", "shows an absolute path: /repo/series/alpha"]);
  });

  it("reads the hints on the element it is handed, not only on what is inside it", () => {
    // A view test is handed the section, and a `title` can sit on one of its
    // direct children — a walk that only descends reads past the label on the
    // node it was standing on.
    const el = document.createElement("section");
    const button = document.createElement("button");
    button.title = "Play the matches under /repo/series/alpha";
    el.append(button);

    expect(wordsOf(el)).toContain("Play the matches under /repo/series/alpha");
    expect(breachesOf(wordsOf(el))).toEqual(["shows an absolute path: /repo/series/alpha"]);
  });

  it("reads the heading over a group of choices, which is an attribute and not text", () => {
    // A seat picker groups its choices by kind, and a group heading is drawn from
    // an attribute — the one place a kind's name can be spelled in the command
    // line's words without appearing in `textContent` at all.
    const el = document.createElement("section");
    const select = document.createElement("select");
    const group = document.createElement("optgroup");
    group.label = "Registered providers (--provider)";
    const option = document.createElement("option");
    option.value = "marvin";
    group.append(option);
    select.append(group);
    el.append(select);

    expect(wordsOf(el)).toContain("Registered providers (--provider)");
    expect(breachesOf(wordsOf(el))).toEqual(["names a CLI flag: --provider"]);
  });

  it("passes an element whose text and hints are all in words", () => {
    const el = document.createElement("section");
    const input = document.createElement("input");
    input.placeholder = "the name before the slash, as in marvin/subagent";
    const button = document.createElement("button");
    button.title = "Play the matches of alpha that have no log, with the pairing its record holds";
    const select = document.createElement("select");
    const group = document.createElement("optgroup");
    group.label = "Pi's models";
    select.append(group);
    el.append(input, button, select, document.createTextNode("Pairs: 75 — the runner's default, the field is blank"));

    expectPlainWords("example", wordsOf(el));
  });
});
