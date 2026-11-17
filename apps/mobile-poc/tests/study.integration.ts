/* Studieles-spike tegen de echte lokale backend (geen mocks): het gepubliceerde lesdocument via de nieuwe native leesroute,
 * afbeelding via de bestaande mediaroute, selectie → selector → opslaan via de bestaande annotatieservice, plaatsing door de server
 * na herladen, isolatie tussen gebruikers, rechten, versiecontrole en een door de server geweigerde selector.
 * Vereist: seed-synthetic.ts, seed-reader-content.ts en seed-study-lesson.ts (synthetisch testprofiel). Draaien: npm run test:study */
import assert from "node:assert/strict";
import { createAppSession } from "@poc/core/session";
import type { SecureSessionStore } from "@/lib/native/client";
import { NativeClientError } from "@/lib/native/client";
import { deleteStudyAnnotation, loadStudy, loadStudyImage, putStudyAnnotation, overlapping } from "@poc/study/api";
import { buildItems, buildRunLayout, marksByBlock, rangesToLessonSelector, selectionToRanges } from "@poc/study/runModel";

const base = process.env.POC_BASE_URL ?? "http://127.0.0.1:3100";
const pw = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
const memory = (): SecureSessionStore => { let v: string | null = null; return { read: async () => v, write: async x => { v = x; }, clear: async () => { v = null; } }; };
const log = (m: string) => console.log(`✓ ${m}`);
const login = async (email: string) => { const s = createAppSession(base, memory()); await s.signIn(email, pw); return s; };
const status = (e: unknown) => (e instanceof NativeClientError ? `${e.status}` : String(e));

async function main() {
  const gerda = await login("gerda@example.invalid");
  let { lesson, annotations } = await loadStudy(gerda.client);
  const types = new Set(lesson.body.sections.flatMap(s => s.blocks.map(b => b.type)));
  for (const t of ["heading", "paragraph", "list", "quote", "table", "figure", "reference", "question", "divider"]) assert.ok(types.has(t as never), `blok ${t} ontbreekt`);
  log(`Les via de native leesroute (bestaande getPublishedStudyLesson): "${lesson.title}", ${lesson.body.sections[0]!.blocks.length} blokken, alle typen aanwezig (zod-contract gevalideerd)`);

  const mediaId = lesson.media.find(m => m.mediaKey === "media-painting")?.mediaId;
  assert.ok(mediaId);
  const image = await loadStudyImage(gerda.client, mediaId!);
  assert.ok(image.uri.startsWith("data:image/webp;base64,") && image.width > 0);
  log(`Afbeelding via de bestaande beveiligde mediaroute: ${image.width}×${image.height}`);

  // schone start (herhaalbaar)
  for (const row of annotations.annotations.filter(r => !r.deleted)) await deleteStudyAnnotation(gerda.client, lesson, row);
  ({ annotations } = await loadStudy(gerda.client));
  assert.equal(annotations.annotations.filter(r => !r.deleted).length, 0);

  // selectie over een kop en twee alinea's → één annotatie met drie bereiken
  const section = lesson.body.sections[0]!.id, items = buildItems(lesson.body, section);
  const run = items[0]!;
  assert.equal(run.type, "run");
  const layout = buildRunLayout((run as Extract<typeof run, { type: "run" }>).units);
  const a = layout.spans.find(s => s.unit.id === "b-topic1")!.start + 4, b = layout.spans.find(s => s.unit.id === "b-p2")!.start + 6;
  const ranges = selectionToRanges(layout, a, b);
  const selector = rangesToLessonSelector(lesson.body, section, lesson.revisionId, ranges);
  assert.equal(selector.ranges.length, 3);
  const put = await putStudyAnnotation(gerda.client, lesson, annotations.annotations, annotations.tombstones, selector, { kind: "highlight", color: "yellow" });
  assert.equal(put.annotation.kind, "highlight");
  await putStudyAnnotation(gerda.client, lesson, annotations.annotations, annotations.tombstones, selector, { kind: "note", text: "Proefnotitie bij de les" });
  log("Markering en notitie over drie blokken opgeslagen via de bestaande annotatieservice (één annotatie per selectie)");

  // herladen met een nieuwe sessie: de server plaatst de annotatie in de huidige revisie; de client rekent dat om naar tekstbereiken
  const again = await login("gerda@example.invalid");
  const reloaded = await loadStudy(again.client);
  const live = reloaded.annotations.annotations.filter(r => !r.deleted);
  assert.equal(live.length, 2);
  assert.ok(live.every(r => r.placement?.status === "EXACT"));
  const marks = marksByBlock((run as Extract<typeof run, { type: "run" }>).units, live);
  assert.deepEqual([...marks.keys()].sort(), ["b-p1", "b-p2", "b-topic1"]);
  log("Na herladen met nieuwe sessie: server plaatst beide annotaties EXACT en de client herleidt dezelfde drie bereiken");

  // overlap-zoeken (voor "markering wissen")
  assert.equal(overlapping(live, "highlight", [{ blockId: "b-p1", start: 1, end: 3 }]).length, 1);
  assert.equal(overlapping(live, "highlight", [{ blockId: "b-fill1", start: 0, end: 3 }]).length, 0);

  // een andere gebruiker in dezelfde collectie ziet niets (annotaties zijn privé)
  const hans = await login("hans@example.invalid");
  assert.equal((await loadStudy(hans.client)).annotations.annotations.filter(r => !r.deleted).length, 0);
  log("Een andere gebruiker ziet de annotaties niet");

  // rechten: een gebruiker zonder toegang tot deze collectie krijgt de les niet (zelfde rechtencontrole als stappen/weken)
  const alice = await login("alice@example.invalid");
  const denied = await alice.client.api(`courses/${lesson.courseId}/weeks/${lesson.editionId}/lesson`).then(() => "toegestaan", status);
  assert.equal(denied, "404");
  log("Gebruiker met een andere actieve collectie: 404 (geen lesinhoud buiten de eigen rechten)");

  // de server controleert de selector tegen het gepubliceerde document: een vervalste exacte tekst wordt geweigerd
  const forged = { ...selector, exact: selector.exact + "x" };
  const forgedResult = await gerda.client.api(`courses/${lesson.courseId}/weeks/${lesson.editionId}/annotations`, {
    operation: "put", action: { kind: "highlight", target: { type: "lesson", lessonEditionId: lesson.editionId, revisionId: lesson.revisionId, selector: forged }, expectedVersion: 0, actionId: crypto.randomUUID(), color: "green" },
  }).then(() => "geaccepteerd", status);
  assert.notEqual(forgedResult, "geaccepteerd");
  log(`Vervalste selector wordt door de server geweigerd (${forgedResult})`);

  // een verouderde expectedVersion wordt geweigerd (geen omzeiling door de client)
  const row = live.find(r => r.kind === "highlight")!;
  const stale = await gerda.client.api(`courses/${lesson.courseId}/weeks/${lesson.editionId}/annotations`, {
    operation: "put", action: { kind: "highlight", target: { type: "lesson", lessonEditionId: lesson.editionId, revisionId: lesson.revisionId, selector }, expectedVersion: row.mutationVersion + 5, actionId: crypto.randomUUID(), color: "blue" },
  }).then(() => "geaccepteerd", status);
  assert.notEqual(stale, "geaccepteerd");
  log(`Verouderde/onjuiste versie wordt geweigerd (${stale})`);

  // een andere revisie dan de gepubliceerde wordt geweigerd
  const wrongRevision = await gerda.client.api(`courses/${lesson.courseId}/weeks/${lesson.editionId}/annotations`, {
    operation: "put", action: { kind: "highlight", target: { type: "lesson", lessonEditionId: lesson.editionId, revisionId: "andere", selector: { ...selector, originalRevisionId: "andere" } }, expectedVersion: 0, actionId: crypto.randomUUID(), color: "blue" },
  }).then(() => "geaccepteerd", status);
  assert.notEqual(wrongRevision, "geaccepteerd");
  log(`Een andere revisie dan de gepubliceerde wordt geweigerd (${wrongRevision})`);

  // verwijderen
  for (const r of live) await deleteStudyAnnotation(again.client, reloaded.lesson, r);
  assert.equal((await loadStudy(gerda.client)).annotations.annotations.filter(r => !r.deleted).length, 0);
  log("Alles verwijderd; de eerste sessie ziet het ook");
  process.exit(0);
}
main().catch(e => { console.error("✗", e); process.exit(1); });
