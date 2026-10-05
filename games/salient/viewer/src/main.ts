/**
 * The viewer's entry point: one `salient-log/1` log onto the page. This file
 * owns the frame, the three ways of handing the page a log — the picker, a drop
 * anywhere on the frame, and `?log=<url>` — and the line that says what went
 * wrong when the file is not one. It draws the board through `render-board.ts`,
 * the seat panels through `render-panels.ts`, the turn's headline through
 * `render-headline.ts`, the lead chart through `render-chart.ts`, and holds the
 * view mode the toggle asks for: the spectator frame by default, a seat's fog on
 * request. The frame index — step back, step forward, scrub, autoplay — is
 * `turns.ts`, and this file is the only place that owns a clock: it steps that
 * index from a timer, and the index never looks at one.
 */
import { parseLog, pickLogSource, readLogSource } from "./load.ts";
import type { LogSource } from "./load.ts";
import { boardView } from "./board.ts";
import { headerView } from "./header.ts";
import { renderHeader } from "./render-header.ts";
import { headline } from "./headline.ts";
import { renderHeadline } from "./render-headline.ts";
import { chartView } from "./chart.ts";
import { renderChart } from "./render-chart.ts";
import { fogView } from "./fog.ts";
import { renderBoard } from "./render-board.ts";
import { panelsView } from "./panels.ts";
import { renderPanel } from "./render-panels.ts";
import { turnFrames } from "./turns.ts";
import type { TurnFrames } from "./turns.ts";
import { frameHandlers, mountTurnControls } from "./render-turns.ts";
import type { TurnControls } from "./render-turns.ts";
import { DEFAULT_MODE, mountViewToggle } from "./view-mode.ts";
import type { BoardMode } from "./view-mode.ts";
import type { MatchLog } from "@no-dice/log";

/** The frame's own elements, which `index.html` owns. */
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`${selector} is missing from index.html`);
  return found;
}

const frame = element<HTMLDivElement>("#frame");
const status = element<HTMLParagraphElement>("#status");
const fileInput = element<HTMLInputElement>("#log-file");
const header = element<HTMLDivElement>("#header");
const headlineRow = element<HTMLDivElement>("#headline");
const stage = element<HTMLDivElement>("#stage");
const board = element<HTMLDivElement>("#board");
const panelA = element<HTMLDivElement>("#panel-a");
const panelB = element<HTMLDivElement>("#panel-b");
const turnsBar = element<HTMLDivElement>("#turns");
const chart = element<HTMLDivElement>("#chart");
const toggleBar = element<HTMLDivElement>("#view-toggle");

/**
 * What the page shows: the log it holds, the frame of it, and whose eyes the
 * board is seen through. The mode is the board's only — the header shows what the
 * match scored whichever frame is up, and so do the panels, which describe what
 * each seat did rather than what that seat could see.
 */
let log: MatchLog | null = null;
let frames: TurnFrames | null = null;
let controls: TurnControls | null = null;
let mode: BoardMode = DEFAULT_MODE;

/**
 * How long each step of a turn's animation is held: the four steps of brief
 * §6.8, so one turn plays in a little over a second. The timer is the page's,
 * and `tick()` is all the view-model knows of it, which is what lets
 * `turns.test.ts` step a whole match without waiting for anything.
 */
const TICK_MS = 350;
let timer: number | null = null;

/** The one line the page has, and whether it is bad news. */
function say(message: string, bad = false): void {
  status.textContent = message;
  status.classList.toggle("bad", bad);
}

/**
 * The frame the page shows: the header, the headline, the board and the lead
 * chart at the frame the index is on, with each seat's panel beside it, seen
 * through the mode the toggle is on. Fog is a lens over that one board — the same
 * hexes in the same places — so the only thing it changes is what the frame knows
 * about each of them, never what the match scored, what each seat did, or how far
 * ahead either seat was.
 *
 * The board is the only part that moves mid-turn: it shows the board the frame
 * is animating from until the turn settles, while the header, the headline, the
 * panels and the chart describe the frame's turn throughout, because they state
 * facts about the turn rather than its picture.
 */
function redraw(): void {
  if (log === null || frames === null) return;
  const view = frames.view();
  // Fog over the board the frame is drawing, which mid-animation is still the
  // previous turn's — the seat's knowledge follows the picture, not the counter.
  const fog = mode === "spectator" ? null : fogView(log, view.board, mode);
  header.hidden = false;
  headlineRow.hidden = false;
  stage.hidden = false;
  board.hidden = false;
  panelA.hidden = false;
  panelB.hidden = false;
  turnsBar.hidden = false;
  chart.hidden = false;
  toggleBar.hidden = false;
  renderHeader(header, headerView(log, view.frame));
  renderHeadline(headlineRow, headline(log, view.frame));
  renderBoard(board, boardView(log, view.board), fog, view);
  const panels = panelsView(log, view.frame);
  renderPanel(panelA, panels.A);
  renderPanel(panelB, panels.B);
  renderChart(chart, chartView(log, view.frame));
  toggle.select(mode);
  controls?.select(frames.state());
  keepTimer(frames.playing());
}

/**
 * Run the page's timer while the frame index is playing, and only while. The
 * interval is left alone between steps — restarting it on every redraw would
 * make the step's length depend on how long the frame took to draw.
 */
function keepTimer(playing: boolean): void {
  if (playing && timer === null) {
    timer = window.setInterval(() => {
      frames?.tick();
      redraw();
    }, TICK_MS);
  } else if (!playing && timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

/**
 * What a log that arrived shows: the board as the last turn the log holds left
 * it, and the line that names the log — the facts that prove the page holds the
 * log it was given. The frame index opens on that last turn, which is what the
 * match ended up as; the controls take the viewer back through it from there.
 */
function showLog(next: MatchLog): void {
  const winner = next.result.winner ?? "nobody";
  say(`${next.format} · seed ${next.seed} · ${next.turns.length} turns · ${next.result.type} win for ${winner} on turn ${next.result.turn}`);
  log = next;
  frames = turnFrames(next);
  // Remounted per log, since the slider spans the log: its maximum is the last
  // turn this log holds, which for a knockout is short of `config.turns`.
  // `frameHandlers` is what makes a click move the frame and then redraw the
  // page, so the board, the header, the panels and the chart follow the index
  // rather than staying where they were.
  controls = mountTurnControls(turnsBar, frameHandlers(frames, redraw));
  redraw();
}

/** The three frames the page can show, and the mode each one asks for. */
const toggle = mountViewToggle(toggleBar, (next) => {
  mode = next;
  redraw();
});

async function load(source: LogSource): Promise<void> {
  if (source.kind === "none") {
    say("No log yet: choose a match log, drop one anywhere on this frame, or open the page as ?log=<url>.");
    return;
  }

  const from = source.kind === "file" ? source.file.name : source.url;
  say(`Reading ${from}…`);
  try {
    showLog(parseLog(await readLogSource(source)));
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }
}

fileInput.addEventListener("change", () => {
  void load(pickLogSource(window.location.search, [...(fileInput.files ?? [])]));
});

frame.addEventListener("dragover", (event) => {
  event.preventDefault();
  frame.classList.add("dropping");
});

frame.addEventListener("dragleave", (event) => {
  // The frame's own children raise this on the way in as well as on the way out,
  // so only a move out of the frame itself clears the mark.
  const wentTo = event.relatedTarget;
  if (!(wentTo instanceof Node) || !frame.contains(wentTo)) frame.classList.remove("dropping");
});

frame.addEventListener("drop", (event) => {
  event.preventDefault();
  frame.classList.remove("dropping");
  void load(pickLogSource(window.location.search, [...(event.dataTransfer?.files ?? [])]));
});

void load(pickLogSource(window.location.search, []));
