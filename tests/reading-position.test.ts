import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  readingPositionActionSchema,
  readingStart,
  readingQuote,
  resolveReadingAnchor,
  type ReadingPositionState,
  type ReadingPositionView,
  type ReadingPositionAction,
} from "../src/lib/studyContent/readingPositionContract";
import {
  ReadingSaveQueue,
  ReadingSaveFailure,
} from "../src/lib/studyContent/readingSaveQueue";
import { canRestoreScroll, restoreEntryScroll } from "../src/lib/scrollRestore";
import { studyRevisionFixture } from "./fixtures/study-content";
import { parseStudyDocument } from "../src/lib/studyContent/schema";
import {
  issueReadingVisitProof,
  validReadingVisitProof,
  READING_VISIT_TTL_SECONDS,
} from "../src/lib/studyContent/readingVisitProof";
const doc = parseStudyDocument(studyRevisionFixture().body);
const start = readingStart(doc, "revision");
const action = () => ({
  ...start,
  lessonEditionId: "edition",
  expectedVersion: 0,
  actionId: randomUUID(),
  intent: "SAVE" as const,
});
const state = (): ReadingPositionState => ({
  lessonEditionId: "edition",
  currentRevisionId: "revision",
  publicationVersion: 1,
  position: null,
});
const position = (
  patch: Partial<ReadingPositionView> = {},
): ReadingPositionView => ({
  ...start,
  lessonEditionId: "edition",
  version: 1,
  updatedAt: new Date().toISOString(),
  quoteContext: null,
  lastActionId: randomUUID(),
  ...patch,
});
test("leesbezoekbewijs is ondertekend, sessie-/user-/editie-/revisiegebonden en verloopt", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "reader-proof-unit-secret-at-least-32-characters";
  try {
    const issued = Date.UTC(2026, 9, 13, 12);
    const proof = issueReadingVisitProof("user-one", "edition-one", "rev-one", "session-one", issued);
    const valid = (token: string | undefined, user = "user-one", edition = "edition-one", revision = "rev-one", session = "session-one", now = issued) =>
      validReadingVisitProof(token, user, edition, revision, session, now);
    assert.equal(valid(proof), true);
    assert.equal(valid(proof, "user-two"), false);
    assert.equal(valid(proof, "user-one", "edition-two"), false);
    assert.equal(valid(proof, "user-one", "edition-one", "rev-two"), false);
    assert.equal(valid(proof, "user-one", "edition-one", "rev-one", "session-two"), false);
    assert.equal(valid(proof, "user-one", "edition-one", "rev-one", "session-one", issued + READING_VISIT_TTL_SECONDS * 1000), false);
    assert.equal(valid(proof.replace(/.$/, proof.endsWith("A") ? "B" : "A")), false);
    assert.equal(valid(undefined), false);
    assert.equal(valid("rv1.bad.signature"), false);
    assert.equal(readingPositionActionSchema.safeParse({
      ...action(), visitProof: proof,
    }).success, true);
    assert.equal(readingPositionActionSchema.safeParse({
      ...action(), visitProof: "x".repeat(1501),
    }).success, false);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

for (const patch of [
  { sectionFraction: -0.01 },
  { sectionFraction: 1.01 },
  { sectionFraction: NaN },
  { sectionFraction: Infinity },
  { expectedVersion: -1 },
  { expectedVersion: 2147483647 },
  { userId: "victim" },
  { quoteContext: "invented" },
  { sectionAnchor: "../path" },
  { blockAnchor: "" },
  { revisionId: "" },
  { hintCount: 0 },
  { readStatus: "READ" },
  { actionId: "no-uuid" },
])
  test(`strikte positiepayload weigert ${JSON.stringify(patch)}`, () => {
    assert.equal(
      readingPositionActionSchema.safeParse({ ...action(), ...patch }).success,
      false,
    );
  });
test("begin, exact blok, sectieherstel en ontbrekend anker zijn onderscheiden", () => {
  assert.equal(resolveReadingAnchor(doc, "revision", null).kind, "NEW");
  assert.equal(resolveReadingAnchor(doc, "next", position()).kind, "EXACT");
  assert.equal(
    resolveReadingAnchor(doc, "next", position({ blockAnchor: "removed" }))
      .kind,
    "SECTION",
  );
  assert.deepEqual(
    resolveReadingAnchor(
      doc,
      "next",
      position({ sectionAnchor: "removed", blockAnchor: "removed" }),
    ),
    { kind: "LOST", coordinate: null },
  );
});
test("quoteherstel vereist één uniek exact tekstfragment, geen korte/ambigue tekst", () => {
  const unique =
    "Dit is een voldoende lange, exact herkenbare synthetische passage.";
  const body = structuredClone(doc);
  const paragraph = body.sections[0].blocks.find(
    (b) => b.type === "paragraph",
  )!;
  if (paragraph.type !== "paragraph") throw new Error("fixture");
  paragraph.content = [{ type: "text", text: unique }];
  const old = position({
    sectionAnchor: "removed",
    blockAnchor: "removed",
    quoteContext: unique,
  });
  assert.equal(resolveReadingAnchor(body, "next", old).kind, "QUOTE");
  body.sections.push({
    id: "duplicate-section",
    blocks: [{ ...paragraph, id: "duplicate-paragraph" }],
  });
  assert.equal(resolveReadingAnchor(body, "next", old).kind, "LOST");
  assert.equal(
    resolveReadingAnchor(body, "next", { ...old, quoteContext: "Dit" }).kind,
    "LOST",
  );
});
test("quote is server-afleidbaar en begrensd zonder persoonlijke notities", () => {
  assert.equal(
    readingQuote({
      id: "paragraph",
      type: "paragraph",
      content: [{ type: "text", text: "😀".repeat(300) }],
    })?.length,
    480,
  );
});
test("scrollprioriteit: geschiedenis en gebruiker winnen; expliciete gebruikersactie blijft mogelijk", () => {
  const base = {
    key: "entry",
    history: false,
    interacted: false,
    restoring: false,
  };
  assert.ok(canRestoreScroll(base, "entry", "position"));
  assert.equal(
    canRestoreScroll({ ...base, history: true }, "entry", "position"),
    false,
  );
  assert.equal(
    canRestoreScroll({ ...base, interacted: true }, "entry", "position"),
    false,
  );
  assert.equal(canRestoreScroll(base, "old-entry", "position"), false);
  assert.ok(
    canRestoreScroll(
      { ...base, history: true, interacted: true },
      "entry",
      "explicit",
      true,
    ),
  );
});
test("verlies response herhaalt exact actionId; nieuwere pending positie volgt serieel", async () => {
  const sent: ReadingPositionAction[] = [];
  let attempt = 0;
  const q = new ReadingSaveQueue(
    state(),
    "revision",
    async (a) => {
      sent.push(a);
      if (++attempt === 1) throw new Error("network");
      return {
        state: {
          ...state(),
          position: position({
            ...a,
            version: a.expectedVersion + 1,
            lastActionId: a.actionId,
          }),
        },
      };
    },
    () => {},
  );
  q.update({ ...start, sectionFraction: 0.2 });
  await q.flush();
  assert.equal(q.snapshot().status, "error");
  q.update({ ...start, sectionFraction: 0.4 });
  await q.flush();
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].expectedVersion, 1);
  assert.equal(q.snapshot().state.position?.sectionFraction, 0.4);
});
test("conflict stopt de queue tot bewuste serverkeuze; oude responses/andere editie worden niet toegepast", async () => {
  const fresh = {
    ...state(),
    position: position({ version: 3, sectionFraction: 0.8 }),
  };
  let calls = 0;
  const q = new ReadingSaveQueue(
    state(),
    "revision",
    async () => {
      calls++;
      throw new ReadingSaveFailure(409, fresh);
    },
    () => {},
  );
  q.update({ ...start, sectionFraction: 0.1 });
  await q.flush();
  q.update({ ...start, sectionFraction: 0.2 });
  await q.flush();
  assert.equal(calls, 1);
  assert.equal(q.snapshot().status, "conflict");
  assert.equal(q.acceptServer().position?.version, 3);
  q.observe({ ...fresh, lessonEditionId: "another" });
  assert.equal(q.snapshot().state.lessonEditionId, "edition");
});
test("start-over wordt na lopende save verstuurd, met nieuwe versie en eigen idempotente identiteit", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const sent: ReadingPositionAction[] = [];
  const q = new ReadingSaveQueue(
    state(),
    "revision",
    async (a) => {
      sent.push(a);
      if (sent.length === 1) await wait;
      return {
        state: {
          ...state(),
          position: position({
            ...a,
            version: a.expectedVersion + 1,
            lastActionId: a.actionId,
          }),
        },
      };
    },
    () => {},
  );
  q.update({ ...start, sectionFraction: 0.6 });
  const save = q.flush();
  const reset = q.startOver(start);
  release();
  await Promise.all([save, reset]);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].intent, "START_OVER");
  assert.equal(sent[1].expectedVersion, 1);
  assert.equal(q.snapshot().state.position?.sectionFraction, 0);
});
test("disposed visit ontvangt geen late callbacks; ingetrokkene kan niet opnieuw opslaan", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let notifications = 0;
  const q = new ReadingSaveQueue(
    state(),
    "revision",
    async () => {
      await wait;
      return { state: state() };
    },
    () => {
      notifications++;
    },
  );
  q.update({ ...start, sectionFraction: 0.2 });
  const save = q.flush();
  const before = notifications;
  q.dispose();
  release();
  await save;
  assert.equal(notifications, before);
  const denied = new ReadingSaveQueue(
    state(),
    "revision",
    async () => {
      throw new ReadingSaveFailure(404);
    },
    () => {},
  );
  denied.update(start);
  await denied.flush();
  assert.equal(denied.snapshot().status, "unavailable");
});

import {
  classifyContentRoute,
  contentHubHref,
} from "../src/lib/contentRouting";
test("studielesroute is exact collectiegebonden en heeft een veilige leerhub", () => {
  const route = classifyContentRoute(
    "/study-lesson/logical-lesson/exact-edition",
  );
  assert.deepEqual(route, {
    kind: "studyLesson",
    lessonId: "logical-lesson",
    collectionId: "exact-edition",
  });
  assert.equal(contentHubHref(route), "/courses");
});

test("readerreload gebruikt serverpositie; generieke reload en browserback behouden historie", () => {
  assert.equal(restoreEntryScroll("reload", true), false);
  assert.equal(restoreEntryScroll("back_forward", true), true);
  assert.equal(restoreEntryScroll("reload", false), true);
  assert.equal(restoreEntryScroll("navigate", true), false);
});

test("UUID-acties worden genormaliseerd naar de PostgreSQL-identiteit", () => {
  const id = randomUUID();
  assert.equal(
    readingPositionActionSchema.parse({
      ...action(),
      actionId: id.toUpperCase(),
    }).actionId,
    id,
  );
});

test("late eigen response kan nieuwere toestelpositie of publicatiemetadata niet terugzetten", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let sends = 0;
  const q = new ReadingSaveQueue(
    state(),
    "revision",
    async (a) => {
      sends++;
      await held;
      return {
        state: {
          ...state(),
          position: position({ ...a, version: 1, lastActionId: a.actionId }),
        },
      };
    },
    () => {},
  );
  q.update({ ...start, sectionFraction: 0.2 });
  const own = q.flush();
  const reset = q.startOver(start);
  q.observe({
    ...state(),
    currentRevisionId: "new-revision",
    publicationVersion: 2,
    position: position({ version: 2, sectionFraction: 0.8 }),
  });
  release();
  await Promise.all([own, reset]);
  assert.equal(q.snapshot().status, "conflict");
  assert.equal(q.snapshot().state.position?.version, 2);
  assert.equal(q.snapshot().state.position?.sectionFraction, 0.8);
  assert.equal(q.snapshot().state.publicationVersion, 2);
  assert.equal(sends, 1);
});
test("late metadataresponse met dezelfde positie overschrijft geen nieuwere publicatie", () => {
  const q = new ReadingSaveQueue(
    state(),
    "revision",
    async () => ({ state: state() }),
    () => {},
  );
  q.observe({ ...state(), publicationVersion: 3, currentRevisionId: "new" });
  q.observe(state());
  assert.equal(q.snapshot().state.publicationVersion, 3);
  assert.equal(q.snapshot().state.currentRevisionId, "new");
});

test("bewust accepteren van serverpositie maakt een nog onderweg zijnde response ongeldig", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const q = new ReadingSaveQueue(
    state(),
    "revision",
    async (a) => {
      await held;
      return {
        state: {
          ...state(),
          position: position({ ...a, version: 1, lastActionId: a.actionId }),
        },
      };
    },
    () => {},
  );
  q.update({ ...start, sectionFraction: 0.2 });
  const pending = q.flush();
  q.observe({
    ...state(),
    position: position({ version: 2, sectionFraction: 0.8 }),
  });
  q.acceptServer();
  release();
  await pending;
  assert.equal(q.snapshot().status, "idle");
  assert.equal(q.snapshot().state.position?.version, 2);
  assert.equal(q.snapshot().state.position?.sectionFraction, 0.8);
});
