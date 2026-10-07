/**
 * Drawing the header row, and nothing else.
 *
 * The shape and the type are the mock-up's (`salient/docs/mockups/spectator-view.html`):
 * each seat on one side with its name over its model and its score in 96 px
 * numerals, and between them the counter, the score bar and the two lines under
 * it. The classes are in `viewer.css`; the only style set here is the flex of
 * each bar segment, which is a fact about the frame rather than about the page —
 * A's points from the left, B's from the right, the points nobody is scoring in
 * the middle — and the tick that marks half of the total, which sits at the
 * middle of a bar whose whole width is the total.
 *
 * The header is the logged truth, so a seat's fog frame changes none of it: the
 * scores, the bar and the lead come from the log either way, which is what keeps
 * the fog toggle a comparison of what a seat can see rather than a second set of
 * facts about the match.
 *
 * The series line is the one part of the row that is not in the log, because a
 * log holds one match. It arrives beside the log, as the `salient-showcase/1`
 * sidecar `series.ts` reads, and is handed to `renderHeader` as a line of its
 * own: the series a match came from is the same at turn 0 as at turn 25.
 *
 * The frame is replaced whole on every render, so a stepped header shows exactly
 * the scores the log gives for that frame with nothing left from the last.
 */
import type { Seat } from "@no-dice/log";

import type { HeaderView } from "./header.ts";

/**
 * What the mock-up's series line becomes when no sidecar came with the log. A
 * `salient-log/1` log holds one match and no series, so the element says so and
 * names how to get the line, rather than leaving the mock-up's `[n] of [N]`
 * brackets as an unexplained gap. It is kept to one line on purpose: the header
 * row is the mock-up's fixed 104 px, and a sentence that wraps in it pushes the
 * board out of the frame (docs/viewer-notes.md §4).
 */
const SERIES_LINE = "No series in this log: pick its showcase.json beside it, or open the page as ?series=<url>.";

/** One seat's half of the header: its name, and its score in the big numerals. */
function seatElement(seat: Seat, name: string, score: number): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `seat seat-${seat.toLowerCase()}`;

  const label = document.createElement("div");
  label.className = "seat-label";
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  // The mock-up puts A's colour swatch before its name and B's after.
  if (seat === "A") label.append(swatch, "PLAYER A");
  else label.append("PLAYER B", swatch);

  const nameEl = document.createElement("div");
  nameEl.className = "seat-name";
  nameEl.textContent = name;

  const id = document.createElement("div");
  id.className = "seat-id";
  id.append(label, nameEl);

  const scoreEl = document.createElement("div");
  scoreEl.className = "score";
  scoreEl.textContent = String(score);

  // A's name sits on the outer edge with its score beside the bar; B's half is
  // the same thing mirrored, so the two scores face each other across the bar.
  if (seat === "A") wrap.append(id, scoreEl);
  else wrap.append(scoreEl, id);
  return wrap;
}

/** One segment of the score bar: `points` of the total, in the class's colour. */
function segment(className: string, points: number, title: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `seg ${className}`;
  // The mock-up sizes the bar by flex, so the three segments share its width in
  // the ratio of the points they hold.
  el.style.flex = String(points);
  el.title = title;
  return el;
}

/** The bar: A's points, the points nobody is scoring, B's, and the half-total tick. */
function barElement(view: HeaderView): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.append(
    segment("seg-a", view.score.A, `A: ${view.score.A} points`),
    segment("seg-mid", view.unscoring, `Not scoring: ${view.unscoring} points`),
    segment("seg-b", view.score.B, `B: ${view.score.B} points`),
  );

  const tick = document.createElement("div");
  tick.className = "tick";
  tick.title = `Half of the ${view.total} points`;
  bar.append(tick);
  return bar;
}

/**
 * Draw `view` into `container`, replacing whatever header was there before. The
 * container is the row itself, so the page owns where the header sits and this
 * file owns only what is in it.
 *
 * `series` is the line the sidecar gives the match — model X against its
 * opponent, the win rate with its interval, the pairs and the stop — or `null`
 * when no sidecar came with the log, which leaves the placeholder in place of it
 * rather than a gap.
 */
export function renderHeader(container: HTMLElement, view: HeaderView, series: string | null = null): void {
  const centre = document.createElement("div");
  centre.className = "centre";

  const counter = document.createElement("div");
  counter.className = "counter";
  counter.textContent = view.counter;

  const summary = document.createElement("div");
  summary.className = "summary";
  summary.textContent = view.summary;

  const seriesEl = document.createElement("div");
  seriesEl.className = "series";
  seriesEl.textContent = series ?? SERIES_LINE;

  centre.append(counter, barElement(view), summary, seriesEl);
  container.classList.add("header");
  container.replaceChildren(
    seatElement("A", view.names.A, view.score.A),
    centre,
    seatElement("B", view.names.B, view.score.B),
  );
}
