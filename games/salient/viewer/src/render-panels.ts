/**
 * Drawing one seat's panel, and nothing else.
 *
 * The shape is the mock-up's (`salient/docs/mockups/spectator-view.html`): the
 * intent and the prediction as sentences, the tool-call trace under them, and
 * the three small boxes along the bottom — troops, Nodes held, actions — in the
 * panel's own grey. The classes are in `viewer.css`; the only style set here is
 * the width of the context meter's fill, which is a fact about the log rather
 * than about the page.
 *
 * Each trace line is one call the player made, in the log's order: the tool as
 * it called it, its arguments compacted onto the line, how long the server took,
 * and a mark on the line when the call came back an error. The hexes the seat
 * scouted are listed alongside the trace, since the log keeps them as its own
 * record of what the seat paid to see.
 *
 * What a log does not hold is left out rather than invented. A seat with no
 * window to measure its context against — a bot, which keeps no conversation —
 * gets no meter at all, not an empty one. A turn with no tool calls says so in
 * the mock-up's placeholder spot. And there is no "Called it" or "Missed" tag
 * beside the prediction: how predictions are scored is undecided
 * (`salient/docs/salient-mockups.md`, "What is placeholder"), so the panel shows
 * what the seat predicted and no judgement of it.
 *
 * The panel is replaced whole on every render, so a stepped frame shows exactly
 * what the log says about that turn with nothing left from the last.
 */
import { markLines } from "./marks.ts";
import type { ContextView, PanelView, ToolCallView } from "./panels.ts";

/** The label above one block of the panel, in the mock-up's small caps. */
function label(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "label";
  el.textContent = text;
  return el;
}

/** A block of the panel: its label and what stands under it. */
function block(kind: string, title: string, ...body: (Element | string)[]): HTMLElement {
  const el = document.createElement("div");
  el.className = `block ${kind}`;
  el.append(label(title), ...body);
  return el;
}

/** A sentence the seat wrote, or the reason there is none to show. */
function sentence(kind: string, title: string, text: string, whenEmpty: string): HTMLElement {
  const body = document.createElement("p");
  body.className = text === "" ? "text empty" : "text";
  body.textContent = text === "" ? whenEmpty : text;
  return block(kind, title, body);
}

/** One tool call: its name, its arguments, how long it took, and its error. */
function callElement(call: ToolCallView): HTMLElement {
  const li = document.createElement("li");
  li.className = call.error ? "call errored" : "call";

  const tool = document.createElement("span");
  tool.className = "call-tool";
  tool.textContent = call.tool;

  const args = document.createElement("span");
  args.className = "call-args";
  args.textContent = call.args;

  const ms = document.createElement("span");
  ms.className = "call-ms";
  ms.textContent = `${call.ms} ms`;

  li.append(tool, args, ms);
  if (call.error) {
    const error = document.createElement("span");
    error.className = "call-error";
    error.textContent = "errored";
    li.append(error);
  }
  return li;
}

/** The trace block: the calls in the log's order, and what the seat scouted. */
function traceElement(view: PanelView): HTMLElement {
  if (view.toolCalls.length === 0) {
    return block("trace", "TOOL CALLS THIS TURN", "The log holds no tool calls for this turn.");
  }

  const list = document.createElement("ol");
  list.className = "calls";
  list.append(...view.toolCalls.map(callElement));

  const body: (Element | string)[] = [list];
  // The hexes the seat paid an action point to see, which the log keeps in its
  // own list rather than leaving a reader to dig out of the trace.
  if (view.scouted.length > 0) {
    const scouted = document.createElement("div");
    scouted.className = "scouted";
    scouted.textContent = `Scouted ${view.scouted.join(", ")}`;
    body.push(scouted);
  }
  return block("trace", "TOOL CALLS THIS TURN", ...body);
}

/** A token count with the thousands grouped, so 131072 reads as 131,072. */
function grouped(tokens: number): string {
  return String(tokens).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The context meter brief §6.8 suggests: the seat's conversation against the
 * window it is played in. `null` — no meter at all — for a seat with no window,
 * which is every bot seat: an empty meter would read as a context that had
 * emptied rather than one that never existed.
 */
function contextElement(view: ContextView): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "block context";
  wrap.append(label("CONTEXT"));

  const meter = document.createElement("div");
  meter.className = "meter";
  const fill = document.createElement("span");
  // A context over its window is drawn full: the meter shows how much of the
  // window is used, and a bar past the end of it would leave the box.
  fill.style.width = `${Math.min(100, view.percent)}%`;
  meter.append(fill);

  const line = document.createElement("div");
  line.className = "context-line";
  line.textContent = `${grouped(view.tokens)} of ${grouped(view.window)} tokens (${view.percent}%)`;

  wrap.append(meter, line);
  return wrap;
}

/** One of the three small boxes: troops, Nodes held, actions used. */
function box(title: string, value: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "box";
  const number = document.createElement("div");
  number.className = "value";
  number.textContent = value;
  el.append(label(title), number);
  return el;
}

/** The marks the turn carries, each in its own chip, with the reason it has. */
function marksElement(view: PanelView): HTMLElement | null {
  const lines = markLines(view.marks);
  if (lines.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "marks";
  for (const line of lines) {
    const chip = document.createElement("div");
    chip.className = `chip ${line.kind}`;
    chip.textContent = line.text;
    wrap.append(chip);
  }
  return wrap;
}

/** Who the panel belongs to: the seat, and what drives it. */
function headElement(view: PanelView): HTMLElement {
  const head = document.createElement("div");
  head.className = "panel-head";

  const swatch = document.createElement("span");
  swatch.className = "swatch";
  const seat = document.createElement("span");
  seat.className = "panel-seat";
  seat.textContent = `PLAYER ${view.seat}`;
  const name = document.createElement("span");
  name.className = "panel-name";
  name.textContent = view.name;

  head.append(swatch, seat, name);
  return head;
}

/**
 * Draw `view` into `container`, replacing whatever panel was there before. The
 * container is the panel's own slot in the frame, so the page owns where the
 * panel sits and this file owns only what is in it.
 */
export function renderPanel(container: HTMLElement, view: PanelView): void {
  container.classList.add("panel", `panel-${view.seat.toLowerCase()}`);
  // The seat goes on the element as well as in it, so a test — and a later task
  // that wants to find one panel — can ask the frame which seat a panel is.
  container.dataset.seat = view.seat;

  const blocks: Element[] = [headElement(view)];
  const marks = marksElement(view);
  if (marks !== null) blocks.push(marks);

  const atStart = view.frame === 0;
  blocks.push(
    sentence("intent", "INTENT", view.intent, atStart ? "No turn has been played yet." : "The seat wrote no intent."),
    sentence(
      "prediction",
      "PREDICTION",
      view.prediction,
      atStart ? "No turn has been played yet." : "The seat wrote no prediction.",
    ),
    traceElement(view),
  );

  // A seat with no window has no meter to draw, so the block is left out.
  if (view.context !== null) blocks.push(contextElement(view.context));

  const boxes = document.createElement("div");
  boxes.className = "boxes";
  boxes.append(
    box("TROOPS", String(view.troops)),
    box("NODES HELD", String(view.nodesHeld)),
    box("ACTIONS", `${view.actionsUsed} of ${view.actionPoints}`),
  );
  blocks.push(boxes);

  container.replaceChildren(...blocks);
}
