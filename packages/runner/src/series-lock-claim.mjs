/**
 * One process's attempt to take a series directory's lock, printed as one line of JSON.
 *
 * `./series-lock.test.ts` starts several of these at one directory at once. A claim has
 * to be atomic between processes as well as inside one, and separate processes are the
 * only way to have two of them at the same moment.
 *
 * A process that took the lock holds it until a deadline fixed when the process started,
 * and does not let go. A run that had already finished would make the next one's lock
 * stale, and the test would be measuring takeover rather than the claim; holding to a
 * start-relative deadline keeps every one of these processes alive across every other
 * one's attempt, whatever the machine's load does to their start-up times.
 */
const holdUntil = Date.now() + 1500;
const lockModule = await import(process.argv[2]);

try {
  const lock = await lockModule.acquireSeriesLock(process.argv[3]);
  console.log(JSON.stringify({ ok: true, pid: process.pid, started_at: lock.started_at }));
  await new Promise((done) => setTimeout(done, Math.max(0, holdUntil - Date.now())));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ok: false, pid: process.pid, message }));
}
