import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeSessionClient,
  NativeClientError,
} from "../src/lib/native/client";
import {
  NativeLearningFlow,
  learningReceipt,
} from "../src/lib/native/learningFlow";
import { NativeDataRuntime } from "../src/lib/data/native";
import { LiveDataStore, type LiveEnvironment } from "../src/lib/data/store";
import type { NativeReader } from "../src/lib/native/readerContract";
import type { NativeLearningSession } from "../src/lib/native/learningContract";
const environment: LiveEnvironment = {
  now: () => Date.now(),
  random: () => 0.5,
  isOnline: () => true,
  isVisible: () => true,
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
const reader: NativeReader = {
  version: 1,
  userId: "user",
  activeCollectionId: "collection",
  selectionVersion: 3,
  language: "nl",
  courseId: "course",
  kind: "steps",
  targetId: "step",
  chapterId: "chapter",
  startVerse: 1,
  endVerse: 1,
  focusVerse: 1,
  sourceLanguage: "nl",
  bookName: "Synthetisch",
  collectionName: "Synthetisch",
  chapterNumber: 1,
  verses: [{ id: "verse", number: 1, text: "Synthetische tekst" }],
};
const exercise = {
  id: "q1",
  type: "MULTIPLE_CHOICE" as const,
  verseRef: "1",
  prompt: "Synthetische vraag",
  blanks: 1,
  options: ["A", "B"],
};
const answers = [{ exerciseId: "q1", given: ["A"] }];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function outcome(kind = "steps") {
  return {
    xpEarned: 10,
    correctCount: 1,
    total: 1,
    scorePercent: 100,
    baseXp: 10,
    bonusXp: 0,
    repeatXp: 0,
    currentStreak: 1,
    longestStreak: 1,
    streakBroken: false,
    freezeUsed: false,
    freezesEarned: 0,
    freezeCount: 0,
    newAchievements: [],
    alreadyStudiedToday: false,
    chapterCompleted: true,
    results: [{ exerciseId: "q1", correct: true, correctAnswer: ["A"] }],
    chapterId: "chapter",
    content: {
      read: "READ" as const,
      readVerse: 1,
      exercisesAnswered: 1,
      exercisesTotal: 1,
      exercisesComplete: true,
      exerciseScore: 100,
      perfect: true,
      done: true,
      contentKey: "synthetic",
      xpAvailable: 0,
    },
    ...(kind === "steps"
      ? { nextLessonId: "next-step" }
      : { nextChapterId: "next-chapter" }),
  };
}
async function fixture(empty = false, kind: "steps" | "chapters" = "steps") {
  let saved: string | null = null,
    current = true,
    receipt: NativeLearningSession | null = null,
    fail: "none" | "before" | "after" = "none",
    statusFailure = 0,
    authorizeAllowed = true;
  let held: ReturnType<typeof deferred<Response>> | null = null;
  const calls: {
      route: string;
      method: string;
      body: Record<string, unknown> | null;
    }[] = [],
    confirmed: string[] = [];
  let transform: (value: unknown) => unknown = (value) => value;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(transform(value)), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const client = new NativeSessionClient(
    "https://example.invalid",
    {
      read: async () => saved,
      write: async (value) => {
        saved = value;
      },
      clear: async () => {
        saved = null;
      },
    },
    async (url, input) => {
      const route =
        new URL(String(url)).pathname.split("/learning/")[1] ??
        new URL(String(url)).pathname.split("/").at(-1)!;
      const body = input?.body
        ? (JSON.parse(String(input.body)) as Record<string, unknown>)
        : null;
      calls.push({ route, method: input?.method ?? "GET", body });
      if (route === "login" || route === "refresh")
        return json({
          accessToken: "synthetic",
          refreshToken: "synthetic",
          expiresIn: 300,
        });
      if (route === "logout") return json({ ok: true });
      if (route.startsWith("sessions/")) {
        if (held) {
          const gate = held;
          held = null;
          return gate.promise;
        }
        if (statusFailure)
          return json(
            {
              error:
                statusFailure === 403
                  ? "content_unavailable"
                  : "native_request_failed",
            },
            statusFailure,
          );
        return receipt && route.endsWith(receipt.sessionId)
          ? json(receipt)
          : json({ error: "content_unavailable" }, 404);
      }
      if (route === "check")
        return json({
          version: 1,
          exerciseId: "q1",
          correct: true,
          correctAnswer: ["A"],
        });
      if (fail === "before") {
        fail = "none";
        throw new TypeError("synthetic network loss");
      }
      if (route === "start")
        receipt = {
          version: 1,
          sessionId: String(body!.actionId),
          status: "open",
          exercises: empty ? [] : [exercise],
          outcome: null,
        };
      if (route === "submit")
        receipt = { ...receipt!, status: "submitted", outcome: outcome(kind) };
      if (route === "read")
        receipt = {
          version: 1,
          sessionId: String(body!.actionId),
          status: "submitted",
          exercises: [],
          outcome:
            kind === "steps"
              ? { nextLessonId: "next-step" }
              : {
                  content: outcome(kind).content,
                  counted: true,
                  nextChapterId: "next-chapter",
                },
        };
      if (fail === "after") {
        fail = "none";
        throw new TypeError("synthetic response loss after commit");
      }
      return json(receipt);
    },
    false,
  );
  await client.login("synthetic", "synthetic");
  const stamp = client.getSessionStamp(),
    store = new LiveDataStore(environment),
    key = ["native", 0, "flow"];
  const flow = new NativeLearningFlow({
    client,
    store,
    key,
    reader: { ...reader, kind },
    current: () => current && client.getSessionStamp() === stamp,
    authorize: async () => {
      calls.push({ route: "authorize-reader", method: "GET", body: null });
      if (!authorizeAllowed)
        throw new NativeClientError("content_unavailable", 403);
    },
    confirmed: () => {
      confirmed.push(flow.snapshot()!.phase);
    },
  });
  return {
    flow,
    store,
    client,
    calls,
    confirmed,
    key,
    fail: (value: typeof fail) => {
      fail = value;
    },
    statusFailure: (value: number) => {
      statusFailure = value;
    },
    authorize: (value: boolean) => {
      authorizeAllowed = value;
    },
    invalidate: () => {
      current = false;
      flow.dispose();
    },
    heldStatus: () => {
      const gate = deferred<Response>();
      held = gate;
      return {
        releaseOpen: () =>
          gate.resolve(
            json(copy({ ...receipt!, status: "open", outcome: null })),
          ),
        resolve: gate.resolve,
      };
    },
    receipt: () => copy(receipt!),
    transform: (fn: typeof transform) => {
      transform = fn;
    },
  };
}

test("openen schrijft niets; dubbele start deelt dezelfde UUID en servervragen", async () => {
  const f = await fixture();
  assert.equal(f.flow.snapshot()!.phase, "read");
  assert.equal(f.calls.filter((c) => c.route === "start").length, 0);
  await Promise.all([f.flow.start(), f.flow.start()]);
  assert.equal(f.calls.filter((c) => c.route === "start").length, 1);
  assert.equal(f.flow.snapshot()!.phase, "questions");
  assert.deepEqual(f.flow.snapshot()!.session!.exercises, [exercise]);
  assert.equal(f.confirmed.length, 0);
});
test("verloren submitantwoord na commit herstelt origineel via GET, zonder tweede POST of beloningssignaal", async () => {
  const f = await fixture();
  await f.flow.start();
  f.fail("after");
  const result = await f.flow.submit(answers);
  assert.equal(result.status, "submitted");
  assert.equal(f.flow.snapshot()!.phase, "result");
  assert.equal(f.calls.filter((c) => c.route === "submit").length, 1);
  assert.equal(f.confirmed.length, 1);
  assert.equal(f.calls.at(-1)!.method, "GET");
  f.store.revalidate({ force: true });
  await tick();
  await tick();
  assert.equal(f.confirmed.length, 1);
});
test("onzekere inzending blijft bevroren; handmatige retry vraagt eerst status en herhaalt exact dezelfde antwoorden", async () => {
  const f = await fixture();
  await f.flow.start();
  f.fail("before");
  await assert.rejects(f.flow.submit(answers));
  assert.equal(f.flow.snapshot()!.pending?.kind, "submit");
  assert.equal(f.calls.filter((c) => c.route === "submit").length, 1);
  await assert.rejects(
    f.flow.submit([{ exerciseId: "q1", given: ["B"] }]),
    /learning_replay_conflict/,
  );
  const cut = f.calls.length;
  await f.flow.submit(answers);
  assert.equal(f.calls[cut].method, "GET");
  assert.deepEqual(
    f.calls.filter((c) => c.route === "submit").map((c) => c.body?.answers),
    [answers, answers],
  );
  assert.equal(f.confirmed.length, 1);
});
test("oude open status-GET kan nieuwe pending submit of bevestigd resultaat niet terugzetten", async () => {
  const f = await fixture();
  await f.flow.start();
  const old = f.receipt(),
    gate = f.heldStatus();
  f.store.revalidate({ force: true });
  await tick();
  await f.flow.submit(answers);
  gate.resolve(
    new Response(JSON.stringify(old), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  await tick();
  await tick();
  assert.equal(f.flow.snapshot()!.phase, "result");
  assert.equal(f.flow.snapshot()!.pending, null);
  assert.equal(f.flow.snapshot()!.session!.status, "submitted");
  assert.equal(f.confirmed.length, 1);
});
test("mislukte vervolg-GET bewaart bevestigd resultaat en XP", async () => {
  const f = await fixture();
  await f.flow.start();
  await f.flow.submit(answers);
  f.statusFailure(503);
  f.store.revalidate({ force: true });
  await tick();
  await tick();
  assert.equal(f.flow.snapshot()!.phase, "result");
  assert.equal(
    (f.flow.snapshot()!.session!.outcome as ReturnType<typeof outcome>)
      .xpEarned,
    10,
  );
  assert.equal(f.confirmed.length, 1);
});
test("404 na verloren start vereist readerautorisatie; ingetrokken toegang verstuurt geen nieuwe POST", async () => {
  const f = await fixture();
  f.fail("before");
  await assert.rejects(f.flow.start());
  assert.ok(f.calls.some((c) => c.route === "authorize-reader"));
  f.authorize(false);
  await assert.rejects(f.flow.retry());
  assert.equal(f.calls.filter((c) => c.route === "start").length, 1);
  assert.equal(f.flow.snapshot()!.phase, "blocked");
  assert.equal(f.flow.snapshot()!.checkpoint, null);
});
test("een lege vragenset rondt niets af; uitsluitend expliciete read geeft een leesresultaat zonder score", async () => {
  const f = await fixture(true);
  await f.flow.start();
  assert.equal(f.flow.snapshot()!.phase, "empty");
  assert.equal(f.confirmed.length, 0);
  assert.equal(f.calls.filter((c) => c.route === "read").length, 0);
  await f.flow.read();
  assert.equal(f.flow.snapshot()!.phase, "read-result");
  assert.deepEqual(f.flow.snapshot()!.readReceipt!.outcome, {
    nextLessonId: "next-step",
  });
  assert.equal(f.confirmed.length, 1);
});
test("gewone remount deelt LiveDataStore-poging; account-/bronwissel wist checkpoint en blokkeert late antwoorden", async () => {
  const f = await fixture(),
    runtime = new NativeDataRuntime(f.client, environment);
  const first = runtime.learningFlow(reader);
  await first.start();
  first.checkpoint({
    index: 0,
    answers: [],
    reviewQueue: null,
    reviewPos: 0,
    pending: null,
  });
  assert.strictEqual(
    runtime.learningFlow({ ...reader, verses: [...reader.verses] }),
    first,
  );
  const second = runtime.learningFlow({ ...reader, selectionVersion: 4 });
  assert.notStrictEqual(second, first);
  await assert.rejects(first.start(), /session_changed/);
  runtime.reset();
  assert.equal(second.snapshot(), null);
  await assert.rejects(second.start(), /session_changed/);
});
test("intrekking na ontvangen vragen verwijdert privévragen en laat geen controle of inzending doorgaan", async () => {
  const f = await fixture();
  await f.flow.start();
  f.statusFailure(403);
  f.store.revalidate({ force: true });
  await tick();
  await tick();
  assert.equal(f.flow.snapshot()!.phase, "blocked");
  assert.equal(f.flow.snapshot()!.session, null);
  assert.equal(f.flow.snapshot()!.checkpoint, null);
  await assert.rejects(f.flow.submit(answers));
  assert.equal(f.calls.filter((c) => c.route === "submit").length, 0);
});
test("receipts weigeren foutieve versie, verkeerde identiteit en verzonnen scorevelden", async () => {
  const sessionId = crypto.randomUUID(),
    good = {
      version: 1,
      sessionId,
      status: "submitted",
      exercises: [exercise],
      outcome: outcome(),
    };
  assert.equal(learningReceipt(good, sessionId).status, "submitted");
  for (const changed of [
    { ...good, version: 2 },
    { ...good, sessionId: crypto.randomUUID() },
    { ...good, outcome: { ...outcome(), xpEarned: -1 } },
    { ...good, outcome: { ...outcome(), nextLessonId:"//unauthorized" } },
    { ...good, status: "open" },
  ])
    assert.throws(
      () => learningReceipt(changed, sessionId),
      /invalid_response/,
    );
});

test("laat statusantwoord na logout kan geen vragen of resultaat terugplaatsen", async () => {
  const f = await fixture();
  await f.flow.start();
  const old = f.receipt(),
    gate = f.heldStatus();
  f.store.revalidate({ force: true });
  await tick();
  f.invalidate();
  gate.resolve(
    new Response(JSON.stringify(old), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  await tick();
  await tick();
  assert.equal(f.flow.snapshot()?.session, null);
  assert.equal(f.flow.snapshot()?.checkpoint, null);
  assert.equal(f.confirmed.length, 0);
  await assert.rejects(f.flow.submit(answers));
  assert.equal(f.calls.filter((c) => c.route === "submit").length, 0);
});

test("na oefenen en daarna lezen hercontroleert hervatten de actieve leesreceipt", async () => {
  const f = await fixture(false, "chapters");
  await f.flow.start();
  await f.flow.submit(answers);
  const questionId = f.flow.snapshot()!.session!.sessionId;
  const read = await f.flow.read();
  assert.notEqual(read.sessionId, questionId);
  const cut = f.calls.length;
  f.store.revalidate({ force: true });
  await tick();
  await tick();
  assert.equal(f.calls[cut].route, `sessions/${read.sessionId}`);
  assert.equal(f.flow.snapshot()!.phase, "read-result");
  assert.equal(f.flow.snapshot()!.readReceipt!.sessionId, read.sessionId);
});

test("nieuwe read/start na resultaat behoudt eigen UUID bij ontbrekende receipt; alleen handmatige retry schrijft", async () => {
  for (const kind of ["read", "start"] as const) {
    const f = await fixture(false, "chapters");
    await f.flow.start();
    await f.flow.submit(answers);
    const oldId = f.flow.snapshot()!.session!.sessionId;
    f.fail("before");
    await assert.rejects(f.flow[kind]());
    const pending = f.flow.snapshot()!.pending!;
    assert.equal(pending.kind, kind);
    assert.notEqual(pending.id, oldId);
    assert.notEqual(f.flow.snapshot()!.phase, "blocked");
    assert.ok(f.calls.some((c) => c.route === "authorize-reader"));
    const before = f.calls.filter((c) => c.route === kind).length;
    f.store.revalidate({ force: true });
    await tick();
    await tick();
    assert.equal(f.calls.filter((c) => c.route === kind).length, before);
    await f.flow.retry();
    assert.equal(f.flow.snapshot()!.pending, null);
    const writes = f.calls.filter(
      (c) => c.route === kind && c.body?.actionId === pending.id,
    );
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].body, writes[1].body);
  }
});

test("PostgreSQL-jsonb mag objectsleutels herschikken zonder een andere vragenset te suggereren", async () => {
  const f = await fixture();
  await f.flow.start();
  const old = f.receipt(),
    gate = f.heldStatus();
  const reordered = {
    ...old,
    exercises: old.exercises.map((e) =>
      Object.fromEntries(Object.entries(e).reverse()),
    ),
  };
  assert.notEqual(
    JSON.stringify(old.exercises),
    JSON.stringify(reordered.exercises),
  );
  f.store.revalidate({ force: true });
  await tick();
  gate.resolve(
    new Response(JSON.stringify(reordered), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  await tick();
  await tick();
  assert.equal(f.flow.snapshot()!.phase, "questions");
  assert.equal(f.flow.snapshot()!.denial, null);
  await f.flow.submit(answers);
  assert.equal(f.flow.snapshot()!.phase, "result");
});

test("afwijkend resultaat wordt nooit getoond of als beloning geïnvalideerd", async () => {
  for (const patch of [
    { chapterId: "other" },
    { total: 2 },
    { correctCount: 2 },
    { nextLessonId: undefined, nextChapterId: "other" },
  ]) {
    const f = await fixture();
    await f.flow.start();
    f.transform((raw) =>
      raw && typeof raw === "object" && "outcome" in raw && raw.outcome
        ? { ...raw, outcome: { ...raw.outcome, ...patch } }
        : raw,
    );
    await assert.rejects(f.flow.submit(answers));
    assert.notEqual(f.flow.snapshot()!.phase, "result");
    assert.equal(f.confirmed.length, 0);
  }
});

test("echte wijziging van servervragen wordt ondanks jsonb-normalisatie afgeschermd", async () => {
  const f = await fixture();
  await f.flow.start();
  f.transform((raw) =>
    raw && typeof raw === "object" && "exercises" in raw
      ? { ...raw, exercises: [{ ...exercise, prompt: "Andere inhoud" }] }
      : raw,
  );
  f.store.revalidate({ force: true });
  await tick();
  await tick();
  assert.equal(f.flow.snapshot()!.phase, "blocked");
  assert.equal(f.flow.snapshot()!.session, null);
});
