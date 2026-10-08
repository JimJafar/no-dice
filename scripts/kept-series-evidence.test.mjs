/**
 * The kept copies under `reports/series/` hold the figures they were kept for.
 * Where a series' logs are tracked as well, they hold exactly what those logs
 * give today.
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
 *
 * The second suite answers the other half of the problem. A kept series is now
 * tracked twice over: the whole series directory (`series/marvin-subagent-vs-
 * greedy/`, whitelisted into git as the benchmark's baseline) and the kept copy
 * under `reports/series/`. `no-dice stats` and `no-dice evidence` rewrite the
 * first and never touch the second, so the two can drift and the rules review
 * would quietly quote the stale one. So the copy is regenerated from the logs
 * with the very generators the CLI runs, and compared: only the line naming the
 * directory the generator was pointed at is allowed to differ, because a kept
 * copy carries the path of the machine that played the series.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { renderSeriesReportMarkdown, seriesReport } from "../packages/stats/src/series-report.ts";
import { renderSeriesEvidenceMarkdown, seriesEvidence } from "../packages/stats/src/rules-evidence.ts";

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

/** The one series whose logs are tracked, and the copies kept from them. */
const SERIES_DIR = join(ROOT, "series", "marvin-subagent-vs-greedy");
const KEPT_OF_SERIES = {
  report: join(KEPT_DIR, "marvin-subagent-vs-greedy-rerun.md"),
  evidence: join(KEPT_DIR, "marvin-subagent-vs-greedy-rerun-evidence.md"),
};

/**
 * The kept copies and a fresh render compared on everything but where they were
 * generated: the `Series directory ...` line is the one line the generator
 * copies from its argument rather than from the logs.
 */
const apartFromTheDirectoryLine = (text) =>
  text.replace(/^Series directory `[^`]*`\.$/m, "Series directory <wherever>.");

describe("the kept copies against the series they were copied from", () => {
  /** What the CLI's own generators make of the tracked logs, in memory. */
  let rendered;

  beforeAll(async () => {
    const report = await seriesReport(SERIES_DIR);
    const evidence = await seriesEvidence(SERIES_DIR);
    rendered = {
      report: renderSeriesReportMarkdown(report),
      evidence: renderSeriesEvidenceMarkdown(evidence),
      pairing: [report.xLabel, report.opponentLabel],
    };
  });

  it("keeps a report and an evidence copy for the series whose logs are tracked", () => {
    expect(existsSync(join(SERIES_DIR, "series.json")), `${SERIES_DIR} has no series.json`).toBe(
      true,
    );
    for (const [kind, path] of Object.entries(KEPT_OF_SERIES)) {
      expect(existsSync(path), `no kept ${kind} at ${path}`).toBe(true);
    }
  });

  it("keeps a report that is what `no-dice stats` writes for those logs", () => {
    expect(apartFromTheDirectoryLine(readFileSync(KEPT_OF_SERIES.report, "utf8"))).toBe(
      apartFromTheDirectoryLine(rendered.report),
    );
  });

  it("keeps an evidence file that is what `no-dice evidence` writes for those logs", () => {
    expect(apartFromTheDirectoryLine(readFileSync(KEPT_OF_SERIES.evidence, "utf8"))).toBe(
      apartFromTheDirectoryLine(rendered.evidence),
    );
  });

  it("counts the same matches in both copies as the record lists", () => {
    // The line `stats` prints and the report and the evidence both repeat.
    const counted = rendered.report.match(/^\d+ pairs recorded, \d+ matches: .+$/m)?.[0] ?? "";
    expect(counted, "the record's own tally did not match the pattern").not.toBe("");
    for (const [kind, path] of Object.entries(KEPT_OF_SERIES)) {
      expect(readFileSync(path, "utf8"), `the kept ${kind} counts other matches`).toContain(
        counted,
      );
    }
  });

  it("names the pairing the record says was played", () => {
    const [x, opponent] = rendered.pairing;
    expect(readFileSync(KEPT_OF_SERIES.report, "utf8")).toContain(
      `# Series report: ${x} vs ${opponent}`,
    );
    expect(readFileSync(KEPT_OF_SERIES.evidence, "utf8")).toContain(
      `# Rules evidence: ${x} vs ${opponent}`,
    );
  });
});
