/**
 * Test support: taking this machine's provider credentials away from a run.
 *
 * A seat's Pi home is empty by design, so the only credential `pi auth check`
 * can find for a provider is one the machine running the tests happens to
 * export. A test that expects "this provider has no credential" would otherwise
 * be testing whatever the developer's laptop has, and would take a different
 * path on a machine that is logged in.
 *
 * The list is what the pinned Pi resolves an Anthropic credential from:
 * `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_OAUTH_TOKEN` each
 * make `pi auth check --provider anthropic --json` answer `ready`, while the
 * other `ANTHROPIC_*` variables it reads — `ANTHROPIC_BASE_URL`, the service
 * account and federation names — do not.
 */

/** The variables the pinned Pi resolves an Anthropic credential from. */
const ANTHROPIC_CREDENTIALS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
];

/**
 * Delete this machine's Anthropic credentials, and hand back the function that
 * puts them back. Call it in a `finally`: a suite that lost a developer's key
 * and carried on would fail every later test that needs one.
 */
export const withoutAnthropicCredentials = (): (() => void) => {
  const saved = ANTHROPIC_CREDENTIALS.map(
    (name) => [name, process.env[name]] as const,
  );
  for (const name of ANTHROPIC_CREDENTIALS) delete process.env[name];
  return () => {
    for (const [name, value] of saved) {
      if (value !== undefined) process.env[name] = value;
    }
  };
};
