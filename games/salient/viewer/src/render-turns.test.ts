// @vitest-environment happy-dom
/**
 * The controls the viewer uses to move through the match: a step back, a step
 * forward, autoplay, and a slider that goes straight to a turn. What a frame
 * means is `turns.test.ts`; what matters here is that a click asks for the move
 * and that the controls only ever show the frame the page agreed to — the same
 * rule `view-mode.test.ts` holds the fog toggle to.
 */
import { describe, expect, it } from "vitest";
import { matchLogSchema } from "@no-dice/log";

import { cellsAt } from "./board.ts";

import { frameHandlers, mountTurnControls } from "./render-turns.ts";
import type { TurnControlHandlers } from "./render-turns.ts";
import { turnFrames } from "./turns.ts";
import type { FrameState, TurnFrames } from "./turns.ts";
import golden01 from "../fixtures/golden-01-time-win.json" with { type: "json" };

const log = matchLogSchema.parse(golden01);

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

/**
 * `frameHandlers` is the link between the controls and the frame index, and it
 * is what `main.ts` hands `mountTurnControls`. The tests above deliberately keep
 * the controls from updating anything themselves, which makes this the one place
 * a click can go nowhere — so it is wired to a real frame index here, and the
 * page's redraw is recorded rather than stubbed out.
 */
describe("frameHandlers", () => {
  /** The controls wired to a real frame index, and the frames it redrew. */
  function wired(start = 10): {
    frames: TurnFrames;
    drawn: number[];
    back: HTMLButtonElement;
    forward: HTMLButtonElement;
    play: HTMLButtonElement;
    slider: HTMLInputElement;
  } {
    const container = document.createElement("div");
    const frames = turnFrames(log);
    const drawn: number[] = [];
    const report = (): void => {
      // What `main.ts` does after moving the index: report it to the controls,
      // which is what keeps the slider and the two step buttons in step with it.
      controls.select(frames.state());
      drawn.push(frames.view().frame);
    };
    const controls = mountTurnControls(container, frameHandlers(frames, report));
    // The index opens on the last logged turn, so getting to `start` is a scrub
    // through the page rather than a bare call on the index: a button the page
    // had disabled at the end of the log would stay disabled otherwise.
    frames.scrub(start);
    report();
    drawn.length = 0;
    const { back, forward, play, slider } = parts(container);
    return { frames, drawn, back, forward, play, slider };
  }

  it("steps back to the previous turn's settled board, and tells the page", () => {
    const { frames, drawn, back } = wired();

    back.click();

    expect(frames.state().frame).toBe(9);
    const view = frames.view();
    expect(view.phase).toBe("settled");
    expect(view.board).toBe(9);
    expect(cellsAt(log, view.board)).toEqual(log.turns.find((t) => t.n === 9)!.after.cells);
    // The page was told once, after the move, and not before it.
    expect(drawn).toEqual([9]);
  });

  it("steps forward to the next turn's settled board, and tells the page", () => {
    const { frames, drawn, forward } = wired();

    forward.click();

    expect(frames.view()).toMatchObject({ frame: 11, phase: "settled", board: 11 });
    expect(drawn).toEqual([11]);
  });

  it("scrubs to the turn the slider names, settled, and tells the page", () => {
    const { frames, drawn, slider } = wired();

    slider.value = "7";
    slider.dispatchEvent(new Event("input"));

    expect(frames.view()).toMatchObject({ frame: 7, phase: "settled", board: 7 });
    expect(cellsAt(log, frames.view().board)).toEqual(log.turns.find((t) => t.n === 7)!.after.cells);
    expect(drawn).toEqual([7]);
  });

  it("leaves autoplay running, so the page's timer has something to step", () => {
    const { frames, play } = wired();

    play.click();

    expect(frames.playing()).toBe(true);
    // The page's timer calls `tick()`; the first step of the next turn shows the
    // board as it stood, with nothing over it yet.
    frames.tick();
    expect(frames.view()).toMatchObject({ frame: 11, phase: "before", board: 10 });
    expect(frames.playing()).toBe(true);
  });

  it("pauses mid-turn on the settled frame, and tells the page", () => {
    const { frames, drawn, play } = wired();
    play.click();
    frames.tick();
    frames.tick();
    expect(frames.view().phase).toBe("orders");

    play.click();

    expect(frames.playing()).toBe(false);
    expect(frames.view()).toMatchObject({ frame: 11, phase: "settled", board: 11 });
    expect(drawn).toEqual([10, 11]);
  });
});
