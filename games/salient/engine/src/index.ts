/**
 * Entry point for the Salient rules engine.
 *
 * The rules themselves land in the later engine tasks (board, visibility,
 * order validation, turn resolution, scoring). This module exists so the
 * workspace has a real package to typecheck and test against.
 */
export const enginePackage = {
  name: "@no-dice/salient-engine",
} as const;
