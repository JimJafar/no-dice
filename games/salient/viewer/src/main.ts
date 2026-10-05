/**
 * The viewer's entry point: one `salient-log/1` log onto the page. This file
 * owns the frame, the three ways of handing the page a log — the picker, a drop
 * anywhere on the frame, and `?log=<url>` — and the line that says what went
 * wrong when the file is not one. It draws the board through `render-board.ts`,
 * at the last turn the log holds, the lead chart through `render-chart.ts`, and
 * holds the view mode the toggle asks for: the spectator frame by default, a
 * seat's fog on request. The panels and the turn stepper are the tasks after
 * this one.
 */
import { parseLog, pickLogSource, readLogSource } from "./load.ts";
import type { LogSource } from "./load.ts";
import { boardView } from "./board.ts";
import { headerView } from "./header.ts";
import { renderHeader } from "./render-header.ts";
import { chartView } from "./chart.ts";
import { renderChart } from "./render-chart.ts";
import { fogView } from "./fog.ts";
import { renderBoard } from "./render-board.ts";
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
const board = element<HTMLDivElement>("#board");
const chart = element<HTMLDivElement>("#chart");
const toggleBar = element<HTMLDivElement>("#view-toggle");

/**
 * What the page shows: the log it holds, and whose eyes the board is seen
 * through. The mode is the board's only — the header shows what the match
 * scored whichever frame is up.
 */
let log: MatchLog | null = null;
let mode: BoardMode = DEFAULT_MODE;

/** The one line the page has, and whether it is bad news. */
function say(message: string, bad = false): void {
  status.textContent = message;
  status.classList.toggle("bad", bad);
}

/**
 * The frame the page shows: the header, the board and the lead chart at the
 * last turn the log holds, seen through the mode the toggle is on. Fog is a lens
 * over that one board — the same hexes in the same places — so the only thing it
 * changes is what the frame knows about each of them, never what the match
 * scored or how far ahead either seat was.
 */
function redraw(): void {
  if (log === null) return;
  // The last turn the log holds, which for a knockout is the knockout turn and
  // not `config.turns`. A log with no turns played shows its start position.
  const turn = log.turns.at(-1)?.n ?? 0;
  const fog = mode === "spectator" ? null : fogView(log, turn, mode);
  header.hidden = false;
  board.hidden = false;
  chart.hidden = false;
  toggleBar.hidden = false;
  renderHeader(header, headerView(log, turn));
  renderBoard(board, boardView(log, turn), fog);
  renderChart(chart, chartView(log, turn));
  toggle.select(mode);
}

/**
 * What a log that arrived shows: the board as the last turn the log holds left
 * it, and the line that names the log — the facts that prove the page holds the
 * log it was given.
 */
function showLog(next: MatchLog): void {
  const winner = next.result.winner ?? "nobody";
  say(`${next.format} · seed ${next.seed} · ${next.turns.length} turns · ${next.result.type} win for ${winner} on turn ${next.result.turn}`);
  log = next;
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
