/**
 * Which of the console's four views the page shows, and the nav bar that asks
 * for one.
 *
 * The page used to be five sections stacked under each other, so reading the
 * leaderboard meant scrolling past a start form and a run's lines scrolled off
 * the top while someone looked for a provider. Four views replace that order:
 * **Matches** (what `#results` holds), **Runs** (`#start` and `#progress`,
 * because starting a run and watching it is one job), **Leaderboard** and
 * **Providers & models** (`#providers`). The five sections and their headings
 * are where they were, inside the view that now holds them: each is still drawn
 * by the module that owns it, and nothing here draws into one.
 *
 * The visible view is named by the URL hash — `#matches`, `#runs`,
 * `#leaderboard`, `#providers` — and that rule is the whole of the state. The
 * console is served on the tailnet and read from other machines, so a reload, a
 * back button and a link sent to someone else all have to land where the operator
 * was standing; a view held only in a variable would do none of that. A hash
 * that names nothing the page has is the default view rather than an error, and
 * the default is Matches, since reading what has been played is what the console
 * is now for.
 *
 * A view that is not showing is `hidden`, not removed. The page reads
 * `/api/run` once a second while a run is in flight and draws the answer into
 * the progress section, and a Runs view taken out of the document would be a
 * section the poller drew into nothing — an operator watching the leaderboard
 * while a series plays would come back to a Runs view that had lost its lines and
 * its pair counters. `hidden` keeps the sections in the document, so the poller
 * keeps drawing and switching back shows what it drew.
 */

/** The views the console has, in the order the nav bar lists them. */
export const VIEW_NAMES = ["matches", "runs", "leaderboard", "providers"] as const;

/** One of them. */
export type ViewName = (typeof VIEW_NAMES)[number];

/** What the page opens on, and what a hash that names nothing gets. */
export const DEFAULT_VIEW: ViewName = "matches";

/** What each view is called in the nav bar. */
export const VIEW_LABELS: Record<ViewName, string> = {
  matches: "Matches",
  runs: "Runs",
  leaderboard: "Leaderboard",
  providers: "Providers & models",
};

/** The wrapper `index.html` holds one view's sections in. */
export const wrapperId = (view: ViewName): string => `view-${view}`;

/**
 * The view a URL hash names, with or without its `#`.
 *
 * A hash that names nothing the page has — no hash at all, one typed by hand, a
 * link to a view the page no longer has — is the default view rather than a
 * failure: whoever sent the link meant to send the reader to the console, and the
 * console's front page is what has been played.
 */
export const viewOfHash = (hash: string): ViewName => {
  const named = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const view of VIEW_NAMES) {
    if (view === named) return view;
  }
  return DEFAULT_VIEW;
};

/** The handle the page keeps once the views are mounted. */
export interface Views {
  /** The view showing: the one the URL names, and the one the nav marks. */
  current: () => ViewName;
}

/** One element by id, or the reason the page is not the page it should be. */
const byId = (root: ParentNode, id: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`#${id}`);
  if (found === null) throw new Error(`#${id} is missing from index.html`);
  return found;
};

/**
 * Mount the views: draw the nav bar, show the view the URL names, and follow the
 * hash from then on.
 *
 * The nav bar is drawn here rather than written out in `index.html`, because the
 * links and the views are one list: a nav bar naming a fifth view, or a view with
 * no link to it, is a nav bar that disagrees with the page.
 *
 * Nothing here sets the hash — the links do that by being links, which is what
 * keeps the back button working and a shared URL honest. The page only ever
 * follows the hash, so there is one rule for which view is on screen.
 */
export const mountViews = (root: ParentNode): Views => {
  const nav = byId(root, "nav");
  const wrappers = new Map<ViewName, HTMLElement>(
    VIEW_NAMES.map((view): [ViewName, HTMLElement] => [view, byId(root, wrapperId(view))]),
  );
  const links = new Map<ViewName, HTMLAnchorElement>();

  for (const view of VIEW_NAMES) {
    const link = document.createElement("a");
    link.href = `#${view}`;
    link.className = "view-link";
    link.dataset.view = view;
    link.textContent = VIEW_LABELS[view];
    nav.append(link);
    links.set(view, link);
  }

  let showing: ViewName = DEFAULT_VIEW;

  /** Show one view: the others are hidden, and the nav marks the one showing. */
  const show = (view: ViewName): void => {
    showing = view;
    for (const [name, wrapper] of wrappers) wrapper.hidden = name !== view;
    for (const [name, link] of links) {
      if (name === view) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };

  const followHash = (): void => void show(viewOfHash(window.location.hash));
  window.addEventListener("hashchange", followHash);
  followHash();

  return { current: (): ViewName => showing };
};
