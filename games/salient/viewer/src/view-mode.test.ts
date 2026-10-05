// @vitest-environment happy-dom
/**
 * The toggle's own decisions: three buttons, one of them marked as showing, and
 * the mode a click asks for. What a mode does to the board is `fog.test.ts` and
 * `render-board.test.ts`; what matters here is that the frame and the buttons
 * never disagree about which seat's eyes the board is seen through.
 */
import { describe, expect, it } from "vitest";

import { BOARD_MODES, DEFAULT_MODE, mountViewToggle } from "./view-mode.ts";
import type { BoardMode } from "./view-mode.ts";

/** The toggle's buttons, keyed by the mode each one asks for. */
function buttons(container: HTMLElement): Map<BoardMode, HTMLButtonElement> {
  const made = new Map<BoardMode, HTMLButtonElement>();
  for (const button of container.querySelectorAll<HTMLButtonElement>("button")) {
    const mode = button.dataset.mode as BoardMode | undefined;
    expect(mode, "a toggle button names no mode to switch to").toBeTruthy();
    made.set(mode!, button);
  }
  return made;
}

/** The modes currently marked pressed, in the order the toggle offers them. */
function pressed(container: HTMLElement): BoardMode[] {
  return BOARD_MODES.filter((mode) => container.querySelector(`button[data-mode="${mode}"]`)?.getAttribute("aria-pressed") === "true");
}

describe("mountViewToggle", () => {
  it("offers the spectator frame and each seat's fog, and opens on the spectator", () => {
    const container = document.createElement("div");
    const asked: BoardMode[] = [];
    mountViewToggle(container, (mode) => asked.push(mode));

    expect([...buttons(container).keys()]).toEqual([...BOARD_MODES]);
    expect(DEFAULT_MODE).toBe("spectator");
    expect(pressed(container)).toEqual([DEFAULT_MODE]);
    // Mounting draws the buttons; it does not ask for a frame of its own.
    expect(asked).toEqual([]);
  });

  it("names each mode in words a viewer reads", () => {
    const container = document.createElement("div");
    mountViewToggle(container, () => {});
    const labels = new Map([...buttons(container)].map(([mode, button]) => [mode, button.textContent]));
    expect(labels.get("spectator")).toBe("Spectator");
    expect(labels.get("A")).toBe("Player A fog");
    expect(labels.get("B")).toBe("Player B fog");
  });

  it("reports the mode a click asks for, and marks it only once the page agrees", () => {
    const container = document.createElement("div");
    const asked: BoardMode[] = [];
    const toggle = mountViewToggle(container, (mode) => asked.push(mode));
    const made = buttons(container);

    made.get("B")!.click();
    made.get("A")!.click();
    expect(asked).toEqual(["B", "A"]);
    // Neither click moved the marks: the page holds the mode, and the buttons
    // follow the frame rather than getting ahead of it.
    expect(pressed(container)).toEqual(["spectator"]);

    toggle.select("A");
    expect(pressed(container)).toEqual(["A"]);
    toggle.select("spectator");
    expect(pressed(container)).toEqual(["spectator"]);
  });

  it("marks whichever mode the page says is showing", () => {
    const container = document.createElement("div");
    const toggle = mountViewToggle(container, () => {});

    toggle.select("A");
    expect(pressed(container)).toEqual(["A"]);
    toggle.select("spectator");
    expect(pressed(container)).toEqual(["spectator"]);
  });
});
