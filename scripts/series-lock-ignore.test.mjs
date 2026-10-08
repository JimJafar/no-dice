/**
 * A series' lock is never committed, not even in a kept baseline series.
 *
 * A run holds `<dir>/series.lock` — its pid, and when it started — for as long as it
 * plays, and lets go of it in a `finally`. A run killed hard enough to miss that
 * leaves one behind, and the next run reads it as stale and takes over. So the file is
 * a fact about a live process on one machine, not part of a series, and it must not
 * reach a commit — which matters most for the two baseline series under `series/` that
 * `.gitignore` whitelists back into git as what later series are measured against.
 *
 * The rule is a lock pattern under `series/`, and where it sits is the whole of it: the
 * negations that keep `series/deepseek-flash-vs-greedy/` come first, so a pattern after
 * them wins for the lock while leaving every other file of the kept series tracked.
 * That is why this asks `git check-ignore` rather than reading `.gitignore`: the
 * question is which pattern git lands on, and git is the only one who knows.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * What git's own matcher says about a path: whether it is ignored, and the pattern that
 * decided it. `--no-index` asks the question about the patterns rather than the index,
 * so a tracked file is judged the same way an untracked one is. The answer comes from
 * the plain run, because `-v` exits 0 for a path a negation re-included as well as for
 * one a pattern ignores; `-v` is run beside it only to name the pattern.
 */
const checkIgnore = (path) => {
  const args = ["check-ignore", "--no-index"];
  const plain = spawnSync("git", [...args, path], { cwd: ROOT, encoding: "utf8" });
  // 0 for ignored, 1 for not ignored; anything else is git failing to answer.
  if (plain.status !== 0 && plain.status !== 1) {
    throw new Error(
      `git check-ignore ${path} failed with ${String(plain.status)}: ${plain.stderr.trim()}`,
    );
  }
  const verbose = spawnSync("git", [...args, "-v", path], { cwd: ROOT, encoding: "utf8" });
  return { ignored: plain.status === 0, line: verbose.stdout.trim() };
};

describe("a series lock under a kept series directory", () => {
  it("is ignored, by the lock rule rather than by the whole directory being ignored", () => {
    for (const name of ["deepseek-flash-vs-greedy", "marvin-subagent-vs-greedy"]) {
      const found = checkIgnore(`series/${name}/series.lock`);
      expect(found.ignored, `series/${name}/series.lock is not git-ignored`).toBe(true);
      expect(found.line).toContain("/series/*/series.lock");

      // The name a run's lock bytes travel by: it writes them there and links them
      // into `series.lock`, so a run killed in between leaves the name behind.
      const claim = checkIgnore(`series/${name}/series.lock.4242.1`);
      expect(claim.ignored, `series/${name}/series.lock.4242.1 is not git-ignored`).toBe(true);
      expect(claim.line).toContain("/series/*/series.lock.*");
    }
  });

  it("leaves the rest of the kept series unignored", () => {
    // The record and the logs of the same directory the lock rule above catches:
    // they are the baseline later series are measured against, and a rule that took
    // them with the lock would delete the benchmark.
    for (const path of [
      "series/deepseek-flash-vs-greedy/series.json",
      "series/deepseek-flash-vs-greedy/matches",
      "series/marvin-subagent-vs-greedy/series.json",
    ]) {
      expect(checkIgnore(path).ignored, `${path} is git-ignored`).toBe(false);
    }
  });
});
