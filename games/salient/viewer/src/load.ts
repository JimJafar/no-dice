/**
 * Getting one `salient-log/1` log onto the page, and the `salient-showcase/1`
 * sidecar that says which series it came from. A log arrives three ways —
 * `?log=<url>`, the file picker, a drop on the frame — and all three come
 * through here, so a log means the same thing whichever way it reached the
 * viewer. The sidecar arrives the same three ways, beside the log: `?series=`
 * and a file picked or dropped with the match's own.
 *
 * Every failure is one readable message, because the page shows that message:
 * someone who picked the wrong file has to be able to tell what was wrong with
 * it. A bad log leaves the page with nothing to draw; a bad sidecar is the
 * series line's problem alone, and the page says so while the match renders.
 *
 * The log's own shape is not redefined here. `matchLogSchema` from `@no-dice/log`
 * is the one place `salient-log/1` is named, and the viewer reads it like
 * everyone else does. The sidecar's shape is the viewer's own declaration, in
 * `series.ts`, because the package that writes it is one the viewer may not
 * import.
 */
import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

import { showcaseSchema, SHOWCASE_FORMAT } from "./series.ts";
import type { Showcase } from "./series.ts";

/** The part of a picked or dropped file the viewer reads. The DOM's `File` satisfies it. */
export interface LogFile {
  readonly name: string;
  text(): Promise<string>;
}

/** Where the log text comes from. */
export type LogSource =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly file: LogFile }
  | { readonly kind: "none" };

/** How many of a rejected file's problems the page is shown, so the message stays readable. */
const SHOWN_ISSUES = 5;

/**
 * The part of a zod rejection this file shows. Spelled out rather than imported
 * as `ZodIssue`: the viewer names no package but `@no-dice/log`.
 */
type Rejection = readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];

/**
 * A file's text as JSON, or the reason it is not — naming which file, since a
 * log and its sidecar can both arrive, and either of them can fail.
 */
function jsonOf(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A file a schema refused, as one readable line naming the fields that were wrong. */
function reject(issues: Rejection, what: string): never {
  const problems = issues
    .slice(0, SHOWN_ISSUES)
    .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
  const hidden = issues.length - problems.length;
  if (hidden > 0) problems.push(`(and ${hidden} more)`);
  throw new Error(`that is not ${what}: ${problems.join("; ")}`);
}

/**
 * A picked or dropped file that is the series sidecar rather than a match log.
 * The stats package writes it as `showcase.json` in the series directory, so a
 * user who picks both files at once hands over one with that name; a name is the
 * only thing that tells them apart before either is read.
 */
function isShowcaseFile(file: LogFile): boolean {
  return file.name.toLowerCase().endsWith("showcase.json");
}

/**
 * Which log to load, out of what the page was opened with and what the user has
 * just handed over. A file wins over `?log=`: the query string is the same on
 * every later load, so it cannot outrank a file that was just picked or dropped.
 * The first file of a multi-file drop that is not the series sidecar is the one,
 * since the frame is one board.
 */
export function pickLogSource(search: string, files: readonly LogFile[]): LogSource {
  // A sidecar picked alongside the match is not a log, and picking both at once
  // is the usual way to see a series line, so it is passed over rather than read
  // as a log that fails.
  const file = files.find((each) => !isShowcaseFile(each));
  if (file) return { kind: "file", file };

  const url = new URLSearchParams(search).get("log");
  if (url) return { kind: "url", url };

  return { kind: "none" };
}

/**
 * Whether the page was opened with a log of its own to read.
 *
 * This is what decides what the loading screen offers. A viewer the console
 * opened with `?log=` has been handed the match it is meant to show, and a file
 * picker and a "choose a match log" hint asked of that person are an invitation
 * to do something they never meant to do — including when the log then fails to
 * read, which is the moment they most need the line about *that* log instead.
 * A viewer opened without it is the one way a log from somewhere else gets in, so
 * it keeps the picker.
 */
export function namesLogUrl(search: string): boolean {
  return pickLogSource(search, []).kind === "url";
}

/** The text a source holds, read the only way that source can be read. */
export async function readLogSource(source: LogSource): Promise<string> {
  switch (source.kind) {
    case "file":
      return await source.file.text();
    case "url": {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`there is no log at ${source.url}: ${response.status} ${response.statusText}`);
      }
      return await response.text();
    }
    case "none":
      throw new Error("there is no log to read yet");
  }
}

/**
 * The text of a log file, as a `MatchLog`. Both ways a file can be wrong are
 * reported: it is not JSON at all, or it is JSON that is not a `salient-log/1`
 * log — the last one being the golden logs' older shape, which has no `format`.
 */
export function parseLog(text: string): MatchLog {
  const parsed = matchLogSchema.safeParse(jsonOf(text, "the log"));
  if (parsed.success) return parsed.data;
  reject(parsed.error.issues, "a salient-log/1 log");
}

/** Where the series sidecar comes from — the same three ways as the log. */
export type SeriesSource = LogSource;

/**
 * Which sidecar to load. A picked or dropped file named `showcase.json` wins
 * over `?series=` for the reason `pickLogSource` gives: the query string is the
 * same on every later load, so it cannot outrank a file just handed over. A
 * picked file that is not named like a sidecar is not one — it is the match.
 */
export function pickSeriesSource(search: string, files: readonly LogFile[]): SeriesSource {
  const file = files.find(isShowcaseFile);
  if (file) return { kind: "file", file };

  const url = new URLSearchParams(search).get("series");
  if (url) return { kind: "url", url };

  return { kind: "none" };
}

/** The text a sidecar source holds, read the only way that source can be read. */
export async function readSeriesSource(source: SeriesSource): Promise<string> {
  switch (source.kind) {
    case "file":
      return await source.file.text();
    case "url": {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`there is no showcase.json at ${source.url}: ${response.status} ${response.statusText}`);
      }
      return await response.text();
    }
    case "none":
      throw new Error("there is no series sidecar to read yet");
  }
}

/**
 * The text of a sidecar, as the series the viewer can name. A file that is not
 * JSON, and one that is JSON of some other shape, are reported the same way a
 * bad log is — one line naming what was wrong — and the page treats that line as
 * about the series line only, with the match still rendered.
 */
export function parseShowcase(text: string): Showcase {
  const parsed = showcaseSchema.safeParse(jsonOf(text, "the series sidecar"));
  if (parsed.success) return parsed.data;
  reject(parsed.error.issues, `a ${SHOWCASE_FORMAT} sidecar`);
}
