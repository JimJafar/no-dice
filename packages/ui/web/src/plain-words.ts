/**
 * The one rule the console's front end is held to, written once so every view is
 * held to it the same way: the page speaks in words.
 *
 * A benchmark run is read by someone who typed a command and then looked at a
 * browser. The two have to line up, and they line up on what a run *was* — the
 * pairing, the seed, the day, how far it got — not on the words that happened to
 * be typed to start it, nor on the names of the files it left behind. A flag name
 * in a field label makes a reader wonder whether the browser needs the command
 * line; an absolute path in a heading is a fact about the machine nobody can act
 * on; a log file name in a row says `1234-greedy-random.json` to someone who
 * wants to know who played, on what seed, when.
 *
 * The checks run over the text a view draws — `textContent`, which is what a
 * reader sees — and not over the `href` of a link, which is what a browser
 * follows. A link keeps the URL the console gave it: that address is the
 * console's own, and rewriting it would break the replay.
 *
 * This is a test helper, not part of the page: nothing in `main.ts` imports it.
 */

/** A CLI flag: `--max-cost`, or any two dashes, a letter, and the rest of the word. */
const FLAG = /--[a-z][\w-]*/i;

/**
 * An absolute path: a slash that starts a path rather than sitting inside a word.
 *
 * What that leaves out is what the page legitimately says with a slash in it: a
 * model named `marvin/subagent` or `deepseek/deepseek-flash`, whose slash has a
 * word on both sides of it, and a URL's `://`, whose first slash is followed by
 * another one. What it catches is a path glued to anything — a space,
 * a comma, an arrow, an equals sign, the start of the text — because that is the
 * shape a label takes when someone writes `under,/repo/series` or
 * `root -> /repo/series`.
 */
const ABSOLUTE_PATH = /(^|[^\w/])\/(?!\/)[^\s]+/;

/** The name of a log file, as the console names them on disk: the whole token, not one letter of it. */
const LOG_FILE_NAME = /[\w.-]+\.json\b/;

/**
 * Why a piece of drawn text breaks the rule, as lines; empty when it does not.
 *
 * Returned rather than thrown so the test that calls it can name the view it
 * drew and show the text that broke the rule — the part whoever reads the
 * failure needs.
 */
export const breachesOf = (text: string): string[] => {
  const found: string[] = [];
  if (FLAG.test(text)) found.push(`names a CLI flag: ${String(text.match(FLAG)?.[0])}`);
  if (ABSOLUTE_PATH.test(text)) {
    // The match carries whatever the path was glued to, which is not part of
    // the path: one character of glue, then the path from its first slash.
    const glued = String(text.match(ABSOLUTE_PATH)?.[0].trim());
    found.push(`shows an absolute path: ${glued.replace(/^\S(?=\/)/, "")}`);
  }
  if (LOG_FILE_NAME.test(text)) found.push(`shows a log file name: ${String(text.match(LOG_FILE_NAME)?.[0])}`);
  return found;
};

/** Assert that everything a view drew is in plain words, and show it if it is not. */
export const expectPlainWords = (view: string, text: string): void => {
  const breaches = breachesOf(text);
  if (breaches.length > 0) {
    throw new Error(`the ${view} view is not in plain words — ${breaches.join("; ")}\n\ndrew:\n${text}`);
  }
};

/**
 * Everything a drawn element says, in the order a reader meets it: the text, and
 * the attributes that stand in for text — a field's hint, a button's explanation,
 * a control's accessible name.
 *
 * `textContent` alone misses the labels most likely to drift back to a flag name,
 * because a placeholder is where someone writes the flag they have in mind. Those
 * three attributes are every one this page uses to label something without
 * drawing words for it.
 */
export const wordsOf = (el: HTMLElement): string => {
  // The element itself is part of the walk: a `title` or an `aria-label` can sit
  // on the very node the view test was handed, and a descendant-only walk would
  // read straight past it.
  const said = [el.textContent ?? ""];
  for (const each of [el, ...el.querySelectorAll("[placeholder], [title], [aria-label]")]) {
    for (const name of ["placeholder", "title", "aria-label"]) {
      const value = each.getAttribute(name);
      if (value !== null) said.push(value);
    }
  }
  return said.join("\n");
};
