/**
 * The two fetch calls the page makes: `GET` for what the console knows, and
 * `POST` for what it asks the console to do. Both speak JSON in both directions.
 *
 * Both fail with the console's own line rather than a status number. A 400 from
 * a run the console will not start carries `parseArgs`'s message — the wording
 * the terminal uses — and the page shows that wording to whoever typed the form,
 * so it has to arrive whole rather than wrapped.
 *
 * `fetch` is a parameter defaulted to the browser's own, so a test can answer
 * with a real `Response` and no server.
 */

/** A body that parsed as nothing at all, as opposed to one that was empty. */
const NOT_JSON = Symbol("not JSON");

/**
 * The `fetch` the helpers use. Narrower than the platform's own because the page
 * only ever names a path on the console that served it — and a test can answer
 * one without standing up a server.
 */
export type FetchJson = (path: string, init?: RequestInit) => Promise<Response>;

/** The JSON a response carries, or `NOT_JSON` when it is not JSON. */
const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
};

/** Why the console refused, in its own words when it had any to give. */
const refusal = (response: Response, value: unknown): string => {
  if (value !== NOT_JSON && value !== null && typeof value === "object") {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && error !== "") return error;
  }
  return `the console answered ${String(response.status)}`;
};

/** A response as the page wants it: its JSON, or one line saying what went wrong. */
async function answerOf(path: string, response: Response): Promise<unknown> {
  const text = await response.text();
  const value = text === "" ? NOT_JSON : jsonOf(text);
  if (!response.ok) throw new Error(refusal(response, value));
  if (value === NOT_JSON) throw new Error(`the answer at ${path} is not JSON`);
  return value;
}

/** What the console says about itself, at `path`. */
export async function getJson<T>(path: string, fetchImpl: FetchJson = fetch): Promise<T> {
  return (await answerOf(path, await fetchImpl(path))) as T;
}

/** What the console does when asked for `body` at `path`. */
export async function postJson<T>(
  path: string,
  body: unknown,
  fetchImpl: FetchJson = fetch,
): Promise<T> {
  const response = await fetchImpl(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await answerOf(path, response)) as T;
}
