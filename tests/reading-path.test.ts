import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { BOOK_KEYS_BY_SLUG } from "../prisma/bookKeys";
import { CHAPTER_SCENES, chapterSceneKey, chapterSceneSrc } from "../src/lib/chapterScenes";
import { artworkFor, chapterArtworkKeys } from "../src/lib/artwork";
import {
  buildPathChapters,
  chapterPercent,
  chapterState,
  currentChapterId,
  pathScrollTarget,
  stepState,
  type PathLessonInput,
} from "../src/lib/readingPath";

// Leerpad Stap voor stap: alleen presentatie. De status komt uit de server (getStepOverview); deze tests
// bewaken dat het pad die status ongewijzigd toont, geen activiteiten bijmaakt en de illustraties alleen
// koppelt waar de inhoud klopt.

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// --- gegevens uit de server -> hoofdstukken met echte stappen

function lessons(shape: Record<string, number>, book = { name: "1 Nephi", key: "bofm/1-ne" }): PathLessonInput[] {
  const out: PathLessonInput[] = [];
  let n = 0;
  for (const [chapter, count] of Object.entries(shape)) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      out.push({ id: `l${n}`, chapterId: `c${chapter}`, startVerse: i * 9 + 1, endVerse: i * 9 + 9, chapter: { number: Number(chapter), book } });
    }
  }
  return out;
}
const quiet = () => ({ read: "UNREAD" as const, exercisesAnswered: 0, exercisesTotal: 0 });
function status(done: string[], available: string[]) {
  return (id: string) => ({ done: done.includes(id), available: done.includes(id) || available.includes(id) });
}
function stepMap(ls: PathLessonInput[], done: string[], available: string[]) {
  const f = status(done, available);
  return new Map(ls.map((l) => [l.id, f(l.id)]));
}

test("hoofdstuk met één stap, hoofdstuk met meerdere stappen: elke les is precies één stap en er komt niets bij", () => {
  const ls = lessons({ 9: 1, 10: 3, 11: 4 });
  const chapters = buildPathChapters(ls, stepMap(ls, [], ["l1"]), quiet);
  assert.deepEqual(chapters.map((c) => c.steps.length), [1, 3, 4]);
  assert.equal(chapters.reduce((sum, c) => sum + c.steps.length, 0), ls.length, "geen losse lees-, quiz- of bonusstappen");
  assert.deepEqual(chapters[2].steps.map((s) => [s.number, s.startVerse, s.endVerse]), [[1, 1, 9], [2, 10, 18], [3, 19, 27], [4, 28, 36]]);
  assert.deepEqual(chapters.map((c) => c.id), ["c9", "c10", "c11"], "exact de cursusvolgorde");
});

test("1 Nephi 11-voorbeeld: vier stappen, één af, huidige stap is stap 2, rest vergrendeld", () => {
  const ls = lessons({ 11: 4 });
  const [chapter] = buildPathChapters(ls, stepMap(ls, ["l1"], ["l2"]), () => ({ read: "READING", exercisesAnswered: 3, exercisesTotal: 12 }));
  assert.equal(chapter.completedLessons, 1);
  assert.equal(chapter.lessonCount, 4);
  assert.deepEqual(chapter.steps.map((s) => stepState(s, "l2")), ["done", "current", "locked", "locked"]);
  assert.equal(chapterState(chapter, "l2"), "current");
  assert.equal(chapterPercent(chapter), 25);
  assert.deepEqual([chapter.read, chapter.exercisesAnswered, chapter.exercisesTotal], ["READING", 3, 12]);
});

test("eerste, middelste en laatste stap, geen vragen, alles af en een toekomstige stap blijft vergrendeld", () => {
  const ls = lessons({ 1: 2, 2: 3, 3: 2 });
  const ids = ls.map((l) => l.id);
  // eerste stap actief
  let chapters = buildPathChapters(ls, stepMap(ls, [], ["l1"]), quiet);
  assert.deepEqual(chapters.map((c) => chapterState(c, "l1")), ["current", "locked", "locked"]);
  assert.equal(currentChapterId(chapters, "l1"), "c1");
  // middelste stap actief: hoofdstuk 1 af, hoofdstuk 2 bezig
  chapters = buildPathChapters(ls, stepMap(ls, ["l1", "l2", "l3"], ["l4"]), quiet);
  assert.deepEqual(chapters.map((c) => chapterState(c, "l4")), ["done", "current", "locked"]);
  assert.equal(chapters[2].steps.every((s) => stepState(s, "l4") === "locked"), true, "toekomstige stappen blijven vergrendeld");
  // laatste stap actief
  chapters = buildPathChapters(ls, stepMap(ls, ids.slice(0, 6), ["l7"]), quiet);
  assert.deepEqual(chapters.map((c) => chapterState(c, "l7")), ["done", "done", "current"]);
  // alles af: geen actief hoofdstuk, geen actieve stap
  chapters = buildPathChapters(ls, stepMap(ls, ids, []), quiet);
  assert.equal(currentChapterId(chapters, null), null);
  assert.deepEqual(chapters.map((c) => chapterState(c, null)), ["done", "done", "done"]);
  assert.equal(chapters.every((c) => c.steps.every((s) => stepState(s, null) === "done")), true);
});

test("een hoofdstuk dat via een andere route is afgerond telt hier als af; een elders begonnen hoofdstuk is open, niet vergrendeld", () => {
  const ls = lessons({ 1: 2, 2: 2, 3: 2 });
  // server: hoofdstuk 1 af (via een andere leesroute), hoofdstuk 3 al begonnen en dus open, 2 is aan de beurt
  const chapters = buildPathChapters(ls, stepMap(ls, ["l1", "l2"], ["l3", "l5"]), quiet);
  assert.deepEqual(chapters.map((c) => chapterState(c, "l3")), ["done", "current", "open"]);
  assert.equal(stepState(chapters[2].steps[0], "l3"), "open");
  assert.equal(stepState(chapters[2].steps[1], "l3"), "locked", "binnen een open hoofdstuk blijft de volgorde van stappen gelden");
});

test("de status is ongewijzigd die van de server: het pad maakt nooit zelf een stap open of af", () => {
  const ls = lessons({ 1: 3 });
  const [chapter] = buildPathChapters(ls, stepMap(ls, [], []), quiet);
  assert.equal(chapter.steps.every((s) => !s.done && !s.available), true);
  assert.equal(chapter.locked, true);
  assert.throws(() => buildPathChapters(ls, new Map(), quiet), /Geen stapstatus/);
});

test("hoofdstukken lopen over boeken heen in de volgorde van de cursus", () => {
  const a = lessons({ 22: 1 }, { name: "1 Nephi", key: "bofm/1-ne" }).map((l) => ({ ...l, id: `a${l.id}`, chapterId: `a${l.chapterId}` }));
  const b = lessons({ 1: 1 }, { name: "2 Nephi", key: "bofm/2-ne" }).map((l) => ({ ...l, id: `b${l.id}`, chapterId: `b${l.chapterId}` }));
  const all = [...a, ...b];
  const chapters = buildPathChapters(all, stepMap(all, [], []), quiet);
  assert.deepEqual(chapters.map((c) => `${c.bookName} ${c.number}`), ["1 Nephi 22", "2 Nephi 1"]);
});

// --- automatisch bij de juiste stap

test("pathScrollTarget: de actieve stap staat in beeld, met het vorige hoofdstuk erboven als er ruimte is", () => {
  const base = { header: 64, nav: 80, viewport: 800, margin: 12 };
  // veel ruimte: het vorige hoofdstuk staat net onder de bovenbalk
  const roomy = pathScrollTarget({ ...base, previousTop: 4000, cardTop: 4070, stepTop: 4300, stepBottom: 4370 });
  assert.equal(roomy, 4000 - 64 - 12);
  // zonder vorig hoofdstuk (eerste) begint de kaart zelf onder de bovenbalk
  assert.equal(pathScrollTarget({ ...base, previousTop: null, cardTop: 300, stepTop: 500, stepBottom: 560 }), 300 - 64 - 12);
  // weinig ruimte: de stap gaat voor, het vorige hoofdstuk verdwijnt uit beeld maar de stap blijft boven de onderbalk
  const tight = pathScrollTarget({ ...base, viewport: 500, previousTop: 4000, cardTop: 4070, stepTop: 4500, stepBottom: 4560 });
  assert.ok(tight >= 4560 + 12 - (500 - 80), "stap onder de bovenkant van de onderbalk");
  assert.ok(tight <= 4500 - 64 - 12, "stap boven de onderkant van de bovenbalk");
  // nooit negatief
  assert.equal(pathScrollTarget({ ...base, previousTop: null, cardTop: 20, stepTop: 60, stepBottom: 120 }), 0);
  // een stap die niet in het scherm past: de bovenkant blijft zichtbaar
  const huge = pathScrollTarget({ ...base, viewport: 300, previousTop: 1000, cardTop: 1100, stepTop: 1200, stepBottom: 1900 });
  assert.equal(huge, 1200 - 64 - 12);
});

// --- illustraties: alleen waar de inhoud klopt

test("chapterScenes: elke koppeling wijst naar een bestaand verhaal met dezelfde titel, een bestaand beeld en een bestaand hoofdstuk", () => {
  const stories = JSON.parse(read("prisma/kidsManifest.json")) as { number: number; title: string; images: string[] }[];
  const bom = JSON.parse(read("prisma/bomContent.json")) as { slug: string; chapters: { number: number }[] }[];
  const bookKeys = Object.fromEntries(Object.entries(BOOK_KEYS_BY_SLUG).map(([slug, key]) => [key, slug]));
  const seen = new Set<string>();
  assert.ok(CHAPTER_SCENES.length >= 40);
  for (const scene of CHAPTER_SCENES) {
    const id = chapterSceneKey(scene.book, scene.chapter);
    assert.equal(seen.has(id), false, `dubbele koppeling ${id}`);
    seen.add(id);
    const story = stories.find((s) => s.number === scene.story);
    assert.ok(story, `verhaal ${scene.story} bestaat niet`);
    assert.equal(story.title, scene.title, `verhaal ${scene.story} heet nu anders: de koppeling moet opnieuw gecontroleerd worden`);
    assert.ok(existsSync(new URL(`../public${chapterSceneSrc(scene)}`, import.meta.url)), `beeld ontbreekt voor ${id}`);
    const slug = bookKeys[scene.book];
    assert.ok(slug, `onbekend boek ${scene.book}`);
    if (scene.book.startsWith("bofm/")) {
      const book = bom.find((b) => b.slug === slug);
      assert.ok(book?.chapters.some((c) => c.number === scene.chapter), `${scene.book} ${scene.chapter} bestaat niet`);
    }
  }
});

test("artwork: 1 Nephi 2 krijgt de scène van Lehi's vertrek; 1 Nephi 11 niet zomaar het verhaal met nummer 11 maar het boekbeeld", () => {
  assert.equal(artworkFor(chapterArtworkKeys("bofm/1-ne", 2))?.src, "/kids/images/story-3-0.jpg");
  const eleven = artworkFor(chapterArtworkKeys("bofm/1-ne", 11));
  assert.equal(eleven?.src, "/images/book-of-mormon/1-nephi.png");
  assert.notEqual(eleven?.src, "/kids/images/story-11-0.jpg");
  // een hoofdstuk zonder eigen scène in een boek zonder beeld: geen beeld (kaart met icoon, nooit een gok)
  assert.equal(artworkFor(chapterArtworkKeys("bofm/onbekend", 5)), null);
  assert.deepEqual(chapterArtworkKeys(null, 1), []);
  // gelijk nummer in een ander boek geeft die scène niet
  assert.equal(artworkFor(chapterArtworkKeys("bofm/2-ne", 2))?.src, "/images/book-of-mormon/2-nephi.png");
});

// --- broncontracten: geen tweede systeem, geen eigen shellmechanisme, geen harde kleuren

test("het pad schrijft nergens voortgang weg, linkt alleen naar bestaande lesroutes en toont vergrendelde stappen zonder link", () => {
  const path = read("src/components/reading/ReadingPath.tsx");
  assert.doesNotMatch(path, /fetch\(|liveMutation|jsonMutation|XMLHttpRequest|prisma/);
  assert.deepEqual([...new Set([...path.matchAll(/href=\{`([^`]+)`\}/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, "$")))], ["/reading-lesson/$"]);
  // een vergrendeld hoofdstuk en een vergrendelde stap zijn geen link en niet bedienbaar
  assert.equal((path.match(/aria-disabled="true"/g) ?? []).length, 2);
});

test("het pad gebruikt de bestaande tokens en geen eigen vaste of sticky balk", () => {
  for (const rel of ["src/components/reading/ReadingPath.tsx", "src/components/ReadingCourseView.tsx"]) {
    const source = read(rel);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, `${rel}: harde kleurcode`);
    assert.doesNotMatch(source, /\bsticky\b|env\(/, `${rel}: eigen sticky of env()`);
    assert.doesNotMatch(source, /text-\[\d+px\]/, `${rel}: leesbare tekst in px`);
    assert.doesNotMatch(source, /window\.scrollTo\(0,\s*0\)|scrollIntoView/, `${rel}: eigen scrolllogica`);
  }
  const path = read("src/components/reading/ReadingPath.tsx");
  // het enige vaste element: de knop "Mijn stap", boven de onderbalk en binnen de safe area
  assert.equal((path.match(/\bfixed\b/g) ?? []).length, 1);
  assert.match(path, /bottom-\[calc\(var\(--nav-height,0px\)\+var\(--vs-safe-area-bottom,0px\)\+0\.75rem\)\]/);
  assert.match(path, /requestScrollRestore\(currentEntryKey\(\), "position"/, "scrollen via het centrale coördinatiepunt");
});

test("geen slingerlijn meer: geen SVG-route, knooppunten of statusbolletjes op het pad; wel korte rechte streepjes tussen kaarten", () => {
  const path = read("src/components/reading/ReadingPath.tsx");
  assert.doesNotMatch(path, /<svg|<path|RAIL|WIGGLE|railX|function Node|strokeDasharray|vectorEffect/);
  assert.doesNotMatch(path, /text-vs-success"?[^>]*\bw-\[|bg-vs-success\b(?!-soft)/, "geen lange groene lijn");
  assert.match(path, /mx-auto h-\[18px\] w-\[2px\]/, "recht, gecentreerd streepje van ~18 px");
  assert.match(path, /aria-hidden className="mx-auto h-\[18px\]/, "puur decoratief");
});

test("statusiconen staan binnen de kaart; een afgerond hoofdstuk toont alleen een vinkje met een tekst voor schermlezers", () => {
  const path = read("src/components/reading/ReadingPath.tsx");
  assert.match(path, /<Check size=\{18\} strokeWidth=\{3\} aria-hidden \/>\s*<span className="sr-only">\{t\("courseView\.path\.chapterDone"\)\}/);
  assert.match(path, /<Lock size=\{16\} strokeWidth=\{2\.25\} aria-hidden \/>\s*<span className="sr-only">\{t\("courseView\.path\.chapterLocked"\)\}/);
  assert.doesNotMatch(path, /border-dashed/, "geen zware stippelrand als standaard");
});

test("de actieve stap is een compacte tegel in hetzelfde raster, geen enorme knop over de volle breedte", () => {
  const path = read("src/components/reading/ReadingPath.tsx");
  assert.doesNotMatch(path, /col-span-full|primaryButton \$\{|!rounded-2xl/);
  assert.match(path, /grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,8\.5rem\),1fr\)\)\]/);
  assert.match(path, /data-current-step=\{state === "current" \? "" : undefined\}/);
  // het label "Volgende stap" staat alleen op de huidige tegel
  assert.equal((path.match(/courseView\.path\.nextStep/g) ?? []).length, 1);
});

test("de bovenste voortgang telt voltooide hoofdstukken, niet het nummer van het hoofdstuk waar je bezig bent", () => {
  const view = read("src/components/ReadingCourseView.tsx");
  assert.match(view, /completedChapters = chapters\.filter\(\(chapter\) => chapter\.lessonCount > 0 && chapter\.completedLessons === chapter\.lessonCount\)\.length/);
  assert.match(view, /pos: completedChapters/);
  assert.doesNotMatch(view, /currentChapterIndex|progressPosition/);
});

test("het leerpad heeft een eigen Focusroute; de gewone cursuspagina blijft voor alle andere cursustypes en stuurt READING_LESSONS door", () => {
  const hub = read("src/app/courses/[courseId]/page.tsx");
  assert.match(hub, /if \(course\.type === "READING_LESSONS"\) redirect\(`\/courses\/\$\{course\.id\}\/pad`\);/);
  assert.doesNotMatch(hub, /ReadingCourseView|buildPathChapters/);
  const pad = read("src/app/courses/[courseId]/pad/page.tsx");
  // geen lus: de padpagina stuurt alleen andere typen terug, en zonder geldige/selecteerbare cursus naar de lijst
  assert.match(pad, /if \(course\.type !== "READING_LESSONS"\) redirect\(`\/courses\/\$\{course\.id\}`\);/);
  assert.match(pad, /if \(!course\) redirect\("\/courses"\);/);
  assert.match(pad, /isContentCollectionSelectable\(course\.contentCollectionId, user\.isAdmin\)\)\) redirect\("\/courses"\)/);
  assert.match(pad, /loadReadingPath\(prisma, user\.id, course\.id\)/);
  assert.match(pad, /<LiveRefresh scopes=\{\["courses", "progress"\]\}/);
  const data = read("src/lib/readingPathData.ts");
  assert.match(data, /getStepOverview\(db, userId, courseId\)/);
  assert.match(data, /currentLessonId: overview\.next\?\.id \?\? null/, "ongewijzigde voortgangscursor");
  // terug vanuit een les gaat rechtstreeks naar het leerpad
  assert.match(read("src/app/reading-lesson/[lessonId]/page.tsx"), /CourseBackTarget href=\{`\/courses\/\$\{lesson\.courseId\}\/pad`\}/);
});
