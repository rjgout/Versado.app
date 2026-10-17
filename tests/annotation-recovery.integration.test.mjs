// Fase 4D: veilig annotatieherstel. Eigen wegwerp-PostgreSQL (assertReferenceTestEnvironment) en de echte productieserver.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { mutateAnnotation, resolveAnnotation, getAnnotation, listAnnotations, readerAnnotations, AnnotationError } from "../src/lib/annotations/service.ts";
import { passageBlocks, validatePassageSelector } from "../src/lib/annotations/contract.ts";
import { resolveAnnotationFocus } from "../src/lib/annotations/studyFocus.ts";
import { listStudyFolder } from "../src/lib/annotations/studyFolder.ts";
import { appendStudyRevision } from "../src/lib/studyContent/revisions.ts";
import { referenceFixture, referenceAccount, assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";

assertReferenceTestEnvironment();
let f, original, section, block, target, quote;
const command = (kind, tgt, expectedVersion = 0, extra = {}) => ({ kind, target: tgt, expectedVersion, actionId: randomUUID(), ...(kind === "note" ? { text: "Privénotitie 4D" } : {}), ...extra });
const fault = (code) => (error) => error instanceof AnnotationError && error.code === code;
const http = (path, method = "GET", body, who = f.owner, origin = f.base) => fetch(f.base + path, {
  method, redirect: "manual",
  headers: { ...(who ? { Cookie: who.cookie } : {}), ...(method === "GET" ? {} : { Origin: origin, "Content-Type": "application/json" }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const chars = (text) => [...text];
function selectorFor(body, revisionId, sectionAnchor, blockId, start, end) {
  const text = chars(passageBlocks(body, sectionAnchor).find((b) => b.id === blockId).text);
  return validatePassageSelector(body, {
    normalizationVersion: 1, originalRevisionId: revisionId, sectionAnchor,
    ranges: [{ blockId, start, end }], exact: text.slice(start, end).join(""),
    prefix: text.slice(Math.max(0, start - 32), start).join(""), suffix: text.slice(end, end + 32).join(""),
  });
}
function editBlock(body, id, fn) {
  const copy = structuredClone(body);
  (function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (value.id === id) fn(value);
    for (const key of ["blocks", "items", "children", "rows", "cells"]) walk(value[key]);
  })(copy.sections);
  return copy;
}
const pointer = (id) => prisma.studyLessonEdition.update({ where: { id: f.item.lessonEditionId }, data: { publishedRevisionId: id } });
async function newRevision(body, title = "Herstel 4D") {
  const old = await prisma.studyRevision.findUniqueOrThrow({ where: { id: original } });
  return appendStudyRevision(f.admin.actor, f.item.lessonEditionId, { schemaVersion: 1, title, body, sourceMetadata: old.sourceMetadata, rightsMetadata: old.rightsMetadata });
}
const lessonOf = async (actor) => {
  const { getPublishedStudyLesson } = await import("../src/lib/studyContent/revisions.ts");
  const edition = await prisma.studyLessonEdition.findUniqueOrThrow({ where: { id: f.item.lessonEditionId } });
  return getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId);
};
const raw = async (kind, id) => (await prisma.$queryRawUnsafe(`SELECT * FROM "${kind === "bookmark" ? "Bookmark" : kind === "highlight" ? "Highlight" : "Note"}" WHERE id=$1`, id))[0];
const snapshot = (row) => JSON.stringify({ id: row.id, userId: row.userId, createdAt: row.createdAt, lessonEditionId: row.lessonEditionId, revisionId: row.revisionId, selector: row.selector, targetKey: row.targetKey, text: row.text, color: row.color });
async function economy(userId) {
  return JSON.stringify([await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { xpTotal: true, hintBalance: true, currentStreak: true } }), await prisma.streakDay.count({ where: { userId } })]);
}

before(async () => {
  f = await referenceFixture();
  original = f.item.revisionId;
  section = f.dto.lesson.body.sections[0];
  block = passageBlocks(f.dto.lesson.body, section.id)[0];
  const len = Math.min(18, chars(block.text).length);
  const selector = selectorFor(f.dto.lesson.body, original, section.id, block.id, 0, len);
  quote = selector.exact;
  target = { type: "lesson", lessonEditionId: f.item.lessonEditionId, revisionId: original, selector };
});
after(() => prisma.$disconnect());

test("exact herkend: eigen annotaties blijven bewerkbaar via hun oorspronkelijke identiteit; oorspronkelijke velden byte-identiek", async () => {
  const who = await referenceAccount();
  const before = await economy(who.user.id);
  const rows = {};
  for (const kind of ["bookmark", "highlight", "note"]) rows[kind] = (await mutateAnnotation(who.actor, command(kind, target, 0, kind === "highlight" ? { color: "green" } : {}))).annotation;
  const frozen = Object.fromEntries(await Promise.all(Object.entries(rows).map(async ([kind, a]) => [kind, snapshot(await raw(kind, a.id))])));
  const second = await newRevision(structuredClone(f.dto.lesson.body), "Zelfde inhoud");
  await pointer(second.id);
  try {
    const list = await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: second.id });
    assert.equal(list.annotations.length, 3);
    for (const a of list.annotations) {
      assert.equal(a.placement.status, "EXACT");
      assert.equal(a.placement.selector.originalRevisionId, second.id, "effectieve selector hoort bij de actuele revisie");
      assert.equal(a.target.revisionId, original, "identiteit blijft de oorspronkelijke revisie");
      assert.equal(a.targetKey, rows[a.kind].targetKey);
    }
    const focus = await resolveAnnotationFocus(who.actor, `highlight:${rows.highlight.id}`, await lessonOf(who.actor));
    assert.equal(focus.status, "exact");
    const item = (await listStudyFolder(who.actor, {})).items.find((i) => i.id === rows.highlight.id);
    assert.equal(item.recovery, "found");
    assert.equal(item.source.status, "available");
    // Kleur en notitie wijzigen via de oorspronkelijke identiteit: bewezen exacte plaats geeft schrijfrecht, ook op de nieuwe revisie.
    const recolored = await mutateAnnotation(who.actor, command("highlight", target, rows.highlight.mutationVersion, { color: "purple" }));
    assert.equal(recolored.annotation.color, "purple");
    assert.equal(recolored.annotation.id, rows.highlight.id);
    const edited = await mutateAnnotation(who.actor, command("note", target, rows.note.mutationVersion, { text: "Bewerkt op nieuwe revisie" }));
    assert.equal(edited.annotation.id, rows.note.id);
    for (const kind of ["bookmark", "highlight", "note"]) {
      const row = await raw(kind, rows[kind].id);
      assert.equal(row.revisionId, original); assert.equal(row.targetKey, rows[kind].targetKey);
      assert.deepEqual(row.selector, target.selector);
      assert.equal(row.resolvedRevisionId, null);
    }
    assert.equal(await prisma.note.count({ where: { userId: who.user.id } }), 1);
    assert.equal(await economy(who.user.id), before, "geen XP, hints of reeks");
    // Een andere gebruiker kan er geen schrijfrecht aan ontlenen.
    await assert.rejects(mutateAnnotation((await referenceAccount()).actor, command("highlight", target, 0, { color: "blue" })), fault("UNAVAILABLE"));
    // De oorspronkelijke velden van de ongewijzigde bladwijzer zijn nog byte-identiek.
    assert.equal(snapshot(await raw("bookmark", rows.bookmark.id)), frozen.bookmark);
  } finally { await pointer(original); }
});

test("voorstel: nooit automatisch; pas na bevestiging, met versie, idempotentie en conflictbescherming", async () => {
  const who = await referenceAccount(), other = await referenceAccount();
  const note = (await mutateAnnotation(who.actor, command("note", target, 0, { text: "Aan mijn passage" }))).annotation;
  const updatedAt = (await raw("note", note.id)).updatedAt;
  const renamed = editBlock(f.dto.lesson.body, block.id, (b) => { b.id = `${block.id}-v2`; });
  const rev = await newRevision(renamed, "Blok vervangen");
  await pointer(rev.id);
  try {
    const reader = await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev.id });
    assert.equal(reader.annotations[0].placement.status, "NEEDS_REVIEW");
    assert.equal(reader.annotations[0].placement.selector, undefined, "een voorstel wordt niet als bestaande plaats geleverd");
    const lesson = await lessonOf(who.actor);
    const focus = await resolveAnnotationFocus(who.actor, `note:${note.id}`, lesson);
    assert.equal(focus.status, "proposal");
    assert.equal(focus.quote, quote);
    assert.equal((await listStudyFolder(who.actor, {})).items.find((i) => i.id === note.id).recovery, "review");
    assert.equal((await raw("note", note.id)).resolvedRevisionId, null, "lezen muteert niets");
    const base = { kind: "note", id: note.id, mode: "proposal", revisionId: rev.id, selector: focus.proposal, expectedVersion: note.mutationVersion, actionId: randomUUID() };
    // Gemanipuleerd voorstel, verouderde versie, vreemde gebruiker.
    const tampered = structuredClone(focus.proposal); tampered.ranges[0].end -= 1; tampered.exact = [...tampered.exact].slice(0, -1).join(""); tampered.suffix = "";
    await assert.rejects(resolveAnnotation(who.actor, { ...base, actionId: randomUUID(), selector: tampered }), (e) => e instanceof AnnotationError && ["INVALID", "CONFLICT"].includes(e.code));
    await assert.rejects(resolveAnnotation(who.actor, { ...base, actionId: randomUUID(), expectedVersion: 5 }), fault("CONFLICT"));
    await assert.rejects(resolveAnnotation(other.actor, { ...base, actionId: randomUUID() }), fault("UNAVAILABLE"));
    await assert.rejects(resolveAnnotation(f.admin.actor, { ...base, actionId: randomUUID() }), fault("UNAVAILABLE"), "een adminrol geeft geen toegang tot andermans annotatie");
    await assert.rejects(resolveAnnotation(who.actor, { ...base, actionId: randomUUID(), revisionId: original, selector: { ...focus.proposal, originalRevisionId: original } }), (e) => e instanceof AnnotationError);
    assert.equal((await raw("note", note.id)).resolvedRevisionId, null, "mislukte pogingen schrijven niets");
    const before = await economy(who.user.id);
    const done = await resolveAnnotation(who.actor, base);
    assert.equal(done.changed, true);
    assert.equal(done.annotation.mutationVersion, note.mutationVersion + 1);
    assert.equal(done.annotation.id, note.id);
    // Identieke retry na een verloren respons: geen tweede schrijfactie.
    const retry = await resolveAnnotation(who.actor, base);
    assert.equal(retry.changed, false);
    assert.equal(retry.annotation.mutationVersion, done.annotation.mutationVersion);
    await assert.rejects(resolveAnnotation(who.actor, { ...base, selector: { ...focus.proposal, suffix: "x" } }), fault("INVALID"), "zelfde actionId met andere inhoud");
    const row = await raw("note", note.id);
    assert.equal(row.resolvedRevisionId, rev.id);
    assert.equal(row.text, "Aan mijn passage");
    assert.equal(row.revisionId, original); assert.equal(row.targetKey, note.targetKey);
    assert.deepEqual(row.selector, target.selector);
    assert.equal(+row.updatedAt, +updatedAt, "Note.updatedAt blijft bij louter technische metadata gelijk");
    assert.equal(await prisma.note.count({ where: { userId: who.user.id } }), 1, "geen tweede annotatie");
    const after = await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev.id });
    assert.equal(after.annotations[0].placement.status, "EXACT");
    assert.equal((await resolveAnnotationFocus(who.actor, `note:${note.id}`, lesson)).status, "exact");
    assert.equal((await listStudyFolder(who.actor, {})).items.find((i) => i.id === note.id).recovery, "found");
    // Oude clients zien niets van de resolutie in hun bestaande responsecontracten.
    assert.ok(!("placement" in (await getAnnotation(who.actor, "note", note.id))));
    assert.ok(!("placement" in (await listAnnotations(who.actor, { lessonEditionId: target.lessonEditionId }))[0]));
    assert.equal(await economy(who.user.id), before);
    // Rollback naar de oorspronkelijke revisie: de oorspronkelijke selector geldt weer; de bevestigde koppeling blijft bewaard.
    await pointer(original);
    const back = await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: original });
    assert.equal(back.annotations[0].placement.status, "EXACT");
    assert.equal(back.annotations[0].placement.selector.originalRevisionId, original);
    assert.equal((await raw("note", note.id)).resolvedRevisionId, rev.id);
    // Derde revisie: de oude bevestigde selector wordt nooit blind toegepast.
    const third = await newRevision(editBlock(f.dto.lesson.body, block.id, (b) => { b.content = [{ type: "text", text: "Totaal ander verhaal zonder de passage." }]; }), "Derde");
    await pointer(third.id);
    const lost = await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: third.id });
    assert.equal(lost.annotations[0].placement.status, "ORPHANED");
    const thirdSame = await newRevision(renamed, "Derde zelfde als tweede");
    await pointer(thirdSame.id);
    assert.equal((await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: thirdSame.id })).annotations[0].placement.status, "EXACT", "bevestigde locatie blijft het vertrekpunt");
  } finally { await pointer(original); }
});

test("orphan: quote en notitie blijven; handmatige herkoppeling wordt server-side gevalideerd; geen koppeling naar een vergelijkbare passage", async () => {
  const who = await referenceAccount();
  const highlight = (await mutateAnnotation(who.actor, command("highlight", target, 0, { color: "pink" }))).annotation;
  const gone = editBlock(f.dto.lesson.body, block.id, (b) => { b.content = [{ type: "text", text: "Dit blok is volledig vervangen door nieuwe tekst." }]; });
  const rev = await newRevision(gone, "Blok verwijderd");
  await pointer(rev.id);
  try {
    const lesson = await lessonOf(who.actor);
    const focus = await resolveAnnotationFocus(who.actor, `highlight:${highlight.id}`, lesson);
    assert.equal(focus.status, "orphaned");
    assert.equal(focus.quote, quote);
    const row = await raw("highlight", highlight.id);
    assert.equal(row.color, "pink"); assert.equal(row.resolvedRevisionId, null);
    assert.equal((await listStudyFolder(who.actor, {})).items.find((i) => i.id === highlight.id).recovery, "missing");
    const marked = (await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev.id })).annotations.find((a) => a.id === highlight.id);
    assert.equal(marked.placement.status, "ORPHANED");
    assert.equal(marked.placement.selector, undefined, "geen automatische markering elders");
    const newBlock = passageBlocks(gone, section.id).find((b) => b.text.startsWith("Dit blok"));
    const picked = selectorFor(gone, rev.id, section.id, newBlock.id, 0, 7);
    const base = { kind: "highlight", id: highlight.id, mode: "manual", revisionId: rev.id, selector: picked, expectedVersion: highlight.mutationVersion, actionId: randomUUID() };
    await assert.rejects(resolveAnnotation(who.actor, { ...base, actionId: randomUUID(), selector: { ...picked, exact: "Verzonnen" } }), fault("INVALID"));
    await assert.rejects(resolveAnnotation(who.actor, { ...base, actionId: randomUUID(), revisionId: original, selector: { ...picked, originalRevisionId: original } }), (e) => e instanceof AnnotationError);
    const done = await resolveAnnotation(who.actor, base);
    assert.equal(done.changed, true);
    const after = await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev.id });
    const placed = after.annotations.find((a) => a.id === highlight.id);
    assert.equal(placed.placement.status, "EXACT");
    assert.equal(placed.placement.selector.exact, picked.exact);
    assert.equal((await raw("highlight", highlight.id)).color, "pink");
    // Een annotatie die al op haar plaats staat, heeft geen koppeling nodig.
    await assert.rejects(resolveAnnotation(who.actor, { ...base, actionId: randomUUID(), expectedVersion: done.annotation.mutationVersion }), fault("INVALID"));
  } finally { await pointer(original); }
});

test("brontoegang: een ontoegankelijke bron geeft geen brontekst, geen herkoppeling en laat de eigen gegevens ongemoeid; tombstones blijven tombstones", async () => {
  const who = await referenceAccount();
  const note = (await mutateAnnotation(who.actor, command("note", target, 0, { text: "Mijn eigen notitie" }))).annotation;
  const rev = await newRevision(editBlock(f.dto.lesson.body, block.id, (b) => { b.id = `${block.id}-v3`; }), "Voor bron-intrekking");
  await pointer(rev.id);
  try {
    const lesson = await lessonOf(who.actor);
    const focus = await resolveAnnotationFocus(who.actor, `note:${note.id}`, lesson);
    await prisma.contentCollection.update({ where: { id: f.collection.id }, data: { visibleToUsers: false } });
    try {
      assert.equal(await lessonOf(who.actor), null, "bron is ontoegankelijk");
      await assert.rejects(resolveAnnotation(who.actor, { kind: "note", id: note.id, mode: "proposal", revisionId: rev.id, selector: focus.proposal, expectedVersion: note.mutationVersion, actionId: randomUUID() }), fault("UNAVAILABLE"));
      const item = (await listStudyFolder(who.actor, {})).items.find((i) => i.id === note.id);
      assert.equal(item.source.status, "unavailable");
      assert.equal(item.recovery, undefined);
      assert.equal(item.quote, quote, "eigen quote blijft");
      assert.equal(item.snippet, undefined, "geen brontekst zonder toegang");
      assert.ok(!JSON.stringify(item).includes(f.collection.name), "geen bronnaam zonder toegang");
      const list = await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev.id });
      assert.ok(list.annotations.every((a) => !a.placement), "zonder toegang geen plaatsbepaling");
      assert.equal((await getAnnotation(who.actor, "note", note.id)).text, "Mijn eigen notitie");
    } finally { await prisma.contentCollection.update({ where: { id: f.collection.id }, data: { visibleToUsers: true } }); }
    // Tombstone: een late resolutie mag een verwijderde annotatie niet reactiveren.
    const removed = await mutateAnnotation(who.actor, { kind: "note", target, expectedVersion: note.mutationVersion, actionId: randomUUID() }, true);
    await assert.rejects(resolveAnnotation(who.actor, { kind: "note", id: note.id, mode: "proposal", revisionId: rev.id, selector: focus.proposal, expectedVersion: removed.annotation.mutationVersion, actionId: randomUUID() }), fault("UNAVAILABLE"));
    assert.ok((await raw("note", note.id)).deletedAt, "blijft verwijderd");
  } finally { await pointer(original); }
});

test("gelijktijdige notitiebewerking en resolutie: precies één wint de versie, nooit een dubbele schrijfactie", async () => {
  const who = await referenceAccount();
  const note = (await mutateAnnotation(who.actor, command("note", target, 0, { text: "Race" }))).annotation;
  const rev = await newRevision(editBlock(f.dto.lesson.body, block.id, (b) => { b.id = `${block.id}-v4`; }), "Race");
  await pointer(rev.id);
  try {
    const focus = await resolveAnnotationFocus(who.actor, `note:${note.id}`, await lessonOf(who.actor));
    const results = await Promise.allSettled([
      mutateAnnotation(who.actor, command("note", target, note.mutationVersion, { text: "Gelijktijdig bewerkt" })),
      resolveAnnotation(who.actor, { kind: "note", id: note.id, mode: "proposal", revisionId: rev.id, selector: focus.proposal, expectedVersion: note.mutationVersion, actionId: randomUUID() }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected" && r.reason?.code === "CONFLICT").length, 1);
    assert.equal((await raw("note", note.id)).mutationVersion, note.mutationVersion + 1);
    assert.equal(await prisma.note.count({ where: { userId: who.user.id } }), 1);
  } finally { await pointer(original); }
});

test("HTTP: /api/annotations/resolve valideert, is eigen-gebruiker-only en niet cachebaar; legacy verse-API's ongewijzigd", async () => {
  const who = await referenceAccount(), other = await referenceAccount();
  const note = (await mutateAnnotation(who.actor, command("note", target, 0, { text: "HTTP" }))).annotation;
  const rev = await newRevision(editBlock(f.dto.lesson.body, block.id, (b) => { b.id = `${block.id}-v5`; }), "HTTP");
  await pointer(rev.id);
  try {
    const focus = await resolveAnnotationFocus(who.actor, `note:${note.id}`, await lessonOf(who.actor));
    const body = { kind: "note", id: note.id, mode: "proposal", revisionId: rev.id, selector: focus.proposal, expectedVersion: note.mutationVersion, actionId: randomUUID() };
    assert.equal((await http("/api/annotations/resolve", "POST", body, null)).status, 401);
    assert.equal((await http("/api/annotations/resolve", "POST", body, who, "https://evil.example")).status, 403);
    assert.equal((await http("/api/annotations/resolve", "GET", undefined, who)).status, 405);
    assert.equal((await http("/api/annotations/resolve", "POST", { ...body, extra: 1 }, who)).status, 400);
    assert.equal((await http("/api/annotations/resolve", "POST", { ...body, mode: "other" }, who)).status, 400);
    assert.equal((await http("/api/annotations/resolve", "POST", body, other)).status, 404);
    assert.equal((await http("/api/annotations/resolve", "POST", { ...body, expectedVersion: 9 }, who)).status, 409);
    const ok = await http("/api/annotations/resolve", "POST", body, who);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
    const json = await ok.json();
    assert.equal(json.changed, true);
    assert.ok(!JSON.stringify(json).includes(other.user.id));
    const again = await http("/api/annotations/resolve", "POST", body, who);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).changed, false);
    // Een andere gebruiker leest geen resolutie via de reader-GET.
    const foreign = await (await http(`/api/annotations?view=reader&lessonEditionId=${target.lessonEditionId}&revisionId=${rev.id}`, "GET", undefined, other)).json();
    assert.deepEqual(foreign.annotations, []);
    // Legacy: een verse-only endpoint levert geen lestargets en geen resolutiemetadata.
    const verse = await prisma.verse.findFirstOrThrow({ where: { chapter: { book: { contentCollectionId: "content_bom" } } } });
    const legacy = await mutateAnnotation(who.actor, command("highlight", { type: "verse", verseId: verse.id }, 0, { color: "blue" }));
    assert.ok(!("placement" in legacy.annotation) && !("resolvedRevisionId" in legacy.annotation));
    assert.equal(legacy.annotation.target.type, "verse");
    await assert.rejects(resolveAnnotation(who.actor, { kind: "highlight", id: legacy.annotation.id, mode: "manual", revisionId: rev.id, selector: focus.proposal, expectedVersion: 1, actionId: randomUUID() }), fault("UNAVAILABLE"), "een vers heeft geen herstelactie");
  } finally { await pointer(original); }
});

test("databaseconstraints: resolutiemetadata is alles-of-niets, alleen voor lestargets en gebonden aan dezelfde leseditie", async () => {
  const who = await referenceAccount();
  const hl = (await mutateAnnotation(who.actor, command("highlight", target, 0, { color: "blue" }))).annotation;
  const selector = JSON.stringify({ ...target.selector, originalRevisionId: original });
  const bad = (sql, ...params) => assert.rejects(prisma.$executeRawUnsafe(sql, ...params), /violates (check|foreign key)/);
  await bad(`UPDATE "Highlight" SET "resolvedRevisionId"=$1 WHERE id=$2`, original, hl.id);
  await bad(`UPDATE "Highlight" SET "resolvedSelector"=$1::jsonb, "resolvedAt"=now() WHERE id=$2`, selector, hl.id);
  await bad(`UPDATE "Highlight" SET "resolvedRevisionId"='bestaat-niet', "resolvedSelector"=$1::jsonb, "resolvedAt"=now() WHERE id=$2`, JSON.stringify({ ...target.selector, originalRevisionId: "bestaat-niet" }), hl.id);
  await bad(`UPDATE "Highlight" SET "resolvedRevisionId"=$1, "resolvedSelector"=$2::jsonb, "resolvedAt"=now() WHERE id=$3`, original, JSON.stringify({ ...target.selector, originalRevisionId: "andere" }), hl.id);
  const verse = await prisma.verse.findFirstOrThrow({ where: { chapter: { book: { contentCollectionId: "content_bom" } } } });
  const vr = await mutateAnnotation(who.actor, command("bookmark", { type: "verse", verseId: verse.id }));
  await bad(`UPDATE "Bookmark" SET "resolvedRevisionId"=$1, "resolvedSelector"=$2::jsonb, "resolvedAt"=now() WHERE id=$3`, original, selector, vr.annotation.id);
  await prisma.$executeRawUnsafe(`UPDATE "Highlight" SET "resolvedRevisionId"=$1, "resolvedSelector"=$2::jsonb, "resolvedAt"=now() WHERE id=$3`, original, selector, hl.id);
  await assert.rejects(prisma.studyRevision.delete({ where: { id: original } }), /STUDY_REVISION_IMMUTABLE|Foreign key|violat|constraint/i, "een revisie met annotaties kan niet verdwijnen");
});

test("bevestigingshistorie: eerdere bevestigde koppelingen blijven bewaard en bruikbaar na een rollback; oorspronkelijke velden ongewijzigd", async () => {
  const who = await referenceAccount();
  const hl = (await mutateAnnotation(who.actor, command("highlight", target, 0, { color: "blue" }))).annotation;
  const frozen = snapshot(await raw("highlight", hl.id));
  const reviseHeading = (text) => editBlock(f.dto.lesson.body, block.id, (b) => { b.content = [{ type: "text", text }]; });
  const confirm = async (rev, body, length, version, extra = {}) => {
    const selector = selectorFor(body, rev.id, section.id, block.id, 0, length);
    return { selector, result: await resolveAnnotation(who.actor, { kind: "highlight", id: hl.id, mode: "manual", revisionId: rev.id, selector, expectedVersion: version, actionId: randomUUID(), ...extra }) };
  };
  const exactAt = async (rev) => (await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev })).annotations.find((a) => a.id === hl.id).placement;
  const body2 = reviseHeading("Tweede revisie met een andere kop"), body3 = reviseHeading("Derde revisie met weer een andere kop"), body4 = reviseHeading("Vierde zonder enige overeenkomst");
  const rev2 = await newRevision(body2, "H2"), rev3 = await newRevision(body3, "H3"), rev4 = await newRevision(body4, "H4");
  try {
    await pointer(rev2.id);
    const first = await confirm(rev2, body2, 8, hl.mutationVersion);
    await pointer(rev3.id);
    assert.equal((await exactAt(rev3.id)).status, "ORPHANED", "de koppeling van revisie 2 wordt niet blind op revisie 3 toegepast");
    const second = await confirm(rev3, body3, 6, first.result.annotation.mutationVersion);
    const row = await raw("highlight", hl.id);
    assert.equal(row.resolvedRevisionId, rev3.id);
    assert.equal(row.resolutionHistory.length, 1);
    assert.equal(row.resolutionHistory[0].revisionId, rev2.id);
    assert.equal(row.resolutionHistory[0].selector.exact, first.selector.exact, "de eerdere bevestiging is bewaard");
    assert.ok(row.resolutionHistory[0].resolvedAt);
    // Rollback naar revisie 2: de eerdere bevestigde koppeling wordt opnieuw gebruikt.
    await pointer(rev2.id);
    const at2 = await exactAt(rev2.id);
    assert.equal(at2.status, "EXACT"); assert.equal(at2.selector.exact, first.selector.exact);
    // Rollback naar revisie 1: de oorspronkelijke selector heeft voorrang.
    await pointer(original);
    const at1 = await exactAt(original);
    assert.equal(at1.status, "EXACT"); assert.equal(at1.selector.exact, target.selector.exact);
    // Terug naar revisie 3: de actuele bevestiging blijft correct.
    await pointer(rev3.id);
    const at3 = await exactAt(rev3.id);
    assert.equal(at3.status, "EXACT"); assert.equal(at3.selector.exact, second.selector.exact);
    // Revisie 4: nergens zekerheid, dus ORPHANED; een nieuwe bevestiging verplaatst de actuele naar de historie (nu twee).
    await pointer(rev4.id);
    assert.equal((await exactAt(rev4.id)).status, "ORPHANED");
    const third = await confirm(rev4, body4, 6, second.result.annotation.mutationVersion);
    const afterThird = await raw("highlight", hl.id);
    assert.deepEqual(afterThird.resolutionHistory.map((e) => e.revisionId), [rev2.id, rev3.id], "oudste eerst, niets afgekapt");
    for (const [rev, exact] of [[rev2.id, first.selector.exact], [rev3.id, second.selector.exact], [rev4.id, third.selector.exact]]) {
      await pointer(rev);
      assert.equal((await exactAt(rev)).selector.exact, exact);
    }
    // Oorspronkelijke identiteit en gegevens zijn nooit gewijzigd.
    const ours = { ...afterThird };
    assert.equal(snapshot(ours), frozen);
    assert.equal(ours.color, "blue");
    // Identieke retry met dezelfde actionId en payload na een verloren respons: geen tweede mutatie, geen dubbele historie.
    const retryAction = { kind: "highlight", id: hl.id, mode: "manual", revisionId: rev4.id, selector: third.selector, expectedVersion: second.result.annotation.mutationVersion, actionId: third.result.annotation && (await raw("highlight", hl.id)).lastActionId };
    const retry = await resolveAnnotation(who.actor, retryAction);
    assert.equal(retry.changed, false);
    assert.equal((await raw("highlight", hl.id)).resolutionHistory.length, 2);
    // Gelijktijdige bevestigingen: precies één wint, de historie blijft consistent.
    const rev5 = await newRevision(reviseHeading("Vijfde kop zonder overlap"), "H5");
    await pointer(rev5.id);
    const body5 = rev5 && reviseHeading("Vijfde kop zonder overlap");
    const version = (await raw("highlight", hl.id)).mutationVersion;
    const racers = await Promise.allSettled([0, 1].map((n) => resolveAnnotation(who.actor, { kind: "highlight", id: hl.id, mode: "manual", revisionId: rev5.id, selector: selectorFor(body5, rev5.id, section.id, block.id, 0, 5 + n), expectedVersion: version, actionId: randomUUID() })));
    assert.equal(racers.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(racers.filter((r) => r.status === "rejected" && r.reason?.code === "CONFLICT").length, 1);
    assert.equal((await raw("highlight", hl.id)).resolutionHistory.length, 3);
    // Tombstone: een verwijderde annotatie blijft verwijderd en behoudt haar historie.
    const live = await raw("highlight", hl.id);
    await mutateAnnotation(who.actor, { kind: "highlight", target, expectedVersion: live.mutationVersion, actionId: randomUUID() }, true);
    await assert.rejects(resolveAnnotation(who.actor, { kind: "highlight", id: hl.id, mode: "manual", revisionId: rev5.id, selector: selectorFor(body5, rev5.id, section.id, block.id, 0, 3), expectedVersion: live.mutationVersion + 1, actionId: randomUUID() }), fault("UNAVAILABLE"));
    const dead = await raw("highlight", hl.id);
    assert.ok(dead.deletedAt); assert.equal(dead.resolutionHistory.length, 3);
    assert.equal(await prisma.highlight.count({ where: { userId: who.user.id } }), 1, "geen dubbele annotaties");
  } finally { await pointer(original); }
});

test("historiegrens en eigenaargebondenheid: een volle historie wordt expliciet geweigerd, niets wordt stil afgekapt", async () => {
  const who = await referenceAccount(), other = await referenceAccount();
  const hl = (await mutateAnnotation(who.actor, command("highlight", target, 0, { color: "green" }))).annotation;
  const rev = await newRevision(editBlock(f.dto.lesson.body, block.id, (b) => { b.content = [{ type: "text", text: "Totaal andere koptekst hier" }]; }), "Grens");
  await pointer(rev.id);
  try {
    const entry = (n) => ({ revisionId: rev.id, selector: { ...target.selector, originalRevisionId: rev.id }, resolvedAt: new Date(2026, 0, 1, 0, 0, n).toISOString() });
    await prisma.$executeRaw`UPDATE "Highlight" SET "resolvedRevisionId"=${original}, "resolvedSelector"=${JSON.stringify({ ...target.selector, originalRevisionId: original })}::jsonb, "resolvedAt"=now(), "resolutionHistory"=${JSON.stringify(Array.from({ length: 100 }, (_, n) => entry(n)))}::jsonb WHERE id=${hl.id}`;
    const body = editBlock(f.dto.lesson.body, block.id, (b) => { b.content = [{ type: "text", text: "Totaal andere koptekst hier" }]; });
    const selector = selectorFor(body, rev.id, section.id, block.id, 0, 6);
    const version = (await raw("highlight", hl.id)).mutationVersion;
    await assert.rejects(resolveAnnotation(who.actor, { kind: "highlight", id: hl.id, mode: "manual", revisionId: rev.id, selector, expectedVersion: version, actionId: randomUUID() }), fault("INVALID"));
    const after = await raw("highlight", hl.id);
    assert.equal(after.resolutionHistory.length, 100); assert.equal(after.mutationVersion, version); assert.equal(after.resolvedRevisionId, original);
    // Historie is nooit zichtbaar voor anderen of in een leesresponse.
    const json = JSON.stringify([await getAnnotation(who.actor, "highlight", hl.id), await readerAnnotations(who.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev.id }), await listStudyFolder(who.actor, {})]);
    assert.ok(!json.includes("resolutionHistory") && !json.includes("resolvedAt"));
    await assert.rejects(getAnnotation(other.actor, "highlight", hl.id), fault("UNAVAILABLE"));
    assert.deepEqual((await readerAnnotations(other.actor, { lessonEditionId: target.lessonEditionId, revisionId: rev.id })).annotations, []);
    await assert.rejects(prisma.$executeRaw`UPDATE "Highlight" SET "resolutionHistory"='[]'::jsonb WHERE id=${hl.id}`, /check/i);
    await assert.rejects(prisma.$executeRaw`UPDATE "Highlight" SET "resolutionHistory"=${JSON.stringify(Array.from({ length: 101 }, (_, n) => entry(n)))}::jsonb WHERE id=${hl.id}`, /check/i);
  } finally { await pointer(original); }
});

test("idempotentie: de requesthash omvat alle aanvraagvelden (ook expectedVersion); afgewezen acties veranderen niets", async () => {
  const who = await referenceAccount();
  const note = (await mutateAnnotation(who.actor, command("note", target, 0, { text: "Hash" }))).annotation;
  const rev = await newRevision(editBlock(f.dto.lesson.body, block.id, (b) => { b.id = `${block.id}-v7`; }), "Hash");
  await pointer(rev.id);
  try {
    const focus = await resolveAnnotationFocus(who.actor, `note:${note.id}`, await lessonOf(who.actor));
    const body = { kind: "note", id: note.id, mode: "proposal", revisionId: rev.id, selector: focus.proposal, expectedVersion: note.mutationVersion, actionId: randomUUID() };
    const post = async (payload) => (await http("/api/annotations/resolve", "POST", payload, who)).status;
    const state = async () => { const r = await raw("note", note.id); return JSON.stringify([r.mutationVersion, r.lastActionId, r.lastActionHash, r.resolvedRevisionId, r.resolvedSelector, r.resolutionHistory, +r.updatedAt, r.text]); };
    assert.equal(await post(body), 200);
    const settled = await state();
    assert.equal(await post(body), 200, "identieke retry na een verloren response");
    assert.equal(await state(), settled, "geen tweede mutatie");
    assert.equal(await post({ ...body, expectedVersion: body.expectedVersion + 1 }), 400, "andere expectedVersion");
    assert.equal(await post({ ...body, selector: { ...focus.proposal, suffix: "x" } }), 400, "gewijzigde selector");
    assert.equal(await post({ ...body, mode: "manual" }), 400, "andere mode");
    assert.equal(await post({ ...body, revisionId: original, selector: { ...focus.proposal, originalRevisionId: original } }), 400, "andere revisie");
    assert.equal(await post({ ...body, actionId: randomUUID(), expectedVersion: note.mutationVersion }), 409, "nieuwe actionId met verouderde versie");
    assert.equal(await state(), settled, "afgewezen acties veranderen niets");
    // Hetzelfde patroon voor de writer: dezelfde actionId met andere expectedVersion is geen retry.
    const edit = command("note", target, (await raw("note", note.id)).mutationVersion, { text: "Eerst" });
    assert.equal((await mutateAnnotation(who.actor, edit)).changed, true);
    await assert.rejects(mutateAnnotation(who.actor, { ...edit, expectedVersion: edit.expectedVersion + 1 }), fault("INVALID"));
  } finally { await pointer(original); }
});
