/**
 * The console's design: the replay viewer's, on a page that is not the viewer's frame.
 *
 * `viewer-frame-budget.test.mjs`, beside this file, can add the viewer's frame up
 * because that frame is a fixed 1920 × 1080 box. The console is the opposite shape: it is
 * read on a laptop and sometimes on a phone through `tailscale serve`, so it is as wide as
 * the window, and it holds no fixed pixel size that a 375 px screen would have to scroll
 * to reach. Its budget therefore cannot be added up. What can be pinned is the five
 * things that decide whether it reads as the same tool as the viewer and still works
 * at a phone's width:
 *
 * **The palette and the two font families are the viewer's**, read out of `viewer.css` and
 * compared rather than restated here, so a colour changed on one page and not the other
 * fails. The console is served at `/` and the replay at `/viewer/`, and an operator crosses
 * between them mid-run: two designs side by side would read as two tools disagreeing.
 *
 * **The page is told it is the window's width.** The viewer needs no viewport meta — its
 * frame is a fixed box a phone shrinks — and the console does, or a phone lays it out at a
 * desktop's width and shrinks the result to something no one can tap.
 *
 * **Nothing wide is loose in the page.** A table cannot be squeezed below the width of its
 * own words, and the leaderboard's two are nine and eight columns of figures. Each has to
 * scroll inside a box of its own, and so does the run's `<pre>`, or the page itself slides
 * sideways and the nav bar goes off the top of the screen with it.
 *
 * **The nav bar wraps.** Four links, one of them named "Providers & models", do not fit in
 * 375 px, and a nav bar that cannot reach its fourth view is a console with three views.
 *
 * **Every block the renderers hide by attribute keeps that attribute working.** An
 * author `display` beats the user agent's `[hidden]{display:none}`, and this is the first
 * stylesheet the page has ever had, so a class that sets a `display` silently un-hides
 * whatever the renderers were hiding.
 *
 * happy-dom has no box model, so none of this is measured on a screen. The rules are read
 * out of `console.css` — the base ones, outside every `@media` block, which are what apply
 * at 375 px. That the tables arrive inside their scroll boxes is pinned where the
 * tables are drawn, in `packages/ui/web/src/render-leaderboard.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { VIEW_NAMES } from "../packages/ui/web/src/views.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CSS = readFileSync(join(ROOT, "packages/ui/web/src/console.css"), "utf8");
const HTML = readFileSync(join(ROOT, "packages/ui/web/index.html"), "utf8");
const VIEWER_CSS = readFileSync(join(ROOT, "games/salient/viewer/src/viewer.css"), "utf8");
const VIEWER_HTML = readFileSync(join(ROOT, "games/salient/viewer/index.html"), "utf8");
const VIEWER_MAIN = readFileSync(join(ROOT, "games/salient/viewer/src/main.ts"), "utf8");

/** The narrowest width the console has to hold, and the widest it is asked to. */
const PHONE = 375;
const LAPTOP = 1440;

/** The stylesheet with its comments out. They are the file's reasoning, and they
 * name the rules they explain, so a scan for a rule has to go without them. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The CSS with every `@media` block taken out: the rules that apply at every width. */
function baseOf(css) {
  let out = "";
  let at = 0;
  for (;;) {
    const block = css.indexOf("@media", at);
    if (block === -1) return out + css.slice(at);
    out += css.slice(at, block);
    let depth = 0;
    let end = css.indexOf("{", block);
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}" && (depth -= 1) === 0) break;
    }
    at = end + 1;
  }
}

const BASE = baseOf(CODE);

/** The viewer's stylesheet, same treatment: comments out, `@media` blocks out. */
const VIEWER_BASE = baseOf(VIEWER_CSS.replace(/\/\*[\s\S]*?\*\//g, ""));

/** Every rule block whose selector list names `selector`, joined as declarations. Both
 * stylesheets put each rule at the start of a line, which is what makes this readable. */
function declarations(selector, css = BASE) {
  const blocks = [];
  for (const rule of css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)) {
    if (rule[2].split(",").some((each) => each.trim() === selector)) blocks.push(rule[3]);
  }
  if (blocks.length === 0) throw new Error(`console.css has no ${selector} rule outside @media`);
  return blocks.join(";");
}

/** One declaration of a rule, or null when the rule does not make it. Anchored to the
 * start of a declaration, so `max-width` is not read as `width`. */
function declaration(block, property) {
  const match = block.match(new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+)`));
  return match === null ? null : match[1].trim();
}

/** The four palette tokens a page's `body` rule carries. */
function paletteOf(css) {
  const body = declarations("body", css);
  return [
    declaration(body, "background"),
    declaration(body, "color"),
    declaration(body, "--team-a"),
    declaration(body, "--team-b"),
  ].map((value) => (value ?? "").toLowerCase());
}

/** A page's `<head>`, as text: the console's page is read for what it links, not for a
 * live document that would fetch what it links. */
function headOf(html) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html);
  if (head === null) throw new Error("the page has no <head>");
  return head[1];
}

/** The `href` of a page's Google Fonts link, or null when it has none. */
function fontsHref(html) {
  const link = /<link href="(https:\/\/fonts\.googleapis\.com[^"]*)"/.exec(html);
  return link === null ? null : link[1];
}

/**
 * The classes the viewer's own entry hides by attribute.
 *
 * `main.ts` holds each block it shows or hides as an `element("#id")`, so the
 * set is read out of that file rather than written out here: an element the entry
 * starts hiding is in the list the next time the file is read, which is the point
 * — a list kept by hand is the convention this check exists to replace.
 */
function viewerHiddenClasses() {
  const held = new Map(
    [...VIEWER_MAIN.matchAll(/const (\w+) = element<[^>]+>\("#([\w-]+)"\)/g)].map((each) => [
      each[1],
      each[2],
    ]),
  );

  const classes = new Set();
  for (const each of VIEWER_MAIN.matchAll(/(\w+)\.hidden\s*=/g)) {
    const id = held.get(each[1]);
    if (id === undefined) continue;
    const tag = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(VIEWER_HTML);
    if (tag === null) throw new Error(`the viewer's page has no #${id}`);
    const carried = /class="([^"]*)"/.exec(tag[0]);
    for (const name of carried === null ? [] : carried[1].split(/\s+/)) classes.add(name);
  }
  return [...classes];
}

describe("the console's page", () => {
  it("loads its own stylesheet, out of the source the build bundles", () => {
    expect(headOf(HTML)).toContain('<link rel="stylesheet" href="/src/console.css">');
  });

  it("asks for the viewer's fonts, link for link", () => {
    // The same link, character for character: the console wears that design, so
    // it asks for the same faces at the same weights.
    expect(fontsHref(HTML)).toBe(fontsHref(VIEWER_HTML));
    expect(fontsHref(HTML)).toContain("IBM+Plex+Sans:wght@400;500;600");
    expect(fontsHref(HTML)).toContain("Barlow+Semi+Condensed:wght@500;600;700");
  });

  it("is told it is the window's width", () => {
    // The viewer's page needs no viewport meta — its frame is a fixed 1920 ×
    // 1080 box a phone shows shrunk — and the console does, or a phone lays it
    // out at a desktop's width and shrinks the result to something no one can
    // tap. What the viewer's own head holds is not this page's business.
    expect(headOf(HTML)).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
  });

  it("wears the viewer's palette, token for token", () => {
    expect(paletteOf(CSS)).toEqual(paletteOf(VIEWER_CSS));
    expect(paletteOf(CSS)).toEqual(["#12161c", "#eef1f5", "#2c6fd1", "#e06f35"]);
  });

  it("sets its type in the viewer's two families, on the viewer's stacks", () => {
    expect(CSS).toContain("'IBM Plex Sans'");
    expect(CSS).toContain("'Barlow Semi Condensed'");
    // The fallbacks too, so a machine that cannot reach the fonts gets the same
    // page at both ends of a run.
    expect(declaration(declarations("body"), "font-family")).toBe(
      declaration(declarations("body", VIEWER_CSS), "font-family"),
    );
  });

  it("keeps the run's lines and every path in the CLI's face", () => {
    // The run's output is the terminal's own text, and a path is a path.
    expect(declarations(".run-lines")).toMatch(/font-family:[^;]*monospace/);
    expect(declarations("code")).toMatch(/font-family:[^;]*monospace/);
  });
});

describe("the console at a phone's width", () => {
  it("has a media rule, and none of them applies at 375 px", () => {
    const conditions = [...CODE.matchAll(/@media([^{]*)\{/g)].map((match) => match[1].trim());
    expect(conditions.length).toBeGreaterThan(0);
    // The base rules are the whole layout at 375 px, which is what makes the
    // checks below about this page at that width rather than about a phone-only
    // branch someone could later forget to keep narrow-safe.
    for (const condition of conditions) {
      const wide = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(condition);
      expect(wide, `@media ${condition} is not a min-width rule`).not.toBeNull();
      expect(Number(wide[1])).toBeGreaterThan(PHONE);
      expect(Number(wide[1])).toBeLessThan(LAPTOP);
    }
  });

  it("wraps its nav bar instead of running it off the screen", () => {
    expect(declarations(".nav")).toMatch(/flex-wrap:\s*wrap/);
    // A link that cannot shrink is one link too many in the row.
    expect(declaration(declarations(".view-link"), "width")).toBeNull();

    // And the bar reaches every view: `views.ts` draws one link per view into the
    // `#nav` the page holds, and every view has the wrapper it shows or hides.
    expect(HTML).toContain('<nav id="nav"');
    for (const view of VIEW_NAMES) {
      expect(HTML, `the page has no ${view} view`).toContain(`id="view-${view}"`);
    }
  });

  it("keeps a hidden part of the page out of the page it is hidden from", () => {
    // Each of these classes sets a `display`, and an author `display` always wins
    // over the user agent's `[hidden]{display:none}` — so every block the
    // renderers hide by setting the attribute has to have the rule put back.
    // `views.ts` hides the three views that are not showing; `render-start.ts`
    // hides the limits fields the chosen Run kind has no flag for, and a `--seed`
    // left on the page under a kind that has no seed is a form asking for the
    // wrong run. The viewer puts the same rule back for its own hidden blocks.
    const guards = [
      [".view", /\.view\[hidden\]\{[^}]*display:\s*none/],
      [".field", /\.field\[hidden\]\{[^}]*display:\s*none/],
      // `render-providers.ts` builds every row's edit form with the row and hides
      // it, so a row that has not been asked to be edited does not show its form.
      [".provider-edit", /\.provider-edit\[hidden\]\{[^}]*display:\s*none/],
    ];
    for (const [selector, guard] of guards) {
      expect(CSS, `${selector} is hidden by attribute and has no rule for it`).toMatch(guard);
    }

    // The viewer's page, same stylesheet and same trap. Its entry hides the
    // blocks that wait for a log, and — for a viewer the console opened with
    // `?log=` — the file picker and the sentence under it. Only a class that
    // sets a `display` of its own needs the rule put back; the rest are hidden
    // by the user agent's `[hidden]{display:none}` already.
    const hidden = viewerHiddenClasses();
    expect(hidden.length, "the viewer's entry hides nothing by attribute").toBeGreaterThan(0);
    for (const name of hidden) {
      const rule = new RegExp(`\\.${name}\\{[^}]*\\bdisplay:`).exec(VIEWER_BASE);
      if (rule === null) continue;
      expect(
        VIEWER_CSS,
        `.${name} sets a display and the viewer hides it by attribute, so viewer.css has to put [hidden] back`,
      ).toMatch(new RegExp(`\\.${name}\\[hidden\\]\\{[^}]*display:\\s*none`));
    }
  });

  it("scrolls a wide table inside its own box rather than sideways with the page", () => {
    expect(declarations(".table-scroll")).toMatch(/overflow-x:\s*auto/);
    // The box is as wide as the section it sits in and no wider, so the overflow
    // stays the box's problem rather than becoming the page's.
    expect(declaration(declarations(".table-scroll"), "width")).toBeNull();
    expect(declaration(declarations(".frame"), "width")).toBeNull();
    expect(declaration(declarations(".section"), "width")).toBeNull();
  });

  it("scrolls the run's lines inside their box, and keeps the page's measure fluid", () => {
    expect(declarations(".run-lines")).toMatch(/overflow-x:\s*auto/);
    // The frame is the window up to a readable measure — never the viewer's
    // 1920 px box, which at 375 px would be a page nearly four times as wide as
    // the screen holding it.
    expect(declaration(declarations(".frame"), "max-width")).toMatch(/\d+px/);
    expect(declaration(declarations(".frame"), "height")).toBeNull();
  });

  it("counts its figures in the viewer's numeral face", () => {
    expect(declarations(".num")).toMatch(/Barlow Semi Condensed/);
    expect(declarations(".num")).toMatch(/letter-spacing/);
  });
});
