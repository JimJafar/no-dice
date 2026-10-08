/**
 * The console's design: the replay viewer's, on a page that is not the viewer's frame.
 *
 * `viewer-frame-budget.test.mjs`, beside this file, can add the viewer's frame up
 * because that frame is a fixed 1920 × 1080 box. The console is the opposite shape: it is
 * read on a laptop and sometimes on a phone through `tailscale serve`, so it is as wide as
 * the window, and it holds no fixed pixel size that a 375 px screen would have to scroll
 * to reach. Its budget therefore cannot be added up. What can be pinned is the four
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

  it("is told it is the window's width, which the viewer is not", () => {
    expect(headOf(HTML)).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
    // The viewer has none, and that is right for it: its frame is a fixed
    // 1920 × 1080 box. Pinning the difference keeps the two pages' one real
    // layout disagreement on the record.
    expect(VIEWER_HTML).not.toContain('name="viewport"');
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

  it("keeps a hidden view out of the page it is hidden from", () => {
    // `.view` sets a `display`, which would win over the `hidden` attribute
    // `views.ts` uses for the three views that are not showing.
    expect(CSS).toMatch(/\.view\[hidden\]\{[^}]*display:\s*none/);
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
