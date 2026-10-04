import { defineConfig } from "vitest/config";

// Every game's tests live next to the code they test; add a pattern here when a
// new top-level area appears.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "games/salient/**/*.test.ts"],
    passWithNoTests: false,
  },
});
