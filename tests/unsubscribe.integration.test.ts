// Uitschrijven met de database (alleen LEARNING_TEST_DATABASE_URL, nooit productie): de echte
// dispatcher stuurt een mail met de juiste token, de route wijzigt precies één veld, een GET
// wijzigt nooit iets, en de gerenderde pagina bevat nergens het volledige e-mailadres.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET = "integration-test-secret-0123456789";
process.env.APP_URL = "https://versado.test";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

// De mail vangen in plaats van versturen, en de sessie/taal van een bezoeker zonder login nabootsen.
const sent: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }[] = [];
const localRequire = Module.createRequire(import.meta.url);
function stub(path: string, exports: Record<string, unknown>) {
  localRequire.cache[localRequire.resolve(path)] = { exports: { __esModule: true, ...exports } } as unknown as NodeJS.Module;
}
let currentUser: unknown = null;
stub("../src/lib/email", { sendMail: async (input: (typeof sent)[number]) => (sent.push(input), { ok: true }), isEmailConfigured: async () => true });
stub("../src/lib/session", { getCurrentUser: async () => currentUser });
stub("../src/lib/requestLanguage", { anonymousLanguage: async () => "nl", requestLanguage: async () => "nl" });

type Db = typeof import("../src/lib/db").prisma;
let db: Db;
const userIds: string[] = [];
const FIELDS = ["notifyDailyReminder", "notifyDailyText", "notifySocial", "notifyActivityReactions", "notifyAchievements", "notifyWordGame", "notifyStreakReturn"] as const;
const EMAIL_A = `uitschrijf.testpersoon.${Date.now()}@voorbeeld-domein.invalid`;
const EMAIL_B = `ander.account.${Date.now()}@voorbeeld-domein.invalid`;

async function makeUser(email: string, handle: string, language: string) {
  const user = await db.user.create({
    data: { email, passwordHash: "x", handle, discriminator: "01", uiLanguage: language, emailNotificationsEnabled: true, pushNotificationsEnabled: true, onlineSocketCount: 0, ...Object.fromEntries(FIELDS.map((f) => [f, true])) },
  });
  userIds.push(user.id);
  return user;
}

const settings = async (id: string) => db.user.findUniqueOrThrow({ where: { id }, select: { emailNotificationsEnabled: true, pushNotificationsEnabled: true, notifyDailyReminder: true, notifyDailyText: true, notifySocial: true, notifyActivityReactions: true, notifyAchievements: true, notifyWordGame: true, notifyStreakReturn: true } });

const route = () => localRequire("../src/app/api/unsubscribe/route") as typeof import("../src/app/api/unsubscribe/route");
const { NextRequest } = localRequire("next/server") as typeof import("next/server");
const lib = () => localRequire("../src/lib/unsubscribe") as typeof import("../src/lib/unsubscribe");

function post(fields: Record<string, string>, search = "") {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return route().POST(new NextRequest(`https://versado.test/api/unsubscribe${search}`, { method: "POST", body }));
}
async function page(token: string, search: Record<string, string> = {}) {
  const Page = (localRequire("../src/app/uitschrijven/[token]/page") as typeof import("../src/app/uitschrijven/[token]/page")).default;
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token }), searchParams: Promise.resolve(search) }));
}

before(async () => {
  if (!url) return;
  db = (localRequire("../src/lib/db") as typeof import("../src/lib/db")).prisma;
});
after(async () => {
  if (db) await db.user.deleteMany({ where: { id: { in: userIds } } });
});

test("de dispatcher stuurt per categorie een mail met het juiste token en beide opties (HTML én tekst)", { skip }, async () => {
  const notify = localRequire("../src/lib/notify") as typeof import("../src/lib/notify");
  const user = await makeUser(EMAIL_A, "Testpersoon", "nl");
  const cases: [string, () => Promise<void>, string][] = [
    ["social", () => notify.notifyFriendRequest(user.id, "Bram"), "social"],
    ["dailyText", () => notify.notifyDailyText(user.id, { href: "/lesson/x", bookName: "Alma", chapterNumber: 1, verseNumber: 1, content: "Tekst" }), "dailyText"],
    ["wordGame", () => notify.notifyWordGame(user.id), "wordGame"],
    ["dailyReminder", () => notify.notifyDailyReminder(user.id), "dailyReminder"],
  ];
  for (const [label, run, category] of cases) {
    sent.length = 0;
    await run();
    assert.equal(sent.length, 1, `${label}: precies één mail`);
    const mail = sent[0];
    const tokenMatch = /\/uitschrijven\/([^"?\s]+)/.exec(mail.html);
    assert.ok(tokenMatch, `${label}: geen uitschrijflink in de HTML`);
    const verified = lib().verifyUnsubscribeToken(decodeURIComponent(tokenMatch![1]));
    assert.deepEqual(verified, { userId: user.id, category }, `${label}: token hoort bij ${category}`);
    assert.match(mail.html, /Uitschrijven voor dit soort meldingen/);
    assert.match(mail.html, /Alle e-mailmeldingen uitschakelen/);
    assert.match(mail.html, /\/uitschrijven\/[^"]+\?actie=alles/);
    assert.match(mail.text, /Uitschrijven voor dit soort meldingen: https:\/\/versado\.test\/uitschrijven\//);
    assert.match(mail.text, /Alle e-mailmeldingen uitschakelen: https:\/\/versado\.test\/uitschrijven\/[^\s]+\?actie=alles/);
    assert.match(mail.headers?.["List-Unsubscribe"] ?? "", /^<https:\/\/versado\.test\/api\/unsubscribe\?t=/);
    assert.equal(mail.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    // het adres van de ontvanger staat niet in de link of in de voettekst
    assert.ok(!mail.html.includes(encodeURIComponent(EMAIL_A)) && !mail.text.includes(`uitschrijven/${EMAIL_A}`));
  }
});

test("de footer volgt de taal van de ontvanger (User.uiLanguage)", { skip }, async () => {
  const notify = localRequire("../src/lib/notify") as typeof import("../src/lib/notify");
  const english = await makeUser(`en.${EMAIL_B}`, "Engelstalig", "en");
  sent.length = 0;
  await notify.notifyFriendRequest(english.id, "Bram");
  assert.match(sent[0].html, /Unsubscribe from this type of notification/);
  assert.match(sent[0].text, /Turn off all email notifications/);
  assert.doesNotMatch(sent[0].html, /Uitschrijven/);
});

test("geen mail, dus ook geen footer, als e-mail uit staat of de melding alleen push is", { skip }, async () => {
  const notify = localRequire("../src/lib/notify") as typeof import("../src/lib/notify");
  const off = await makeUser(`uit.${EMAIL_B}`, "Uit", "nl");
  await db.user.update({ where: { id: off.id }, data: { emailNotificationsEnabled: false } });
  sent.length = 0;
  await notify.notifyFriendRequest(off.id, "Bram");
  await notify.notifyGameInvite(off.id, "Bram", () => "Spel", "ABCD");
  assert.equal(sent.length, 0);
});

test("specifiek uitschrijven wijzigt alleen dat ene notify*-veld (dailyText en nog een categorie)", { skip }, async () => {
  const user = await makeUser(`spec.${EMAIL_B}`, "Specifiek", "nl");
  for (const [category, field] of [["dailyText", "notifyDailyText"], ["achievements", "notifyAchievements"], ["social", "notifySocial"]] as const) {
    await db.user.update({ where: { id: user.id }, data: Object.fromEntries(FIELDS.map((f) => [f, true])) });
    const before = await settings(user.id);
    const token = lib().createUnsubscribeToken(user.id, category);
    const response = await post({ token, actie: "category" });
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") ?? "", /klaar=1/);
    const after = await settings(user.id);
    assert.equal(after[field], false, `${field} hoort uit`);
    assert.equal(after.emailNotificationsEnabled, true, "het e-mailkanaal blijft aan");
    assert.equal(after.pushNotificationsEnabled, true, "pushinstelling blijft hetzelfde");
    for (const other of FIELDS.filter((f) => f !== field)) assert.equal(after[other], before[other], `${other} is onaangeroerd`);
  }
});

test("alle e-mail uitschakelen wijzigt alleen emailNotificationsEnabled", { skip }, async () => {
  const user = await makeUser(`alles.${EMAIL_B}`, "Alles", "nl");
  await db.user.update({ where: { id: user.id }, data: { notifySocial: false, notifyWordGame: false } });
  const before = await settings(user.id);
  const response = await post({ token: lib().createUnsubscribeToken(user.id, "social"), actie: "all" });
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /actie=alles&klaar=1/);
  const after = await settings(user.id);
  assert.equal(after.emailNotificationsEnabled, false);
  assert.equal(after.pushNotificationsEnabled, true);
  for (const f of FIELDS) assert.equal(after[f], before[f], `${f} is onaangeroerd`);
});

test("idempotent: tweemaal uitschrijven geeft geen fout en dezelfde staat", { skip }, async () => {
  const user = await makeUser(`idem.${EMAIL_B}`, "Idem", "nl");
  const token = lib().createUnsubscribeToken(user.id, "wordGame");
  for (let i = 0; i < 2; i++) {
    assert.equal((await post({ token, actie: "category" })).status, 303);
    assert.equal((await settings(user.id)).notifyWordGame, false);
  }
  for (let i = 0; i < 2; i++) assert.equal((await post({ token, actie: "all" })).status, 303);
  assert.equal((await settings(user.id)).emailNotificationsEnabled, false);
  // de pagina toont dan de juiste "al uitgeschakeld"-status, geen foutpagina
  assert.match(await page(token), /Al uitgeschakeld/);
  assert.match(await page(token, { actie: "alles" }), /E-mailmeldingen staan al uit/);
});

test("beveiliging: gemanipuleerde, willekeurige en andermans tokens wijzigen niets", { skip }, async () => {
  const a = await makeUser(`beveilig.a.${EMAIL_B}`, "Anna", "nl");
  const b = await makeUser(`beveilig.b.${EMAIL_B}`, "Bram", "nl");
  const beforeA = await settings(a.id);
  const beforeB = await settings(b.id);
  const tokenA = lib().createUnsubscribeToken(a.id, "dailyText");
  const [version, , , signature] = tokenA.split(".");
  const attempts = [
    [version, b.id, "dailyText", signature].join("."), // token van A voor gebruiker B
    [version, a.id, "social", signature].join("."), // categorie in het token aangepast
    [version, a.id, "alles", signature].join("."),
    `${tokenA}x`,
    "willekeurig-token",
    "",
    "u1.x.y.z",
  ];
  for (const token of attempts) {
    for (const actie of ["category", "all"]) {
      const response = await post({ token, actie });
      assert.ok(response.status === 303 && !/klaar=1/.test(response.headers.get("location") ?? ""), "een ongeldig token mag nooit 'klaar' geven");
    }
    // ook als één-klik vanuit de mailclient: afgewezen
    assert.equal((await post({ "List-Unsubscribe": "One-Click" }, `?t=${encodeURIComponent(token)}`)).status, 400);
  }
  assert.deepEqual(await settings(a.id), beforeA);
  assert.deepEqual(await settings(b.id), beforeB);
  // een onbekende actie valt terug op de veilige, kleinste actie: alleen deze categorie
  assert.equal((await post({ token: tokenA, actie: "alles-en-meer" })).status, 303);
  const afterA = await settings(a.id);
  assert.equal(afterA.notifyDailyText, false);
  assert.equal(afterA.emailNotificationsEnabled, true);
  assert.deepEqual(await settings(b.id), beforeB, "token van A raakt B nooit");
});

test("één-klik (List-Unsubscribe-Post) en GET: één-klik wijzigt alleen de categorie, een GET nooit iets", { skip }, async () => {
  const user = await makeUser(`eenklik.${EMAIL_B}`, "Eenklik", "nl");
  const token = lib().createUnsubscribeToken(user.id, "achievements");
  const before = await settings(user.id);
  // GET (mailscanner, voorbeeldweergave): doorsturen naar de pagina, niets gewijzigd
  const get = await route().GET(new NextRequest(`https://versado.test/api/unsubscribe?t=${encodeURIComponent(token)}`));
  assert.equal(get.status, 303);
  assert.match(get.headers.get("location") ?? "", /^https:\/\/versado\.test\/uitschrijven\//);
  // en de pagina zelf wijzigt bij openen ook niets
  await page(token);
  await page(token, { actie: "alles" });
  await page(token, { klaar: "1" });
  assert.deepEqual(await settings(user.id), before, "GET wijzigt nooit instellingen");
  // één-klik: gewoon antwoord (geen doorverwijzing), alleen deze categorie
  const oneClick = await post({ "List-Unsubscribe": "One-Click" }, `?t=${encodeURIComponent(token)}`);
  assert.equal(oneClick.status, 200);
  const after = await settings(user.id);
  assert.equal(after.notifyAchievements, false);
  assert.equal(after.emailNotificationsEnabled, true);
});

test("pagina: gemaskeerd adres, de juiste tekst per situatie en geen volledig adres in HTML of foutpagina", { skip }, async () => {
  const user = await makeUser(EMAIL_B.replace("ander.account", "pagina.test"), "Pagina", "nl");
  const full = user.email;
  const local = full.split("@")[0];
  const token = lib().createUnsubscribeToken(user.id, "dailyText");
  const pages = {
    category: await page(token),
    all: await page(token, { actie: "alles" }),
    invalid: await page("onzin.token"),
    tampered: await page(`${token}x`),
    failed: await page(token, { fout: "1" }),
  };
  assert.match(pages.category, /E-mailmeldingen aanpassen/);
  assert.match(pages.category, /Uitschrijven voor dit soort meldingen/);
  assert.match(pages.category, /Alle e-mailmeldingen uitschakelen/);
  assert.match(pages.category, /p\*\*\*@v\*\*\*\.invalid/);
  assert.match(pages.all, /Pushmeldingen en meldingen in Versado blijven afhankelijk van je bestaande instellingen/);
  assert.match(pages.invalid, /Deze link werkt niet/);
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!html.includes(full) && !html.includes(local) && !html.includes(encodeURIComponent(full)), `${name}: het volledige adres staat in de pagina`);
  }
  // de ongeldige pagina verraadt niets over wat er niet klopt en bevat geen formulier
  assert.doesNotMatch(pages.invalid, /<form/);
  assert.doesNotMatch(pages.tampered, /<form/);
  // na uitschrijven: bevestiging op dezelfde pagina; een ?klaar=1 zonder dat het gebeurd is toont de vraag, geen bevestiging
  assert.doesNotMatch(await page(token, { klaar: "1" }), /Je bent uitgeschreven/);
  await post({ token, actie: "category" });
  const done = await page(token, { klaar: "1" });
  assert.match(done, /Je bent uitgeschreven/);
  assert.match(done, /Je andere notificatie-instellingen zijn niet gewijzigd/);
  await post({ token, actie: "all" });
  const doneAll = await page(token, { actie: "alles", klaar: "1" });
  assert.match(doneAll, /E-mailmeldingen uitgeschakeld/);
  assert.match(doneAll, /Je kunt e-mailmeldingen later weer inschakelen via je notificatie-instellingen/);
  assert.ok(!done.includes(full) && !doneAll.includes(full));
});

test("een verwijderd account geeft dezelfde neutrale pagina en geen fout", { skip }, async () => {
  const user = await makeUser(`weg.${EMAIL_B}`, "Weg", "nl");
  const token = lib().createUnsubscribeToken(user.id, "social");
  await db.user.delete({ where: { id: user.id } });
  assert.match(await page(token), /Deze link werkt niet/);
  assert.equal((await post({ token, actie: "category" })).status, 303);
});

test("de link naar de notificatie-instellingen staat er alleen voor wie is ingelogd; de flow zelf vraagt nooit om login", { skip }, async () => {
  const user = await makeUser(`login.${EMAIL_B}`, "Login", "nl");
  const token = lib().createUnsubscribeToken(user.id, "social");
  currentUser = null;
  const anonymous = await page(token);
  assert.doesNotMatch(anonymous, /view=notifications/);
  assert.match(anonymous, /<form[^>]*action="\/api\/unsubscribe"[^>]*method="post"|<form[^>]*method="post"[^>]*action="\/api\/unsubscribe"/, "ook zonder login kun je bevestigen");
  currentUser = { id: user.id };
  try {
    assert.match(await page(token), /\/profile\?view=notifications/);
  } finally {
    currentUser = null;
  }
});
