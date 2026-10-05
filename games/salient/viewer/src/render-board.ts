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
 * A fog frame is the same frame with one seat's knowledge laid over it: the
 * `FogView` from `fog.ts` says which hexes that seat cannot see, and each of
 * them is drawn as the mock-up's fog hex — its terrain, its label, and a `?`
 * where a Base or a Node has its number. Everything the seat can see is drawn
 * exactly as the spectator frame draws it, which is what makes the toggle a
 * comparison of one frame against another rather than a second set of facts.
 *
 * The frame is replaced whole on every render: a stepped or scrubbed frame
 * shows exactly the board the log gives, with nothing left over from the last.
 */
import { HEX_HEIGHT, HEX_WIDTH, type BoardView, type HexView } from "./board.ts";
import type { FogView } from "./fog.ts";

/** What a hidden Base or Node stands in for its number: the mock-ups' `?`. */
const UNKNOWN = "?";

/** The mock-ups' background for a hex: a team colour, a hatch, fog, or blocked. */
function backgroundClass(hex: HexView, hidden: boolean): string {
  if (hex.terrain === "blocked") return "x";
  // A hex the seat cannot see shows the fog background: its terrain is known,
  // but who holds it is not, so it gets no team colour and no cut-off hatch —
  // being cut off is a fact about the owner.
  if (hidden) return "f";
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
function baseMark(shown: string): HTMLElement {
  const circle = document.createElement("span");
  circle.className = "bs";
  circle.textContent = shown;
  return circle;
}

/** A Node: its number in a diamond, which the CSS turns grey on a neutral hex. */
function nodeMark(shown: string): HTMLElement {
  const diamond = document.createElement("span");
  diamond.className = "nd";
  const value = document.createElement("b");
  value.textContent = shown;
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
function markOf(hex: HexView, hidden: boolean): Element | string | null {
  if (hex.terrain === "blocked") return null;
  // A hidden hex keeps the symbol its terrain gives it — a Base and a Node are
  // never hidden, only their numbers are — with a `?` in place of the number.
  // A plain hidden hex gets nothing: a `?` there would claim the seat knows
  // troops stand on it, which is a fact it does not have.
  if (hidden) {
    if (hex.terrain === "base") return baseMark(UNKNOWN);
    if (hex.terrain === "node") return nodeMark(UNKNOWN);
    return null;
  }
  const number = shownNumber(hex);
  if (hex.terrain === "base") return baseMark(number === 0 ? "" : String(number));
  if (hex.terrain === "node") return nodeMark(number === 0 ? "" : String(number));
  if (number === 0) return null;
  return hex.cutOff ? cutOffMark(number) : String(number);
}

/** One hex of the board, placed by the mock-ups' geometry inside `width` × `height`. */
function hexElement(hex: HexView, width: number, height: number, hidden: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = `hx ${backgroundClass(hex, hidden)}`;
  // The label is also how a later task finds a hex again — an arrow's end, a
  // fight outline, a fog mark — so it goes on the element as well as in it.
  el.dataset.hex = hex.label;
  // Whole pixels, because that is the box the mock-ups place their hexes in.
  el.style.left = `${Math.round(width / 2 + hex.x - HEX_WIDTH / 2)}px`;
  el.style.top = `${Math.round(height / 2 + hex.y - HEX_HEIGHT / 2)}px`;

  const label = document.createElement("i");
  label.textContent = hex.label;
  el.append(label);

  const mark = markOf(hex, hidden);
  if (mark !== null) el.append(mark);
  return el;
}

/**
 * Draw `view` into `container`, replacing whatever frame was there before. With
 * a `FogView`, the hexes that seat cannot see are drawn as fog; without one,
 * every hex is drawn as the log says it is.
 */
export function renderBoard(container: HTMLElement, view: BoardView, fog: FogView | null = null): void {
  const width = Math.round(view.width);
  const height = Math.round(view.height);
  container.classList.add("board");
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.replaceChildren(
    ...view.hexes.map((hex) => hexElement(hex, width, height, fog !== null && fog.hidden.has(hex.label))),
  );
}
