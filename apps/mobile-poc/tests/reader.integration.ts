/* Lezer-spike tegen de echte lokale backend (geen mocks van de server): hoofdstuk via de bestaande cursusroutes,
 * markering en notitie per vers via de bestaande annotatieroute, herladen met een nieuwe sessie, isolatie tussen gebruikers,
 * versiecontrole van de server en verwijderen.
 * Vereist: seed-synthetic.ts en seed-reader-content.ts. Draaien: POC_BASE_URL=http://127.0.0.1:3100 npm run test:reader */
import assert from "node:assert/strict";
import { createAppSession } from "@poc/core/session";
import type { SecureSessionStore } from "@/lib/native/client";
import { NativeClientError } from "@/lib/native/client";
import { deleteAnnotation, highlightsByVerse, loadBundle, notesByVerse, putAnnotation } from "@poc/reader/api";

const base = process.env.POC_BASE_URL ?? "http://127.0.0.1:3100";
const pw = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
const memory = (): SecureSessionStore => { let v: string | null = null; return { read: async () => v, write: async x => { v = x; }, clear: async () => { v = null; } }; };
const log = (m: string) => console.log(`✓ ${m}`);
const login = async (email: string) => { const s = createAppSession(base, memory()); await s.signIn(email, pw); return s; };

async function main() {
  const alice = await login("alice@example.invalid");
  let { reader, annotations } = await loadBundle(alice.client, "Proefboek");
  assert.equal(reader.bookName, "Proefboek");
  assert.equal(reader.verses.length, 12);
  assert.equal(reader.verses[0]!.number, 1);
  log(`Hoofdstuk via cursusroutes: ${reader.bookName} ${reader.chapterNumber}, ${reader.verses.length} verzen (contract gevalideerd door zod)`);

  // schone start (de test is herhaalbaar)
  for (const row of annotations.annotations.filter(r => !r.deleted)) await deleteAnnotation(alice.client, reader, row);
  ({ annotations } = await loadBundle(alice.client, "Proefboek"));
  assert.equal(annotations.annotations.filter(r => !r.deleted).length, 0);

  // markering over drie verzen (een selectie over meerdere verzen) + notitie op het eerste geselecteerde vers
  for (const n of [5, 6, 7]) await putAnnotation(alice.client, reader, annotations.annotations, { kind: "highlight", verseId: reader.verses[n - 1]!.id, color: "yellow" });
  await putAnnotation(alice.client, reader, annotations.annotations, { kind: "note", verseId: reader.verses[7]!.id, text: "Proefnotitie bij vers 8" });
  log("Markering op vers 5–7 en notitie op vers 8 opgeslagen via de bestaande route");

  // herladen met een volledig nieuwe sessie: server is de bron van waarheid
  const again = await login("alice@example.invalid");
  const reloaded = await loadBundle(again.client, "Proefboek");
  const hl = highlightsByVerse(reloaded.annotations.annotations), notes = notesByVerse(reloaded.annotations.annotations);
  assert.deepEqual(Object.keys(hl).sort(), [5, 6, 7].map(n => reader.verses[n - 1]!.id).sort());
  assert.ok(Object.values(hl).every(c => c === "yellow"));
  assert.equal(notes[reader.verses[7]!.id], "Proefnotitie bij vers 8");
  log("Na herladen met nieuwe sessie: dezelfde markeringen en notitie");

  // een andere gebruiker ziet niets (annotaties zijn privé)
  const carol = await login("carol@example.invalid");
  const carolBundle = await loadBundle(carol.client, "Proefboek");
  assert.equal(carolBundle.annotations.annotations.filter(r => !r.deleted).length, 0);
  log("Een andere gebruiker ziet de annotaties niet");

  // kleur wijzigen met de juiste versie; een verouderde versie weigert de server (geen omzeiling door de client)
  const row = reloaded.annotations.annotations.find(r => r.kind === "highlight" && r.target.verseId === reader.verses[4]!.id)!;
  const green = await putAnnotation(again.client, reloaded.reader, reloaded.annotations.annotations, { kind: "highlight", verseId: row.target.verseId, color: "green" });
  assert.equal(green.annotation.color, "green");
  const stale = await again.client.api(`courses/${reader.courseId}/read/${reader.kind}/${reader.targetId}/annotations`, {
    operation: "put",
    context: { activeCollectionId: reader.activeCollectionId, selectionVersion: reader.selectionVersion, language: reader.language, chapterId: reader.chapterId, startVerse: reader.startVerse, endVerse: reader.endVerse },
    action: { kind: "highlight", target: { type: "verse", verseId: row.target.verseId }, expectedVersion: row.mutationVersion, actionId: crypto.randomUUID(), color: "blue" },
  }).then(() => "geaccepteerd", (e: unknown) => (e instanceof NativeClientError ? `${e.status}` : String(e)));
  assert.notEqual(stale, "geaccepteerd", "verouderde expectedVersion moet door de server worden geweigerd");
  log(`Kleur wijzigen met juiste versie werkt; verouderde versie wordt door de server geweigerd (${stale})`);

  // verwijderen
  const fresh = await loadBundle(again.client, "Proefboek");
  for (const r of fresh.annotations.annotations.filter(x => !x.deleted)) await deleteAnnotation(again.client, fresh.reader, r);
  const gone = await loadBundle(alice.client, "Proefboek");
  assert.equal(gone.annotations.annotations.filter(r => !r.deleted).length, 0);
  log("Alles verwijderd; de eerste sessie ziet het ook");
  process.exit(0);
}
main().catch(e => { console.error("✗", e); process.exit(1); });
