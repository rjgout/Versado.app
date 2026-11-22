import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { publicationTextEvidence, publicationObjectHash } from "../scripts/otb/publicationEvidence.ts";
import { scripturePublicationSchema, isScripturePublicationBusy } from "../src/lib/scripturePublication.ts";
import { notifyContentAvailabilityChanged, setRealtimeServer } from "../src/lib/realtime.ts";
import { OTB_COLLECTIONS } from "../scripts/otb/trialConfig.ts";
const lock = JSON.parse(readFileSync("scripts/otb/source-lock.json", "utf8")), evidence = JSON.parse(readFileSync("scripts/otb/publication-evidence.json", "utf8"));

test("controlebewijs bevat exact tien bekende uitgaven, gepinde bron en volledige boek-/hoofdstuktellingen", () => {
  assert.equal(evidence.sourceLockHash, publicationObjectHash(lock)); assert.equal(evidence.upstreamCommit, lock.upstreamCommit);
  assert.deepEqual(evidence.editions.map(e => e.id), OTB_COLLECTIONS.map(e => e.id));
  for (const item of evidence.editions) { assert.equal(item.books, item.work === "old-testament" ? 39 : 27); assert.equal(item.chapters, item.work === "old-testament" ? 929 : 260); assert.match(item.sha256, /^[a-f0-9]{64}$/); assert.ok(item.verses > item.chapters); }
});
test("tekstbewijs ziet gewijzigde tekst, lege/extra hoofdstukken, volgorde en identiteit; database-IDs en audio tellen niet mee", () => {
  const book = { key: "gen", slug: "old-testament-otb-nl-gen", name: "Genesis", order: 0, chapters: [{ number: 1, order: 0, verses: [{ number: 1, text: "Voorbeeldtekst" }] }] };
  const original = publicationTextEvidence([book]);
  assert.deepEqual(publicationTextEvidence([{ ...book, id: "different", audioUrl: "ignored" }]), original);
  for (const mutate of [b => b.chapters[0].verses[0].text += "!", b => b.chapters.push({ number: 2, order: 1, verses: [] }), b => b.order++, b => b.key = "exo", b => b.chapters[0].verses[0].number++]) {
    const changed = structuredClone(book); mutate(changed); assert.notEqual(publicationTextEvidence([changed]).sha256, original.sha256);
  }
});
test("alleen expliciete, unieke selecties met bevestiging en controlesleutels worden geaccepteerd", () => {
  const body = { actionId: randomUUID(), confirmation: "PUBLICEREN", editions: [{ id: "known", releaseToken: "a".repeat(64) }] };
  assert.equal(scripturePublicationSchema.safeParse(body).success, true);
  for (const changed of [{ ...body, all: true }, { ...body, editions: [] }, { ...body, editions: Array(11).fill(body.editions[0]) }, { ...body, editions: [body.editions[0], body.editions[0]] }, { ...body, confirmation: true }, { ...body, actionId: "unsafe" }]) assert.equal(scripturePublicationSchema.safeParse(changed).success, false);
});
test("bestaand contentChanged-event bevat geen inhoud, rechten of gebruikersgegevens", () => {
  const events = []; setRealtimeServer({ emit: (...args) => events.push(args) });
  try { notifyContentAvailabilityChanged(); assert.deepEqual(events, [["data_event", { event: "contentChanged" }]]); }
  finally { setRealtimeServer(undefined); }
});
test("alle vijf talen hebben complete bediening, blokkeerredenen en bevestiging", async () => {
  const { nl } = await import("../src/lib/i18n/messages/nl.ts");
  const flatten = (o, prefix = "") => Object.entries(o).flatMap(([k,v]) => typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`,v]]);
  const expected = flatten(nl.scripturePublication).map(([k]) => k).sort();
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const messages = (await import(`../src/lib/i18n/messages/${lang}.ts`))[lang].scripturePublication;
    assert.deepEqual(flatten(messages).map(([k]) => k).sort(), expected); assert.ok(flatten(messages).every(([,v]) => typeof v === "string" && v.length));
    assert.ok(messages.confirm.includes("{names}"));
  }
});

test("alleen bekende Prisma-/SQL-lockfouten heten BUSY, inclusief Prisma 7 adapter-pg", () => {
  for (const code of ["55P03", "40001", "40P01"]) {
    assert.equal(isScripturePublicationBusy({ code: "P2010", meta: { code } }), true);
    assert.equal(isScripturePublicationBusy({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: code } } } }), true);
  }
  for (const error of [null, new Error("unknown"), { code: "P2010" }, { code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "P0001" } } } }, { code: "P2010", meta: { code: "22P02" } }]) assert.equal(isScripturePublicationBusy(error), false);
  assert.equal(isScripturePublicationBusy({ code: "P2028" }), true); assert.equal(isScripturePublicationBusy({ code: "P2034" }), true);
});
