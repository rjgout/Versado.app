// Uitschrijven uit notificatiemails: token, maskering, mailinhoud en bronregels. Zonder
// database; het gedrag met de database (instellingen wijzigen, route, pagina) staat in
// tests/unsubscribe.integration.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { maskEmail } from "../src/lib/mailAddress";
import { NOTIFY_CATEGORIES, CATEGORY_FIELD, CATEGORY_LABEL_KEY, type NotifyCategory } from "../src/lib/notifyCategories";

process.env.SESSION_SECRET = "unit-test-secret-0123456789-abcdef";
const read = (file: string) => readFileSync(file, "utf8");

async function lib() {
  return import("../src/lib/unsubscribe");
}

test("maskering: herkenbaar maar nooit het volledige adres", () => {
  assert.equal(maskEmail("raphael@example.com"), "r***@e***.com");
  // zeer korte lokale naam of domeinlabel: helemaal verborgen (anders staat het bijna open)
  assert.equal(maskEmail("ab@x.nl"), "***@***.nl");
  assert.equal(maskEmail("a@b.co"), "***@***.co");
  assert.equal(maskEmail("abc@abc.nl"), "a***@a***.nl");
  // subdomeinen: elk label gemaskeerd (een kort label als `co` helemaal), alleen het laatste blijft staan
  assert.equal(maskEmail("jan.jansen@mail.uni.example.co.uk"), "j***@m***.u***.e***.***.uk");
  // ongebruikelijke maar geldige adressen
  assert.equal(maskEmail("first+tag@sub-domain.example.org"), "f***@s***.e***.org");
  assert.equal(maskEmail("üser@bücher.de"), "ü***@b***.de");
  assert.equal(maskEmail("a@localhost"), "***@l***");
  assert.equal(maskEmail("name@localhost"), "n***@l***");
  // ongeldig: nooit de oorspronkelijke tekst
  for (const bad of ["", "geen-adres", "@domein.nl", "naam@", "  "]) assert.equal(maskEmail(bad), "***");
  // het resultaat bevat nooit meer dan het eerste teken van een deel
  for (const email of ["raphael@example.com", "jan.jansen@mail.uni.example.co.uk"]) {
    const masked = maskEmail(email);
    assert.ok(!masked.includes(email) && !masked.includes(email.split("@")[0]) && !masked.includes("example"), masked);
  }
});

test("token: rondreis en strikte controle", async () => {
  const { createUnsubscribeToken, verifyUnsubscribeToken } = await lib();
  const token = createUnsubscribeToken("clx1abc2def3ghi4jkl5mno6p", "dailyText");
  assert.deepEqual(verifyUnsubscribeToken(token), { userId: "clx1abc2def3ghi4jkl5mno6p", category: "dailyText" });
  for (const category of NOTIFY_CATEGORIES) assert.equal(verifyUnsubscribeToken(createUnsubscribeToken("clx1abc2def3ghi4jkl5mno6p", category))?.category, category);
  // elke gebruiker en categorie geeft een ander token, en hetzelfde token blijft stabiel (links blijven jaren werken)
  assert.notEqual(token, createUnsubscribeToken("clx1abc2def3ghi4jkl5mno6q", "dailyText"));
  assert.notEqual(token, createUnsubscribeToken("clx1abc2def3ghi4jkl5mno6p", "social"));
  assert.equal(token, createUnsubscribeToken("clx1abc2def3ghi4jkl5mno6p", "dailyText"));
  // het token bevat geen e-mailadres of andere gegevens dan id en categorie
  assert.match(token, /^u1\.clx1abc2def3ghi4jkl5mno6p\.dailyText\.[A-Za-z0-9_-]{43}$/);
});

test("token: gemanipuleerde en willekeurige tokens werken niet", async () => {
  const { createUnsubscribeToken, verifyUnsubscribeToken } = await lib();
  const a = "clxaaaaaaaaaaaaaaaaaaaaaa";
  const b = "clxbbbbbbbbbbbbbbbbbbbbbb";
  const token = createUnsubscribeToken(a, "dailyText");
  const [v, , , signature] = token.split(".");
  // token van A kan B niet wijzigen: gebruiker vervangen met dezelfde handtekening
  assert.equal(verifyUnsubscribeToken([v, b, "dailyText", signature].join(".")), null);
  // categorie aanpassen in de URL (ook naar een bestaande) werkt niet
  assert.equal(verifyUnsubscribeToken([v, a, "social", signature].join(".")), null);
  assert.equal(verifyUnsubscribeToken([v, a, "alles", signature].join(".")), null);
  // aangepaste, afgekapte, uitgebreide of lege handtekening
  assert.equal(verifyUnsubscribeToken([v, a, "dailyText", signature.slice(0, -1)].join(".")), null);
  assert.equal(verifyUnsubscribeToken([v, a, "dailyText", `${signature}x`].join(".")), null);
  assert.equal(verifyUnsubscribeToken([v, a, "dailyText", ""].join(".")), null);
  assert.equal(verifyUnsubscribeToken([v, a, "dailyText", signature.replace(/^./, signature[0] === "A" ? "B" : "A")].join(".")), null);
  // een oude of onbekende versie
  assert.equal(verifyUnsubscribeToken(["u0", a, "dailyText", signature].join(".")), null);
  // willekeurige invoer, verkeerde types, extreem lang
  for (const junk of ["", "x", "abc.def", "u1.a.b.c", "u1....", "../../etc/passwd", "u1.<script>.dailyText.x", null, undefined, 42, {}, [], "a".repeat(5000)]) {
    assert.equal(verifyUnsubscribeToken(junk), null, String(junk).slice(0, 30));
  }
  // een token met een ander geheim (bv. een andere installatie) is niet geldig
  const other = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "een-heel-ander-geheim-0123456789";
  assert.equal(verifyUnsubscribeToken(token), null);
  process.env.SESSION_SECRET = other;
  assert.notEqual(verifyUnsubscribeToken(token), null);
});

test("token: zonder geldig geheim faalt het veilig, nooit met een uitzondering of een geldig token", async () => {
  const { createUnsubscribeToken, verifyUnsubscribeToken } = await lib();
  const token = createUnsubscribeToken("clxaaaaaaaaaaaaaaaaaaaaaa", "social");
  const secret = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.equal(verifyUnsubscribeToken(token), null);
  process.env.SESSION_SECRET = secret;
});

test("elke categorie wijst naar een bestaand notify*-veld en een bestaande vertaling", () => {
  const schema = read("prisma/schema.prisma");
  const nl = read("src/lib/i18n/messages/nl.ts");
  assert.equal(NOTIFY_CATEGORIES.length, 7);
  for (const category of NOTIFY_CATEGORIES) {
    assert.match(schema, new RegExp(`\\b${CATEGORY_FIELD[category]}\\s+Boolean`), `${category}: veld ontbreekt in het schema`);
    assert.ok(CATEGORY_LABEL_KEY[category], category);
    const [group, key] = CATEGORY_LABEL_KEY[category].split(".");
    assert.match(nl, new RegExp(`${group}: \\{[\\s\\S]*?\\b${key}:`), `${category}: ${CATEGORY_LABEL_KEY[category]} ontbreekt`);
  }
  // de mapping die de dispatcher gebruikt is dezelfde als die van uitschrijven
  assert.match(read("src/lib/notify.ts"), /from "@\/lib\/notifyCategories"/);
  assert.match(read("src/lib/unsubscribeActions.ts"), /CATEGORY_FIELD/);
});

test("e-mailinhoud: HTML en platte tekst bevatten beide opties, subtiel en vertaald", async () => {
  const { emailWrap, emailTextFooter, unsubscribeHeaders } = await import("../src/lib/notify");
  const { createUnsubscribeToken, unsubscribePageUrl, unsubscribeOneClickUrl } = await lib();
  const { getT } = await import("../src/lib/i18n");
  const token = createUnsubscribeToken("clxaaaaaaaaaaaaaaaaaaaaaa", "social");
  const links = { category: unsubscribePageUrl("https://versado.test", token), all: unsubscribePageUrl("https://versado.test", token, "all"), oneClick: unsubscribeOneClickUrl("https://versado.test", token) };
  for (const language of ["nl", "en", "de", "fr", "es"] as const) {
    const t = getT(language);
    const html = emailWrap(t, "Tekst", "https://versado.test/friends", "Bekijk", links);
    const text = emailTextFooter(t, links);
    for (const label of [t("notify.unsubscribeCategory"), t("notify.unsubscribeAll")]) {
      assert.ok(html.includes(label), `${language}: HTML mist "${label}"`);
      assert.ok(text.includes(label), `${language}: platte tekst mist "${label}"`);
    }
    assert.ok(html.includes(`href="${links.category}"`) && html.includes(`href="${links.all}"`));
    assert.ok(text.includes(links.category) && text.includes(links.all));
  }
  const html = emailWrap(getT("nl"), "Tekst", "https://versado.test/friends", "Bekijk", links);
  // de eigen knop van de melding blijft de prominente actie; de uitschrijfopties zijn gedempte voettekst
  assert.match(html, /<p><a href="https:\/\/versado\.test\/friends">Bekijk →<\/a><\/p>/);
  assert.match(html, /<p style="color:#94a3b8;font-size:12px">[^]*Uitschrijven voor dit soort meldingen<\/a> · <a [^>]*>Alle e-mailmeldingen uitschakelen/);
  assert.doesNotMatch(html, /<button|class="btn/);
  // de één-klik-header (RFC 8058) wijst naar de POST-route, nooit naar de pagina
  const headers = unsubscribeHeaders(links.oneClick);
  assert.equal(headers["List-Unsubscribe"], `<${links.oneClick}>`);
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(links.oneClick, /\/api\/unsubscribe\?t=/);
});

test("de dispatcher voegt de footer centraal toe, met de categorie van de melding in het token", () => {
  const source = read("src/lib/notify.ts");
  assert.match(source, /createUnsubscribeToken\(input\.userId, input\.category\)/);
  assert.match(source, /headers: unsubscribeHeaders\(unsubscribe\.oneClick\)/);
  // geen enkele notifyX() bouwt zijn eigen uitschrijf-HTML
  const body = source.slice(source.indexOf("export async function notifyFreezeReceived"));
  assert.doesNotMatch(body, /uitschrijven|unsubscribe/i);
  // alleen de e-mailtak krijgt de footer: pushOnly-meldingen sturen geen mail
  assert.match(source, /user\.emailNotificationsEnabled && !input\.pushOnly/);
});

test("transactionele en beheerdersmail krijgen bewust geen uitschrijffooter", () => {
  const files = [
    "src/lib/registration.ts",
    "src/app/api/auth/forgot-password/route.ts",
    "src/app/api/auth/verify-email/resend/route.ts",
    "src/app/api/auth/register/route.ts",
    "src/app/api/admin/users/[userId]/reset-password/route.ts",
    "src/lib/feedback.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /sendMail/, `${file} stuurt geen mail meer?`);
    assert.doesNotMatch(source, /unsubscribe|uitschrijven|List-Unsubscribe|emailWrap/i, `${file}: uitschrijfopties horen hier niet`);
  }
  // alleen notify.ts (de centrale dispatcher) gebruikt de uitschrijflaag
  for (const file of ["src/lib/email.ts"]) assert.doesNotMatch(read(file), /createUnsubscribeToken/);
});

test("pagina en route: noindex, geen referrer, alleen POST wijzigt, geen logging van token of adres", () => {
  const page = read("src/app/uitschrijven/[token]/page.tsx");
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /referrer: "no-referrer"/);
  assert.match(page, /method="post" action="\/api\/unsubscribe"/);
  assert.match(page, /maskEmail\(state\.email\)/);
  // elke verwijzing naar het adres loopt via de maskering; het ruwe adres komt nergens in de uitvoer
  assert.equal((page.match(/state\.email\b/g) ?? []).length, (page.match(/maskEmail\(state\.email\)/g) ?? []).length, "ruw adres buiten maskEmail");
  assert.doesNotMatch(page, /applyUnsubscribe/, "de pagina (GET) wijzigt nooit iets");
  const route = read("src/app/api/unsubscribe/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(get, /applyUnsubscribe/, "GET wijzigt nooit iets");
  for (const file of [route, page, read("src/lib/unsubscribe.ts"), read("src/lib/unsubscribeActions.ts")]) assert.doesNotMatch(file, /console\.(log|error|warn|info)/);
});

test("de uitschrijfteksten bestaan in alle vijf de talen", () => {
  const keys = ["title", "invalidTitle", "invalidText", "categoryText", "categoryNote", "categoryButton", "allButton", "allTitle", "allText", "orAll", "backToCategory", "doneCategoryTitle", "doneCategoryText", "doneAllTitle", "doneAllText", "alreadyCategoryTitle", "alreadyCategoryText", "alreadyAllTitle", "alreadyAllText", "settingsLink", "failed"];
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const source = read(`src/lib/i18n/messages/${lang}.ts`);
    const group = source.slice(source.search(/"?unsubscribe"?: \{/));
    const end = group.indexOf("\n  },");
    const body = group.slice(0, end);
    for (const key of keys) assert.match(body, new RegExp(`"?${key}"?: "`), `${lang}: unsubscribe.${key} ontbreekt`);
    assert.match(source, /"?unsubscribeCategory"?: "/);
    assert.match(source, /"?unsubscribeAll"?: "/);
  }
});

// Compileerbare typecontrole dat NotifyCategory de bron blijft.
const _category: NotifyCategory = "social";
void _category;
