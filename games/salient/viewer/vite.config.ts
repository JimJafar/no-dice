/**
 * The viewer's build settings, and one of them matters: `base: "./"`.
 *
 * The console serves this built app under a sub-path — `http://127.0.0.1:8765/viewer/`
 * — and Vite's default `base` of `/` writes the built asset URLs from the site
 * root (`/assets/index-….js`), which on that page is the *console's* root and
 * answers a 404 for a script. Relative URLs resolve against the page that holds
 * them, so the built viewer loads its own assets wherever it is mounted: under
 * the console at `/viewer/`, and still straight off `vite preview` or a
 * `file://` directory as before.
 *
 * This is a build setting and nothing else. It sits outside `src`, so it is not
 * part of the module graph `module-graph.test.ts` walks, and the viewer still
 * reads a log and nothing more.
 */
export default {
  base: "./",
};
