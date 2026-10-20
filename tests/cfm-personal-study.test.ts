import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import { cfmOldTestament2026NlManifest as manifest } from "../src/lib/studyContent/cfm2026Manifest";
import { readingBlockText, type ReaderDocument } from "../src/lib/studyContent/readingPositionContract";
import {
  PERSONAL_STUDY_STEPS,
  PERSONAL_STUDY_VERSION,
  LEGACY_PERSONAL_STUDY,
  personalStudyView,
  planPersonalStudy,
  stepOfBlock,
  text8,
  validatePersonalPlan,
} from "../src/lib/studyContent/personalStudy";
import { isPersonalStudyWork, loadPersonalStudyOverrides, personalStudyFor, safePersonalPlan } from "../src/lib/studyContent/personalStudyOverrides";
import { classifyFigure, figureLayout } from "../src/lib/studyContent/figureDisplay";
import { classifyContentRoute } from "../src/lib/contentRouting";
import { isFocusRoute, shellModeForRoute } from "../src/lib/focusMode";

const lessons = await Promise.all(manifest.lessons.map(async (l) => ({ key: l.sourceKey, parsed: await loadCfmLesson(l.sourceKey) })));

test("alle 52 lessen krijgen precies zes niet-lege stappen zonder verlies van bronblokken", () => {
  assert.equal(lessons.length, 52);
  for (const { key, parsed } of lessons) {
    const before = JSON.stringify(parsed.document);
    const plan = planPersonalStudy(parsed.document, loadPersonalStudyOverrides(manifest.workKey, key));
    assert.equal(JSON.stringify(parsed.document), before, `${key}: brondocument gewijzigd`);
    assert.ok(plan.supported, `${key}: niet ondersteund`);
    assert.deepEqual(validatePersonalPlan(parsed.document, plan), [], key);
    assert.equal(plan.supported && plan.issues.length, 0, `${key}: override ongeldig`);
    assert.equal(plan.supported && plan.steps.length, PERSONAL_STUDY_STEPS);
  }
});

test("de indeling is deterministisch en elke persoonlijke alinea komt exact één keer voor", () => {
  for (const { key, parsed } of lessons) {
    const overrides = loadPersonalStudyOverrides(manifest.workKey, key);
    const a = planPersonalStudy(parsed.document, overrides);
    const b = planPersonalStudy(JSON.parse(JSON.stringify(parsed.document)), overrides);
    assert.deepEqual(a, b, key);
    if (!a.supported) throw new Error(key);
    const stepped = a.steps.flatMap((s) => s.blockIds);
    assert.equal(new Set(stepped).size, stepped.length, `${key}: blok in meerdere stappen`);
    assert.deepEqual(stepped, a.blocks.filter((x) => x.personal).map((x) => x.id), `${key}: volgorde of dekking`);
    assert.equal(new Set(a.steps.map((s) => s.fingerprint)).size, PERSONAL_STUDY_STEPS, `${key}: dubbele stapvingerafdruk`);
  }
});

test("kinderideeën en bijlagen staan nooit in de persoonlijke route; twijfelgevallen verdwijnen niet stil", () => {
  for (const { key, parsed } of lessons) {
    const blocks = parsed.document.sections[0].blocks;
    const h2 = blocks.flatMap((b, i) => (b.type === "heading" && b.level === 2 ? [i] : []));
    const plan = planPersonalStudy(parsed.document, loadPersonalStudyOverrides(manifest.workKey, key));
    if (!plan.supported) throw new Error(key);
    const personal = new Set(plan.blocks.filter((b) => b.personal).map((b) => b.id));
    for (const block of blocks.slice(h2[2])) assert.ok(!personal.has(block.id), `${key}: ${block.id} hoort bij kinderen/bijlagen`);
    for (const planned of plan.blocks.filter((b) => !b.personal)) assert.ok(planned.reason.length > 10, `${key}: ${planned.id} heeft geen reden`);
    // Een verborgen kader is alleen verborgen via een expliciete override met de juiste brontekst.
    for (const planned of plan.blocks.filter((b) => b.role === "OVERRIDE_HIDDEN")) {
      const override = loadPersonalStudyOverrides(manifest.workKey, key).hide?.find((h) => h.id === planned.id);
      assert.ok(override, `${key}: ${planned.id}`);
      assert.equal(override.text8, text8(blocks.find((b) => b.id === planned.id)!));
    }
  }
});

test("een override die niet meer bij de brontekst past wordt genegeerd en gemeld", () => {
  const { key, parsed } = lessons[9];
  const overrides = loadPersonalStudyOverrides(manifest.workKey, key);
  assert.ok(overrides.hide?.length);
  const stale = { hide: [{ ...overrides.hide![0], text8: "00000000" }] };
  const plan = planPersonalStudy(parsed.document, stale);
  assert.ok(plan.supported);
  if (plan.supported) {
    assert.equal(plan.issues[0]?.code, "OVERRIDE_STALE");
    assert.ok(plan.blocks.find((b) => b.id === overrides.hide![0].id)!.personal);
  }
});

test("handmatige stapgrenzen worden gevalideerd; ongeldige grenzen vallen terug op de automatische indeling", () => {
  const { parsed } = lessons[9];
  const auto = planPersonalStudy(parsed.document);
  assert.ok(auto.supported);
  if (!auto.supported) return;
  const cuts = auto.steps.slice(1).map((s) => s.blockIds[0]);
  const manual = planPersonalStudy(parsed.document, { cuts });
  assert.ok(manual.supported && manual.steps.map((s) => s.fingerprint).join() === auto.steps.map((s) => s.fingerprint).join());
  const bad = planPersonalStudy(parsed.document, { cuts: [...cuts].reverse() });
  assert.ok(bad.supported && bad.issues.some((i) => i.code === "CUTS_INVALID"));
});

test("een les zonder de vaste opbouw is niet ondersteund en verzint geen stappen", () => {
  const doc = { schemaVersion: 1, sections: [{ id: "s", blocks: [{ id: "a", type: "paragraph", content: [{ type: "text", text: "Alleen een alinea." }] }] }] } as unknown as ReaderDocument;
  assert.equal(planPersonalStudy(doc).supported, false);
  assert.equal(isPersonalStudyWork("cfm-old-testament-2026"), true);
  assert.equal(isPersonalStudyWork("fsy"), false);
  assert.equal(personalStudyFor({ workKey: "fsy", sourceKey: "1", body: doc }).supported, false);
});

test("stapvingerafdruk wijzigt bij een andere brontekst, zodat oude voortgang niet stil meegaat", () => {
  const { parsed } = lessons[3];
  const a = planPersonalStudy(parsed.document);
  const changed = JSON.parse(JSON.stringify(parsed.document)) as ReaderDocument;
  const target = (changed.sections[0].blocks as unknown as Array<{ type: string; content?: Array<{ type: string; text?: string }> }>).find((b) => b.type === "paragraph" && b.content?.[0]?.type === "text" && (b.content[0].text ?? "").length > 200)!;
  target.content![0].text += " (gewijzigd)";
  const b = planPersonalStudy(changed);
  assert.ok(a.supported && b.supported);
  if (a.supported && b.supported) {
    assert.notEqual(a.fingerprint, b.fingerprint);
    const same = a.steps.filter((s, i) => s.fingerprint === b.steps[i].fingerprint).length;
    assert.ok(same >= 1 && same < PERSONAL_STUDY_STEPS, "alleen de gewijzigde stap (of buren) krijgt een nieuwe vingerafdruk");
  }
});

test("de client-DTO bevat ankers en kopteksten maar geen brontekst, en vindt de stap bij een alinea", () => {
  const { parsed } = lessons[0];
  const plan = planPersonalStudy(parsed.document);
  const view = personalStudyView(plan)!;
  assert.ok(view);
  const json = JSON.stringify(view);
  const long = readingBlockText(parsed.document.sections[0].blocks.find((b) => b.id === "b-p2") ?? parsed.document.sections[0].blocks[6]);
  assert.ok(!json.includes(long.slice(0, 80)));
  const second = view.steps[1].blockIds[0];
  assert.equal(stepOfBlock(view, second), 2);
  assert.equal(stepOfBlock(view, "bestaat-niet"), null);
  for (const id of view.otherBlockIds) assert.equal(stepOfBlock(view, id), null);
});

test("afbeeldingsklassen: liggend, staand, vierkant, pictogram, bijschrift en poster", () => {
  const landscape = { id: "img-img2", width: 500, height: 281, hasCaption: false };
  const portrait = { id: "img-img3", width: 320, height: 427, hasCaption: true };
  const square = { id: "img-img4", width: 500, height: 500, hasCaption: false };
  const icon = { id: "img-img5", width: 120, height: 120, hasCaption: false };
  const headingIcon = { id: "img-b-title3-0", width: 320, height: 320, hasCaption: false };
  const poster = { id: "img-source-1-2-3-poster", width: 1280, height: 720, hasCaption: false };
  assert.equal(classifyFigure(landscape), "NARRATIVE");
  assert.equal(classifyFigure(portrait), "NARRATIVE");
  assert.equal(classifyFigure(square), "NARRATIVE");
  assert.equal(classifyFigure(icon), "ICON");
  assert.equal(classifyFigure(headingIcon), "SMALL");
  assert.equal(classifyFigure(poster), "POSTER");
  // Een staand beeld wordt begrensd door schermhoogte, een pictogram blijft klein en wordt nooit vergroot.
  assert.ok(figureLayout("NARRATIVE", portrait).maxViewport > 0);
  assert.equal(figureLayout("ICON", icon).enlarge, false);
  assert.equal(figureLayout("NARRATIVE", landscape).enlarge, true);
  // Alleen de pixelafmeting beslist het type niet: hetzelfde formaat met bijschrift is geen pictogram.
  assert.equal(classifyFigure({ ...icon, hasCaption: true }), "SMALL");
});

test("routes voor Vrije studie, het weekoverzicht en een stap horen bij dezelfde Focusroute en contentroute", () => {
  for (const route of ["/study-lesson/a/b", "/study-lesson/a/b/stappen", "/study-lesson/a/b/stappen/3"]) {
    assert.equal(isFocusRoute(route), true, route);
    assert.equal(shellModeForRoute(route), "focus", route);
    assert.deepEqual(classifyContentRoute(route), { kind: "studyLesson", lessonId: "a", collectionId: "b" }, route);
  }
  assert.equal(isFocusRoute("/study-lesson/a/b/stappen/3/extra"), false);
});

test("gebruikersgerichte stapteksten bevatten nergens dagnamen en de stapnamen zijn Stap 1 t/m Stap 6", () => {
  const nl = readFileSync(path.join(process.cwd(), "src/lib/i18n/messages/nl.ts"), "utf8");
  const section = nl.slice(nl.indexOf("  cfmStudy: {"), nl.indexOf("  studyReader: {"));
  assert.match(section, /"stepN": "Stap \{n\}"/);
  assert.doesNotMatch(section, /maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag/i);
  // Zondag komt alleen voor in de rustboodschap na de zesde stap; er is geen zevende stap en geen dagkoppeling.
  const sundays = section.split("\n").filter((line) => /zondag/i.test(line));
  assert.equal(sundays.length, 1);
  assert.match(sundays[0], /"sundayRest": "Neem zondag de tijd om stil te staan bij wat je hebt geleerd\."/);
  assert.doesNotMatch(section, /Stap 7|zeven stappen/i);
});

test("er zijn zes stappen en een veilige omzetting van de zevenstappenindeling van versie 1", () => {
  assert.equal(PERSONAL_STUDY_STEPS, 6);
  assert.equal(PERSONAL_STUDY_VERSION, 2);
  for (const { key, parsed } of lessons) {
    const overrides = loadPersonalStudyOverrides(manifest.workKey, key);
    const six = planPersonalStudy(parsed.document, overrides);
    const seven = planPersonalStudy(parsed.document, overrides, LEGACY_PERSONAL_STUDY);
    assert.ok(six.supported && seven.supported, key);
    if (!six.supported || !seven.supported) continue;
    assert.equal(seven.steps.length, 7, key);
    // Dezelfde persoonlijke blokken in dezelfde volgorde; een vingerafdruk van versie 1 kan nooit een stap van versie 2 zijn.
    assert.deepEqual(six.steps.flatMap((s) => s.blockIds), seven.steps.flatMap((s) => s.blockIds), key);
    const fingerprints = new Set(six.steps.map((s) => s.fingerprint));
    for (const old of seven.steps) assert.ok(!fingerprints.has(old.fingerprint), `${key}: oude vingerafdruk komt terug`);
  }
});

test("stap afronden raakt nooit de READ-actie, de reeks of XP", () => {
  // Alleen de imports tellen: commentaar mag uitleggen wat er juist niet gebeurt.
  for (const file of ["src/lib/studyContent/stepProgress.ts", "src/app/api/study-steps/route.ts"]) {
    const imports = readFileSync(path.join(process.cwd(), file), "utf8").split("\n").filter((line) => /^import /.test(line)).join("\n");
    assert.doesNotMatch(imports, /streak|readStatus|learning|\/xp|realtime|contentProgress/i, file);
  }
  const source = readFileSync(path.join(process.cwd(), "src/lib/studyContent/stepProgress.ts"), "utf8");
  assert.ok(!/contentProgress\.|recordLearningActivity|markStudyLessonRead|emitToUser/.test(source));
});

test("een ongeldige indeling wordt gedetecteerd en valt veilig terug op de volledige les", () => {
  const { parsed } = lessons[4];
  const plan = planPersonalStudy(parsed.document);
  assert.ok(plan.supported);
  if (!plan.supported) return;
  // Een dubbele toewijzing, een lege stap of een ontbrekend blok moet de validatie laten falen.
  const duplicate = { ...plan, steps: plan.steps.map((s, i) => (i === 1 ? { ...s, blockIds: [...s.blockIds, plan.steps[0].blockIds[0]] } : s)) };
  assert.ok(validatePersonalPlan(parsed.document, duplicate).length > 0);
  const empty = { ...plan, steps: plan.steps.map((s, i) => (i === 3 ? { ...s, blockIds: [] } : s)) };
  assert.ok(validatePersonalPlan(parsed.document, empty).some((m) => /leeg|bevatten/.test(m)));
  const lost = { ...plan, blocks: plan.blocks.slice(1) };
  assert.ok(validatePersonalPlan(parsed.document, lost).length > 0);
  // Een geldige les geeft het plan ongewijzigd door.
  const safe = safePersonalPlan({ workKey: manifest.workKey, sourceKey: lessons[4].key, body: parsed.document });
  assert.ok(safe.supported);
});

test("toekomstige CFM-jaren gebruiken dezelfde laag zodra hun werksleutel met cfm- begint en de structuur klopt", () => {
  const { parsed } = lessons[0];
  const future = personalStudyFor({ workKey: "cfm-new-testament-2027", sourceKey: "01", body: parsed.document });
  assert.ok(future.supported, "zelfde structuur, geen hardgecodeerd jaar of weeknummer");
  assert.equal(personalStudyFor({ workKey: "fsy-2027", sourceKey: "01", body: parsed.document }).supported, false, "andere programma's worden niet automatisch geactiveerd");
});
