// @vitest-environment happy-dom
/**
 * The form's values as the console takes them: the seat, the payload, the
 * ceilings the page promises the run will be started under, and the read that
 * asks what a run like this one would cost.
 *
 * The two things these tests hold the page to are that it sends what the
 * terminal would be given — a model seat typed as `subagent` against `marvin`
 * goes as `marvin/subagent`, one of Pi's own models goes as its reference with
 * nothing typed, and a field left blank contributes nothing at all,
 * which is what makes it the runner's default rather than a zero — and
 * that it never invents a verdict: a payload the console refuses comes back as
 * the console's own line, and a blank limit is reported as the default it is.
 *
 * The estimate is held to the same two things from the other side: the ask names
 * the seats the pickers hold and the pair count the form holds — a blank pair box
 * asking with the runner's own 75, which is what a blank means — and the answer is
 * read as it stands, so a figure the console did not give is a line rather
 * than a figure the page made up.
 *
 * The environment is the page's own rather than Node's, so nothing in this half
 * can quietly reach for a global the browser does not have.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULTS,
  OPEN_VALUES,
  ceilingsOf,
  estimatePathOf,
  fetchEstimate,
  parseEstimate,
  payloadOf,
  seatKindOf,
  seatOf,
  startRun,
} from "./start.ts";
import type { StartValues } from "./start.ts";
import type { RunSnapshot } from "./progress.ts";
import type { FetchJson } from "./api.ts";

/** The form as it stands before anyone has typed anything. */
const BLANK: StartValues = {
  kind: "series",
  game: "salient",
  seatA: "bot:random",
  modelA: "",
  seatB: "bot:greedy",
  modelB: "",
  seed: "",
  seedBase: "",
  maxPairs: "",
  maxTokens: "",
  maxCost: "",
  concurrency: "",
  name: "",
};

/** The same form with some fields filled in. */
const filled = (fields: Partial<StartValues>): StartValues => ({ ...BLANK, ...fields });

/** The run a start answers with, as `/api/run` would answer it. */
const STARTED: RunSnapshot = {
  state: "running",
  lines: ["series: /repo/series/alpha"],
  dir: "/repo/series/alpha",
  out: null,
  startedAt: "2025-03-01T12:03:00.000Z",
  endedAt: null,
  exitCode: null,
  counters: null,
};

/** `parseArgs`'s own line for a provider picked with no model id typed. */
const NO_MODEL = '--a takes bot:random, bot:greedy and <provider>/<model-id>, not "marvin/"';

/**
 * What `/api/estimate` answers for a run of five pairs whose seats have both
 * been played: the series it counted, how many matches it counted, and the
 * figures per match and over the run. The numbers are the route's, and these
 * tests hand them back as JSON rather than checking what the route computed.
 */
const ESTIMATE = {
  pairs: 5,
  matches: 10,
  concurrency: 1,
  seats: [
    {
      label: "deepseek/deepseek-flash",
      measured: {
        series: ["deepseek-flash-vs-greedy"],
        matches: 10,
        perMatch: { turns: 25, tokens: 14_755_955, costUsd: 0.3154, seatMs: 935_106 },
      },
      run: { turns: 250, tokens: 147_559_550, costUsd: 3.154, seatMs: 9_351_065 },
    },
    {
      label: "bot:greedy",
      measured: {
        series: ["deepseek-flash-vs-greedy"],
        matches: 10,
        perMatch: { turns: 25, tokens: 0, costUsd: 0, seatMs: 12_000 },
      },
      run: { turns: 250, tokens: 0, costUsd: 0, seatMs: 120_000 },
    },
  ],
};

/** The same ask with a seat nothing under the root has ever played. */
const UNMEASURED = {
  pairs: 5,
  matches: 10,
  concurrency: 1,
  seats: [
    {
      label: "nowhere/ghost",
      measured: null,
      fallback: {
        perMatch: { tokens: 3_200_000, seatMs: 840_000 },
        line:
          "the only model match measured on this repo's record: the first Marvin match, " +
          "about 14 minutes and 3.2M tokens for one match",
      },
    },
    ESTIMATE.seats[1],
  ],
};

describe("seatOf", () => {
  it("leaves a bot seat exactly as the picker named it", () => {
    expect(seatOf("bot:random", "")).toBe("bot:random");
    expect(seatOf("bot:greedy", "")).toBe("bot:greedy");
  });

  it("sends a model seat typed as subagent against marvin as marvin/subagent", () => {
    expect(seatOf("marvin", "subagent")).toBe("marvin/subagent");
    expect(seatOf("openai", "gpt-4o")).toBe("openai/gpt-4o");
  });

  it("sends a provider with nothing typed as it stands, so the CLI's line names it", () => {
    // The page has no opinion about what a valid seat is. `marvin/` is what the
    // form holds, and `parseArgs` is who says what is wrong with it.
    expect(seatOf("marvin", "")).toBe("marvin/");
  });

  it("reads the bot prefix the way the parser does", () => {
    expect(seatOf("bot:random", "subagent")).toBe("bot:random");
    expect(seatOf("marvin", "deepseek/deepseek-r1")).toBe("marvin/deepseek/deepseek-r1");
  });

  it("sends one of Pi's own models as its reference, with nothing typed", () => {
    // The reference already names a provider and a model, so there is nothing to
    // type: this is the string the estimate looks its figures up by.
    expect(seatOf("deepseek/deepseek-flash", "")).toBe("deepseek/deepseek-flash");
  });

  it("ignores an id left in the box against one of Pi's models", () => {
    // The box is hidden for that kind of seat, and whatever an operator
    // typed at an earlier choice cannot turn the reference into a path.
    expect(seatOf("deepseek/deepseek-flash", "subagent")).toBe("deepseek/deepseek-flash");
  });
});

describe("seatKindOf", () => {
  it("names a bot by the prefix the parser names it by", () => {
    expect(seatKindOf("bot:random")).toBe("bot");
    expect(seatKindOf("bot:greedy")).toBe("bot");
  });

  it("names a registered provider, whose name is one path segment", () => {
    expect(seatKindOf("marvin")).toBe("provider");
    expect(seatKindOf("openai")).toBe("provider");
  });

  it("names one of Pi's models by the slash its reference carries", () => {
    expect(seatKindOf("deepseek/deepseek-flash")).toBe("model");
    expect(seatKindOf("deepseek/deepseek-v4-pro")).toBe("model");
  });
});

describe("payloadOf", () => {
  it("names the route for the command the form asked for", () => {
    expect(payloadOf(filled({ kind: "series" })).path).toBe("/api/run/series");
    expect(payloadOf(filled({ kind: "match" })).path).toBe("/api/run/match");
  });

  it("sends the seats, the game, and the limits the form gave", () => {
    const payload = payloadOf(
      filled({
        seatA: "marvin",
        modelA: "subagent",
        seatB: "bot:greedy",
        maxPairs: "3",
        maxTokens: "900000",
        maxCost: "12.5",
        concurrency: "4",
        seedBase: "135",
        name: "alpha",
      }),
    );

    expect(payload.body).toEqual({
      game: "salient",
      a: "marvin/subagent",
      b: "bot:greedy",
      maxPairs: "3",
      maxCost: "12.5",
      maxTokens: "900000",
      concurrency: "4",
      seedBase: "135",
      name: "alpha",
    });
  });

  it("sends a Pi model seat as its reference, with no id typed anywhere", () => {
    // The reference is the whole seat, and it is the same string the estimate
    // looks a seat's measured figures up by.
    const payload = payloadOf(
      filled({ seatA: "deepseek/deepseek-flash", seatB: "bot:greedy", modelA: "" }),
    );

    expect(payload.body["a"]).toBe("deepseek/deepseek-flash");
    expect(payload.body["b"]).toBe("bot:greedy");
  });

  it("sends nothing for a field left blank, which is what leaves it the runner's default", () => {
    // A `maxPairs: ""` would be a flag with an empty value, and a `maxPairs: 0`
    // would be a series asked to play nothing. Neither is what a blank means.
    expect(payloadOf(BLANK).body).toEqual({ game: "salient", a: "bot:random", b: "bot:greedy" });
  });

  it("sends a match no ceilings, and a series no seed", () => {
    // The two commands take different flags, and `parseArgs` refuses a flag a
    // command does not have — so a payload cannot ask for one by accident.
    expect(payloadOf(filled({ kind: "match", seed: "135", maxPairs: "3" })).body).toEqual({
      game: "salient",
      a: "bot:random",
      b: "bot:greedy",
      seed: "135",
    });
    expect(payloadOf(filled({ kind: "series", seed: "135" })).body).toEqual({
      game: "salient",
      a: "bot:random",
      b: "bot:greedy",
    });
  });

  it("sends a seat the console will refuse rather than one the page repaired", () => {
    expect(payloadOf(filled({ seatA: "marvin" })).body.a).toBe("marvin/");
  });
});

describe("ceilingsOf", () => {
  it("names the runner's defaults for a series whose limits are all blank", () => {
    const ceilings = ceilingsOf(BLANK);

    expect(ceilings.map((each) => `${each.label}: ${each.value}`)).toEqual([
      "Pairs: 75",
      "Pairs at once: 1",
      "Cost ceiling: none",
      "Token ceiling: none",
      "Seed base: 0",
    ]);
    // Every one of them is the runner's, not something the operator chose, and
    // the page says so: a blank field is not "no limit".
    expect(ceilings.every((each) => each.source === "runner")).toBe(true);
  });

  it("names what was typed instead, and says whose value it is", () => {
    const ceilings = ceilingsOf(filled({ maxPairs: "3", maxCost: "12.5" }));

    expect(ceilings.map((each) => [each.label, each.value, each.source])).toEqual([
      ["Pairs", "3", "form"],
      ["Pairs at once", "1", "runner"],
      ["Cost ceiling", "12.5", "form"],
      ["Token ceiling", "none", "runner"],
      ["Seed base", "0", "runner"],
    ]);
  });

  it("says a match has no ceilings, and names the seed it plays", () => {
    const ceilings = ceilingsOf(filled({ kind: "match", seed: "135" }));

    expect(ceilings.map((each) => `${each.label}: ${each.value}`)).toEqual([
      "Matches: 2 — one pair, both seat orders",
      "Seed: 135",
      "Ceilings: none — a single match has no pair, cost or token limit",
    ]);
  });

  it("names each ceiling in the words its field is labelled in", () => {
    // The block sits under the Start button and is read by someone looking at the
    // fields above it, so a bound has to be called what its field calls it.
    const series = ceilingsOf(filled({ maxPairs: "3", maxTokens: "900000", maxCost: "12.5", concurrency: "2" }));
    const match = ceilingsOf(filled({ kind: "match", seed: "135" }));

    expect([...series, ...match].map((each) => each.label).join(" ")).not.toMatch(/--/);
  });

  it("says when a match has no seed given, without deciding that it is refused", () => {
    const [seed] = ceilingsOf(filled({ kind: "match" })).filter((each) => each.label === "Seed");
    // No default stands behind the seed, so the page says what the form holds
    // and lets the console say what it makes of that.
    expect(seed).toEqual({ label: "Seed", value: "none given", source: "fixed" });
  });
});

describe("the values the form opens with", () => {
  it("opens on five pairs, one at a time, with no ceiling and no seed base", () => {
    // The form is where a two-day run gets started by accident, so what it
    // opens with is a run someone meant to press Start on rather than
    // the CLI's own answer for an unset flag.
    expect(OPEN_VALUES).toEqual({
      maxPairs: "5",
      concurrency: "1",
      seedBase: "",
      maxCost: "",
      maxTokens: "",
    });
  });

  it("leaves DEFAULTS the runner's own numbers, which is what a blank field falls back to", () => {
    // The ceilings block quotes these when a box is cleared, and the quote has to
    // stay what `parseArgs` would do — not what the page opened with.
    expect(DEFAULTS).toEqual({
      maxPairs: 75,
      concurrency: 1,
      seedBase: 0,
      maxCost: null,
      maxTokens: null,
    });
  });

  it("reads the limits it opens with as values from the form, and the blanks as the runner's", () => {
    const ceilings = ceilingsOf(filled(OPEN_VALUES));

    expect(ceilings.map((each) => [each.label, each.value, each.source])).toEqual([
      ["Pairs", "5", "form"],
      ["Pairs at once", "1", "form"],
      ["Cost ceiling", "none", "runner"],
      ["Token ceiling", "none", "runner"],
      ["Seed base", "0", "runner"],
    ]);
  });

  it("sends the pair limit it opened with, and sends nothing for the ceilings it left blank", () => {
    expect(payloadOf(filled(OPEN_VALUES)).body).toEqual({
      game: "salient",
      a: "bot:random",
      b: "bot:greedy",
      maxPairs: "5",
      concurrency: "1",
    });
  });
});

describe("the estimate the page asks for", () => {
  it("asks the estimate route with the two seats and the pair count the form holds", () => {
    // The seats are the strings the run would be sent with, and the pair count is
    // the box's own. Nothing else the form holds changes what a match costs.
    const path = new URL(
      estimatePathOf(filled({ seatA: "deepseek/deepseek-flash", seatB: "marvin", modelB: "subagent", maxPairs: "3" })),
      "http://127.0.0.1",
    );

    expect(path.pathname).toBe("/api/estimate");
    expect(Object.fromEntries(path.searchParams)).toEqual({
      a: "deepseek/deepseek-flash",
      b: "marvin/subagent",
      pairs: "3",
    });
  });

  it("asks with the runner's 75 when the pair box is blank, which is what a blank means", () => {
    // The same 75 the ceilings block states beside the Start button: the ask and
    // the promise have to be about the same run.
    const path = new URL(estimatePathOf(BLANK), "http://127.0.0.1");

    expect(path.searchParams.get("pairs")).toBe("75");
  });

  it("asks with the pair count the form opens on, not with the runner's", () => {
    const path = new URL(estimatePathOf(filled(OPEN_VALUES)), "http://127.0.0.1");

    expect(path.searchParams.get("pairs")).toBe("5");
  });

  it("asks about the seat as it stands when no model id was typed, and lets the route refuse it", () => {
    // The page has no opinion about what a valid seat is, and no opinion here
    // either: the route reads the same flags and answers with its own line.
    const path = new URL(estimatePathOf(filled({ seatA: "marvin" })), "http://127.0.0.1");

    expect(path.searchParams.get("a")).toBe("marvin/");
  });

  it("reads the answer's figures as the route gave them", async () => {
    const asked: string[] = [];
    const fetchJson: FetchJson = (path) => {
      asked.push(path);
      return Promise.resolve(Response.json(ESTIMATE));
    };

    const answer = await fetchEstimate(filled(OPEN_VALUES), fetchJson);

    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!, "http://127.0.0.1").pathname).toBe("/api/estimate");
    expect(answer.pairs).toBe(5);
    expect(answer.matches).toBe(10);
    expect(answer.seats[0]).toEqual(ESTIMATE.seats[0]);
    expect(answer.seats[1]).toEqual(ESTIMATE.seats[1]);
  });

  it("keeps a seat nothing has played as unmeasured, with the figure the route quoted", async () => {
    const answer = await fetchEstimate(BLANK, () => Promise.resolve(Response.json(UNMEASURED)));
    const [seat] = answer.seats;

    expect(seat?.measured).toBeNull();
    if (seat === undefined || seat.measured !== null) throw new Error("the seat came back measured");
    // Quoted, and cited in words: the page draws this line and holds no copy of
    // the figure itself.
    expect(seat.fallback.line).toContain("measured on");
    expect(seat.fallback.perMatch.seatMs).toBeGreaterThan(0);
  });

  it("refuses an answer that is not an estimate, rather than drawing an undefined", () => {
    expect(() => parseEstimate({ pairs: 5 })).toThrow("seats is not a list");
    expect(() => parseEstimate({ pairs: 5, matches: 10, seats: [{}] })).toThrow(/seats\[0\]\.label/);
    expect(() => parseEstimate({ pairs: 5, matches: 10, seats: [{ label: "bot:greedy" }] })).toThrow(
      /seats\[0\]\.measured is not an object/,
    );
  });

  it("hands back the route's own line for an ask it refuses", async () => {
    const error = '--a takes bot:random, bot:greedy and <provider>/<model-id>, not "marvin/"';

    await expect(fetchEstimate(filled({ seatA: "marvin" }), () =>
      Promise.resolve(Response.json({ error }, { status: 400 })),
    )).rejects.toThrow(error);
  });
});

describe("startRun", () => {
  /** A console that refuses: the line it answers with, and the status it answers at. */
  const refusing = (status: number, error: string): FetchJson => () =>
    Promise.resolve(Response.json({ error }, { status }));

  it("posts the payload to the route for the command and reads back the run", async () => {
    const asked: Array<{ path: string; body: unknown }> = [];
    const fetchJson: FetchJson = (path, init) => {
      asked.push({ path, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(Response.json(STARTED));
    };
    const body = { game: "salient", a: "marvin/subagent", b: "bot:random" };

    const outcome = await startRun("series", body, fetchJson);

    expect(asked).toEqual([{ path: "/api/run/series", body }]);
    expect(outcome).toEqual({ ok: true, run: STARTED });
  });

  it("hands back the console's own line for a payload it refuses, and starts nothing", async () => {
    // `parseArgs`'s wording, whole: it names the flag and the value, and the
    // person who can fix either is the one reading the form.
    const outcome = await startRun("series", { game: "salient", b: "bot:random" }, refusing(400, NO_MODEL));

    expect(outcome).toEqual({ ok: false, error: NO_MODEL });
  });

  it("hands back the line for a run already in flight, which is the console's too", async () => {
    const busy = "a run is already running: a series of bot:greedy vs bot:random in /repo/series/alpha";
    const body = { game: "salient", a: "bot:random", b: "bot:greedy", seed: "1" };

    const outcome = await startRun("match", body, refusing(409, busy));

    expect(outcome).toEqual({ ok: false, error: busy });
  });

  it("refuses an answer that is not a run, rather than drawing an undefined", async () => {
    const outcome = await startRun("series", {}, () => Promise.resolve(Response.json({ started: true })));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("is not a state a run can be in");
  });
});
