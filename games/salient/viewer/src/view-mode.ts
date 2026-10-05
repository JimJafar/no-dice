/**
 * Which seat's eyes the frame shows, and the buttons that ask for one.
 *
 * The spectator frame is the logged truth. A seat's frame is that same board
 * with only what that seat can see left in it — fog changes visibility, never
 * the score bar, the panels or the chart, which keep showing what the log says.
 * So the page holds the mode and re-renders the board itself; this file only
 * draws the three buttons, marks the one showing, and reports the one the
 * viewer asks for, which is what keeps the buttons from drifting out of step
 * with the frame they describe.
 */
import type { Seat } from "@no-dice/log";

/** `spectator` shows the whole board; a seat shows the board as that seat knows it. */
export type BoardMode = "spectator" | Seat;

/** The modes the toggle offers, in the order it offers them. */
export const BOARD_MODES: readonly BoardMode[] = ["spectator", "A", "B"];

/** What the page opens on: the logged truth, with a seat's fog only on request. */
export const DEFAULT_MODE: BoardMode = "spectator";

/** What each mode is called on its button. */
const LABELS: Record<BoardMode, string> = {
  spectator: "Spectator",
  A: "Player A fog",
  B: "Player B fog",
};

/** The handle the page uses to say which mode is the one showing. */
export interface ViewToggle {
  select(mode: BoardMode): void;
}

/**
 * Draw the three buttons into `container`, mark `DEFAULT_MODE` as the one
 * showing, and call `onMode` with whatever the viewer clicks. Nothing is marked
 * by a click itself: the page holds the mode, redraws, and says which one shows
 * through `select`, so the buttons can never claim a frame the board is not
 * showing. The buttons are the page's only way of asking for fog, so a frame is
 * never fogged without one of them saying so.
 */
export function mountViewToggle(container: HTMLElement, onMode: (mode: BoardMode) => void): ViewToggle {
  const buttons = new Map<BoardMode, HTMLButtonElement>();

  for (const mode of BOARD_MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = mode;
    button.textContent = LABELS[mode];
    button.addEventListener("click", () => onMode(mode));
    buttons.set(mode, button);
    container.append(button);
  }

  const select = (mode: BoardMode): void => {
    for (const [candidate, button] of buttons) {
      button.setAttribute("aria-pressed", String(candidate === mode));
    }
  };
  select(DEFAULT_MODE);

  return { select };
}
