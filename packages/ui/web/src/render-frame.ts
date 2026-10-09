/**
 * The console's frame: the five sections the page is made of, and the rule for
 * what stands under each heading.
 *
 * Nothing here decides what a run is, what a provider costs or
 * what a leaderboard row holds — those are the progress, start, results,
 * providers and leaderboard tasks' own modules, which draw into these
 * same sections.
 *
 * The start section, the progress section, the results section and the providers
 * section are the four this file leaves standing empty. The start form is built
 * in `#start` by `render-start.ts` out of the state read, and owns that
 * section from then on: a frame that redrew it would be a frame that wiped what
 * someone had typed. The providers section is owned by `render-providers.ts` for
 * the same reason, and a sharper one: it holds the add form and the credential
 * check an operator just asked for, and a frame that redrew it would be a frame
 * that wiped that answer. A run's own lines and counters come from `/api/run`,
 * which the page reads once a second, and the finished series and matches come
 * from `/api/series` and `/api/matches`; a line invented here from `/api/state`
 * would be a second, staler account of the same thing.
 *
 * So the frame draws nothing of its own. `/api/state`'s name-only provider
 * answer still feeds the seat pickers in `render-start.ts`; the wider entry —
 * endpoint, rates, the key variable's *name* — is read from `/api/providers` by
 * that section's own module, which is the only thing allowed to redraw it.
 *
 * A section is kept as it is in `index.html` apart from what stands under its
 * heading, which is replaced whole on every render: an entry that has left the
 * registry file must not leave its row on the page. The caller puts back what it
 * owns — the progress section, for one.
 *
 * The five sit inside the four views `views.ts` shows one at a time, and the frame
 * does not care which one is on screen: it takes every section back to its heading,
 * hidden view included, which is what keeps a Runs view current while the operator
 * is looking at the leaderboard.
 */

/** The sections the console is made of, whichever view each one sits in. */
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

/**
 * Every section taken back to its heading, so what stands under one is what the
 * module that owns it last read. The start section is left for
 * `render-start.ts` to build its form in, the progress section for `progress.ts`
 * to fill from `/api/run`, the results section for `results.ts` to fill from
 * `/api/series` and `/api/matches` — the roots it names there are the roots
 * those listings were taken from, so there is no second copy of them to keep in
 * step — the providers section for `render-providers.ts` to fill from
 * `/api/providers` and from the one `/api/models` read the page makes, and the
 * leaderboard section for `render-leaderboard.ts` to
 * fill from `/api/leaderboard`, which is the one answer both of its tables come
 * from. Nothing is invented here: a row drawn from `/api/state` would be a row
 * the section that read the disk contradicts.
 *
 * The frame takes no state because it draws nothing from it: every section with
 * an answer of its own reads that answer from its own route, and a copy of it
 * carried through here would be a second, staler one.
 */
export const renderFrame = (sections: FrameSections): void => {
  for (const el of Object.values(sections)) clear(el);
};
