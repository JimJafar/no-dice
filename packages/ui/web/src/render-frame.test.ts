// @vitest-environment happy-dom
/**
 * The frame the console draws: five sections, and what is left standing under
 * each heading. Every section with an answer of its own has a module of its own
 * — the form in `#start`, the run in `#progress`, the listings in `#results`, the
 * registry in `#providers` — so what this file holds is that the frame takes
 * those sections back to their heading and no further, and that a redraw does
 * not leave a stale row behind.
 */
import { describe, expect, it } from "vitest";

import { SECTION_IDS, frameSections, renderFrame } from "./render-frame.ts";
import type { FrameSections } from "./render-frame.ts";

/** A frame in the shape `index.html` gives it. */
const frame = (): { sections: FrameSections; root: HTMLElement } => {
  const root = document.createElement("div");
  for (const id of SECTION_IDS) {
    const section = document.createElement("section");
    section.id = id;
    const heading = document.createElement("h2");
    heading.textContent = id;
    section.append(heading);
    root.append(section);
  }
  document.body.append(root);
  return { sections: frameSections(root), root };
};

describe("frameSections", () => {
  it("names the five sections the console is made of", () => {
    const { sections } = frame();
    expect(Object.keys(sections)).toEqual([...SECTION_IDS]);
    expect(SECTION_IDS).toEqual(["start", "progress", "results", "providers", "leaderboard"]);
  });

  it("says which section a page is missing", () => {
    const root = document.createElement("div");
    expect(() => frameSections(root)).toThrow("#start is missing from index.html");
  });
});

describe("renderFrame", () => {
  it("leaves the start section to the module that builds the form, rather than drawing a second list of seats", () => {
    const { sections, root } = frame();
    renderFrame(sections);

    // The seat pickers are `render-start.ts`'s, built out of this same state. A
    // list drawn here would be a second account of the same seats, and a frame
    // that redrew `#start` would wipe what someone had typed into the form.
    expect(root.querySelector("#start")?.children).toHaveLength(1);
  });

  it("leaves the progress section to the run's own module, rather than inventing a line for a run it cannot see", () => {
    const { sections, root } = frame();
    renderFrame(sections);
    renderFrame(sections);

    // `/api/state` does not carry a run: `/api/run` does, and the page reads that
    // once a second, putting its lines back under this heading after every frame.
    // A line drawn here would be a second, staler account of it.
    expect(root.querySelector("#progress")?.children).toHaveLength(1);
  });

  it("leaves the results section to the module that reads the listings, rather than naming roots it cannot list", () => {
    const { sections, root } = frame();
    renderFrame(sections);

    // `/api/state` knows the two roots but not what stands in them. The roots
    // belong on the page beside the listing they were taken from, which is
    // `results.ts`'s, from `/api/series` and `/api/matches`.
    expect(root.querySelector("#results")?.children).toHaveLength(1);
  });

  it("leaves the providers section to the module that lists the registry", () => {
    const { sections, root } = frame();
    renderFrame(sections);

    // `render-providers.ts` draws the whole entry — endpoint, api, the key
    // variable's name, the window, the cap, the rates — from `/api/providers`,
    // along with the add form and the credential check under each row. A list
    // drawn here from `/api/state` would be a second, narrower account of the
    // same providers, and a frame that redrew the section would wipe a check the
    // operator had just asked for.
    expect(root.querySelector("#providers")?.children).toHaveLength(1);
    expect(root.querySelector(".providers")).toBeNull();
  });

  it("keeps each section's heading and replaces only what stands under it", () => {
    const { sections, root } = frame();
    // What a section's own module put there, as if it had drawn it.
    const stale = document.createElement("p");
    stale.className = "providers-none";
    stale.textContent = "The registry names no provider yet.";
    sections.providers.append(stale);

    renderFrame(sections);

    expect(root.querySelectorAll("h2")).toHaveLength(SECTION_IDS.length);
    expect(root.querySelector(".providers-none")).toBeNull();
  });

  it("leaves the leaderboard standing empty until a series has been counted", () => {
    const { sections, root } = frame();
    renderFrame(sections);

    expect(root.querySelector("#leaderboard")?.children).toHaveLength(1);
  });
});
