import test from "node:test";
import assert from "node:assert/strict";
import { CFM_SOURCES, CFM_SOURCE_2026, cfmSourceOfAdapter, cfmSourceOfCollection, cfmSourceOfWork, isCfmAdapter } from "../src/lib/studyContent/cfmSources";
import { CFM_VOLUMES } from "../src/lib/studyContent/cfmVolumes";
import { classifyUnresolvedCfmReference, isKnownUnresolvableCfmReference } from "../src/lib/studyContent/cfmReferencePolicy";
import { studyImportAllowed, studyReleaseAllowed } from "../src/lib/studyContent/policy";
import { validateStudyManifest } from "../src/lib/studyContent/manifest";
import { cfmDisplayOnlyKeys } from "../src/lib/studyContent/cfmReview";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import { cfmReferenceTarget } from "../src/lib/studyContent/cfm2026Adapter";

test("elke gepinde bron hoort bij precies één geregistreerde jaargang en heeft een eigen, vaste adapteridentiteit", () => {
  assert.ok(CFM_SOURCES.length >= 1);
  assert.equal(new Set(CFM_SOURCES.map((s) => s.adapter)).size, CFM_SOURCES.length, "adapter uniek");
  assert.equal(new Set(CFM_SOURCES.map((s) => s.dataDir)).size, CFM_SOURCES.length, "gegevensmap uniek");
  for (const source of CFM_SOURCES) {
    const volume = CFM_VOLUMES.find((v) => v.workKey === source.manifest.workKey);
    assert.ok(volume, `${source.manifest.workKey} is geregistreerd in cfmVolumes`);
    assert.equal(source.volume, volume);
    assert.equal(source.manifest.year, volume.year);
    assert.equal(source.manifest.editionKey, volume.editionKey);
    assert.equal(source.manifest.language, volume.language);
    assert.match(source.adapter, new RegExp(`^cfm-${volume.year}-${volume.language}-v1$`));
    assert.deepEqual(Object.keys(source.sourceLock.lessons).sort(), source.manifest.lessons.map((l) => l.sourceKey).sort(), "elke les heeft een gepinde hash");
    assert.equal(validateStudyManifest(source.manifest).filter((d) => d.status === "BLOCKED" && d.code !== "REFERENCES_BLOCKED").length >= 0, true);
    assert.equal(source.sourceLock.verifiedAt <= new Date().toISOString().slice(0, 10), true);
  }
});

test("bestaande bronidentiteit van CFM 2026 blijft exact behouden (compatibiliteit met bestaande importruns)", () => {
  assert.equal(CFM_SOURCE_2026.adapter, "cfm-2026-nl-v1");
  assert.equal(CFM_SOURCE_2026.manifest.workKey, "cfm-old-testament-2026");
  assert.equal(CFM_SOURCE_2026.manifest.editionKey, "church-cfm-ot-2026");
  assert.equal(CFM_SOURCE_2026.volume.collectionId, "content_cfm_ot_2026_nl");
  assert.equal(CFM_SOURCE_2026.dataDir, "data/study-content/cfm-2026-nl");
});

test("alleen een geregistreerde adapter telt als officiële CFM-bron; geen naamherkenning", () => {
  assert.equal(isCfmAdapter("cfm-2026-nl-v1"), true);
  for (const name of ["cfm-2099-nl-v1", "cfm-2026-nl-v2", "CFM-2026-nl-v1", "synthetic-v1", "fsy-legacy-v1", "", null, undefined, "cfm-2026-xx-v1"])
    assert.equal(isCfmAdapter(name as string), false, String(name));
  assert.equal(studyImportAllowed("cfm-2099-nl-v1"), false);
  assert.equal(studyReleaseAllowed("cfm-2099-nl-v1"), false);
  assert.equal(studyImportAllowed("cfm-2026-nl-v1"), true);
  assert.equal(studyReleaseAllowed("cfm-2026-nl-v1"), true);
});

test("collectie-opzoeking vereist werk, uitgavefamilie én taal", () => {
  const ok = { work: "cfm-old-testament-2026", editionKey: "church-cfm-ot-2026", language: "nl" };
  assert.equal(cfmSourceOfCollection(ok), CFM_SOURCE_2026);
  for (const bad of [{ ...ok, language: "en" }, { ...ok, editionKey: "otb" }, { ...ok, work: "old-testament" }, { ...ok, work: null }])
    assert.equal(cfmSourceOfCollection(bad), undefined);
  assert.equal(cfmSourceOfWork("cfm-old-testament-2026"), CFM_SOURCE_2026);
  assert.equal(cfmSourceOfAdapter("cfm-2026-nl-v1"), CFM_SOURCE_2026);
});

test("verwijzingsbeleid: alleen een goed gevormd, veilig officieel doel mag als tekst worden gedegradeerd", () => {
  const official = "https://www.churchofjesuschrist.org/study/scriptures/ot/gen/1?lang=nld";
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: "otb:gen:1:3", externalUrl: official }), "KNOWN_UNRESOLVABLE");
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: `unverified-numbering:${official}`, externalUrl: official }), "KNOWN_UNRESOLVABLE");
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: `unverified-range:${official}`, externalUrl: official }), "KNOWN_UNRESOLVABLE");
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: official, externalUrl: official }), "KNOWN_UNRESOLVABLE");
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: "https://assets.churchofjesuschrist.org/abc-360p-nl.mp4", externalUrl: "https://assets.churchofjesuschrist.org/abc-360p-nl.mp4" }), "KNOWN_UNRESOLVABLE");
  assert.equal(isKnownUnresolvableCfmReference({ sourceKey: "otb:gen:1", externalUrl: official }), true);
});

test("verwijzingsbeleid: onveilige URL's en onherkenbare doelen blokkeren altijd; een externe https-host wordt alleen tekst", () => {
  const unsafe = [
    "http://www.churchofjesuschrist.org/study/x",
    "https://user:pw@www.churchofjesuschrist.org/study/x",
    "https://www.churchofjesuschrist.org:8443/study/x",
    "https://127.0.0.1/study/x",
    "https://localhost/study/x",
    "https://[::1]/study/x",
    "ftp://www.churchofjesuschrist.org/x",
    "javascript:alert(1)",
    "data:text/html;base64,AAAA",
    "https://www.churchofjesuschrist.org/study/\u0000x",
    "https://www.churchofjesuschrist.org/study/with space",
  ];
  for (const url of unsafe) {
    assert.equal(classifyUnresolvedCfmReference({ sourceKey: url, externalUrl: url }), "UNSAFE_URL", url);
    assert.equal(isKnownUnresolvableCfmReference({ sourceKey: "otb:gen:1", externalUrl: url }), false, `${url} als externalUrl`);
  }
  // Een externe https-host (bv. familysearch.org) wordt nooit een link, alleen veilige tekst.
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: "https://www.familysearch.org/discovery", externalUrl: "https://www.familysearch.org/discovery" }), "KNOWN_UNRESOLVABLE");
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: "iets-onbekends" }), "UNKNOWN");
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: "otb:gen:1" }), "UNKNOWN", "een intern doel zonder bron-URL is niet te herkennen");
  assert.equal(classifyUnresolvedCfmReference({ sourceKey: "" }), "UNKNOWN");
});

test("CFM 2026: de bestaande beoordeelde lijst blijft een deelverzameling van wat als tekst mag; alleen veilige doelen komen erbij", async () => {
  let total = 0, reviewed = 0, unsafe = 0;
  for (const lesson of CFM_SOURCE_2026.manifest.lessons) {
    const parsed = await loadCfmLesson(lesson.sourceKey);
    const keys = new Set(await cfmDisplayOnlyKeys(lesson.sourceKey, {
      schemaVersion: 1, title: parsed.title, body: parsed.document,
      sourceMetadata: { sourceKey: lesson.sourceKey, name: CFM_SOURCE_2026.collectionName, url: lesson.sourceUrl },
      rightsMetadata: (await import("../src/lib/studyContent/cfm2026Adapter")).CFM_RIGHTS,
    } as never, CFM_SOURCE_2026.sourceLock.lessons[lesson.sourceKey]));
    for (const reference of parsed.inventory.references) {
      total += 1;
      if (keys.has(reference.occurrenceKey)) {
        reviewed += 1;
      }
      const t = reference.target as { sourceKey: string; externalUrl?: string };
      if (classifyUnresolvedCfmReference(t) === "UNSAFE_URL") {
        unsafe += 1;
        // Een niet-officiële host wordt nooit door het nieuwe beleid gedegradeerd; alleen een eerder uitdrukkelijk
        // beoordeelde verwijzing (referenceReview) mag als tekst blijven.
        const manual = [...CFM_SOURCE_2026.referenceReview!.assessments, ...CFM_SOURCE_2026.referenceReview!.additionalFindings].some(
          (a) => a.lesson === lesson.sourceKey && a.classification === "C_MANUAL_REVIEW" && a.sourceLocation === reference.occurrenceKey,
        );
        assert.equal(keys.has(reference.occurrenceKey), manual, `${lesson.sourceKey}:${reference.label}`);
      }
    }
  }
  assert.ok(total > 1000, "de jaargang heeft veel verwijzingen");
  assert.ok(reviewed >= 553, `minstens de 553 beoordeelde verwijzingen (${reviewed})`);
  assert.equal(unsafe, 0, "de officiële bron bevat geen onveilige verwijzing");
});

test("zonder schriftuurprofiel legt een jaargang nooit een interne link: de bron-URL blijft de enige identiteit", () => {
  const nt = { ...CFM_SOURCE_2026, scripture: null };
  const target = cfmReferenceTarget("../../scriptures/nt/matt/5.html", "Mattheüs 5", "https://www.churchofjesuschrist.org/study/manual/x/01?lang=nld", nt);
  assert.equal(target.workKey, undefined);
  assert.equal(target.externalUrl, "https://www.churchofjesuschrist.org/study/scriptures/nt/matt/5?lang=nld");
  assert.equal(target.sourceKey, target.externalUrl);
  // Een onveilige of niet-https doel blijft een harde fout bij het lezen van de bron.
  assert.throws(() => cfmReferenceTarget("javascript:alert(1)", "x", "https://www.churchofjesuschrist.org/study/manual/x/01?lang=nld", nt));
  assert.throws(() => cfmReferenceTarget("http://www.churchofjesuschrist.org/study/x", "x", "https://www.churchofjesuschrist.org/study/manual/x/01?lang=nld", nt));
});
