/**
 * The console's entry point: the frame, the state that fills it, the run it
 * watches while it plays, and the finished work it lists from disk.
 *
 * The page reads `/api/state` once when it opens and draws what it says. The run
 * in flight is a separate read on a separate clock: `/api/run` once a second while
 * `state` is `running`, and no further reads once it is not. Polling rather than a
 * live connection is deliberate — one operator on loopback, and the runner's own
 * granularity is a pair of matches — and it means a page that is closed, reloaded
 * or cut off changes nothing about the run, which lives in the server's process.
 *
 * The listings are a third read, and the least often of the three: `/api/series`
 * and `/api/matches` when the page opens, when a run it was watching ends, and when
 * a resume is asked for. They are not polled, because a series takes hours
 * and a page that re-read every match log once a second would be doing the stats
 * package's work for no one. The leaderboard is read at those same moments and for
 * that same reason: `GET /api/leaderboard` answers both of its tables out of one
 * walk of every series' every log, which is the most expensive read the page makes.
 * The match facts — `GET /api/match-facts`, what each finished log *was* — are read
 * at those moments too, and last: they cost the same full pass over every log, so the
 * series rows and both leaderboard tables go up without waiting for them, and the
 * Matches view's groups go under them when they land.
 *
 * The provider registry is a fourth read, and the rarest: `/api/providers`
 * when the page opens and after an entry has been added, changed or removed. It
 * is not polled and not drawn by the frame, because that section holds the add
 * form, one row's edit form and the credential check an operator asked for, and
 * only the module that drew them knows when a redraw is safe.
 *
 * The models the pinned Pi knows natively are read at that same rare moment:
 * `/api/models` when the page opens, once, beside the state read. The route asks
 * Pi and costs a subprocess of about 0.7 s, so nothing polls it and no key is
 * expected to appear while the console runs. It has to be read *with* the state
 * rather than after it: the start form is built once per page load, and a form
 * that arrived twice would be a form that lost what someone had typed into it.
 * What that one read gave is kept and handed to every later redraw of the
 * Providers & models section too — an add, an edit or a removal re-draws the
 * model rows from it rather than asking Pi a second time.
 *
 * A fifth read keeps a series somebody else is playing honest: `/api/playing` on
 * the run poller's cadence, and only while its answer names a playing
 * series. The four reads above cannot see that series — a terminal's run is not
 * this console's run, so it is in neither the run poll nor a run's end — and a row
 * saying `0 of 12 pairs` while a terminal was on its fortieth is a page its
 * operator stops believing. That poll asks the one route that reads no match log,
 * and writes one span of one row; the listings it would replace stay put.
 *
 * The start form is built out of the state read and the model list, because its
 * seat pickers are the bots and providers `/api/state` names and the models
 * `/api/models` names. It is built once: the frame replaces everything under
 * every heading, so the form and the run the poller is watching both go
 * straight back under the headings they own.
 *
 * What a run like the form describes would cost is the one read the start section
 * asks for itself, and not from here: it is the only part of the page that knows when
 * a seat or the pair count has changed, and the route walks every match log of every
 * series under the root, so polling it from this loop would be a walk per keystroke.
 *
 * The three reads draw into the same sections, so the order matters: `renderFrame`
 * replaces everything under every heading, and the run it cannot see is put back
 * from the last snapshot the poller took. Which of those sections is on screen is
 * `views.ts`'s rule, and only that one: the four views are hidden rather than
 * removed, so every read below reaches its section whether or not the view that
 * holds it is the one the operator is looking at.
 */
import { getJson, postJson } from "./api.ts";
import type { FetchJson } from "./api.ts";
import { fetchLeaderboard } from "./leaderboard.ts";
import { createRunPoller, renderProgress } from "./progress.ts";
import type { RunSnapshot } from "./progress.ts";
import {
  addProvider,
  checkCredential,
  fetchModels,
  fetchProviders,
  removeProvider,
  updateProvider,
} from "./providers.ts";
import type { ModelRead } from "./providers.ts";
import { frameSections, renderFrame } from "./render-frame.ts";
import { renderLeaderboard } from "./render-leaderboard.ts";
import { renderProviders } from "./render-providers.ts";
import { renderStart } from "./render-start.ts";
import type { SeatChoices } from "./render-start.ts";
import { fetchEstimate, startRun } from "./start.ts";
import {
  createMatchHeaderSource,
  createPlayingPoller,
  fetchMatchFacts,
  fetchResults,
  renderResults,
} from "./results.ts";
import type { MatchFactsRead, MatchRow, Results, SeriesRow } from "./results.ts";
import { parseState } from "./state.ts";
import { mountViews } from "./views.ts";

/** The one line the frame has, which `index.html` owns. */
const status = document.querySelector<HTMLElement>("#status");
if (status === null) throw new Error("#status is missing from index.html");

const sections = frameSections(document);

// The nav bar, and the view the URL names. Mounted before the first read, so the
// page a link opens shows the view that link asked for rather than flashing
// another one first.
mountViews(document);

/** The line the page shows about itself: what it read, or why it could not. */
const say = (message: string, bad = false): void => {
  status.textContent = message;
  status.classList.toggle("bad", bad);
};

/** The console's own `fetch`, named once so every read goes through the same door. */
const fetchJson: FetchJson = (path, init) => fetch(path, init);

/**
 * The finished logs the last `/api/matches` read gave, which the leaderboard's
 * per-pairing rows link their matches from. The two listings are read together
 * for that: the leaderboard answer names each series, and the match listing says
 * which logs belong to it.
 */
let listedMatches: readonly MatchRow[] = [];

/**
 * The series the last `/api/series` read gave, kept for the same reason: the
 * resume button hands over a directory, because that is all the route takes, and
 * the line the page writes afterwards is about the series a reader can see —
 * so the page looks the name up rather than repeating the path back.
 */
let listedSeries: readonly SeriesRow[] = [];

/**
 * The page's supply of match-log headers, shared by the two views that label
 * matches: one read per log between them, a few at a time, and never on the path
 * to a draw. Both listings are re-read on every refresh and every run end, and a
 * log that has been read once does not need reading again for the same page.
 *
 * Only the Leaderboard view asks for one now. The Matches view is given the same
 * facts by `/api/match-facts`, which reads every log once on the server instead of
 * once per row in the browser.
 */
const matchHeaders = createMatchHeaderSource(fetchJson);

/**
 * The last listings and the last facts the page read, kept so each can redraw the
 * results section when it lands without waiting for the other.
 *
 * They arrive on the same clock and not in the same read: `/api/match-facts` costs
 * the console every match log under both roots, and a front view that waited for it
 * would be blank for as long as a full series takes to read. So the series rows go
 * up from the two cheap listings, and the match groups go under them when the facts
 * come back — or a line saying they did not, with the reason on the status line.
 */
let listings: Results | null = null;
let facts: MatchFactsRead = { state: "reading" };

/** Draw the results section from what the page has, or leave it if it has no listings. */
const drawResults = (): void => {
  if (listings === null) return;
  renderResults(sections.results, listings, facts, (dir) => void resumeSeries(dir));
};

/**
 * Read what each finished match was, and hold the answer for the next draw.
 *
 * The failure is returned rather than thrown, the way the model list's is: the
 * series rows beside it came from another route and stand, and the console's own
 * line goes on the status line as every other failed read does.
 */
const readMatchFacts = async (): Promise<MatchFactsRead> => {
  try {
    return { state: "ready", facts: await fetchMatchFacts(fetchJson) };
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
    return { state: "failed" };
  }
};

/**
 * Read what the console has on disk and redraw the results section and the
 * leaderboard from it.
 *
 * The figures are the console's — `seriesReport`, the same report `no-dice stats`
 * prints, and `pooledModelRows` over that same walk — and the page adds nothing to
 * them but wording. A listing that could not be read leaves the section standing
 * and says why on the status line: half a results section is worse than a whole
 * one with a bad line under it, and the same goes for a leaderboard that could
 * not be read while the results beside it could.
 */
const refreshListings = async (): Promise<void> => {
  try {
    const results = await fetchResults(fetchJson);
    listedMatches = results.matches;
    listedSeries = results.series;
    listings = results;
    drawResults();
    say(`${String(results.series.length)} series and ${String(results.matches.length)} matches listed.`);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }

  try {
    const board = await fetchLeaderboard(fetchJson);
    renderLeaderboard(sections.leaderboard, { board, matches: listedMatches, headers: matchHeaders });
    say(
      `${String(board.series.length)} pairings and ${String(board.models.length)} models on the leaderboard.`,
    );
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }

  // The facts last, and on their own: of everything on this page they are the read
  // that costs the console a full pass over every match log, so nothing above waits
  // for them, and a read that failed says its line after every other line has said
  // its own. The section is drawn again from what it already holds, with the groups
  // under the series rows.
  facts = await readMatchFacts();
  drawResults();

  // A listing that shows a series being played has counters that move, and this is
  // the only moment the page learns they do: the listing read above is the one
  // that says somebody holds the directory. The poll asks the cheap route once and
  // keeps asking only while that answer names a playing series, so a listing with
  // nobody playing costs one read and no loop.
  if (listedSeries.some((row) => row.playing !== null)) void playingPoller.run();
};

/**
 * Ask the console to finish a series. The directory is all that is sent: the
 * pairing and the pair limit come from the series' own record, which is the
 * only thing that knows what the interrupted run was running. The line afterwards
 * names the series, not the directory: the reader asked for the row they can see,
 * and the path is what the route needed, not what they wanted told back.
 */
const resumeSeries = async (dir: string): Promise<void> => {
  const name = listedSeries.find((row) => row.dir === dir)?.name ?? null;
  try {
    await postJson("/api/run/resume", { dir }, fetchJson);
    say(name === null ? "Resuming that series." : `Resuming ${name}.`);
    void poller.run();
    await refreshListings();
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }
};

/**
 * The run in flight, read once a second while it is running. The last
 * snapshot is kept so a redraw of the frame does not blank the progress section,
 * and a run that has finished keeps its lines on the page rather than losing them
 * to the next read.
 */
let watching = false;
const poller = createRunPoller({
  fetchJson,
  render: (run: RunSnapshot): void => {
    void renderProgress(sections.progress, run);
    // A run that has just stopped has left logs and a record on disk. The
    // listings and both leaderboard views are read again at that moment and at
    // no other, so the finished work appears without a reload and without
    // polling the stats report.
    if (run.state === "running") {
      watching = true;
    } else if (watching) {
      watching = false;
      void refreshListings();
    }
  },
  say,
});

/**
 * The series another process is playing, read on the run poller's cadence while
 * any of them is. It writes one row's counters rather than redrawing the section,
 * and it asks for the listings back once whenever what it hears and what the page
 * shows disagree about who is playing — which is how a row loses its Resume
 * button, or gets it back, with nobody reloading.
 */
const playingPoller = createPlayingPoller({
  fetchJson,
  section: sections.results,
  listed: (): readonly SeriesRow[] => listedSeries,
  relist: refreshListings,
  say,
});

/**
 * The start form, built from the seats the console named. It is drawn once per
 * `/api/state` read — which is once per page load — because a form that rebuilt
 * itself under someone mid-way through typing a model id would lose it. A
 * console that named no seat gets the form anyway, saying that it has nothing to
 * seat a run with, rather than an empty section.
 *
 * The estimate read is handed to the section rather than polled here, and a read
 * that fails is the section's to say about: the estimate it already has stays on the
 * page.
 */
const drawStart = (choices: SeatChoices): void => {
  renderStart(sections.start, {
    choices,
    onStart: (kind, body) => startRun(kind, body, fetchJson),
    onEstimate: (values) => fetchEstimate(values, fetchJson),
    // The run is the console's now, so the page starts reading it: closing this
    // page, or this read failing, changes nothing about the run itself.
    onStarted: (): void => void poller.run(),
  });
};

/**
 * Read the provider registry and redraw the providers section from it.
 *
 * The entries are the console's — `GET /api/providers` answers out of the same
 * file a run seats on — and the page adds nothing to them. It is read again
 * after an entry has been added, changed or removed, because what the section
 * should list is the file's account of itself rather than a form's, and because
 * an entry the file no longer holds must not keep its row. A write the
 * console refused redraws nothing: the row an operator was editing stays where it
 * was, with what they typed in it. A registry that could not be read leaves the
 * section standing and says why on the status line, as every other failed read
 * does.
 *
 * The models beside the registry are not read again here. The route behind them
 * costs a subprocess and no key appears while the console runs, so every redraw
 * draws the list the page's one read gave.
 */
const refreshProviders = async (models: ModelRead, done?: string): Promise<void> => {
  try {
    const rows = await fetchProviders(fetchJson);
    renderProviders(sections.providers, {
      rows,
      models,
      onAdd: (values) => addProvider(values, fetchJson),
      onEdit: (name, values) => updateProvider(name, values, fetchJson),
      onRemove: (name) => removeProvider(name, fetchJson),
      onCheck: (model) => checkCredential(model, fetchJson),
      // An entry the console took is in the file the next run seats
      // on, so the list is read from the console again rather than from what the
      // form posted — and the status line says which entry the list just changed
      // by, since the row it names is gone from the page it was drawn on.
      onAdded: (name): void => void refreshProviders(models, `Added ${name}`),
      onEdited: (name): void => void refreshProviders(models, `Edited ${name}`),
      onRemoved: (name): void => void refreshProviders(models, `Removed ${name}`),
    });
    say(
      done === undefined
        ? `${String(rows.length)} providers listed.`
        : `${done}; ${String(rows.length)} providers listed.`,
    );
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
  }
};

/**
 * The models the pinned Pi knows that this console has a key for — the seats that
 * need nothing typed — or the console's own line for a read that failed.
 *
 * The failure is returned rather than thrown, and the sections that use the list
 * say it: a Pi that did not answer is not a reason an operator cannot seat a
 * bot, and the start form goes on working with the two kinds `/api/state` gave.
 * The status line carries the console's own line as every other failed read does.
 *
 * This is one of the page's rare reads. The route asks Pi and costs a
 * subprocess, so it is asked once per page load, beside the state read and never
 * on a poll, and what it gave is what every later redraw of the Providers section
 * draws.
 */
const readModels = async (): Promise<ModelRead> => {
  try {
    return { ok: true, models: await fetchModels(fetchJson) };
  } catch (error) {
    const line = error instanceof Error ? error.message : String(error);
    say(line, true);
    return { ok: false, error: line };
  }
};

/**
 * Read the console's state and redraw the frame from it. A console that cannot
 * be reached leaves the frame standing with one bad line rather than half a
 * frame: the page is a view of the console, and a console that is not answering
 * is the fact worth showing.
 *
 * The two seat reads go out together and are both waited for before the start
 * form is drawn: the pickers hold all three kinds of seat, and a form drawn again
 * when the model list arrived would be a form drawn under someone mid-way
 * through typing a model id.
 */
const refresh = async (): Promise<void> => {
  const models = readModels();
  try {
    const state = parseState(await getJson<unknown>("/api/state", fetchJson));
    renderFrame(sections);
    // The frame took back everything under every heading, so the run the
    // poller is watching, the form the state was used to build, and the
    // provider entries with the credential check asked of each of them all go
    // straight back under the one they belong to.
    renderProgress(sections.progress, poller.last());
    const read = await models;
    drawStart({
      bots: state.bots,
      providers: state.providers,
      // The pickers have one line for a list they were not given, and it does not
      // carry the console's line; the Providers section draws that one verbatim.
      models: read.ok ? read.models : null,
    });
    void refreshProviders(read);
  } catch (error) {
    drawStart({ bots: [], providers: [], models: null });
    say(error instanceof Error ? error.message : String(error), true);
  }
};

void refresh();
void refreshListings();
void poller.run();
