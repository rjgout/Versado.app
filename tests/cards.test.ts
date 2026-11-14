// Kaartstandaard van Leren en Spelen (docs/KAARTEN.md): persoonlijke
// volgorde, de interactiezones van ContentCard, en dat een cursus pas
// actief wordt als je er een les van opent. Het databasedeel draait alleen
// met LEARNING_TEST_DATABASE_URL.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:cards
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { AppNavigationProvider, type AppLinkProps } from "../src/components/navigation/AppNavigation";
import { renderToStaticMarkup as reactRender } from "react-dom/server";
import { applyPersonalOrder, saveListOrder } from "../src/lib/listOrder";
import { ContentCard, cardActions } from "../src/components/versado/ContentCard";
import { I18nProvider } from "../src/components/I18nProvider";
import { getT, messagesFor } from "../src/lib/i18n";


test("persoonlijke volgorde: opgeslagen eerst, onbekende achteraan in hun eigen volgorde", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(applyPersonalOrder(items, ["c", "a", "x"]).map((i) => i.id), ["c", "a", "b", "d"]);
  assert.deepEqual(applyPersonalOrder(items, []).map((i) => i.id), ["a", "b", "c", "d"]);
});

function renderToStaticMarkup(node: React.ReactNode) {
 const Link = ({replace,prefetch,onNavigate,...props}:AppLinkProps) => { void replace;void prefetch;void onNavigate;return h("a",props); };
 return reactRender(h(AppNavigationProvider,{adapter:{pathname:"/courses",Link,push(){},replace(){},back(){},refresh(){},canGoBack:()=>false},children:node}));
}
function render(props: Partial<Parameters<typeof ContentCard>[0]>) {
  return renderToStaticMarkup(
    h(I18nProvider, {
      language: "nl",
      messages: messagesFor("nl"),
      children: h(ContentCard, {
        title: "Woordzoeker",
        href: "/word-search",
        artwork: { kind: "game", keys: "game:word-search", sizes: "100vw" },
        ...props,
      }),
    })
  );
}

test("afbeelding en titel openen hetzelfde; de titel is de enige tabstop", () => {
  const html = render({});
  const links = [...html.matchAll(/<a [^>]*href="\/word-search"[^>]*>/g)].map((m) => m[0]);
  assert.equal(links.length, 2);
  assert.ok(links.some((a) => /tabindex="-1"/.test(a) && /aria-hidden="true"/.test(a)), "afbeeldinglink niet verborgen voor toetsenbord");
  assert.ok(links.some((a) => /card-title-link/.test(a) && !/tabindex/.test(a)), "titel is geen gewone link");
  assert.doesNotMatch(html, /<article[^>]*onclick/i, "de hele kaart hoort geen link of knop te zijn");
});

test("ⓘ en ⋯ alleen als ze er zijn, met een toegankelijke naam", () => {
  const plain = render({});
  assert.doesNotMatch(plain, /aria-haspopup="menu"/);
  assert.doesNotMatch(plain, /Speluitleg/);
  const full = render({ info: { label: "Speluitleg voor Woordzoeker", onClick: () => {} }, actions: [{ label: "Verbergen uit overzicht", onSelect: () => {} }] });
  assert.match(full, /aria-label="Speluitleg voor Woordzoeker"/);
  assert.match(full, /<button[^>]*aria-label="Beheer Woordzoeker"[^>]*aria-haspopup="menu"/);
});

test("de kaart heeft geen sleepgreep of sleepbediening", () => {
  const html = render({ actions: [{ label: "Later in de lijst", onSelect: () => {} }] });
  assert.doesNotMatch(html, /verplaatsen|aria-roledescription="sortable"|draggable=|touch-none|cursor-grab/);
  assert.match(html, /aria-haspopup="menu"/);
});

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";
const load = async () => ({ db: (await import("../src/lib/db")).prisma, courses: await import("../src/lib/courses") });
let L: Awaited<ReturnType<typeof load>>;
let fixtureCourses: { id: string }[] = [];
const email = `kaarten-${Date.now()}@test.invalid`;

before(async () => {
  if (skip) return;
  L = await load();
  fixtureCourses = await Promise.all([0, 1].map((index) => L.db.course.create({ data: {
    slug: `card-test-${Date.now()}-${index}`, name: `Synthetische kaartcursus ${index}`,
    type: "FREE_CHOICE", contentCollectionId: "content_bom",
  }, select: { id: true } })));
});
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email } });
  await L.db.course.deleteMany({ where: { id: { in: fixtureCourses.map((course) => course.id) } } });
  await L.db.$disconnect();
});

test("bekijken of toevoegen maakt een cursus niet actief, een les openen wel", { skip }, async () => {
  const [first, second] = fixtureCourses;
  assert.ok(first && second, "geen cursussen in de testdatabase");
  const user = await L.db.user.create({ data: { email, passwordHash: "x", handle: "Kaart", discriminator: "07", activeCourseId: first.id } });

  // Niet in het overzicht: een les openen verandert niets.
  await L.courses.markCourseStarted(L.db, user.id, second.id);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).activeCourseId, first.id);

  // Toevoegen: in het overzicht, nog niet actief.
  await L.courses.subscribeUserToCourse(L.db, user.id, second.id);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).activeCourseId, first.id);

  // Een les eruit openen: nu actief. Ook vanuit "geen actieve cursus".
  await L.courses.markCourseStarted(L.db, user.id, second.id);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).activeCourseId, second.id);
  await L.db.user.update({ where: { id: user.id }, data: { activeCourseId: null } });
  await L.courses.markCourseStarted(L.db, user.id, second.id);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).activeCourseId, second.id);

  // Verbergen en terugzetten bewaart de voortgang.
  await L.db.userCourseProgress.update({ where: { userId_courseId: { userId: user.id, courseId: second.id } }, data: { subscribed: false, comboCount: 3 } });
  await L.courses.subscribeUserToCourse(L.db, user.id, second.id);
  const progress = await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId: user.id, courseId: second.id } } });
  assert.equal(progress.subscribed, true);
  assert.equal(progress.comboCount, 3);
});

// "Cursus toevoegen" en "Spel toevoegen" zijn een kaart in dezelfde taal als de cursus- en spelkaarten,
// geen losse gestippelde knop (de gestippelde rand is voorbehouden aan de plek waar je iets neerzet).
test("de toevoegkaart gebruikt de gedeelde kaartstijl en een groot aantikbaar vlak", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/components/versado/ContentCard.tsx", "utf8");
  const picker = source.slice(source.indexOf("export function CardPicker"));
  const closed = picker.slice(0, picker.indexOf("<section aria-labelledby"));
  assert.match(closed, /interactiveCard/);
  assert.match(closed, /min-h-16/);
  assert.doesNotMatch(closed, /border-dashed/);
  assert.match(closed, /addHint/);
  // Leren en Spelen gebruiken hetzelfde onderdeel met een uitleg in alle talen.
  assert.match(readFileSync("src/components/CoursesView.tsx", "utf8"), /addHint=\{t\("courses\.addCourseHint"\)\}/);
  assert.match(readFileSync("src/components/LiveLobbyForm.tsx", "utf8"), /addHint=\{t\("gamesHub\.addGameHint"\)\}/);
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const messages = readFileSync(`src/lib/i18n/messages/${lang}.ts`, "utf8");
    assert.match(messages, /"?addCourseHint"?: "/, `${lang}: courses.addCourseHint ontbreekt`);
    assert.match(messages, /"?addGameHint"?: "/, `${lang}: gamesHub.addGameHint ontbreekt`);
  }
});

// Kinderverhalen: een tik op een plaatje vergroot het over de volle breedte, nog een tik zet het terug.
test("een plaatje in een kinderverhaal wisselt tussen klein en vergroot en heeft een toegankelijke naam", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/components/KidsLessonFlow.tsx", "utf8");
  assert.match(source, /aria-pressed=\{zoomed\}/);
  assert.match(source, /setZoomedImage\(zoomed \? null : src\)/);
  assert.match(source, /col-span-full/);
  assert.match(source, /t\("lessonFlows\.zoomImage"\)/);
  assert.match(source, /t\("lessonFlows\.unzoomImage"\)/);
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const messages = readFileSync(`src/lib/i18n/messages/${lang}.ts`, "utf8");
    assert.match(messages, /"?zoomImage"?: "/, `${lang}: zoomImage ontbreekt`);
    assert.match(messages, /"?unzoomImage"?: "/, `${lang}: unzoomImage ontbreekt`);
  }
});


test("kaartmenu begrenst beide richtingen en bewaart dezelfde indexen", () => {
  for (let index = 0; index < 3; index++) {
    const moves: number[][] = [];
    let hidden = false;
    const actions = cardActions({ t: getT("nl"), index, count: 3, onMove: (from, to) => moves.push([from, to]), onHide: () => { hidden = true; } });
    assert.equal(actions[0].disabled, index === 0);
    assert.equal(actions[1].disabled, index === 2);
    actions[0].onSelect(); actions[1].onSelect(); actions[2].onSelect();
    assert.deepEqual(moves, [[index, index - 1], [index, index + 1]]);
    assert.equal(hidden, true);
  }
  const busy = cardActions({ t: getT("nl"), index: 1, count: 3, busy: true, onMove: () => {}, onHide: () => {} });
  assert.ok(busy.every((action) => action.disabled));
});

test("kaartopslag bewaart het API-contract en meldt HTTP- en netwerkfouten", async () => {
  const original = globalThis.fetch;
  const bodies: unknown[] = [];
  try {
    globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); };
    await saveListOrder("courses", ["active", "b", "a"]);
    await saveListOrder("games", ["b", "a"], ["hidden-other-content"]);
    assert.deepEqual(bodies, [{ listKey: "courses", itemKeys: ["active", "b", "a"] }, { listKey: "games", itemKeys: ["b", "a"], hiddenKeys: ["hidden-other-content"] }]);
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    await assert.rejects(saveListOrder("games", ["a"]), /HTTP 503/);
    globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(saveListOrder("courses", ["a"]), /offline/);
  } finally { globalThis.fetch = original; }
});
