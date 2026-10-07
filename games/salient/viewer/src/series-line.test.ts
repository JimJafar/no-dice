/**
 * The series line: the `salient-showcase/1` sidecar arriving beside a match,
 * what the header says once it has one, and what the page still shows when it
 * has not.
 *
 * The sidecar fixture is written out in the shape the stats package writes —
 * `format`, the series block, the chosen match, and the ranking the choice came
 * out of — because the viewer declares that shape itself rather than importing
 * it, which is the whole point of `module-graph.test.ts`. The fields the header
 * never looks at (`selection`, `ranked`, a candidate's `excitement`) are here
 * anyway, because the file the viewer reads carries them and the viewer has to
 * read past them. The labels are the producer's too: a bot seat under its `bot:`
 * prefix, in the pairing and in the match alike, which is what makes the seats
 * of the picked match comparable with the seats of the log.
 *
 * A seed names a pair and not a match, so the picked match is claimed on its
 * seats as well as its seed: the twin of it — the same seed with the seats
 * swapped, whose log sits beside it in the series directory — is the easy mistake
 * to make, and the line about it is what says so here.
 *
 * A broken sidecar is checked from two sides: the message it produces names
 * what is wrong with it, and the page — mounted from `index.html` and driven
 * through `main.ts`, with `?log=` and `?series=` answered out of memory — still
 * draws the board while that message is on screen. The series line is a line
 * about the board, not part of the board, and it belongs to the board that is
 * actually up: a load that fails on its log leaves the line that goes with the
 * match still on screen.
 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { matchLogSchema } from "@no-dice/log";

import { parseShowcase, pickLogSource, pickSeriesSource, readSeriesSource } from "./load.ts";
import type { LogFile, SeriesSource } from "./load.ts";
import { seriesLineOf } from "./series.ts";
import { headerView } from "./header.ts";
import { renderHeader } from "./render-header.ts";
import golden01 from "../fixtures/golden-01-time-win.json";
import indexHtml from "../index.html?raw";

/** golden-01, validated the way the page validates every log. Its seed is 135. */
const log = matchLogSchema.parse(golden01);

/**
 * The sidecar `no-dice showcase` would write for a series golden-01's log came
 * from: model X as the bot seat `raider`, ten counted matches won nine, five
 * pairs, the run stopped by its pair limit, and this match — seed 135, X in seat
 * A, `raider` and `striker` in the seats the log itself names — picked. The
 * labels are the ones the stats package writes: a bot seat under its `bot:`
 * prefix, in the pairing and in the match alike.
 */
const SIDECAR = {
  format: "salient-showcase/1",
  series: {
    dir: "series/marvin-subagent-vs-greedy",
    x: "bot:raider",
    opponent: "bot:striker",
    winner: "bot:raider",
    line: "bot:raider vs bot:striker — win rate 90.0% (95% 59.6% – 98.2%) over 10 counted matches, 5 pairs, stopped on max_pairs",
    win_rate: { wins: 9, losses: 1, draws: 0, n: 10, successes: 9, rate: 0.9 },
    interval: { low: 0.596, high: 0.982 },
    confidence: 0.95,
    pairs: 5,
    matches: 12,
    counted: 10,
    missing: 1,
    stop_reason: "max_pairs",
    stopped_early: false,
  },
  selection: {
    basis: "series_winner",
    winner: { label: "bot:raider", side: "x", interval: { low: 0.596, high: 0.982 } },
    margins: { count: 9, low: 4, high: 8, kept: 3, widened: false },
    note: "bot:raider won the series: win rate 90.0%, 95% interval 59.6% – 98.2%, clear of 50%",
  },
  match: {
    path: "series/marvin-subagent-vs-greedy/matches/135-a-b.json",
    seed: 135,
    x_seat: "A",
    players: { A: "bot:raider", B: "bot:striker" },
    result: { type: "time", winner: "A", turn: 25, score: { A: 49, B: 41 }, margin: 8 },
    margin: 8,
    excitement: { score: 22, lead_changes: 4, largest_swing: 6, final_change_turn: 12 },
    kept: true,
  },
  ranked: [],
};

const SIDECAR_TEXT = JSON.stringify(SIDECAR);

/** A copy of the sidecar with one field replaced, so each case changes only what it tests. */
function sidecarWith(patch: Record<string, unknown>): string {
  return JSON.stringify({ ...structuredClone(SIDECAR), ...patch });
}

/** A copy of the sidecar with one series field replaced. */
function seriesWith(patch: Record<string, unknown>): string {
  const series = structuredClone(SIDECAR).series;
  return sidecarWith({ series: { ...series, ...patch } });
}

/** The sidecar as a picked or dropped file. */
function sidecarFile(name = "showcase.json"): File {
  return new File([SIDECAR_TEXT], name, { type: "application/json" });
}

/** The file a source names, log or sidecar, failing the test if it names none. */
function fileOf(source: SeriesSource): LogFile {
  if (source.kind !== "file") throw new Error(`expected a file source, got ${source.kind}`);
  return source.file;
}

/** The message a rejected sidecar produces. */
function messageOf(text: string): string {
  try {
    parseShowcase(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the sidecar to be rejected, but it parsed");
}

describe("pickSeriesSource", () => {
  it("says there is no sidecar when nothing named one", () => {
    expect(pickSeriesSource("", [])).toEqual({ kind: "none" });
    // A page opened with a log and no series is the usual case, and the
    // header's placeholder is what it shows.
    expect(pickSeriesSource("?log=/fixtures/golden-01-time-win.json", [])).toEqual({ kind: "none" });
    expect(pickSeriesSource("?series=", [])).toEqual({ kind: "none" });
  });

  it("takes the URL ?series= names", () => {
    expect(pickSeriesSource("?series=/series/match/showcase.json", [])).toEqual({
      kind: "url",
      url: "/series/match/showcase.json",
    });
  });

  it("takes a sidecar picked or dropped beside the match", () => {
    const picked = sidecarFile();
    const dropped = sidecarFile("showcase.json");
    expect(pickSeriesSource("", [picked])).toEqual({ kind: "file", file: picked });
    expect(fileOf(pickSeriesSource("", [picked, dropped]))).toBe(picked);
  });

  it("recognises a sidecar by its name, however the series directory prefixed it", () => {
    // The stats package writes `showcase.json`, but a viewer user who copies one
    // out of a series directory to tell two series apart keeps the name's tail.
    expect(fileOf(pickSeriesSource("", [sidecarFile("Showcase.JSON")])).name).toBe("Showcase.JSON");
    expect(fileOf(pickSeriesSource("", [sidecarFile("greedy-vs-random-showcase.json")])).name).toBe(
      "greedy-vs-random-showcase.json",
    );
  });

  it("does not mistake the match log for a sidecar", () => {
    const match = new File([JSON.stringify(golden01)], "135-a-b.json", { type: "application/json" });
    expect(pickSeriesSource("", [match])).toEqual({ kind: "none" });
  });

  it("prefers a sidecar handed over now to the ?series= the page was opened with", () => {
    const picked = sidecarFile();
    expect(fileOf(pickSeriesSource("?series=/elsewhere/showcase.json", [picked]))).toBe(picked);
  });
});

describe("pickLogSource beside a sidecar", () => {
  it("still takes the match when both files arrive together", () => {
    const match = new File([JSON.stringify(golden01)], "135-a-b.json", { type: "application/json" });
    const sidecar = sidecarFile();
    // Either order: a drop carries the files in the order they were picked.
    expect(fileOf(pickLogSource("", [sidecar, match]))).toBe(match);
    expect(fileOf(pickLogSource("", [match, sidecar]))).toBe(match);
    expect(fileOf(pickSeriesSource("", [sidecar, match]))).toBe(sidecar);
  });

  it("falls back to ?log= when the only file handed over is a sidecar", () => {
    expect(pickLogSource("?log=/matches/135-a-b.json", [sidecarFile()])).toEqual({
      kind: "url",
      url: "/matches/135-a-b.json",
    });
    // And with no `?log=` at all, a sidecar on its own names no log.
    expect(pickLogSource("", [sidecarFile()])).toEqual({ kind: "none" });
  });
});

describe("readSeriesSource", () => {
  it("reads the same sidecar from the picker, a drop and ?series=", async () => {
    const picked = sidecarFile();
    const dropped = sidecarFile();
    const url = `data:application/json,${encodeURIComponent(SIDECAR_TEXT)}`;

    const fromPicker = await readSeriesSource(pickSeriesSource("", [picked]));
    const fromDrop = await readSeriesSource(pickSeriesSource("", [dropped]));
    const fromQuery = await readSeriesSource(pickSeriesSource(`?series=${url}`, []));

    expect(fromPicker).toBe(SIDECAR_TEXT);
    expect(fromDrop).toBe(fromPicker);
    expect(fromQuery).toBe(fromPicker);
  });

  it("refuses to read a source that names no sidecar", async () => {
    await expect(readSeriesSource(pickSeriesSource("", []))).rejects.toThrow(/no series sidecar/);
  });
});

describe("parseShowcase", () => {
  it("takes the sidecar the stats package writes, reading past the fields the header does not show", () => {
    // `selection`, `ranked` and a candidate's `excitement` are the producer's
    // working notes: the viewer declares the fields it reads, and a sidecar with
    // more than those is a normal sidecar rather than a bad one.
    expect(parseShowcase(SIDECAR_TEXT)).toEqual({
      format: "salient-showcase/1",
      series: {
        x: "bot:raider",
        opponent: "bot:striker",
        win_rate: { n: 10, rate: 0.9 },
        interval: { low: 0.596, high: 0.982 },
        confidence: 0.95,
        pairs: 5,
        stop_reason: "max_pairs",
      },
      match: { seed: 135, x_seat: "A", players: { A: "bot:raider", B: "bot:striker" } },
    });
  });

  it("says that a file which is not JSON is not a sidecar, and says which file", () => {
    // The page can be holding a good log when this happens, so the line has
    // to name the sidecar rather than leave "that file" to guess at.
    expect(messageOf("<!doctype html><html></html>")).toMatch(/the series sidecar is not JSON/);
  });

  it("says that a log is not a sidecar, and names the format tag that says so", () => {
    expect(messageOf(JSON.stringify(golden01))).toMatch(/not a salient-showcase\/1 sidecar/);
    expect(messageOf(JSON.stringify(golden01))).toMatch(/format/);
  });

  it("names the field a sidecar is wrong on, by its path in the sidecar", () => {
    expect(messageOf(sidecarWith({ series: undefined }))).toMatch(/series: /);
    expect(messageOf(seriesWith({ pairs: "five" }))).toMatch(/series\.pairs/);
    expect(messageOf(seriesWith({ stop_reason: "" }))).toMatch(/series\.stop_reason/);
    // A match the series picked names a whole-numbered seed, one of two seats,
    // and who held each of them — the seats are what tell it from its twin.
    expect(messageOf(sidecarWith({ match: { seed: 135, x_seat: "C" } }))).toMatch(/match\.x_seat/);
    expect(messageOf(sidecarWith({ match: { seed: 135, x_seat: "A" } }))).toMatch(/match\.players/);
  });

  it("lists a few problems and says how many more there are", () => {
    // Every field of a sidecar of the wrong shape, so the message has to stop
    // short of the list rather than fill the page with it.
    const wrong = sidecarWith({
      series: { x: 1, opponent: 2, win_rate: {}, interval: 3, confidence: "high", pairs: "five", stop_reason: 4 },
      match: {},
    });
    const message = messageOf(wrong);
    expect(message).toMatch(/series\.interval: /);
    expect(message).toMatch(/\(and \d+ more\)/);
    // Five problems listed, then the count of the rest.
    expect(message.split("; ")).toHaveLength(6);
  });

  it("takes a series that counted no match, which has no rate and picked none", () => {
    const empty = parseShowcase(
      sidecarWith({
        series: { ...SIDECAR.series, win_rate: { n: 0, rate: null }, interval: null, pairs: 0 },
        match: null,
      }),
    );
    expect(empty.match).toBeNull();
    expect(empty.series.win_rate.rate).toBeNull();
  });
});

describe("seriesLineOf", () => {
  it("names the pairing, the win rate with its interval, the pairs and the stop", () => {
    expect(seriesLineOf(parseShowcase(SIDECAR_TEXT), log)).toBe(
      "bot:raider vs bot:striker — win rate 90.0% (95% 59.6% – 98.2%) over 10 counted matches, " +
        "5 pairs, stopped on max_pairs. This is the match the series picked: seed 135, with bot:raider in seat A.",
    );
  });

  it("quotes the interval at the confidence the sidecar was written at", () => {
    expect(seriesLineOf(parseShowcase(seriesWith({ confidence: 0.99 })), log)).toContain("(99% 59.6% – 98.2%)");
  });

  it("says there is no rate to quote for a series that counted nothing", () => {
    const line = seriesLineOf(
      parseShowcase(
        sidecarWith({
          series: { ...SIDECAR.series, win_rate: { n: 0, rate: null }, interval: null, pairs: 0 },
          match: null,
        }),
      ),
      log,
    );
    expect(line).toBe(
      "bot:raider vs bot:striker — win rate — over no counted match, 0 pairs, stopped on max_pairs. " +
        "The series counted no match, so it picked none.",
    );
  });

  it("says when the log on screen is not the match the series picked", () => {
    // The two arrive separately, so this is the page telling the viewer so rather
    // than claiming a match the sidecar never named.
    const line = seriesLineOf(
      parseShowcase(sidecarWith({ match: { ...SIDECAR.match, seed: 7, x_seat: "B" } })),
      log,
    );
    expect(line).toContain("The series picked seed 7, with bot:raider in seat B; this log is seed 135.");
  });

  it("names the twin when the log is the other match of the picked pair", () => {
    // A seed names a pair, not a match: one seed played twice with the seats
    // swapped, and a series directory holds both logs side by side. The seed
    // alone would claim this log is the one that was picked, and the seat the
    // sidecar names would be a lie about the match on the board.
    const twin = sidecarWith({
      match: { ...SIDECAR.match, x_seat: "B", players: { A: "bot:striker", B: "bot:raider" } },
    });
    const line = seriesLineOf(parseShowcase(twin), log);
    expect(line).toContain(
      "The series picked seed 135, with bot:raider in seat B; " +
        "this log is the other match of that pair, its seats swapped.",
    );
    expect(line).not.toContain("This is the match the series picked");
  });

  it("says a log that shares the seed but not the seats is not the picked match", () => {
    // The same seed out of some other series: neither seat of it holds either
    // player, so it is neither the picked match nor its twin.
    const other = sidecarWith({
      match: { ...SIDECAR.match, players: { A: "bot:greedy", B: "bot:random" } },
    });
    expect(seriesLineOf(parseShowcase(other), log)).toContain(
      "The series picked seed 135, with bot:raider in seat A; this log has that seed and other players.",
    );
  });

  it("compares a model seat by the label the log itself carries", () => {
    // A bot seat is `bot:<name>` in both files and a model seat `<provider>/<id>`
    // in both, while the viewer's own seat names drop the prefix — so the
    // comparison is made on the log's labels, not on what the header shows.
    const modelLog = matchLogSchema.parse({
      ...structuredClone(golden01),
      players: {
        A: { kind: "pi", model: "anthropic/claude-opus-4-1", thinking: "off", context_window: 200000 },
        B: { kind: "pi", model: "openai/gpt-5", thinking: "off", context_window: 200000 },
      },
    });
    const line = seriesLineOf(
      parseShowcase(
        sidecarWith({
          series: { ...SIDECAR.series, x: "anthropic/claude-opus-4-1", opponent: "openai/gpt-5" },
          match: { ...SIDECAR.match, players: { A: "anthropic/claude-opus-4-1", B: "openai/gpt-5" } },
        }),
      ),
      modelLog,
    );
    expect(line).toContain(
      "This is the match the series picked: seed 135, with anthropic/claude-opus-4-1 in seat A.",
    );
  });
});

describe("the header with and without a series", () => {
  /** The header golden-01 gives at turn 11, drawn with `series` beside it. */
  function header(series: string | null): HTMLElement {
    const el = document.createElement("div");
    renderHeader(el, headerView(log, 11), series);
    return el;
  }

  it("draws the series line in place of the placeholder", () => {
    const line = seriesLineOf(parseShowcase(SIDECAR_TEXT), log);
    const el = header(line);
    expect(el.querySelector(".series")?.textContent).toBe(line);
    expect(el.querySelector(".series")?.textContent).not.toContain("No series in this log");
  });

  it("keeps the placeholder when no sidecar came with the log", () => {
    const text = header(null).querySelector(".series")?.textContent ?? "";
    expect(text).toContain("No series in this log");
    expect(text).toContain("?series=");
  });

  it("still draws the match's own header when the sidecar was rejected", () => {
    // The page shows the message and draws the header anyway, so what the header
    // holds at that moment is the match's scores and the placeholder.
    const problem = messageOf(seriesWith({ pairs: "five" }));
    expect(problem).toMatch(/series\.pairs/);
    const el = header(null);
    expect(el.querySelector(".seat-a .score")?.textContent).toBe("43");
    expect(el.querySelector(".counter")?.textContent).toBe("TURN 11 OF 25");
    expect(el.querySelector(".series")?.textContent).toContain("No series in this log");
  });
});

describe("the page with a sidecar beside its log", () => {
  /**
   * The frame `index.html` owns, installed without its font link or its script
   * tag: the test imports `main.ts` itself, and a page that fetched its own entry
   * — or a font — would be a browser rather than a test.
   */
  function mountPage(): void {
    const body = indexHtml.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? "";
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(document.querySelector("#frame"), "index.html has no #frame").not.toBeNull();
  }

  /** Answer `?log=` and `?series=` out of memory, so the page needs no server. */
  function serve(routes: Record<string, string>): void {
    globalThis.fetch = (async (url: string) => {
      const text = routes[url];
      if (text === undefined) return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
      return { ok: true, status: 200, statusText: "OK", text: async () => text };
    }) as unknown as typeof fetch;
  }

  /**
   * Open the page as `search` and let it settle. `main.ts` starts loading the
   * moment it is imported, so the wait is for its first draw: the board's hexes
   * are there once the log has been read, parsed and rendered.
   */
  async function open(search: string): Promise<void> {
    const win = window as unknown as { happyDOM: { setURL(url: string): void } };
    win.happyDOM.setURL(`http://localhost:5173/${search}`);
    vi.resetModules();
    await import("./main.ts");
    for (let i = 0; i < 20 && document.querySelector("#board .hx") === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const LOG_URL = "/fixtures/golden-01-time-win.json";
  const SIDECAR_URL = "/series/showcase.json";

  /** The line the page says for golden-01, which every case here loads. */
  const LOG_LINE = "salient-log/1 · seed 135 · 25 turns · time win for A on turn 25";

  it("names the series the match came from, beside the board", async () => {
    mountPage();
    serve({ [LOG_URL]: JSON.stringify(golden01), [SIDECAR_URL]: SIDECAR_TEXT });
    await open(`?log=${LOG_URL}&series=${SIDECAR_URL}`);

    expect(document.querySelector(".series")?.textContent).toBe(
      "bot:raider vs bot:striker — win rate 90.0% (95% 59.6% – 98.2%) over 10 counted matches, " +
        "5 pairs, stopped on max_pairs. This is the match the series picked: seed 135, with bot:raider in seat A.",
    );
    // The series line says nothing about the match itself: the board, the counter
    // and the two scores are still the log's, at its last turn.
    expect(document.querySelectorAll("#board .hx")).toHaveLength(91);
    expect(document.querySelector(".counter")?.textContent).toBe("TURN 25 OF 25");
    expect(document.querySelector("#status")?.textContent).toBe(LOG_LINE);
  });

  it("keeps the placeholder when the log arrived without a sidecar", async () => {
    mountPage();
    serve({ [LOG_URL]: JSON.stringify(golden01) });
    await open(`?log=${LOG_URL}`);

    expect(document.querySelectorAll("#board .hx")).toHaveLength(91);
    expect(document.querySelector(".series")?.textContent).toContain("No series in this log");
    expect(document.querySelector("#status")?.textContent).toBe(LOG_LINE);
  });

  it("says what is wrong with a broken sidecar and draws the board anyway", async () => {
    mountPage();
    serve({ [LOG_URL]: JSON.stringify(golden01), [SIDECAR_URL]: seriesWith({ pairs: "five" }) });
    await open(`?log=${LOG_URL}&series=${SIDECAR_URL}`);

    // One readable line, after the line that names the log: a series line that
    // cannot be read is the series line's problem, not the board's.
    const status = document.querySelector("#status");
    expect(status?.textContent).toContain("series.pairs");
    expect(status?.textContent).toContain("the match is shown without its series line");
    expect(status?.classList.contains("bad")).toBe(true);
    expect(document.querySelectorAll("#board .hx")).toHaveLength(91);
    expect(document.querySelector(".series")?.textContent).toContain("No series in this log");
  });

  it("says so when the sidecar is not JSON at all", async () => {
    mountPage();
    serve({ [LOG_URL]: JSON.stringify(golden01), [SIDECAR_URL]: "<html>nothing a series lives in</html>" });
    await open(`?log=${LOG_URL}&series=${SIDECAR_URL}`);

    const status = document.querySelector("#status");
    expect(status?.textContent).toContain("the series sidecar is not JSON");
    expect(status?.classList.contains("bad")).toBe(true);
    expect(document.querySelectorAll("#board .hx")).toHaveLength(91);
  });

  /** Hand the page a drop of these files, which is how two picked files reach it. */
  function drop(files: readonly { readonly name: string; readonly text: () => Promise<string> }[]): void {
    const event = new Event("drop");
    Object.defineProperty(event, "dataTransfer", { value: { files } });
    document.querySelector("#frame")?.dispatchEvent(event);
  }

  /** Wait for the page's one line to say `said`, which is how a second load is followed. */
  async function statusSays(said: string): Promise<void> {
    for (let i = 0; i < 20 && !(document.querySelector("#status")?.textContent ?? "").includes(said); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(document.querySelector("#status")?.textContent).toContain(said);
  }

  it("keeps the series line that belongs to the board when a later load fails on its log", async () => {
    mountPage();
    serve({ [LOG_URL]: JSON.stringify(golden01), [SIDECAR_URL]: SIDECAR_TEXT });
    await open(`?log=${LOG_URL}&series=${SIDECAR_URL}`);
    const line = document.querySelector(".series")?.textContent;
    expect(line).toContain("This is the match the series picked");

    // A drop of another match and its sidecar, where the log is unreadable and
    // the sidecar names a different pairing. The board stays as it was, so the
    // line under it has to stay as it was too: that line belongs to the log on
    // the board, and this log never arrived.
    drop([
      { name: "broken.json", text: async () => "{ not a log" },
      {
        name: "showcase.json",
        text: async () => sidecarWith({ series: { ...SIDECAR.series, x: "bot:other", opponent: "bot:nobody" } }),
      },
    ]);
    await statusSays("the log is not JSON");

    expect(document.querySelector(".series")?.textContent).toBe(line);
    expect(document.querySelectorAll("#board .hx")).toHaveLength(91);
    expect(document.querySelector(".counter")?.textContent).toBe("TURN 25 OF 25");
  });
});
