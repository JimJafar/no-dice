/**
 * Every kept rules-evidence copy holds the five counters it was kept for.
 *
 * `no-dice evidence --series <dir>` writes `series/<name>/evidence.md`, and
 * `/series/` in `.gitignore` is anchored to the repository root precisely so the
 * kept copies under `reports/series/` can be tracked — which means the file the
 * rules review reads is a copy someone made, not a file the runner wrote
 * anywhere tracked. The first real series lost its evidence that way: its
 * `report.md` was copied into `reports/series/`, its `evidence.md` was not, and
 * the directory holding both went with the task workspace that played it
 * (`docs/series-notes.md` §6 and §7). Four sections of `docs/rules-review.md`
 * are `Left open` on that missing file rather than on sample size.
 *
 * So this checks the kept copies, and only them: each one has to carry the five
 * counters — lead changes, hex flips with the turns 18-25 mean, Node hand
 * changes and ping-pong, captures of neutral hexes, per-seat re-scouts — in the
 * sections the generator writes them in. It does not require a copy for
 * every kept report: run 1's logs are gone, so its evidence cannot be
 * regenerated, and a test that demanded one would be a test that fails forever.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Where the kept copies of a finished series' generated markdown live. */
const KEPT_DIR = join(ROOT, "reports", "series");

/** The sections `renderSeriesEvidenceMarkdown` writes, one per counter group. */
const COUNTER_SECTIONS = [
  "## Per match",
  "## Over the series",
  "## Per match, on average",
  "## Node ping-pong",
  "## Re-scouts",
  "## Missing matches",
];

/** The kept evidence copies, by the naming convention §7 of the notes records. */
function keptEvidenceCopies() {
  if (!existsSync(KEPT_DIR)) return [];
  return readdirSync(KEPT_DIR)
    .filter((name) => name.endsWith("-evidence.md"))
    .sort();
}

const copies = keptEvidenceCopies();

describe("the kept rules-evidence copies under reports/series/", () => {
  it("has at least one, so the checks below are not vacuous", () => {
    expect(copies, "reports/series/ holds no *-evidence.md copy").not.toHaveLength(0);
  });

  it("holds the five counters, in the sections the generator writes", () => {
    for (const name of copies) {
      const text = readFileSync(join(KEPT_DIR, name), "utf8");
      for (const section of COUNTER_SECTIONS) {
        expect(text, `reports/series/${name} has no ${section} section`).toContain(section);
      }
      // The rules' own bot figures, which is the point of the file: the counters
      // are only evidence once something is printed beside them.
      expect(text, `reports/series/${name} has no comparison with the rules' bot figures`).toContain(
        "hexes flipped a turn late on (turns 18-25)",
      );
      // How many matches the figures were counted over, and how many were left
      // out — the same line `stats` prints, so the two files cannot disagree.
      expect(text, `reports/series/${name} does not say how many matches it counted`).toMatch(
        /\*\*\d+ counted\*\*, \*\*\d+ missing\*\*/,
      );
      // The per-match table's five counter columns, by their headers.
      for (const column of [
        "lead changes",
        "flips/turn 18-25",
        "Node hand changes",
        "Node ping-pong",
        "neutral captures",
      ]) {
        expect(text, `reports/series/${name} has no ${column} column`).toContain(column);
      }
    }
  });
});
