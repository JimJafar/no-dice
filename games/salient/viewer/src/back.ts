/**
 * The way back to the console that opened this viewer.
 *
 * The console links a replay from one of its views and names that view in the URL
 * it hands over — `back=%23matches`, spelled as the console spells its own views,
 * with the `#` escaped because a bare `#` in a query is read as the start of a
 * fragment. This file is the whole of the viewer's side of that trip: the
 * query either names a view or it does not, and what it names is resolved to an
 * address the page can put in an `href`.
 *
 * **The address is relative, and on purpose.** The console mounts this page
 * one level under its own root (`VIEWER_PREFIX` in `packages/ui/src/server.ts`),
 * so `../` from `/viewer/` is the console — the same reason the build writes its
 * asset URLs relative (`base: "./"` in `vite.config.ts`): the viewer is
 * the same page under the console, under `vite preview`, and out of a `file://`
 * folder, and an absolute path would be true in only one of those.
 *
 * **Nothing here reaches past the query.** No package, no console module, no
 * assumption about what the console's page holds: `module-graph.test.ts` fails
 * the viewer if it imports anything but its own files and `@no-dice/log`, and a
 * viewer that could not be opened on its own would be a viewer that could not be
 * opened from a folder of logs, which is how it was used before the console
 * existed.
 */

/** The query parameter that names the view a replay link was clicked in. */
const BACK_PARAM = "back";

/** How far the console is from the page it serves this viewer at. */
const CONSOLE = "../";

/** The words on the link, which say where it goes without naming the console. */
const LINK_TEXT = "Back to the console";

/**
 * The URL back to the console, or `null` when the query names no view to go back
 * to. A viewer opened on its own — on the dev server, off `vite preview`, out of
 * a folder — names none, and the page offers no link it cannot honour.
 */
export function backHref(search: string): string | null {
  const named = new URLSearchParams(search).get(BACK_PARAM);
  if (named === null || named === "") return null;
  return `${CONSOLE}${named}`;
}

/**
 * The link itself, as the page shows it — or `null`, which is what a viewer
 * opened on its own gets. The caller decides where it goes: the loading screen
 * and the header each hold one, and only when this returns a link.
 */
export function backLinkOf(search: string): HTMLAnchorElement | null {
  const href = backHref(search);
  if (href === null) return null;

  const link = document.createElement("a");
  link.className = "back";
  link.href = href;
  link.textContent = LINK_TEXT;
  return link;
}
