import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Prisma } from "../src/generated/prisma/client";
import {
  scriptureEvidence,
  parseScriptureUrl,
  chapterEvidenceHash,
  verifiedOfficialUrl,
} from "../src/lib/references/evidence";
import { resolveReferenceBatch } from "../src/lib/references/resolver";
import { parseOtbPassage } from "../src/lib/references/otb";
import { referenceRequestSchema } from "../src/lib/references/contract";
import {
  openReferenceTrip,
  sealReferenceTrip,
} from "../src/lib/references/trip";
import {
  REFERENCE_TRIP_TTL_MS,
  type ReferenceTrip,
} from "../src/lib/references/tripContract";
const base =
  "https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/1?lang=nld";
const target = {
  sourceKey: base + "&id=p1-p3",
  workKey: "bofm",
  editionKey: "bofm",
  language: "nl",
};
const otbTarget = {
  sourceKey: "Genesis 1:1-5",
  workKey: "old-testament",
  editionKey: "otb",
  language: "nl",
};
const origin = {
  workKey: "synthetic-study-ref",
  editionKey: "fixture-v1",
  language: "nl",
  collectionId: "synthetic-study-ref",
};
const actor = { id: "synthetic-owner", isAdmin: false };
function chapter() {
  const books = JSON.parse(
    readFileSync("prisma/bomContent.json", "utf8"),
  ) as Array<{
    slug: string;
    chapters: Array<{ number: number; verses: string[] }>;
  }>;
  return {
    id: "synthetic-chapter",
    number: 1,
    book: {
      key: "bofm/1-ne",
      name: "1 Nephi",
      contentCollection: {
        id: "content_bom",
        work: "bofm",
        editionKey: "bofm",
        language: "nl",
      },
    },
    verses: books[0].chapters[0].verses.map((text, i) => ({
      number: i + 1,
      text,
    })),
  };
}
function otbChapter({
  id = "synthetic-otb-genesis-1",
  key = "gen",
  name = "Genesis",
  number = 1,
  verseCount = 5,
}: {
  id?: string;
  key?: string;
  name?: string;
  number?: number;
  verseCount?: number;
} = {}) {
  return {
    id,
    number,
    book: {
      key,
      name,
      contentCollection: {
        id: "content_old_testament_otb_nl",
        work: "old-testament",
        editionKey: "otb",
        language: "nl",
      },
    },
    verses: Array.from({ length: verseCount }, (_, index) => ({
      number: index + 1,
      text: `Nederlandse OTB-vers ${index + 1}.`,
    })),
  };
}
test("alle 393 Nederlandse hoofdstukbewijzen zijn gepind aan bestaande repositorybronnen", () => {
  let count = 0;
  for (const [key, proof] of Object.entries(scriptureEvidence)) {
    const raw = readFileSync(`prisma/${proof.sourceFile}`);
    assert.equal(
      createHash("sha256").update(raw).digest("hex"),
      proof.sourceHash,
    );
    const book = (
      JSON.parse(raw.toString()) as Array<{
        slug: string;
        chapters: Array<{ number: number; verses: string[] }>;
      }>
    ).find((b) => b.slug === proof.alias)!;
    assert.ok(book, key);
    assert.equal(Object.keys(proof.chapters).length, book.chapters.length);
    for (const c of book.chapters) {
      const pin = proof.chapters[String(c.number)];
      assert.equal(pin.verses, c.verses.length);
      assert.equal(
        pin.hash,
        chapterEvidenceHash(
          c.verses.map((text, i) => ({ number: i + 1, text })),
        ),
      );
      count++;
    }
  }
  assert.equal(count, 393);
});
test("canonieke URL en bereik blijven exact; natuurlijke namen zijn geen mapping", () => {
  const p = parseScriptureUrl(target.sourceKey)!;
  assert.deepEqual(
    [p.bookKey, p.chapter, p.from, p.to, p.language],
    ["bofm/1-ne", 1, 1, 3, "nl"],
  );
  for (const url of [
    base + "&id=p0",
    base + "&id=p3-p1",
    base + "&id=p21",
    base + "&id=p1,p2",
    base + "&lang=eng",
    base.replace("1-ne", "nephi"),
    base.replace("/1?", "/999?"),
    "1 Nephi 1:1",
    base + "#other",
    base.replace("bofm/1-ne", "ot/gen"),
  ])
    assert.equal(parseScriptureUrl(url), null, url);
});
test("Nederlandse OTB-namen, afkortingen en codes normaliseren naar de bestaande canonieke sleutels", () => {
  for (const [sourceKey, expected] of [
    ["Genesis 1", ["gen", 1, null]],
    ["Gen. 1:1-5", ["gen", 1, [1, 2, 3, 4, 5]]],
    ["otb:gen:1:1-5", ["gen", 1, [1, 2, 3, 4, 5]]],
    ["1 Samuel 3:1", ["1sa", 3, [1]]],
    ["2 Kron. 7:14", ["2ch", 7, [14]]],
    ["Ezechiël 1:1", ["ezk", 1, [1]]],
    ["Maleachi 3:10", ["mal", 3, [10]]],
  ] as const) {
    const parsed = parseOtbPassage(sourceKey);
    assert.ok(parsed, sourceKey);
    assert.deepEqual(
      [parsed.bookKey, parsed.chapter, parsed.verses],
      expected,
      sourceKey,
    );
  }
  for (const invalid of [
    "Genesis 0",
    "Genesis 1:5-1",
    "Genesis 1:31-2:3",
    "Onbekend 1:1",
    "otb:gen:1:0",
  ])
    assert.equal(parseOtbPassage(invalid), null, invalid);
});
test("onveilige URL-normalisatie en redirects hebben geen externe vrijbrief", () => {
  for (const url of [
    "http://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/1?lang=nld",
    base.replace(
      "www.churchofjesuschrist.org",
      "www.churchofjesuschrist.org.evil.invalid",
    ),
    base.replace("https://", "https://user:secret@"),
    base + "&redirect=https://evil.invalid",
    base.replace("1-ne", "%31-ne"),
    "//www.churchofjesuschrist.org/study",
    "javascript:alert(1)",
    "https://www.churchofjesuschrist.org/login?returnUrl=https://evil.invalid",
    base + "\\evil",
  ])
    assert.equal(verifiedOfficialUrl(url), null);
  assert.equal(verifiedOfficialUrl(base), base);
  assert.equal(
    verifiedOfficialUrl(
      "https://www.churchofjesuschrist.org/study/ftsoy/2026/10/fsy-lessons/00-intro?lang=nld",
    ),
    "https://www.churchofjesuschrist.org/study/ftsoy/2026/10/fsy-lessons/00-intro?lang=nld",
  );
  assert.equal(
    verifiedOfficialUrl(
      "https://www.churchofjesuschrist.org/study/scriptures/ot/gen/1?lang=nld",
    ),
    null,
    "de echte primaire API gaf 404; geen verzonnen fallback",
  );
});
test("strikte requests accepteren uitsluitend referentie-identiteit en bezoekbewijs", () => {
  const valid = {
    lessonEditionId: "edition",
    revisionId: "revision",
    occurrenceKey: "reference",
  };
  assert.equal(referenceRequestSchema.safeParse(valid).success, true);
  for (const extra of [
    { userId: "other" },
    { target },
    { url: base },
    { isAdmin: true },
    { collectionId: "hidden" },
  ])
    assert.equal(
      referenceRequestSchema.safeParse({ ...valid, ...extra }).success,
      false,
    );
});
test("echte canon, expliciete editie en volledige hoofdstukhash leveren de juiste passage", async () => {
  const db = {
    chapter: { findMany: async () => [chapter()] },
  } as unknown as Prisma.TransactionClient;
  const [result] = await resolveReferenceBatch(db, actor, origin, [
    { target, diagnosticKey: "ref" },
  ]);
  assert.equal(result.kind, "internal");
  if (result.kind !== "internal" || result.preview.kind !== "scripture")
    throw Error("geen passage");
  assert.deepEqual(
    result.preview.verses.map((v) => v.number),
    [1, 2, 3],
  );
  assert.equal(result.preview.verses[0].text, chapter().verses[0].text);
  assert.equal(result.href, "/scripture/synthetic-chapter#vers-1");
});
test("Nederlandse OTB-verwijzingen leveren uitsluitend de exact gekozen editie en verzen", async () => {
  const db = {
    chapter: { findMany: async () => [otbChapter()] },
  } as unknown as Prisma.TransactionClient;
  const [result] = await resolveReferenceBatch(db, actor, origin, [
    { target: otbTarget, diagnosticKey: "otb-ref" },
  ]);
  assert.equal(result.kind, "internal");
  if (result.kind !== "internal" || result.preview.kind !== "scripture")
    throw Error("geen OTB-passage");
  assert.equal(result.collectionId, "content_old_testament_otb_nl");
  assert.equal(result.href, "/scripture/synthetic-otb-genesis-1#vers-1");
  assert.equal(result.title, "Genesis 1:1–5");
  assert.deepEqual(
    result.preview.verses.map((verse) => verse.number),
    [1, 2, 3, 4, 5],
  );
});
test("volledige OTB-hoofdstukken krijgen een begrensde preview en behouden een bruikbare volledige leesroute", async () => {
  for (const scenario of [
    {
      sourceKey: "Genesis 1",
      chapter: otbChapter(),
      href: "/scripture/synthetic-otb-genesis-1#vers-1",
      title: "Genesis 1",
      truncated: false,
    },
    {
      sourceKey: "Genesis 24",
      chapter: otbChapter({
        id: "synthetic-otb-genesis-24",
        number: 24,
        verseCount: 67,
      }),
      href: "/scripture/synthetic-otb-genesis-24#vers-1",
      title: "Genesis 24",
      truncated: true,
    },
    {
      sourceKey: "Psalm 119",
      chapter: otbChapter({
        id: "synthetic-otb-psalm-119",
        key: "psa",
        name: "Psalmen",
        number: 119,
        verseCount: 176,
      }),
      href: "/scripture/synthetic-otb-psalm-119#vers-1",
      title: "Psalmen 119",
      truncated: true,
    },
  ]) {
    const [result] = await resolveReferenceBatch(
      {
        chapter: { findMany: async () => [scenario.chapter] },
      } as unknown as Prisma.TransactionClient,
      actor,
      origin,
      [
        {
          target: { ...otbTarget, sourceKey: scenario.sourceKey },
          diagnosticKey: scenario.sourceKey,
        },
      ],
    );
    assert.equal(result.kind, "internal", scenario.sourceKey);
    if (result.kind !== "internal" || result.preview.kind !== "scripture")
      throw Error("geen OTB-hoofdstuk");
    assert.equal(result.href, scenario.href);
    assert.equal(result.title, scenario.title);
    assert.equal(result.preview.truncated, scenario.truncated);
    assert.equal(
      result.preview.verses.length,
      Math.min(scenario.chapter.verses.length, 40),
    );
  }
});
test("OTB-preview- en readerlimieten wijzen expliciete of onleesbare doelen af", async () => {
  const hugeText = otbChapter();
  hugeText.verses[4].text = "x".repeat(500001);
  const missingVerse = otbChapter();
  missingVerse.verses.splice(2, 1);
  for (const [chapter, sourceKey, reason] of [
    [otbChapter({ verseCount: 67 }), "Genesis 1:1-41", "too-large"],
    [otbChapter({ verseCount: 501 }), "Genesis 1", "too-large"],
    [hugeText, "Genesis 1", "too-large"],
    [missingVerse, "Genesis 1:1-5", "range"],
  ] as const) {
    const [result] = await resolveReferenceBatch(
      {
        chapter: { findMany: async () => [chapter] },
      } as unknown as Prisma.TransactionClient,
      actor,
      origin,
      [{ target: { ...otbTarget, sourceKey }, diagnosticKey: "limit" }],
    );
    assert.deepEqual(result, {
      kind: "unavailable",
      reason,
      diagnosticKey: "limit",
    });
  }
});
test("OTB-ranges, toegang en editie-equivalentie falen gesloten", async () => {
  const unavailable = {
    chapter: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  const [missing, edition] = await resolveReferenceBatch(
    unavailable,
    actor,
    origin,
    [
      { target: otbTarget, diagnosticKey: "missing" },
      { target: { ...otbTarget, language: "en" }, diagnosticKey: "edition" },
    ],
  );
  assert.deepEqual(missing, {
    kind: "unavailable",
    reason: "missing",
    diagnosticKey: "missing",
  });
  assert.deepEqual(edition, {
    kind: "unavailable",
    reason: "edition",
    diagnosticKey: "edition",
  });
  const [range] = await resolveReferenceBatch(
    {
      chapter: { findMany: async () => [otbChapter()] },
    } as unknown as Prisma.TransactionClient,
    actor,
    origin,
    [
      {
        target: { ...otbTarget, sourceKey: "Genesis 1:99" },
        diagnosticKey: "range",
      },
    ],
  );
  assert.deepEqual(range, {
    kind: "unavailable",
    reason: "range",
    diagnosticKey: "range",
  });
});
test("100 versverwijzingen naar dezelfde bron gebruiken één gerichte hoofdstukquery", async () => {
  let count = 0;
  const db = {
    chapter: {
      findMany: async (input: { where: unknown }) => {
        count++;
        assert.match(JSON.stringify(input.where), /visibleToUsers/);
        assert.match(JSON.stringify(input.where), /PUBLISHED/);
        return [chapter()];
      },
    },
  } as unknown as Prisma.TransactionClient;
  const refs = Array.from({ length: 100 }, (_, i) => ({
    target: { ...target, sourceKey: base + `&id=p${(i % 20) + 1}` },
    diagnosticKey: `ref-${i}`,
  }));
  const results = await resolveReferenceBatch(
    db,
    { ...actor, isAdmin: true },
    origin,
    refs,
  );
  assert.equal(count, 1);
  assert.ok(results.every((r) => r.kind === "internal"));
});
test("een vergelijkbare tekst, verkeerde editie of taal wordt nooit intern gesubstitueerd", async () => {
  const altered = chapter();
  altered.verses[0].text += " Gewijzigd.";
  const db = {
    chapter: { findMany: async () => [altered] },
  } as unknown as Prisma.TransactionClient;
  assert.equal(
    (
      await resolveReferenceBatch(db, actor, origin, [
        { target, diagnosticKey: "ref" },
      ])
    )[0].kind,
    "external",
  );
  for (const change of [
    { editionKey: "otb" },
    { language: "en" },
    { workKey: "old-testament" },
    { editionKey: undefined },
  ])
    assert.equal(
      (
        await resolveReferenceBatch(db, actor, origin, [
          { target: { ...target, ...change }, diagnosticKey: "ref" },
        ])
      )[0].kind,
      "external",
    );
});
test("ontbrekende en te grote passages falen gesloten en behouden alleen bewezen externe URL", async () => {
  const empty = {
    chapter: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  assert.equal(
    (
      await resolveReferenceBatch(empty, actor, origin, [
        { target, diagnosticKey: "ref" },
      ])
    )[0].kind,
    "external",
  );
  const tooLong = chapter();
  tooLong.verses[0].text = "x".repeat(50000);
  const db = {
    chapter: { findMany: async () => [tooLong] },
  } as unknown as Prisma.TransactionClient;
  assert.equal(
    (
      await resolveReferenceBatch(db, actor, origin, [
        { target, diagnosticKey: "ref" },
      ])
    )[0].kind,
    "external",
  );
  await assert.rejects(
    resolveReferenceBatch(
      empty,
      actor,
      origin,
      Array.from({ length: 201 }, () => ({ target, diagnosticKey: "ref" })),
    ),
    /REFERENCE_LIMIT/,
  );
});
test("onbekende targets blijven unavailable met dezelfde diagnostische identiteit", async () => {
  const [result] = await resolveReferenceBatch(
    {} as Prisma.TransactionClient,
    actor,
    origin,
    [{ target: { sourceKey: "onbekend:bron" }, diagnosticKey: "safe-ref-id" }],
  );
  assert.deepEqual(result, {
    kind: "unavailable",
    reason: "unverified",
    diagnosticKey: "safe-ref-id",
  });
});
test("terugkeerbewijzen zijn sessie/eigenaar/TTL/routegebonden en niet manipuleerbaar", () => {
  const old = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "reference-unit-only-secret-v1";
  try {
    const now = 1000000;
    const trip: ReferenceTrip = {
      purpose: "reference-trip-v1",
      key: "46553e64-8d2a-4a0c-9717-3f10c4d952c1",
      userId: actor.id,
      sessionKey: "session",
      issuedAt: now,
      expiresAt: now + REFERENCE_TRIP_TTL_MS,
      lessonId: "lesson",
      lessonEditionId: "edition",
      collectionId: "source",
      revisionId: "revision",
      sectionAnchor: "section",
      blockAnchor: "block",
      positionVersion: 2,
      workKey: "work",
      studyVersion: 0,
      targetStudyWorkKey: null,
      targetStudyVersion: null,
      beforeVersion: 0,
      afterVersion: 1,
      before: { activeContentCollectionId: "source", contentLanguage: "nl" },
      after: {
        activeContentCollectionId: "content_bom",
        contentLanguage: "nl",
      },
      originHref: "/study-lesson/lesson/source",
      targetHref: "/scripture/chapter#vers-1",
    };
    const token = sealReferenceTrip(trip);
    assert.deepEqual(openReferenceTrip(token, actor.id, "session", now), trip);
    for (const [owner, session, at] of [
      ["other", "session", now],
      [actor.id, "other", now],
      [actor.id, "session", trip.expiresAt],
    ] as const)
      assert.equal(openReferenceTrip(token, owner, session, at), null);
    assert.equal(
      openReferenceTrip(token + "x", actor.id, "session", now),
      null,
    );
    assert.throws(() =>
      sealReferenceTrip({ ...trip, originHref: "//evil.invalid" }),
    );
  } finally {
    if (old === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = old;
  }
});

test("studielesreferenties gebruiken twee batchqueries, geen query per verwijzing", async () => {
  let logical = 0,
    editions = 0;
  const db = {
    studyLesson: {
      findMany: async () => {
        logical++;
        return [];
      },
    },
    studyLessonEdition: {
      findMany: async () => {
        editions++;
        return [];
      },
    },
  } as unknown as Prisma.TransactionClient;
  const refs = Array.from({ length: 100 }, (_, i) => ({
    target: { sourceKey: `study:missing-lesson#section-${i}` },
    diagnosticKey: `ref-${i}`,
  }));
  const results = await resolveReferenceBatch(db, actor, origin, refs);
  assert.equal(logical, 1);
  assert.equal(editions, 1);
  assert.ok(results.every((r) => r.kind === "unavailable"));
  await resolveReferenceBatch(
    db,
    actor,
    origin,
    Array.from({ length: 21 }, (_, i) => ({
      target: { sourceKey: `study:missing-${i}` },
      diagnosticKey: `ref-${i}`,
    })),
  );
  assert.equal(logical, 1);
  assert.equal(
    editions,
    1,
    "een te grote unieke studiebatch haalt geen bodies op",
  );
});

test("fragmenten buiten de canonieke passage worden afgewezen", () => {
  assert.equal(parseScriptureUrl(base + "#p99"), null);
  assert.equal(parseScriptureUrl(base + "&id=p1-p3#p4"), null);
  assert.equal(parseScriptureUrl(base + "#p5")?.from, 5);
});

test("een studielesalias behoudt alleen zijn bewezen eigen externe bron", async () => {
  const db = {
    studyLesson: { findMany: async () => [] },
    studyLessonEdition: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  const url =
    "https://www.churchofjesuschrist.org/study/ftsoy/2026/10/fsy-lessons/00-intro?lang=nld";
  const [valid, invalid] = await resolveReferenceBatch(db, actor, origin, [
    {
      target: {
        sourceKey:
          "study:/study/ftsoy/2026/10/fsy-lessons/00-intro#section-intro",
        externalUrl: url,
      },
      diagnosticKey: "known",
    },
    {
      target: { sourceKey: "study:unrelated-lesson", externalUrl: url },
      diagnosticKey: "unknown",
    },
  ]);
  assert.equal(valid.kind, "external");
  assert.equal(invalid.kind, "unavailable");
});
