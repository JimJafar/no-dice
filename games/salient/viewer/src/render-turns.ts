/**
 * The controls that move the replay: a step back, a step forward, autoplay, and
 * a slider that goes straight to a turn.
 *
 * They ask for moves and never make them. The frame index lives in `turns.ts`,
 * the page holds it, and `select` tells these controls what is showing — which
 * is what keeps a slider from claiming a turn the board is not drawing, and lets
 * the ends of the log be marked from what the log actually holds rather than from
 * `config.turns`: a match knocked out at turn 23 has no turn 24 to scrub to.
 *
 * The mock-ups draw no controls, because a mock-up is one frozen frame
 * (`salient/docs/salient-mockups.md`), so this is the palette's own control: the
 * same panels and small-caps labels the view toggle uses.
 */
import type { FrameState, TurnFrames } from "./turns.ts";

/** What the viewer asks for; the page decides what any of it does to the frame. */
export interface TurnControlHandlers {
  stepBack(): void;
  stepForward(): void;
  scrub(frame: number): void;
  play(): void;
  pause(): void;
}

/** The handle the page uses to say which frame these controls are showing. */
export interface TurnControls {
  select(state: FrameState): void;
}

/**
 * The handlers the page hands the controls: each one moves `frames` and then
 * calls `onFrame`, which is what makes the page draw where it moved to. A
 * control that moved the index without saying so would leave the board, the
 * header, the panels and the chart on the frame before — and autoplay would
 * never start, since running the page's timer is part of drawing. Kept here
 * rather than written out in `main.ts` so the wiring itself can be tested
 * against a real frame index.
 */
export function frameHandlers(frames: TurnFrames, onFrame: () => void): TurnControlHandlers {
  const move = (act: () => void): (() => void) => () => {
    act();
    onFrame();
  };
  return {
    stepBack: move(() => frames.stepBack()),
    stepForward: move(() => frames.stepForward()),
    scrub: (frame) => {
      frames.scrub(frame);
      onFrame();
    },
    play: move(() => frames.play()),
    pause: move(() => frames.pause()),
  };
}

/**
 * Draw the controls into `container` and call `handlers` with whatever the
 * viewer asks for. Nothing is marked by a click itself: the page holds the frame
 * index, redraws, and reports it back through `select`.
 */
export function mountTurnControls(container: HTMLElement, handlers: TurnControlHandlers): TurnControls {
  const step = (which: "back" | "forward"): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.step = which;
    button.textContent = which === "back" ? "Back" : "Forward";
    button.addEventListener("click", () => (which === "back" ? handlers.stepBack() : handlers.stepForward()));
    return button;
  };

  const back = step("back");
  const forward = step("forward");

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "scrub";
  slider.min = "0";
  slider.max = "0";
  slider.step = "1";
  slider.value = "0";
  slider.setAttribute("aria-label", "Turn to show");
  slider.addEventListener("input", () => handlers.scrub(Number(slider.value)));

  const play = document.createElement("button");
  play.type = "button";
  play.dataset.play = "play";
  play.textContent = "Play";
  play.setAttribute("aria-pressed", "false");
  play.addEventListener("click", () =>
    play.getAttribute("aria-pressed") === "true" ? handlers.pause() : handlers.play(),
  );

  container.replaceChildren(back, slider, forward, play);

  return {
    select: ({ frame, last, playing }: FrameState): void => {
      slider.max = String(last);
      slider.value = String(frame);
      // A step off either end of the log has nowhere to land, so it is not
      // offered rather than silently doing nothing.
      back.disabled = frame === 0;
      forward.disabled = frame === last;
      play.textContent = playing ? "Pause" : "Play";
      play.setAttribute("aria-pressed", String(playing));
    },
  };
}
