// @vitest-environment happy-dom
/**
 * The frame the console draws: five sections, and what the console's state puts
 * under each heading. The state itself is `state.test.ts`'s business; this file
 * asks whether the page that gets drawn says what that state says — including
 * the two things it must not say, which are a provider's endpoint and a key.
 */
import { describe, expect, it } from "vitest";

import { SECTION_IDS, frameSections, renderFrame } from "./render-frame.ts";
import type { FrameSections } from "./render-frame.ts";
import type { UiState } from "./state.ts";

/** The state a console that has just started answers. */
const STATE: UiState = {
  bots: ["bot:random", "bot:greedy"],
  providers: [
    { name: "marvin", apiKeyEnv: null },
    { name: "openai", apiKeyEnv: "OPENAI_API_KEY" },
  ],
  seriesRoot: "/repo/series",
  matchesRoot: "/repo/matches",
  running: null,
};

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

/** The text of one section, its heading included. */
const textOf = (root: HTMLElement, id: string): string =>
  root.querySelector<HTMLElement>(`#${id}`)?.textContent ?? "";

/** The items of one list, by the class the section gives it. */
const itemsOf = (root: HTMLElement, listClass: string): string[] =>
  [...root.querySelectorAll<HTMLElement>(`.${listClass} li`)].map((li) => li.textContent ?? "");

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
    renderFrame(sections, STATE);

    // The seat pickers are `render-start.ts`'s, built out of this same state. A
    // list drawn here would be a second account of the same seats, and a frame
    // that redrew `#start` would wipe what someone had typed into the form.
    expect(root.querySelector("#start")?.children).toHaveLength(1);
  });

  it("leaves the progress section to the run's own module, rather than inventing a line for a run it cannot see", () => {
    const { sections, root } = frame();
    renderFrame(sections, STATE);
    renderFrame(sections, { ...STATE, running: { state: "running" } });

    // `/api/state` does not carry a run: `/api/run` does, and the page reads that
    // once a second. A line drawn here would be a second, staler account of it.
    expect(root.querySelector("#progress")?.children).toHaveLength(1);
  });

  it("leaves the results section to the module that reads the listings, rather than naming roots it cannot list", () => {
    const { sections, root } = frame();
    renderFrame(sections, STATE);

    // `/api/state` knows the two roots but not what stands in them. The roots
    // belong on the page beside the listing they were taken from, which is
    // `results.ts`'s, from `/api/series` and `/api/matches`.
    expect(root.querySelector("#results")?.children).toHaveLength(1);
  });

  it("names each provider with the variable its key is read from, and says when it checks none", () => {
    const { sections, root } = frame();
    renderFrame(sections, STATE);

    expect(itemsOf(root, "providers")).toEqual([
      "marvin — no key checked",
      "openai — key from OPENAI_API_KEY",
    ]);
  });

  it("says when the registry names no provider, rather than drawing an empty list", () => {
    const { sections, root } = frame();
    renderFrame(sections, { ...STATE, providers: [] });

    expect(root.querySelector(".providers")).toBeNull();
    expect(textOf(root, "providers")).toContain("The registry names no provider yet.");
  });

  it("keeps each section's heading and replaces only what stands under it", () => {
    const { sections, root } = frame();
    renderFrame(sections, STATE);
    renderFrame(sections, { ...STATE, providers: [{ name: "marvin", apiKeyEnv: null }] });

    expect(root.querySelectorAll("h2")).toHaveLength(SECTION_IDS.length);
    expect(itemsOf(root, "providers")).toEqual(["marvin — no key checked"]);
  });

  it("leaves the leaderboard standing empty until a series has been counted", () => {
    const { sections, root } = frame();
    renderFrame(sections, STATE);

    expect(root.querySelector("#leaderboard")?.children).toHaveLength(1);
  });
});
