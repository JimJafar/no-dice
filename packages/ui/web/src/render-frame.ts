/**
 * The console's frame: the five sections the page is made of, and what
 * `/api/state` puts in them.
 *
 * Nothing here decides what a run is, what a provider costs or
 * what a leaderboard row holds — those are the progress, start, results and
 * leaderboard tasks' own modules, which draw into these same sections. What is
 * drawn now is only what the console has said about itself: the seats a run can be
 * started with, and the providers the registry names.
 *
 * The progress section and the results section are the two this file leaves
 * standing empty. A run's own lines and counters come from `/api/run`, which the
 * page reads once a second, and the finished series and matches come from
 * `/api/series` and `/api/matches`; a line invented here from `/api/state`
 * would be a second, staler account of the same thing.
 *
 * A section is kept as it is in `index.html` apart from what stands under its
 * heading, which is replaced whole on every render: a state that no longer holds
 * a provider must not leave the last one's row on the page. The caller puts back
 * what it owns — the progress section, for one.
 */
import type { ProviderOption, UiState } from "./state.ts";

/** The sections the console is made of, in the order the page draws them. */
export const SECTION_IDS = ["start", "progress", "results", "providers", "leaderboard"] as const;

/** The frame's five sections, by the id `index.html` gives them. */
export interface FrameSections {
  readonly start: HTMLElement;
  readonly progress: HTMLElement;
  readonly results: HTMLElement;
  readonly providers: HTMLElement;
  readonly leaderboard: HTMLElement;
}

/** The section under one id, or the reason the page is not the page it should be. */
const section = (root: ParentNode, id: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`#${id}`);
  if (found === null) throw new Error(`#${id} is missing from index.html`);
  return found;
};

/** The five sections, looked up once when the page starts. */
export const frameSections = (root: ParentNode): FrameSections => ({
  start: section(root, "start"),
  progress: section(root, "progress"),
  results: section(root, "results"),
  providers: section(root, "providers"),
  leaderboard: section(root, "leaderboard"),
});

/**
 * Everything under a section's heading, taken back out before it is redrawn.
 * Exported because the progress section is drawn by `progress.ts` from `/api/run`
 * and needs the same rule: the heading is the page's, the rest is ours.
 */
export const clear = (el: HTMLElement): void => {
  for (const child of [...el.children]) {
    if (child.tagName !== "H2") child.remove();
  }
};

/** A short element with a class and a sentence. */
const paragraph = (className: string, text: string): HTMLElement => {
  const el = document.createElement("p");
  el.className = className;
  el.textContent = text;
  return el;
};

/** A list of one-line items, in the order given. */
const list = (className: string, items: readonly string[]): HTMLElement => {
  const ul = document.createElement("ul");
  ul.className = className;
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.append(li);
  }
  return ul;
};

/** What a run can be seated on: the two bots, then every provider the registry names. */
const renderSeats = (el: HTMLElement, state: UiState): void => {
  el.append(
    paragraph("seats", "Seats a run can be started with — the pickers the start form builds will list these."),
    list("seat-options", [...state.bots, ...state.providers.map((provider) => provider.name)]),
  );
};

/**
 * The providers, each with the name of the variable its key is read from — and
 * nothing else. An endpoint that checks no key says so, which is a fact about
 * the provider rather than a missing field.
 */
const renderProviders = (el: HTMLElement, providers: readonly ProviderOption[]): void => {
  if (providers.length === 0) {
    el.append(paragraph("providers-none", "The registry names no provider yet."));
    return;
  }
  el.append(
    list(
      "providers",
      providers.map((provider) =>
        provider.apiKeyEnv === null
          ? `${provider.name} — no key checked`
          : `${provider.name} — key from ${provider.apiKeyEnv}`,
      ),
    ),
  );
};

/**
 * The frame, as the console's state describes it. The progress section is left
 * empty for `progress.ts` to fill from `/api/run`, and so is the results section,
 * which `results.ts` fills from `/api/series` and `/api/matches` — the roots it
 * names there are the roots those listings were taken from, so there is no second
 * copy of them to keep in step. The leaderboard section is left standing empty as
 * well: it has nothing to say until a series has been counted, and an invented row
 * would be a row the results page contradicts.
 */
export const renderFrame = (sections: FrameSections, state: UiState): void => {
  for (const el of Object.values(sections)) clear(el);
  renderSeats(sections.start, state);
  renderProviders(sections.providers, state.providers);
};
