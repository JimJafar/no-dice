// @vitest-environment happy-dom
/**
 * The way back to the console that opened this viewer.
 *
 * The console links a replay from a view — Matches, Leaderboard — and names
 * that view in the URL it hands over, as `back=%23matches`. This file is
 * the whole of the viewer's side of that: what the query names, resolved to an
 * address the page can put in an `href`, and nothing when the query names
 * nothing. A viewer opened on its own — straight off `vite dev`, off
 * `vite preview`, or out of a `file://` folder — names no `back`, and so has
 * no link to offer.
 */
import { describe, expect, it } from "vitest";

import { backHref, backLinkOf } from "./back.ts";

describe("backHref", () => {
  it("names no way back for a viewer nobody opened from the console", () => {
    expect(backHref("")).toBeNull();
    expect(backHref("?log=/logs/135-greedy-random.json")).toBeNull();
    expect(backHref("?series=/logs/alpha/showcase.json")).toBeNull();
    // An empty `back=` names nothing, the way an empty `?log=` names no URL.
    expect(backHref("?log=/logs/a.json&back=")).toBeNull();
  });

  it("resolves the view the console named against the console's own root", () => {
    // The console serves this page one level under its own root, so `../` from
    // `/viewer/` is the console, and the view's hash goes on the end of it.
    expect(backHref("?log=/logs/a.json&back=%23matches")).toBe("../#matches");
    expect(backHref("?back=%23leaderboard")).toBe("../#leaderboard");
    // The search string arrives without its `?` when it is assembled by hand,
    // as it does in `load.ts`'s tests.
    expect(backHref("back=%23runs")).toBe("../#runs");
  });

  it("keeps a value that needs no escaping as the console wrote it", () => {
    expect(backHref("?back=matches")).toBe("../matches");
  });
});

describe("backLinkOf", () => {
  it("makes no link when the query names no view to go back to", () => {
    expect(backLinkOf("")).toBeNull();
    expect(backLinkOf("?log=/logs/a.json")).toBeNull();
  });

  it("offers one link back to the console, in words a viewer reads", () => {
    const link = backLinkOf("?log=/logs/a.json&back=%23matches");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("../#matches");
    expect(link!.textContent).toBe("Back to the console");
    expect(link!.className).toBe("back");
  });
});
