import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "../src/generated/prisma/client";
import review from "../data/study-content/cfm-2026-nl/reference-review.json";
import baseline from "../data/study-content/cfm-2026-nl/reference-review-baseline.json";
import checks from "../data/study-content/cfm-2026-nl/reference-source-checks.json";
import registered from "../src/lib/references/official-resources-cfm.json";
import { cfmReferenceTarget } from "../src/lib/studyContent/cfm2026Adapter";
import { parseOtbPassage, parseOtbPassageSet } from "../src/lib/references/otb";
import { resolveReferenceBatch } from "../src/lib/references/resolver";
import { verifiedOfficialUrl } from "../src/lib/references/evidence";
import { referenceRequestSchema } from "../src/lib/references/contract";
const base =
  "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/01?lang=nld";
const ot = "https://www.churchofjesuschrist.org/study/scriptures/ot/";
const target = {
  workKey: "old-testament",
  editionKey: "otb",
  language: "nl",
  sourceKey: "otb-set:gen:1;gen:2",
};
const origin = {
  workKey: "synthetic-study-ref",
  editionKey: "fixture-v1",
  language: "nl",
  collectionId: "synthetic-study-ref",
};
const actor = { id: "fixture-owner", isAdmin: false };
function chapter(number: number) {
  return {
    id: `chapter-${number}`,
    number,
    book: {
      key: "gen",
      name: "Genesis",
      contentCollection: {
        id: "fixture-otb",
        work: "old-testament",
        editionKey: "otb",
        language: "nl",
      },
    },
    verses: Array.from({ length: 67 }, (_, i) => ({
      id: `v-${number}-${i}`,
      number: i + 1,
      text: `Vers ${i + 1}`,
    })),
  };
}
test("alle oorspronkelijke 1481 locaties hebben een unieke reproduceerbare beoordeling", () => {
  assert.equal(review.assessments.length, 1481);
  assert.equal(
    new Set(review.assessments.map((a) => `${a.lesson}:${a.sourceLocation}`))
      .size,
    1481,
  );
  for (const a of review.assessments) {
    const old = baseline.occurrences.find(
      (b) => b.lesson === a.lesson && b.anchor === a.sourceLocation,
    )!;
    assert.equal(a.label, old.label);
    assert.equal(a.originalUrl, old.originalTarget.externalUrl);
    assert.equal(a.originalReason, old.originalReason);
    assert.ok(a.sourceEvidence);
    assert.equal(a.runtimeAccessRequired, true);
    if (a.classification.startsWith("A_"))
      assert.ok(
        a.canonicalCandidate.every((p) => p.sourceBlob && p.verseNumbersExist),
      );
    if (a.originalReason === "LABEL_URI_NUMBERING_CONFLICT")
      assert.equal(a.manualReviewRequired, true);
  }
  assert.equal(review.numberingConflictsInternallyResolved, 0);
  assert.equal(review.additionalFindings.length, 4);
  assert.ok(
    review.additionalFindings.every(
      (a) => a.manualReviewRequired && !a.internalMappingApproved,
    ),
  );
  assert.equal(review.videoChecks.length, 95);
  assert.ok(
    review.videoChecks.every(
      (v) =>
        v.sourceAttachment?.posterChecksum &&
        v.sourceAttachment.sourceSnapshotHash &&
        v.posterPreserved &&
        !v.videoMirrored,
    ),
  );
  assert.equal(
    review.altReview.alt,
    "Meer voor onderwijs aan kinderen — Nu bekijken.",
  );
});
test("exact gecontroleerde externe resources, PDF en video; geen host-wildcard of taalvervanging", () => {
  assert.equal(registered.length, 489);
  for (const r of registered) {
    const check = checks.resources.find((c) => c.url === r.url)!;
    assert.equal(check.verified, true);
    assert.equal(verifiedOfficialUrl(r.url), r.url);
    assert.equal(verifiedOfficialUrl(r.url + "&arbitrary=1"), null);
  }
  assert.ok(registered.some((r) => r.url.endsWith(".pdf")));
  assert.ok(registered.some((r) => r.url.endsWith("-nl.mp4")));
  assert.ok(!registered.some((r) => r.url.endsWith("-en.mp4")));
  assert.equal(
    verifiedOfficialUrl(
      "https://www.churchofjesuschrist.org/login?returnTo=https://evil.test",
    ),
    null,
  );
  const nt = cfmReferenceTarget(
    "https://www.churchofjesuschrist.org/study/scriptures/nt/john/6?id=p48&lang=nld#p48",
    "Johannes 6:48",
    base,
  );
  assert.equal(nt.workKey, undefined);
  assert.ok(!nt.sourceKey.startsWith("otb:"));
});
test("hoofdstukbundels, hele boeken, lokale verslabels en grote bereiken behouden ieder onderdeel", () => {
  assert.equal(
    parseOtbPassageSet(
      cfmReferenceTarget(ot + "gen/1?lang=nld", "Genesis 1–6", base).sourceKey,
    )!.length,
    6,
  );
  assert.equal(
    parseOtbPassageSet(
      cfmReferenceTarget(ot + "ruth/1?lang=nld", "Ruth", base).sourceKey,
    )!.length,
    4,
  );
  assert.deepEqual(
    parseOtbPassage(
      cfmReferenceTarget(
        ot + "ex/12?id=p7,p13,p23&lang=nld",
        "vers 7, 13, 23",
        base,
      ).sourceKey,
    )!.verses,
    [7, 13, 23],
  );
  const cross = parseOtbPassageSet(
    cfmReferenceTarget(ot + "gen/1?id=p31&lang=nld", "Genesis 1:31–2:3", base)
      .sourceKey,
  )!;
  assert.deepEqual(
    cross.map((p) => p.verses),
    [[31], [1, 2, 3]],
  );
  const large = parseOtbPassageSet(
    cfmReferenceTarget(
      ot + "gen/41?id=p15-p57&lang=nld",
      "Genesis 41:15–57",
      base,
    ).sourceKey,
  )!;
  assert.deepEqual(
    large.map((p) => p.verses!.length),
    [40, 3],
  );
  assert.deepEqual(
    large.flatMap((p) => p.verses!),
    Array.from({ length: 43 }, (_, i) => i + 15),
  );
  for (const s of [
    "otb-set:gen:1;",
    "otb-set:gen:1;gen:1",
    "otb-set:gen:1:0",
    "otb-set:gen:1:1-41",
  ])
    assert.equal(parseOtbPassageSet(s), null);
  assert.match(
    cfmReferenceTarget(ot + "isa/9?id=p6&lang=nld", "Jesaja 9:5", base)
      .sourceKey,
    /^unverified-numbering:/,
  );
});
test("één batchquery controleert alle hoofdstukken; iedere keuze heeft eigen volledige route en maximaal 40 previewverzen", async () => {
  let queries = 0;
  const db = {
    chapter: {
      findMany: async () => {
        queries++;
        return [chapter(1), chapter(2)];
      },
    },
  } as unknown as Prisma.TransactionClient;
  for (const index of [0, 1]) {
    const [r] = await resolveReferenceBatch(db, actor, origin, [
      { target, diagnosticKey: "compound", passageIndex: index },
    ]);
    assert.equal(r.kind, "internal");
    if (r.kind !== "internal" || r.preview.kind !== "scripture")
      throw Error("geen preview");
    assert.equal(r.passages!.length, 2);
    assert.equal(r.preview.verses.length, 40);
    assert.equal(r.preview.truncated, true);
    assert.equal(r.href, `/scripture/chapter-${index + 1}#vers-1`);
  }
  assert.equal(queries, 2);
  const [missing] = await resolveReferenceBatch(
    {
      chapter: { findMany: async () => [chapter(1)] },
    } as unknown as Prisma.TransactionClient,
    actor,
    origin,
    [{ target, diagnosticKey: "missing" }],
  );
  assert.equal(missing.kind, "unavailable");
  const [bad] = await resolveReferenceBatch(db, actor, origin, [
    { target, diagnosticKey: "bad", passageIndex: 2 },
  ]);
  assert.equal(bad.kind, "unavailable");
  const [edition] = await resolveReferenceBatch(db, actor, origin, [
    { target: { ...target, editionKey: "other" }, diagnosticKey: "edition" },
  ]);
  assert.equal(edition.kind, "unavailable");
  assert.equal(
    referenceRequestSchema.safeParse({
      lessonEditionId: "x",
      revisionId: "y",
      occurrenceKey: "z",
      passageIndex: 40,
    }).success,
    false,
  );
});
