/**
 * The viewer's entry point: one `salient-log/1` log onto the page. This file
 * owns the frame, the three ways of handing the page a log — the picker, a drop
 * anywhere on the frame, and `?log=<url>` — and the line that says what went
 * wrong when the file is not one. Nothing else renders yet: the header, the
 * board and the panels are the tasks after this one.
 */
import { parseLog, pickLogSource, readLogSource } from "./load.ts";
import type { LogSource } from "./load.ts";
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

/** The one line the page has, and whether it is bad news. */
function say(message: string, bad = false): void {
  status.textContent = message;
  status.classList.toggle("bad", bad);
}

/**
 * What a log that arrived shows for now: the facts that prove the page holds
 * the log it was given. The board that reads them is the next task.
 */
function showLog(log: MatchLog): void {
  const winner = log.result.winner ?? "nobody";
  say(`${log.format} · seed ${log.seed} · ${log.turns.length} turns · ${log.result.type} win for ${winner} on turn ${log.result.turn}`);
}

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
