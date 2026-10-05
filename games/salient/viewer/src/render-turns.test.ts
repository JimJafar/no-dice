// @vitest-environment happy-dom
/**
 * The controls the viewer uses to move through the match: a step back, a step
 * forward, autoplay, and a slider that goes straight to a turn. What a frame
 * means is `turns.test.ts`; what matters here is that a click asks for the move
 * and that the controls only ever show the frame the page agreed to — the same
 * rule `view-mode.test.ts` holds the fog toggle to.
 */
import { describe, expect, it } from "vitest";

import { mountTurnControls } from "./render-turns.ts";
import type { TurnControlHandlers } from "./render-turns.ts";
import type { FrameState } from "./turns.ts";

/** A log of every move the viewer asked for. */
function recorded(): { handlers: TurnControlHandlers; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    handlers: {
      stepBack: () => asked.push("back"),
      stepForward: () => asked.push("forward"),
      scrub: (frame) => asked.push(`scrub ${frame}`),
      play: () => asked.push("play"),
      pause: () => asked.push("pause"),
    },
  };
}

/** The controls' parts, found the way the page finds them. */
function parts(container: HTMLElement) {
  const back = container.querySelector<HTMLButtonElement>("button[data-step='back']");
  const forward = container.querySelector<HTMLButtonElement>("button[data-step='forward']");
  const play = container.querySelector<HTMLButtonElement>("button[data-play]");
  const slider = container.querySelector<HTMLInputElement>("input[type='range']");
  for (const [name, el] of Object.entries({ back, forward, play, slider })) {
    expect(el, `${name} is missing from the controls`).toBeTruthy();
  }
  return { back: back!, forward: forward!, play: play!, slider: slider! };
}

describe("mountTurnControls", () => {
  it("draws the four ways of moving, and asks for nothing until the viewer moves it", () => {
    const container = document.createElement("div");
    const { handlers, asked } = recorded();
    mountTurnControls(container, handlers);

    parts(container);
    expect(asked).toEqual([]);
  });

  it("asks for a step back and a step forward, and stops at the ends of the log", () => {
    const container = document.createElement("div");
    const { handlers, asked } = recorded();
    const controls = mountTurnControls(container, handlers);
    const { back, forward } = parts(container);

    controls.select({ frame: 11, last: 25, playing: false });
    back.click();
    forward.click();
    expect(asked).toEqual(["back", "forward"]);

    // The start position has nothing before it and the last logged turn nothing
    // after it, so the button that would step off the log is not offered.
    controls.select({ frame: 0, last: 25, playing: false });
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);

    controls.select({ frame: 25, last: 25, playing: false });
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);
  });

  it("scrubs to whichever turn the slider is moved to", () => {
    const container = document.createElement("div");
    const { handlers, asked } = recorded();
    const controls = mountTurnControls(container, handlers);
    const { slider } = parts(container);

    controls.select({ frame: 11, last: 25, playing: false });
    // The slider spans the log: the start position through the last turn it holds.
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("25");
    expect(slider.value).toBe("11");

    slider.value = "7";
    slider.dispatchEvent(new Event("input"));
    expect(asked).toEqual(["scrub 7"]);
  });

  it("follows the frame the page shows, including a log that ends early", () => {
    const container = document.createElement("div");
    const controls = mountTurnControls(container, recorded().handlers);
    const { slider } = parts(container);

    // golden-02's match was knocked out at turn 23 of a 25-turn config: the
    // slider ends at the last turn the log holds, not at the config's length.
    const state: FrameState = { frame: 23, last: 23, playing: false };
    controls.select(state);
    expect(slider.max).toBe("23");
    expect(slider.value).toBe("23");
  });

  it("asks for autoplay, and for the pause once the page says it is running", () => {
    const container = document.createElement("div");
    const { handlers, asked } = recorded();
    const controls = mountTurnControls(container, handlers);
    const { play } = parts(container);

    play.click();
    // The button does not decide the frame is playing: the page does, and tells
    // the controls afterwards.
    expect(asked).toEqual(["play"]);
    expect(play.textContent).not.toBe("Pause");

    controls.select({ frame: 11, last: 25, playing: true });
    expect(play.textContent).toBe("Pause");
    expect(play.getAttribute("aria-pressed")).toBe("true");

    play.click();
    expect(asked).toEqual(["play", "pause"]);
  });
});
