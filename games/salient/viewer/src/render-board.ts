/**
 * Drawing one board view into the frame, and nothing else.
 *
 * The classes, the symbols and the positions are the mock-ups' — copied out of
 * `salient/docs/mockups/spectator-view.html`, which holds the exact CSS for
 * hexes, arrows and symbols (`salient/docs/salient-mockups.md`, "Build notes").
 * What a hex is drawn as follows from what the log says about it, so the six
 * symbols of the mock-ups' key are decided here and nowhere else:
 *
 * - a number is the troop count, and no number means no troops;
 * - a Base is that number in a circle;
 * - a Node is a number in a diamond — grey when nobody holds it, and then the
 *   number is the garrison rather than the troops;
 * - a blocked hex is the dark hatch, and never an owner colour or a count;
 * - an owned hex its Base is out of supply on is the team-coloured hatch, with
 *   its count in a dark disc so it still reads over the hatch;
 * - every hex carries its label along the top — including a blocked one, which
 *   the mock-ups leave unnamed even though the log names it.
 *
 * The frame is replaced whole on every render: a stepped or scrubbed frame
 * shows exactly the board the log gives, with nothing left over from the last.
 */
import { HEX_HEIGHT, HEX_WIDTH, type BoardView, type HexView } from "./board.ts";

/** The mock-ups' background for a hex: a team colour, a hatch, or blocked. */
function backgroundClass(hex: HexView): string {
  if (hex.terrain === "blocked") return "x";
  // The mock-ups hatch B's cut-off hexes as `.bc`; `.ac` is the same hatch in
  // A's colour, which the mock-ups never had to draw because their frame shows
  // only B cut off.
  if (hex.cutOff) return hex.owner === "A" ? "ac" : "bc";
  return hex.owner === "A" ? "a" : hex.owner === "B" ? "b" : "n";
}

/** The number a hex shows: its troops, or a neutral Node's garrison. */
function shownNumber(hex: HexView): number {
  return hex.terrain === "node" && hex.owner === null ? hex.garrison : hex.troops;
}

/** A Base: its number in a circle, the circle staying empty when it has none. */
function baseMark(number: number): HTMLElement {
  const circle = document.createElement("span");
  circle.className = "bs";
  circle.textContent = number === 0 ? "" : String(number);
  return circle;
}

/** A Node: its number in a diamond, which the CSS turns grey on a neutral hex. */
function nodeMark(number: number): HTMLElement {
  const diamond = document.createElement("span");
  diamond.className = "nd";
  const value = document.createElement("b");
  value.textContent = number === 0 ? "" : String(number);
  diamond.append(value);
  return diamond;
}

/** A cut-off hex's count, on the dark disc that keeps it readable over a hatch. */
function cutOffMark(number: number): HTMLElement {
  const disc = document.createElement("span");
  disc.className = "ct";
  disc.textContent = String(number);
  return disc;
}

/** What goes on a hex besides its label: a symbol, a bare count, or nothing. */
function markOf(hex: HexView): Element | string | null {
  if (hex.terrain === "blocked") return null;
  const number = shownNumber(hex);
  if (hex.terrain === "base") return baseMark(number);
  if (hex.terrain === "node") return nodeMark(number);
  if (number === 0) return null;
  return hex.cutOff ? cutOffMark(number) : String(number);
}

/** One hex of the board, placed by the mock-ups' geometry inside `width` × `height`. */
function hexElement(hex: HexView, width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.className = `hx ${backgroundClass(hex)}`;
  // The label is also how a later task finds a hex again — an arrow's end, a
  // fight outline, a fog mark — so it goes on the element as well as in it.
  el.dataset.hex = hex.label;
  // Whole pixels, because that is the box the mock-ups place their hexes in.
  el.style.left = `${Math.round(width / 2 + hex.x - HEX_WIDTH / 2)}px`;
  el.style.top = `${Math.round(height / 2 + hex.y - HEX_HEIGHT / 2)}px`;

  const label = document.createElement("i");
  label.textContent = hex.label;
  el.append(label);

  const mark = markOf(hex);
  if (mark !== null) el.append(mark);
  return el;
}

/** Draw `view` into `container`, replacing whatever frame was there before. */
export function renderBoard(container: HTMLElement, view: BoardView): void {
  const width = Math.round(view.width);
  const height = Math.round(view.height);
  container.classList.add("board");
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.replaceChildren(...view.hexes.map((hex) => hexElement(hex, width, height)));
}
