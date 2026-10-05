/**
 * Drawing the lead-by-turn chart, and nothing else.
 *
 * The shape and the colours are the mock-up's (`salient/docs/mockups/spectator-view.html`):
 * the key down the left — the title, and the two lines that say which side of
 * the line is which — and the axis beside it, one slot per turn of the match,
 * the zero line across the middle, A's bars standing on that line and growing up
 * and B's hanging under it and growing down. The marked turn gets the slot's own
 * background and its margin written over it, signed, so `+10` and `-2` say which
 * seat is ahead without a second legend.
 *
 * The classes are in `viewer.css`, which holds the mock-up's geometry — the
 * 112 px box, the 44 px slot, the 24 px bar inset 10 px, the line at 56 px. The
 * two styles set here are the axis's width and each bar's height, because both
 * are facts about the log rather than about the page: the axis is as wide as
 * `config.turns` slots, and a bar is as tall as its margin at the chart's scale.
 *
 * A turn the match never reached, or one the frame has not got to, is drawn as
 * an empty slot: the axis stays the match's whole length, which is what lets a
 * match knocked out at turn 19 still show the 25 turns it was played for. A turn
 * that left the scores level has a slot and no bar, since neither seat was ahead
 * to draw.
 *
 * The frame is replaced whole on every render, so a stepped chart shows exactly
 * the turns the frame has reached with nothing left from the last.
 *
 * A turn that was marked — a submission refused, a pass, a context compacted —
 * gets a flag in its slot for each seat the log marked, in that seat's colour and
 * with the reason as its title, which is brief §6.8's mark on the turn strip. The
 * facts come from `marks.ts`, the same module the panels mark from, so a turn is
 * never flagged on the strip without the panel saying why.
 */
import { SLOT_WIDTH, type ChartView, type LeadSlot } from "./chart.ts";
import { markLines, markText, type SeatMarks } from "./marks.ts";

/** The key down the left of the axis: what the chart is, and which side is which. */
function legend(seat: "A" | "B", text: string): HTMLElement {
  const line = document.createElement("div");
  line.className = `chart-legend leg-${seat.toLowerCase()}`;
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  line.append(swatch, text);
  return line;
}

function keyElement(): HTMLElement {
  const key = document.createElement("div");
  key.className = "chart-key";
  const title = document.createElement("div");
  title.className = "chart-title";
  title.textContent = "LEAD BY TURN";
  key.append(title, legend("A", "A ahead, above"), legend("B", "B ahead, below"));
  return key;
}

/** The margin as the mark writes it: signed, so the sign names the seat ahead. */
function signed(margin: number): string {
  return margin > 0 ? `+${margin}` : String(margin);
}

/** The classes a flag carries: its seat, and each mark the turn has for it. */
function flagClasses(mark: SeatMarks): string {
  return ["flag", `flag-${mark.seat.toLowerCase()}`, ...markLines(mark).map((line) => line.kind)].join(" ");
}

/**
 * One seat's mark on one turn: a flag in the slot, named by its classes and
 * spelled out in its title, so the reason is there without the strip needing a
 * second legend.
 */
function flagElement(mark: SeatMarks): HTMLElement {
  const el = document.createElement("i");
  el.className = flagClasses(mark);
  el.dataset.seat = mark.seat;
  el.title = `${mark.seat}: ${markText(mark).join("; ")}`;
  el.textContent = "!";
  return el;
}

/** One turn of the axis: its bar if it had one, and the mark if the frame is on it. */
function slotElement(slot: LeadSlot): HTMLElement {
  const el = document.createElement("div");
  el.className = slot.marked ? "slot marked" : "slot";
  // The turn goes on the element as well as in the title, so a later task — a
  // scrubber, a hover — can find a turn of the chart again without recounting.
  el.dataset.turn = String(slot.turn);
  el.append(...slot.marks.map(flagElement));

  if (slot.leader !== null) {
    const bar = document.createElement("div");
    bar.className = `lead lead-${slot.leader.toLowerCase()}`;
    bar.style.height = `${slot.height}px`;
    bar.title = `Turn ${slot.turn}: ${slot.leader} ahead by ${Math.abs(slot.margin)}`;
    el.append(bar);
  }

  // A frame past the last turn the log holds marks the slot without claiming a
  // margin for a turn that was never played.
  if (slot.marked && slot.played) {
    const mark = document.createElement("div");
    mark.className = "mark";
    mark.textContent = signed(slot.margin);
    el.append(mark);
  }
  return el;
}

/**
 * Draw `view` into `container`, replacing whatever chart was there before. The
 * container is the row itself, so the page owns where the chart sits and this
 * file owns only what is in it.
 */
export function renderChart(container: HTMLElement, view: ChartView): void {
  const axis = document.createElement("div");
  axis.className = "chart-axis";
  axis.style.width = `${view.axis * SLOT_WIDTH}px`;

  const zero = document.createElement("div");
  zero.className = "zero";
  axis.append(zero, ...view.slots.map(slotElement));

  container.classList.add("chart");
  container.replaceChildren(keyElement(), axis);
}
