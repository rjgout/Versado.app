// Kaartstandaard van Leren en Spelen (docs/KAARTEN.md): persoonlijke
// volgorde, de interactiezones van ContentCard, en dat een cursus pas
// actief wordt als je er een les van opent. Het databasedeel draait alleen
// met LEARNING_TEST_DATABASE_URL.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:cards
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyPersonalOrder } from "../src/lib/listOrder";
import Module from "node:module";
import { I18nProvider } from "../src/components/I18nProvider";
import { messagesFor } from "../src/lib/i18n";

// next/image werkt alleen binnen Next; voor deze HTML-test volstaat een <img>.
const localRequire = Module.createRequire(import.meta.url);
localRequire.cache[localRequire.resolve("next/image")] = {
  exports: { __esModule: true, default: (props: { alt?: string }) => h("img", { alt: props.alt ?? "" }) },
} as unknown as NodeJS.Module;
// Pas na het vervangen laden (een gewone import wordt vooraan uitgevoerd).
const { ContentCard } = localRequire("../src/components/versado/ContentCard") as typeof import("../src/components/versado/ContentCard");

test("persoonlijke volgorde: opgeslagen eerst, onbekende achteraan in hun eigen volgorde", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(applyPersonalOrder(items, ["c", "a", "x"]).map((i) => i.id), ["c", "a", "b", "d"]);
  assert.deepEqual(applyPersonalOrder(items, []).map((i) => i.id), ["a", "b", "c", "d"]);
});

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

test("de greep staat links van de titel en heet naar de kaart", () => {
  const html = render({
    handle: { attributes: {} as never, listeners: undefined, setActivatorNodeRef: () => {}, isDragging: false, label: "Woordzoeker" },
  });
  const handleAt = html.indexOf('aria-label="Woordzoeker verplaatsen"');
  assert.ok(handleAt > 0, "greep ontbreekt");
  assert.ok(handleAt < html.indexOf('class="card-title-link'), "greep staat niet vóór de titel");
});

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";
const load = async () => ({ db: (await import("../src/lib/db")).prisma, courses: await import("../src/lib/courses") });
let L: Awaited<ReturnType<typeof load>>;
const email = `kaarten-${Date.now()}@test.invalid`;

before(async () => {
  if (skip) return;
  L = await load();
});
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email } });
  await L.db.$disconnect();
});

test("bekijken of toevoegen maakt een cursus niet actief, een les openen wel", { skip }, async () => {
  const [first, second] = await L.db.course.findMany({ where: { enabled: true }, orderBy: { order: "asc" }, take: 2, select: { id: true } });
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
  assert.match(readFileSync("src/components/CoursesClient.tsx", "utf8"), /addHint=\{t\("courses\.addCourseHint"\)\}/);
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
