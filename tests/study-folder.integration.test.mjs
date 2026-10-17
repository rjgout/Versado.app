// Fase 4C: Mijn studiemap. Eigen wegwerp-PostgreSQL (assertReferenceTestEnvironment) en de echte productieserver.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { mutateAnnotation } from "../src/lib/annotations/service.ts";
import { passageBlocks } from "../src/lib/annotations/contract.ts";
import { listStudyFolder, listStudyFolderSources, getStudyFolderItem, decodeFolderCursor, StudyFolderError } from "../src/lib/annotations/studyFolder.ts";
import { referenceFixture, referenceAccount, assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";

assertReferenceTestEnvironment();
let f, lessonTarget, verses, enChapter, hiddenVerse, hiddenBookId;
const http = (path, method = "GET", body, who = f.owner) => fetch(f.base + path, {
  method, redirect: "manual",
  headers: { ...(who ? { Cookie: who.cookie } : {}), ...(method === "GET" ? {} : { Origin: f.base, "Content-Type": "application/json" }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const command = (kind, target, expectedVersion = 0, extra = {}) => ({ kind, target, expectedVersion, actionId: randomUUID(), ...(kind === "note" ? { text: "Privétestnotitie" } : {}), ...extra });
const removal = (kind, target, expectedVersion) => ({ kind, target, expectedVersion, actionId: randomUUID() });
async function makeChapter(collectionId, name, key, count) {
  const book = await prisma.book.create({ data: { slug: `folder-${randomUUID()}`, key, name, order: 800, contentCollectionId: collectionId } });
  const chapter = await prisma.chapter.create({
    data: { bookId: book.id, number: 1, order: 800, verses: { create: Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `Synthetisch vers ${i + 1} van ${name}.` })) } },
    include: { verses: { orderBy: { number: "asc" } } },
  });
  return { book, chapter, verses: chapter.verses };
}
async function state(userId) {
  const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='userId' AND table_name NOT IN ('Bookmark','Highlight','Note') ORDER BY table_name`;
  const hashes = [];
  for (const { table_name: name } of tables) {
    assert.match(name, /^[A-Za-z0-9_]+$/);
    hashes.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM "${name}" t WHERE "userId"=$1`, userId));
  }
  return { user: await prisma.user.findUniqueOrThrow({ where: { id: userId } }), hashes };
}
const drain = async (actor, input, client) => {
  const all = []; let cursor; let pages = 0;
  do {
    const page = await listStudyFolder(actor, { ...input, cursor, limit: 50 }, client);
    all.push(...page.items); cursor = page.nextCursor ?? undefined; pages += 1;
    assert.ok(pages < 100);
  } while (cursor);
  return { all, pages };
};

before(async () => {
  f = await referenceFixture();
  const section = f.dto.lesson.body.sections[0], block = passageBlocks(f.dto.lesson.body, section.id)[0];
  lessonTarget = { type: "lesson", lessonEditionId: f.item.lessonEditionId, revisionId: f.item.revisionId, selector: { normalizationVersion: 1, originalRevisionId: f.item.revisionId, sectionAnchor: section.id, ranges: [{ blockId: block.id, start: 0, end: [...block.text].length }], exact: block.text, prefix: "", suffix: "" } };
  verses = (await makeChapter("content_bom", "1 Nephi", `bofm/folder-${randomUUID().slice(0, 6)}`, 6)).verses;
  enChapter = await makeChapter("content_bom_en", "1 Nephi EN", `bofm/folder-en-${randomUUID().slice(0, 6)}`, 3);
  const hidden = await makeChapter("content_dc", "Leer en Verbonden", `dc-testament/folder-${randomUUID().slice(0, 6)}`, 2);
  hiddenVerse = hidden.verses[0]; hiddenBookId = hidden.book.id;
});
after(() => prisma.$disconnect());

test("legacy versbladwijzers blijven met oorspronkelijk id en timestamp bestaan en verschijnen in de map", async () => {
  const who = await referenceAccount();
  const createdAt = new Date("2026-01-02T03:04:05.678Z");
  const legacy = await prisma.bookmark.create({ data: { userId: who.user.id, verseId: verses[0].id, createdAt } });
  const page = await listStudyFolder(who.actor, {});
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, legacy.id);
  assert.equal(page.items[0].createdAt, createdAt.toISOString());
  assert.equal(page.items[0].kind, "bookmark");
  assert.equal(page.items[0].source.status, "available");
  assert.match(page.items[0].source.href, new RegExp(`^/lesson/[^?]+\\?vers=1$`));
  assert.equal(page.items[0].source.label, "1 Nephi 1:1");
  const row = await prisma.bookmark.findUniqueOrThrow({ where: { id: legacy.id } });
  assert.equal(row.createdAt.toISOString(), createdAt.toISOString());
  const api = await http("/api/bookmarks", "GET", undefined, who);
  assert.equal(api.status, 200);
  const redirect = await http("/bookmarks", "GET", undefined, who);
  assert.ok([307, 308].includes(redirect.status));
  assert.equal(new URL(redirect.headers.get("location"), f.base).pathname + new URL(redirect.headers.get("location"), f.base).search, "/study-folder?type=bookmark");
});

test("alle drie de typen, verse- en lesson-targets, meerdere collecties en talen; tombstones uitgesloten", async () => {
  const who = await referenceAccount();
  await mutateAnnotation(who.actor, command("bookmark", { type: "verse", verseId: verses[1].id }));
  await mutateAnnotation(who.actor, command("highlight", { type: "verse", verseId: enChapter.verses[0].id }, 0, { color: "green" }));
  await mutateAnnotation(who.actor, command("note", lessonTarget, 0, { text: "Notitie bij les" }));
  await mutateAnnotation(who.actor, command("highlight", lessonTarget, 0, { color: "pink" }));
  const gone = await mutateAnnotation(who.actor, command("note", { type: "verse", verseId: verses[2].id }));
  await mutateAnnotation(who.actor, removal("note", { type: "verse", verseId: verses[2].id }, 1), true);
  const page = await listStudyFolder(who.actor, {});
  assert.equal(page.items.length, 4);
  assert.deepEqual(new Set(page.items.map((i) => i.kind)), new Set(["bookmark", "highlight", "note"]));
  assert.ok(!page.items.some((i) => i.id === gone.annotation.id), "tombstone hoort er niet in");
  const lesson = page.items.find((i) => i.kind === "note");
  assert.equal(lesson.target.type, "lesson");
  assert.equal(lesson.text, "Notitie bij les");
  assert.equal(lesson.quote, lessonTarget.selector.exact);
  assert.equal(lesson.source.status, "available");
  assert.match(lesson.source.href, new RegExp(`^/study-lesson/.+/.+\\?annotation=note:${lesson.id}$`));
  const sources = (await listStudyFolderSources(who.actor)).sources.map((s) => s.id).sort();
  assert.deepEqual(sources, ["content_bom", "content_bom_en", f.collection.id].sort());
  for (const [type, count] of [["bookmark", 1], ["highlight", 2], ["note", 1]])
    assert.equal((await listStudyFolder(who.actor, { type })).items.length, count);
  assert.equal((await listStudyFolder(who.actor, { source: "content_bom_en" })).items.length, 1);
  assert.equal((await listStudyFolder(who.actor, { source: f.collection.id, type: "note" })).items.length, 1);
});

test("duizend synthetische records: keyset zonder dubbelen, gelijke timestamps, begrensde queryresultaten, stabiel bij ongewijzigde data", async () => {
  const who = await referenceAccount();
  const big = await makeChapter("content_bom", "Groot", `bofm/folder-big-${randomUUID().slice(0, 6)}`, 1100);
  const stamp = (i) => new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 60)));
  const rows = (offset) => big.verses.slice(offset, offset + 350).map((v, i) => ({ userId: who.user.id, verseId: v.id, createdAt: stamp(offset + i), targetKey: `verse:${v.id}` }));
  await prisma.bookmark.createMany({ data: rows(0) });
  await prisma.highlight.createMany({ data: rows(350).map((r) => ({ ...r, color: "yellow" })) });
  await prisma.note.createMany({ data: rows(700).map((r) => ({ ...r, text: `Synthetische notitie ${r.verseId}` })) });
  const seen = [];
  const spy = { $queryRaw: async (...args) => { const result = await prisma.$queryRaw(...args); seen.push(result.length); return result; }, contentCollection: prisma.contentCollection };
  const first = await drain(who.actor, {}, spy);
  assert.equal(first.all.length, 1050);
  assert.equal(new Set(first.all.map((i) => `${i.kind}:${i.id}`)).size, 1050, "geen dubbelen");
  assert.ok(Math.max(...seen) <= 51, `elke query levert hooguit limiet+1 rijen: ${Math.max(...seen)}`);
  assert.equal(first.pages, 21);
  const expected = [...first.all].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  assert.deepEqual(first.all.map((i) => `${i.kind}:${i.id}`), expected.map((i) => `${i.kind}:${i.id}`), "deterministische volgorde met tie-breakers");
  assert.equal(new Set(first.all.map((i) => i.createdAt)).size < 1050, true, "er zijn gelijke timestamps");
  const second = await drain(who.actor, {});
  assert.deepEqual(second.all.map((i) => i.id), first.all.map((i) => i.id), "stabiel bij ongewijzigde dataset");
  for (const type of ["bookmark", "highlight", "note"]) assert.equal((await drain(who.actor, { type })).all.length, 350);
  // Gelijktijdige wijziging tijdens het bladeren: een oud item verwijderen en een nieuw item toevoegen.
  const page1 = await listStudyFolder(who.actor, { limit: 50 });
  const removed = page1.items[10];
  await mutateAnnotation(who.actor, removal(removed.kind, removed.target, removed.mutationVersion), true);
  const fresh = await prisma.bookmark.create({ data: { userId: who.user.id, verseId: big.verses[1099].id, createdAt: new Date("2030-01-01T00:00:00.000Z"), targetKey: `verse:${big.verses[1099].id}` } });
  const page2 = await listStudyFolder(who.actor, { cursor: page1.nextCursor, limit: 50 });
  const ids = new Set(page1.items.map((i) => i.id));
  assert.ok(page2.items.every((i) => !ids.has(i.id)), "geen dubbelen na een wijziging");
  assert.ok(!page2.items.some((i) => i.id === fresh.id), "een nieuw item verschijnt niet halverwege de lijst");
  assert.equal(page2.items[0].id, first.all[50].id, "de overgang sluit aan op de eerdere volgorde");
});

test("Unicode en accenten, hoofdletterongevoelig, literal wildcard-tekens en zoeken in alleen leesbare brontekst", async () => {
  const who = await referenceAccount();
  await mutateAnnotation(who.actor, command("note", { type: "verse", verseId: verses[3].id }, 0, { text: "Over Jézus Christus en 100% trouw_" }));
  await mutateAnnotation(who.actor, command("note", { type: "verse", verseId: verses[4].id }, 0, { text: "Gewone notitie zonder bijzonderheden" }));
  await prisma.bookmark.create({ data: { userId: who.user.id, verseId: hiddenVerse.id, targetKey: `verse:${hiddenVerse.id}` } });
  const names = async (q) => (await listStudyFolder(who.actor, { q })).items.map((i) => i.id);
  assert.equal((await names("Jézus")).length, 1, "gedecomposeerde invoer");
  assert.equal((await names("Jézus")).length, 1, "samengestelde invoer");
  assert.equal((await names("CHRISTUS")).length, 1, "hoofdletterongevoelig");
  assert.equal((await names("%")).length, 1, "% is geen wildcard");
  assert.equal((await names("_")).length, 1, "_ is geen wildcard");
  assert.equal((await names("1 Nephi 1:4")).length, 1, "brontabel van een leesbare bron");
  assert.equal((await names("Synthetisch vers 5")).length, 1, "leesbare brontekst");
  assert.equal((await names("Leer en Verbonden")).length, 0, "verborgen bron: geen naam, label of tekst doorzoekbaar");
  assert.equal((await names("Synthetisch vers 1 van Leer")).length, 0);
  await assert.rejects(listStudyFolder(who.actor, { q: "x".repeat(101) }), (e) => e instanceof StudyFolderError && e.code === "INVALID");
});

test("ongeldige filters en cursors; cursor is aan filters en gebruiker gebonden", async () => {
  const who = await referenceAccount(), other = await referenceAccount();
  for (const v of verses) await prisma.bookmark.create({ data: { userId: who.user.id, verseId: v.id, targetKey: `verse:${v.id}` } });
  const page = await listStudyFolder(who.actor, { limit: 2 });
  assert.ok(page.nextCursor);
  for (const bad of ["%%%", "a".repeat(401), Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ t: "x", k: "note", i: "y", h: "z" })).toString("base64url")])
    await assert.rejects(listStudyFolder(who.actor, { cursor: bad }), (e) => e.code === "INVALID");
  await assert.rejects(listStudyFolder(who.actor, { cursor: page.nextCursor, type: "note" }), (e) => e.code === "INVALID");
  await assert.rejects(listStudyFolder(who.actor, { cursor: page.nextCursor, q: "iets" }), (e) => e.code === "INVALID");
  await assert.rejects(listStudyFolder(other.actor, { cursor: page.nextCursor }), (e) => e.code === "INVALID");
  assert.ok(decodeFolderCursor(who.actor.id, {}, page.nextCursor));
  for (const query of ["type=wrong", "limit=500", "limit=0", "cursor=" + "a".repeat(401), "unknown=1", "q=a&q=b", "item=wrong:1", "item=note:" + "a".repeat(129), "view=other"]) {
    const response = await http(`/api/study-folder?${query}`, "GET", undefined, who);
    assert.equal(response.status, 400, query);
  }
  assert.equal((await http("/api/study-folder?limit=2", "GET", undefined, who)).status, 200);
});

test("verborgen, ingetrokken of uitgeschakelde bron: eigen gegevens blijven, geen broninformatie, geen Open-link, ook niet via filters", async () => {
  const who = await referenceAccount();
  const noteText = "Mijn eigen les-notitie die bewaard blijft";
  await mutateAnnotation(who.actor, command("note", lessonTarget, 0, { text: noteText }));
  await mutateAnnotation(who.actor, command("bookmark", { type: "verse", verseId: verses[0].id }));
  await prisma.bookmark.create({ data: { userId: who.user.id, verseId: hiddenVerse.id, targetKey: `verse:${hiddenVerse.id}` } });
  const readable = await listStudyFolder(who.actor, {});
  assert.equal(readable.items.find((i) => i.source.status === "unavailable")?.kind, "bookmark");
  for (const change of [{ visibleToUsers: false }, { enabled: false }, { publicationState: "DRAFT" }]) {
    await prisma.contentCollection.update({ where: { id: f.collection.id }, data: change });
    try {
      const page = await listStudyFolder(who.actor, {});
      const note = page.items.find((i) => i.kind === "note");
      assert.equal(note.text, noteText, "eigen notitie blijft");
      assert.equal(note.quote, lessonTarget.selector.exact, "eigen quote blijft");
      assert.deepEqual(note.source, { status: "unavailable" });
      assert.ok(!JSON.stringify(note).includes(f.collection.name ?? "Synthetische"), "geen bronnaam");
      assert.equal((await listStudyFolder(who.actor, { source: f.collection.id })).items.length, 0);
      assert.ok(!(await listStudyFolderSources(who.actor)).sources.some((s) => s.id === f.collection.id));
      assert.equal((await listStudyFolder(who.actor, { q: "Synthetische verwijzingsles" })).items.length, 0, "bronlabel van ingetrokken bron niet doorzoekbaar");
      assert.equal((await listStudyFolder(who.actor, { q: "bewaard blijft" })).items.length, 1, "eigen tekst blijft doorzoekbaar");
      const item = await getStudyFolderItem(who.actor, "note", note.id);
      assert.deepEqual(item.source, { status: "unavailable" });
    } finally {
      await prisma.contentCollection.update({ where: { id: f.collection.id }, data: { visibleToUsers: true, enabled: true, publicationState: "PUBLISHED" } });
    }
  }
  // Beheer mag een vrijgegeven maar verborgen bron wel lezen (readingAccessWhere), een gewone gebruiker niet.
  await prisma.bookmark.create({ data: { userId: f.admin.user.id, verseId: hiddenVerse.id, targetKey: `verse:${hiddenVerse.id}` } });
  assert.equal((await listStudyFolder(f.admin.actor, {})).items.find((i) => i.targetKey === `verse:${hiddenVerse.id}`).source.status, "available");
  assert.equal((await prisma.contentCollection.findUniqueOrThrow({ where: { id: "content_dc" } })).visibleToUsers, false);
  assert.ok(hiddenBookId);
});

test("bewerken en verwijderen via de 4A-writer: bestaande notitie na bronintrekking, geen nieuwe schrijfrechten, 409, retry, gelijktijdige clients, geen economie", async () => {
  const who = await referenceAccount();
  const before = await state(who.user.id);
  const created = await mutateAnnotation(who.actor, command("note", lessonTarget, 0, { text: "Eerste tekst" }));
  const highlight = await mutateAnnotation(who.actor, command("highlight", lessonTarget, 0, { color: "blue" }));
  await prisma.contentCollection.update({ where: { id: f.collection.id }, data: { visibleToUsers: false } });
  try {
    const edit = command("note", lessonTarget, created.annotation.mutationVersion, { text: "Aangepast na intrekking" });
    const response = await http("/api/annotations", "PUT", edit, who);
    assert.equal(response.status, 200, "bestaande eigen notitie blijft bewerkbaar");
    assert.equal((await http("/api/annotations", "PUT", edit, who)).status, 200, "retry met dezelfde actionId is idempotent");
    const stale = await http("/api/annotations", "PUT", command("note", lessonTarget, created.annotation.mutationVersion, { text: "Verouderd" }), who);
    assert.equal(stale.status, 409, "conflict bij verouderde versie");
    const recolor = await http("/api/annotations", "PUT", command("highlight", lessonTarget, highlight.annotation.mutationVersion, { color: "pink" }), who);
    assert.equal(recolor.status, 404, "geen nieuwe schrijfrechten op een ingetrokken bron");
    const newOne = await http("/api/annotations", "PUT", command("bookmark", lessonTarget), who);
    assert.equal(newOne.status, 404, "geen nieuwe annotatie op een ingetrokken bron");
    const removeHighlight = await http("/api/annotations", "DELETE", removal("highlight", lessonTarget, highlight.annotation.mutationVersion), who);
    assert.equal(removeHighlight.status, 200, "verwijderen blijft mogelijk");
    const page = await listStudyFolder(who.actor, {});
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].text, "Aangepast na intrekking");
    assert.equal(page.items[0].source.status, "unavailable");
  } finally {
    await prisma.contentCollection.update({ where: { id: f.collection.id }, data: { visibleToUsers: true } });
  }
  // Twee gelijktijdige clients met dezelfde verwachte versie: precies één wint, de ander krijgt 409.
  const base = (await listStudyFolder(who.actor, {})).items[0];
  const [a, b] = await Promise.all([
    http("/api/annotations", "PUT", command("note", lessonTarget, base.mutationVersion, { text: "Toestel A" }), who),
    http("/api/annotations", "PUT", command("note", lessonTarget, base.mutationVersion, { text: "Toestel B" }), who),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const bookmark = await mutateAnnotation(who.actor, command("bookmark", { type: "verse", verseId: verses[5].id }));
  assert.equal((await http("/api/annotations", "DELETE", command("bookmark", { type: "verse", verseId: verses[5].id }, bookmark.annotation.mutationVersion), who)).status, 200);
  assert.equal((await listStudyFolder(who.actor, { type: "bookmark" })).items.length, 0);
  const after = await state(who.user.id);
  assert.equal(after.user.xpTotal, before.user.xpTotal);
  assert.equal(after.user.hintBalance, before.user.hintBalance);
  assert.deepEqual(after.hashes, before.hashes, "geen XP-, reeks-, hint- of voortgangswijziging");
});

test("deeplink item=<kind>:<id>: alleen eigen actieve annotaties; ander gebruiker, tombstone, verkeerd type en ongeldige id zijn niet te onderscheiden", async () => {
  const who = await referenceAccount(), other = await referenceAccount();
  const saved = await mutateAnnotation(who.actor, command("note", { type: "verse", verseId: verses[0].id }));
  const ok = await http(`/api/study-folder?item=note:${saved.annotation.id}`, "GET", undefined, who);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).item.id, saved.annotation.id);
  assert.equal((await http(`/api/study-folder?item=note:${saved.annotation.id}`, "GET", undefined, other)).status, 404);
  assert.equal((await http(`/api/study-folder?item=note:${saved.annotation.id}`, "GET", undefined, f.admin)).status, 404);
  assert.equal((await http(`/api/study-folder?item=bookmark:${saved.annotation.id}`, "GET", undefined, who)).status, 404);
  assert.equal((await http(`/api/study-folder?item=note:${randomUUID()}`, "GET", undefined, who)).status, 404);
  assert.equal((await http(`/api/study-folder?item=note:${saved.annotation.id}`, "GET", undefined, null)).status, 401);
  assert.equal((await http("/api/study-folder", "GET", undefined, null)).status, 401);
  const response = await http("/api/study-folder", "GET", undefined, who);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(response.headers.get("cache-control") ?? "", /private/);
  const text = await response.text();
  assert.ok(!text.includes(other.user.id));
  await mutateAnnotation(who.actor, removal("note", { type: "verse", verseId: verses[0].id }, saved.annotation.mutationVersion), true);
  assert.equal((await http(`/api/study-folder?item=note:${saved.annotation.id}`, "GET", undefined, who)).status, 404);
  assert.equal((await listStudyFolder(other.actor, {})).items.length, 0);
});

test("studiepassage openen: exacte revisie, bewezen herplaatst anker en ontbrekend anker zonder fuzzy matching; geen privégegevens van anderen", async () => {
  const who = await referenceAccount(), other = await referenceAccount();
  const note = await mutateAnnotation(who.actor, command("note", lessonTarget, 0, { text: "Bij de eerste revisie" }));
  const href = `${f.href}?annotation=note:${note.annotation.id}`;
  const exact = await http(href, "GET", undefined, who);
  assert.equal(exact.status, 200);
  const exactHtml = await exact.text();
  assert.ok(!exactHtml.includes("data-annotation-focus-note"), "exacte passage: geen waarschuwing");
  const foreign = await (await http(href, "GET", undefined, other)).text();
  assert.ok(foreign.includes('data-annotation-focus-note="missing"'), "andermans annotatie is niet leesbaar en niet te raden");
  assert.ok(!foreign.includes("Bij de eerste revisie"));
  await f.publish("updated");
  const replaced = await (await http(href, "GET", undefined, who)).text();
  // Fase 4D: de bijgewerkte les heeft hetzelfde stabiele anker met dezelfde tekst; de passage is bewezen terug te vinden
  // (zonder dat de oorspronkelijke selector wordt overschreven) en er is dus geen waarschuwing meer nodig.
  assert.ok(!replaced.includes("data-annotation-focus-note"), "bewezen exact anker: geen melding");
  assert.ok(!replaced.includes("data-annotation-recovery"), "geen herstelpaneel nodig");
  const listed = (await listStudyFolder(who.actor, {})).items.find((i) => i.id === note.annotation.id);
  assert.equal(listed.recovery, "found");
  assert.equal(listed.source.status, "available");
  assert.equal(listed.quote, lessonTarget.selector.exact);
  const garbage = await http(`${f.href}?annotation=note:${"x".repeat(200)}`, "GET", undefined, who);
  assert.equal(garbage.status, 200);
  assert.ok(!(await garbage.text()).includes("data-annotation-focus-note"), "ongeldige parameter wordt genegeerd");
});

test("terugnavigatie: alleen /study-folder-returnTo is toegestaan; geen open redirect", async () => {
  const { studyFolderReturn } = await import("../src/lib/annotations/studyFocus.ts");
  assert.equal(studyFolderReturn("/study-folder?type=note&q=abc"), "/study-folder?type=note&q=abc");
  assert.equal(studyFolderReturn("/study-folder"), "/study-folder");
  for (const bad of [null, "", "//evil.example", "/\\evil", "https://evil.example", "/study-folderx", "/mysteries/001"])
    assert.equal(studyFolderReturn(bad), null, String(bad));
});

test("geen XP, reeks, hints of credits door het openen van de map", async () => {
  const who = await referenceAccount();
  await mutateAnnotation(who.actor, command("bookmark", { type: "verse", verseId: verses[0].id }));
  const before = await state(who.user.id);
  for (const path of ["/api/study-folder", "/api/study-folder?view=sources", "/api/study-folder?type=bookmark"]) assert.equal((await http(path, "GET", undefined, who)).status, 200);
  assert.equal((await http("/study-folder", "GET", undefined, who)).status, 200);
  assert.deepEqual(await state(who.user.id), before);
  const hash = createHash("sha256").update("x").digest("hex");
  assert.ok(hash);
});

test("kleurfilter: alleen markeringen van die kleur, vóór paginering, gecombineerd met zoeken en bron, geldige combinaties en cursorbinding", async () => {
  const who = await referenceAccount(), other = await referenceAccount();
  const colors = ["yellow", "green", "blue", "pink", "purple"];
  const big = await makeChapter("content_bom", "Kleurboek", `bofm/folder-colors-${randomUUID().slice(0, 6)}`, 130);
  const en = await makeChapter("content_bom_en", "Colour book EN", `bofm/folder-colors-en-${randomUUID().slice(0, 6)}`, 10);
  const stamp = Date.UTC(2026, 2, 1);
  // 130 markeringen met gemengde kleuren (26 per kleur) plus bladwijzers en notities op dezelfde verzen.
  await prisma.highlight.createMany({ data: big.verses.map((v, i) => ({ userId: who.user.id, verseId: v.id, targetKey: `verse:${v.id}`, color: colors[i % 5], createdAt: new Date(stamp - Math.floor(i / 3) * 1000) })) });
  await prisma.bookmark.createMany({ data: big.verses.slice(0, 40).map((v, i) => ({ userId: who.user.id, verseId: v.id, targetKey: `verse:${v.id}`, createdAt: new Date(stamp - i * 500) })) });
  await prisma.note.createMany({ data: big.verses.slice(0, 40).map((v, i) => ({ userId: who.user.id, verseId: v.id, targetKey: `verse:${v.id}`, text: `Kleurnotitie ${i}`, createdAt: new Date(stamp - i * 700) })) });
  await prisma.highlight.createMany({ data: en.verses.map((v, i) => ({ userId: who.user.id, verseId: v.id, targetKey: `verse:${v.id}`, color: "yellow", createdAt: new Date(stamp + 1000 + i) })) });
  await prisma.highlight.createMany({ data: big.verses.slice(0, 30).map((v, i) => ({ userId: other.user.id, verseId: v.id, targetKey: `verse:${v.id}`, color: "yellow", createdAt: new Date(stamp) })) });
  const expected = async (color) => (await prisma.highlight.findMany({ where: { userId: who.user.id, color, deletedAt: null } })).map((r) => r.id).sort();
  const seen = [];
  const spy = { $queryRaw: async (...args) => { const result = await prisma.$queryRaw(...args); seen.push(result.length); return result; }, contentCollection: prisma.contentCollection };
  const walk = async (input, limit = 10) => {
    const all = []; let cursor; let pages = 0;
    do { const page = await listStudyFolder(who.actor, { ...input, cursor, limit }, spy); all.push(...page.items); cursor = page.nextCursor ?? undefined; pages += 1; assert.ok(pages < 60); } while (cursor);
    return { all, pages };
  };
  const unfiltered = await walk({}, 50);
  assert.equal(unfiltered.all.length, 130 + 40 + 40 + 10, "zonder kleurfilter alle annotaties");
  for (const color of colors) {
    const result = await walk({ color });
    assert.ok(result.all.every((i) => i.kind === "highlight" && i.color === color), `${color}: alleen markeringen van die kleur`);
    assert.deepEqual(result.all.map((i) => i.id).sort(), await expected(color), `${color}: geen dubbele of ontbrekende resultaten`);
    assert.equal(new Set(result.all.map((i) => i.id)).size, result.all.length);
    assert.ok(result.pages >= 3, "meerdere pagina's");
    const expectedOrder = [...result.all].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    assert.deepEqual(result.all.map((i) => i.id), expectedOrder.map((i) => i.id), `${color}: deterministische volgorde`);
  }
  assert.ok(Math.max(...seen) <= 51, "queryresultaten blijven begrensd (limiet+1)");
  assert.equal((await walk({ color: "yellow" })).all.length, 26 + 10);
  assert.equal((await walk({ color: "yellow", type: "highlight" })).all.length, 26 + 10, "color + type=highlight is geldig en gelijk aan color alleen");
  assert.equal((await walk({ color: "yellow", source: "content_bom_en" })).all.length, 10, "kleur + bronfilter");
  assert.equal((await walk({ color: "yellow", q: "vers 6 van Kleurboek" })).all.length, 1, "kleur + zoeken op leesbare brontekst");
  assert.equal((await walk({ color: "blue", q: "vers 6 van Kleurboek" })).all.length, 0);
  assert.equal((await walk({ type: "highlight" }, 50)).all.length, 140, "zonder kleur alle markeringen");
  for (const type of ["note", "bookmark"]) await assert.rejects(listStudyFolder(who.actor, { type, color: "yellow" }), (e) => e instanceof StudyFolderError && e.code === "INVALID");
  for (const color of ["red", "", "YELLOW", "yellow;--"]) await assert.rejects(listStudyFolder(who.actor, { color }), (e) => e instanceof StudyFolderError && e.code === "INVALID", color);
  // Cursor is aan de kleur gebonden.
  const yellow = await listStudyFolder(who.actor, { color: "yellow", limit: 5 });
  assert.ok(yellow.nextCursor);
  await assert.rejects(listStudyFolder(who.actor, { color: "blue", cursor: yellow.nextCursor }), (e) => e.code === "INVALID");
  await assert.rejects(listStudyFolder(who.actor, { cursor: yellow.nextCursor }), (e) => e.code === "INVALID");
  assert.ok((await listStudyFolder(who.actor, { color: "yellow", type: "highlight", cursor: yellow.nextCursor, limit: 5 })).items.length > 0, "dezelfde filters (type volgt de kleur) blijven geldig");
  // Geen gegevens van anderen en geen verborgen bron via het kleurfilter.
  assert.equal((await listStudyFolder(other.actor, { color: "blue" })).items.length, 0);
  assert.equal((await listStudyFolder(other.actor, { color: "yellow", limit: 50 })).items.length, 30);
  assert.ok(!(await walk({ color: "yellow" })).all.some((i) => i.id && other.user.id && JSON.stringify(i).includes(other.user.id)));
  // Een kleurwijziging via de 4A-writer verplaatst de markering tussen de gefilterde lijsten.
  const target = (await walk({ color: "yellow" })).all[3];
  const changed = await mutateAnnotation(who.actor, { kind: "highlight", target: target.target, expectedVersion: target.mutationVersion, actionId: randomUUID(), color: "blue" });
  assert.equal(changed.annotation.color, "blue");
  assert.ok(!(await walk({ color: "yellow" })).all.some((i) => i.id === target.id));
  assert.ok((await walk({ color: "blue" })).all.some((i) => i.id === target.id));
  // HTTP: validatie en combinaties.
  const status = async (query, who2 = who) => (await http(`/api/study-folder?${query}`, "GET", undefined, who2)).status;
  assert.equal(await status("color=yellow"), 200);
  assert.equal(await status("type=highlight&color=blue&limit=10"), 200);
  assert.equal(await status("type=note&color=yellow"), 400);
  assert.equal(await status("type=bookmark&color=yellow"), 400);
  assert.equal(await status("color=red"), 400);
  assert.equal(await status("color=yellow&color=blue"), 400);
  assert.equal(await status("color="), 400);
  const body = await (await http("/api/study-folder?color=yellow&limit=5", "GET", undefined, who)).json();
  assert.ok(body.nextCursor && body.items.every((i) => i.kind === "highlight" && i.color === "yellow"));
  assert.equal(await status(`color=blue&cursor=${encodeURIComponent(body.nextCursor)}`), 400);
  assert.equal(await status("color=yellow", null), 401);
});
