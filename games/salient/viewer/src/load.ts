/**
 * Getting one `salient-log/1` log onto the page, and nothing else. A log
 * arrives three ways — `?log=<url>`, the file picker, a drop on the frame — and
 * all three come through here, so a log means the same thing whichever way it
 * reached the viewer.
 *
 * Every failure is one readable message, because the page shows that message
 * and renders nothing else: someone who picked the wrong file has to be able
 * to tell what was wrong with it.
 *
 * The log's own shape is not redefined here. `matchLogSchema` from `@no-dice/log`
 * is the one place `salient-log/1` is named, and the viewer reads it like
 * everyone else does.
 */
import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

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

/** How many of a rejected log's problems the page is shown, so the message stays readable. */
const SHOWN_ISSUES = 5;

/**
 * Which log to load, out of what the page was opened with and what the user has
 * just handed over. A file wins over `?log=`: the query string is the same on
 * every later load, so it cannot outrank a file that was just picked or dropped.
 * The first file of a multi-file drop is the one, since the frame is one board.
 */
export function pickLogSource(search: string, files: readonly LogFile[]): LogSource {
  const file = files[0];
  if (file) return { kind: "file", file };

  const url = new URLSearchParams(search).get("log");
  if (url) return { kind: "url", url };

  return { kind: "none" };
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
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`that file is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = matchLogSchema.safeParse(json);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .slice(0, SHOWN_ISSUES)
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const hidden = parsed.error.issues.length - problems.length;
  if (hidden > 0) problems.push(`(and ${hidden} more)`);
  throw new Error(`that is not a salient-log/1 log: ${problems.join("; ")}`);
}
