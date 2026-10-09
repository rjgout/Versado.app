// Versado Kompas (src/lib/kompas/, docs/KOMPAS.md): register, uitlegkeuze met
// fallback en schriftbron, taal, versies en gebruikersstatus, rondleidingen
// (ook met ontbrekende doelen), plaatsing op kleine schermen en de regressies
// rond navigatie, onboarding en voortgang. Puur; draait zonder database.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { GAME_CATALOG } from "../src/lib/gameCatalog";
import { LANGUAGES } from "../src/lib/languages";
import { getT } from "../src/lib/i18n";
import type { MessageKey, TFunction } from "../src/lib/i18n/core";
import { kompasNl } from "../src/lib/i18n/messages/kompas/nl";
import { kompasEn } from "../src/lib/i18n/messages/kompas/en";
import { kompasDe } from "../src/lib/i18n/messages/kompas/de";
import { kompasFr } from "../src/lib/i18n/messages/kompas/fr";
import { kompasEs } from "../src/lib/i18n/messages/kompas/es";
import { KOMPAS_ROOT, KOMPAS_TOPICS, childrenOf, getTopic, isTopicVisible, keySegment, kompasHref, topicChain, topicForPath, visibleChildren, type KompasContext } from "../src/lib/kompas/registry";
import { generalEntry, resolveExplanation, resolveWorkIntro } from "../src/lib/kompas/resolve";
import { findRow, isValidScope, mergeStatus, seenGeneral, shouldOffer, type KompasRow } from "../src/lib/kompas/state";
import { KOMPAS_TOURS, getTour, nextTourIndex, planTour, tourStepKeys } from "../src/lib/kompas/tours";
import { TOUR_GUTTER, computeTourLayout, scrollDeltaFor, visibleArea, type Insets, type Rect, type Viewport } from "../src/lib/kompas/tourLayout";
import { guideMascotState } from "../src/lib/kompas/mascot";
import { PERSONAL_MASCOTS, mascotStates } from "../src/lib/mascots";
import { classifyContentRoute, workOf } from "../src/lib/contentRouting";
import { PRIMARY_NAV, activeDestination } from "../src/lib/navigation";
import { isActivityRoute, shellModeForRoute } from "../src/lib/focusMode";
import { isRecordInput } from "../src/lib/kompas/store";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const nl = getT("nl");

/** Een t-functie met een vaste woordenlijst: ontbrekende sleutels geven de sleutel zelf, zoals de echte. */
function fakeT(dictionary: Record<string, string>): TFunction {
  return (key: MessageKey) => dictionary[key] ?? key;
}

function walk(dir: string, filter: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file, filter) : filter(file) ? [file] : [];
  });
}

function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key));
}

// --- Register ---------------------------------------------------------------

test("elk onderdeel heeft een bestaande ouder en een unieke id; de wortel is de algemene Versado-uitleg", () => {
  const ids = KOMPAS_TOPICS.map((topic) => topic.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const topic of KOMPAS_TOPICS) {
    if (topic.id === KOMPAS_ROOT) assert.equal(topic.parent, null);
    else assert.ok(topic.parent && getTopic(topic.parent), `${topic.id} heeft een onbekende ouder`);
    // Elke keten eindigt bij de wortel: zo bestaat er altijd een laatste terugval.
    assert.equal(topicChain(topic.id).at(-1)?.id, KOMPAS_ROOT, topic.id);
    assert.ok(Number.isInteger(topic.version) && topic.version >= 1);
  }
});

test("elk spel uit de catalogus is vanzelf een onderdeel onder Spelen, zonder aparte registratie", () => {
  for (const game of GAME_CATALOG) {
    const topic = getTopic(`play.${game.id}`);
    assert.ok(topic, game.id);
    assert.equal(topic.parent, "play");
    assert.equal(topic.href, game.href);
  }
  assert.equal(childrenOf("play").filter((topic) => topic.game).length, GAME_CATALOG.length);
});

test("de twee hoofdactiviteiten staan voorop, de ondersteunende onderwerpen eronder", () => {
  const main = KOMPAS_TOPICS.filter((topic) => topic.group === "main").map((topic) => topic.id);
  assert.deepEqual(main, ["learn", "play"]);
  const support = KOMPAS_TOPICS.filter((topic) => topic.group === "support").map((topic) => topic.id);
  assert.deepEqual(support, ["together", "progress", "profile", "start"]);
});

test("rondleidingen verwijzen naar bestaande onderdelen en elk onderdeel met een rondleiding naar een bestaande", () => {
  for (const tour of KOMPAS_TOURS) assert.ok(getTopic(tour.topicId), tour.id);
  for (const topic of KOMPAS_TOPICS) if (topic.tour) assert.ok(getTour(topic.tour), `${topic.id}: ${topic.tour}`);
  assert.equal(getTour("bestaat-niet"), undefined);
  assert.equal(getTour(null), undefined);
});

test("zichtbaarheid volgt de echte gegevens: de contentkiezer en de spellen van de actieve content", () => {
  const context: KompasContext = { work: "bofm", switcherEnabled: false, visibleGameIds: ["word-game"] };
  assert.equal(isTopicVisible(getTopic("switcher")!, context), false);
  assert.equal(isTopicVisible(getTopic("switcher")!, { ...context, switcherEnabled: true }), true);
  assert.deepEqual(visibleChildren("play", context).map((topic) => topic.id), ["play.word-game"]);
  assert.deepEqual(visibleChildren("play", { ...context, visibleGameIds: [] }), []);
});

test("een uitnodiging hoort alleen bij een overzichtspagina in de gewone shell, nooit bij een activiteit", () => {
  assert.equal(topicForPath("/courses")?.id, "learn");
  assert.equal(topicForPath("/live/")?.id, "play");
  assert.equal(topicForPath("/word-search")?.id, "play.word-search");
  assert.equal(topicForPath("/word-search/abc"), null);
  assert.equal(topicForPath("/lesson/123"), null);
  assert.equal(topicForPath("/profile"), null);
  // Alleen een spel kan een landingspagina in een focusshell hebben (bv. /word-game); daar biedt de
  // uitnodiging nooit iets aan (ContextOffer controleert de shell), en elke andere pagina is gewoon.
  for (const topic of KOMPAS_TOPICS) {
    for (const route of topic.routes ?? []) {
      if (shellModeForRoute(route) !== "normal") assert.ok(topic.game, `${topic.id}: ${route} is een focusroute`);
      if (!topic.game) assert.equal(isActivityRoute(route), false, route);
    }
  }
  assert.equal(shellModeForRoute("/word-game"), "focus");
  // Een pad hoort bij hoogstens één onderdeel.
  const paths = KOMPAS_TOPICS.flatMap((topic) => topic.routes ?? []);
  assert.equal(new Set(paths).size, paths.length);
});

test("sleutelsegmenten en adressen", () => {
  assert.equal(keySegment("play.word-search"), "playWordSearch");
  assert.equal(keySegment("dc-testament"), "dcTestament");
  assert.equal(keySegment("learn"), "learn");
  assert.equal(kompasHref(), "/kompas");
  assert.equal(kompasHref(KOMPAS_ROOT), "/kompas");
  assert.equal(kompasHref("play.mystery"), "/kompas/play.mystery");
});

// --- Teksten en vertalingen ---------------------------------------------------

test("elk onderdeel heeft in het Nederlands een titel en een omschrijving (spellen via gamesHub)", () => {
  for (const topic of KOMPAS_TOPICS) {
    const resolved = resolveExplanation(nl, topic.id);
    assert.ok(resolved.title && resolved.title !== topic.id, `${topic.id}: titel`);
    assert.ok(resolved.entry.what, `${topic.id}: wat is het`);
    assert.equal(resolved.level, topic.id === KOMPAS_ROOT ? "versado" : "activity", topic.id);
  }
});

test("vertalingen: elke Kompas-tekst bestaat in alle talen die als app-taal klaar zijn", () => {
  const sources = flatten(kompasNl);
  const bundles = { en: kompasEn, de: kompasDe, fr: kompasFr, es: kompasEs } as const;
  for (const language of LANGUAGES.filter((item) => item.uiReady && item.code !== "nl")) {
    const bundle = bundles[language.code as keyof typeof bundles];
    assert.ok(bundle, `${language.code} mist een Kompas-bestand`);
    const present = new Set(flatten(bundle));
    const missing = sources.filter((key) => !present.has(key));
    assert.deepEqual(missing, [], `${language.code} mist: ${missing.slice(0, 5).join(", ")}`);
    const unknown = [...present].filter((key) => !new Set(sources).has(key));
    assert.deepEqual(unknown, [], `${language.code} kent sleutels die het Nederlands niet heeft`);
  }
});

test("vertalingen: tijdelijke plaatshouders blijven behouden en teksten zijn niet leeg", () => {
  const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");
  const get = (tree: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree) as string;
  for (const [code, bundle] of Object.entries({ en: kompasEn, de: kompasDe, fr: kompasFr, es: kompasEs })) {
    for (const key of flatten(kompasNl)) {
      const text = get(bundle, key);
      assert.ok(text.trim().length > 0, `${code}.${key} is leeg`);
      assert.equal(placeholders(text), placeholders(get(kompasNl, key)), `${code}.${key}: plaatshouders`);
    }
  }
});

test("elke tekstsleutel die de Kompas-componenten letterlijk gebruiken bestaat", () => {
  const files = [...walk("src/components/kompas", (f) => f.endsWith(".tsx")), ...walk("src/app/kompas", (f) => f.endsWith(".tsx"))];
  files.push("src/components/OnboardingClient.tsx", "src/components/ProfileClient.tsx", "src/components/LiveLobbyForm.tsx", "src/components/SubpageBackBar.tsx");
  const known = new Set(flatten(kompasNl).map((key) => `kompas.${key}`));
  for (const file of files) {
    const source = file.startsWith("src") && !file.startsWith(root) ? read(file) : readFileSync(file, "utf8");
    for (const [, key] of source.matchAll(/\bt\(\s*"(kompas\.[\w.]+)"/g)) {
      assert.ok(known.has(key), `${file}: ${key} ontbreekt`);
    }
  }
});

test("de teksten van rondleidingen bestaan voor elke stap, in elke taal", () => {
  const bundles = [kompasNl, kompasEn, kompasDe, kompasFr, kompasEs];
  for (const tour of KOMPAS_TOURS) {
    for (const step of tour.steps) {
      const keys = tourStepKeys(tour, step);
      for (const key of [keys.title, keys.text]) {
        const relative = key.replace(/^kompas\./, "");
        for (const bundle of bundles) assert.ok(flatten(bundle).includes(relative), `${key} ontbreekt`);
      }
    }
  }
});

test("Boek van Mormon staat alleen in uitleg die over dat schriftwerk gaat, niet in de algemene uitleg", () => {
  const general = flatten(kompasNl.topics).map((key) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], kompasNl.topics) as string);
  for (const text of general) assert.ok(!/boek van mormon|bom\b/i.test(text), text);
  const work = JSON.stringify(kompasNl.work.bofm);
  assert.ok(/Boek van Mormon/.test(work));
});

// --- Uitlegkeuze: fallback en schriftbron ---------------------------------------

test("schriftbron-uitleg gaat voor de algemene uitleg van hetzelfde onderdeel", () => {
  const bom = resolveExplanation(nl, "learn", { work: "bofm" });
  assert.equal(bom.level, "specific");
  assert.equal(bom.scope, "bofm");
  assert.match(bom.entry.what!, /Boek van Mormon/);
  const dc = resolveExplanation(nl, "learn", { work: "dc-testament" });
  assert.equal(dc.scope, "dc-testament");
  assert.match(dc.entry.what!, /afdeling/);
  // Wat de schriftbron niet zelf zegt, komt uit de algemene uitleg van het onderdeel.
  assert.equal(bom.entry.benefit, generalEntry(nl, getTopic("learn")!).benefit);
  assert.deepEqual(bom.entry.steps, generalEntry(nl, getTopic("learn")!).steps);
});

test("een schriftbron zonder eigen uitleg krijgt de algemene uitleg, ook een toekomstige", () => {
  for (const work of [null, undefined, "", "podcasts", "een-nieuwe-bron"]) {
    const resolved = resolveExplanation(nl, "learn", { work });
    assert.equal(resolved.level, "activity");
    assert.equal(resolved.scope, "");
    assert.equal(resolved.entry.what, generalEntry(nl, getTopic("learn")!).what);
  }
});

test("de fallbackvolgorde: activiteit + bron, activiteit, onderdeel, Versado", () => {
  const dictionary = {
    "kompas.topics.progressXp.title": "XP",
    "kompas.topics.progress.what": "Onderdeel",
    "kompas.topics.versado.what": "Versado",
    "kompas.topics.progressXp.what": "Activiteit",
    "kompas.work.bofm.topics.progressXp.what": "Activiteit voor bron",
  };
  assert.deepEqual(pick(resolveExplanation(fakeT(dictionary), "progress.xp", { work: "bofm" })), ["specific", "bofm", "Activiteit voor bron"]);
  assert.deepEqual(pick(resolveExplanation(fakeT(dictionary), "progress.xp", { work: "dc-testament" })), ["activity", "", "Activiteit"]);
  const withoutActivity = { ...dictionary };
  delete (withoutActivity as Record<string, string>)["kompas.topics.progressXp.what"];
  delete (withoutActivity as Record<string, string>)["kompas.work.bofm.topics.progressXp.what"];
  assert.deepEqual(pick(resolveExplanation(fakeT(withoutActivity), "progress.xp", { work: "bofm" })), ["section", "", "Onderdeel"]);
  const onlyRoot = { "kompas.topics.progressXp.title": "XP", "kompas.topics.versado.what": "Versado" };
  assert.deepEqual(pick(resolveExplanation(fakeT(onlyRoot), "progress.xp", { work: "bofm" })), ["versado", "", "Versado"]);
  // Een onbekend onderdeel valt terug op de algemene Versado-uitleg.
  assert.equal(resolveExplanation(fakeT(onlyRoot), "bestaat-niet").entry.what, "Versado");
});

function pick(resolved: ReturnType<typeof resolveExplanation>) {
  return [resolved.level, resolved.scope, resolved.entry.what];
}

test("een uitleg voor een schriftbron hoeft niet compleet te zijn: ontbrekende delen komen uit de algemene uitleg", () => {
  const dictionary = {
    "kompas.topics.learn.title": "Leren",
    "kompas.topics.learn.what": "algemeen wat",
    "kompas.topics.learn.benefit": "algemeen nut",
    "kompas.topics.learn.step1": "algemene stap",
    "kompas.work.pgp.topics.learn.what": "bron wat",
    "kompas.work.pgp.topics.learn.step1": "bron stap 1",
    "kompas.work.pgp.topics.learn.step2": "bron stap 2",
  };
  const resolved = resolveExplanation(fakeT(dictionary), "learn", { work: "pgp" });
  assert.equal(resolved.entry.what, "bron wat");
  assert.equal(resolved.entry.benefit, "algemeen nut");
  assert.deepEqual(resolved.entry.steps, ["bron stap 1", "bron stap 2"]);
});

test("spellen gebruiken de bestaande speluitleg en tonen de persoonlijke spelnaam", () => {
  const word = resolveExplanation(nl, "play.word-search");
  assert.equal(word.entry.what, nl("gamesHub.wordSearch.description"));
  assert.deepEqual(word.entry.steps, [nl("gamesHub.wordSearch.rule1"), nl("gamesHub.wordSearch.rule2"), nl("gamesHub.wordSearch.rule3")]);
  assert.equal(resolveExplanation(nl, "play.quick-missionary", { character: "varo" }).title, "Vliegende Varo");
  assert.notEqual(resolveExplanation(nl, "play.quick-missionary", { character: "vera" }).title, resolveExplanation(nl, "play.quick-missionary", { character: "varo" }).title);
  // Een eigen aanvulling (Het Mysterie) vult de speluitleg aan zonder die te vervangen.
  const mystery = resolveExplanation(nl, "play.mystery");
  assert.equal(mystery.entry.what, nl("gamesHub.mystery.description"));
  assert.ok(mystery.entry.benefit);
});

test("uitleg is in de taal van de interface; de schriftbron is een aparte keuze", () => {
  const dutch = resolveExplanation(getT("nl"), "learn", { work: "bofm" });
  const german = resolveExplanation(getT("de"), "learn", { work: "bofm" });
  const english = resolveExplanation(getT("en"), "learn", { work: "bofm" });
  assert.notEqual(dutch.entry.what, german.entry.what);
  assert.match(german.entry.what!, /Buch Mormon/);
  assert.match(english.entry.what!, /Book of Mormon/);
  // Dezelfde schriftbron, andere taal: dezelfde sleutel voor de gebruikersstatus.
  assert.equal(dutch.scope, german.scope);
  assert.equal(workOf({ id: "content_bom", work: "bofm" }), workOf({ id: "content_bom_en", work: "bofm" }));
  // Een taal zonder eigen tekst valt terug via fallbackChain, nooit op een kale sleutel.
  const missing = resolveExplanation(getT("es"), "progress.xp");
  assert.ok(missing.entry.what && !missing.entry.what.startsWith("kompas."));
});

test("een introductie en inhoudsbeschrijving per schriftbron, of niets", () => {
  assert.match(resolveWorkIntro(nl, "bofm").intro ?? "", /Boek van Mormon/);
  assert.match(resolveWorkIntro(nl, "dc-testament").contents ?? "", /afdeling/);
  assert.deepEqual(resolveWorkIntro(nl, "een-nieuwe-bron"), { intro: undefined, contents: undefined });
  assert.deepEqual(resolveWorkIntro(nl, null), {});
});

test("de uitleg van de contentkiezer beantwoordt de vragen uit de opdracht", () => {
  const switcher = resolveExplanation(nl, "switcher");
  const questions = switcher.entry.faq.map((item) => item.q).join(" ");
  assert.match(questions, /verandert/i);
  assert.match(questions, /blijft/i);
  assert.match(questions, /taal/i);
  assert.match(questions, /niet beschikbaar/i);
  assert.ok(switcher.entry.what && switcher.entry.benefit && switcher.entry.steps.length >= 3);
});

// --- Status, versies en uitnodigingen -------------------------------------------

const row = (over: Partial<KompasRow> = {}): KompasRow => ({ topicId: "learn", scope: "", kind: "GUIDE", status: "VIEWED", version: 1, ...over });
const offer = (over: Partial<Parameters<typeof shouldOffer>[0]> = {}) =>
  shouldOffer({ rows: [], topicId: "learn", scope: "", version: 1, enabled: true, offeredThisSession: false, ...over });

test("een nieuwe uitleg wordt aangeboden; bekeken, overgeslagen of afgewezen niet nogmaals", () => {
  assert.equal(offer(), true);
  for (const status of ["VIEWED", "SKIPPED", "COMPLETED"] as const) assert.equal(offer({ rows: [row({ status })] }), false, status);
});

test("een wezenlijk gewijzigde uitleg (hogere versie) wordt wel opnieuw aangeboden", () => {
  assert.equal(offer({ rows: [row({ status: "SKIPPED", version: 1 })], version: 2 }), true);
  assert.equal(offer({ rows: [row({ version: 2 })], version: 2 }), false);
});

test("hoogstens één uitnodiging per sessie en nooit zonder toestemming", () => {
  assert.equal(offer({ offeredThisSession: true }), false);
  assert.equal(offer({ enabled: false }), false);
});

test("wisselen tussen schriftbronnen activeert dezelfde uitleg niet steeds opnieuw", () => {
  // Zonder eigen uitleg voor de bron is de scope altijd "": één keer gezien is voldoende, in elke bron.
  const rows = [row()];
  for (const work of ["bofm", "dc-testament", "pgp", "nieuw"]) {
    const scope = resolveExplanation(fakeT({ "kompas.topics.learn.what": "x", "kompas.topics.learn.title": "L" }), "learn", { work }).scope;
    assert.equal(scope, "");
    assert.equal(offer({ rows, scope }), false);
  }
  // Heeft een bron eigen uitleg, dan mag die één keer worden aangeboden, en daarna niet meer.
  assert.equal(offer({ rows, scope: "dc-testament" }), true);
  assert.equal(offer({ rows: [...rows, row({ scope: "dc-testament", status: "SKIPPED" })], scope: "dc-testament" }), false);
  // Een rondleiding is een eigen soort en bepaalt de uitnodiging niet.
  assert.equal(offer({ rows: [row({ kind: "TOUR" })] }), true);
});

test("status samenvoegen: de nieuwste versie wint, afgerond blijft afgerond, anders telt de laatste handeling", () => {
  assert.deepEqual(mergeStatus(undefined, { status: "VIEWED", version: 1 }), { status: "VIEWED", version: 1 });
  assert.deepEqual(mergeStatus({ status: "COMPLETED", version: 1 }, { status: "VIEWED", version: 1 }), { status: "COMPLETED", version: 1 });
  assert.deepEqual(mergeStatus({ status: "SKIPPED", version: 1 }, { status: "VIEWED", version: 1 }), { status: "VIEWED", version: 1 });
  assert.deepEqual(mergeStatus({ status: "VIEWED", version: 1 }, { status: "SKIPPED", version: 1 }), { status: "SKIPPED", version: 1 });
  assert.deepEqual(mergeStatus({ status: "COMPLETED", version: 1 }, { status: "VIEWED", version: 2 }), { status: "VIEWED", version: 2 });
  assert.deepEqual(mergeStatus({ status: "VIEWED", version: 3 }, { status: "VIEWED", version: 2 }), { status: "VIEWED", version: 3 });
});

test("rijen zoeken, scopes valideren en de algemene uitleg herkennen", () => {
  const rows = [row(), row({ scope: "pgp", status: "SKIPPED" })];
  assert.equal(findRow(rows, { topicId: "learn", scope: "pgp", kind: "GUIDE" })?.status, "SKIPPED");
  assert.equal(findRow(rows, { topicId: "learn", scope: "dc", kind: "GUIDE" }), undefined);
  assert.equal(seenGeneral(rows, "learn", 1), true);
  assert.equal(seenGeneral(rows, "learn", 2), false);
  for (const ok of ["", "bofm", "dc-testament"]) assert.equal(isValidScope(ok), true, ok);
  for (const bad of ["../x", "BOFM", " ", "a".repeat(41), 5, null]) assert.equal(isValidScope(bad), false, String(bad));
});

test("de server accepteert alleen bekende onderdelen, soorten en statussen", () => {
  assert.equal(isRecordInput({ topicId: "learn", scope: "", kind: "GUIDE", status: "VIEWED" }), true);
  assert.equal(isRecordInput({ topicId: "play.word-search", scope: "bofm", kind: "TOUR", status: "COMPLETED" }), true);
  for (const bad of [
    null,
    {},
    { topicId: "bestaat-niet", scope: "", kind: "GUIDE", status: "VIEWED" },
    { topicId: "learn", scope: "BAD SCOPE", kind: "GUIDE", status: "VIEWED" },
    { topicId: "learn", scope: "", kind: "XP", status: "VIEWED" },
    { topicId: "learn", scope: "", kind: "GUIDE", status: "DONE" },
    // De versie bepaalt de server; een meegestuurde waarde telt niet en hoeft dus niet te kunnen.
  ]) {
    assert.equal(isRecordInput(bad), false, JSON.stringify(bad));
  }
});

// --- Rondleidingen -----------------------------------------------------------------

test("een rondleiding slaat ontbrekende doelen over en stopt als er niets overblijft", () => {
  const tour = getTour("start")!;
  const present = new Set(["kompas-entry", "nav-learn", "nav-play", "profile"]);
  const plan = planTour(tour, (target) => present.has(target));
  assert.deepEqual(plan.map((step) => step.id), ["entry", "learn", "play", "profile"]);
  assert.deepEqual(planTour(tour, () => false), []);
  // De contentkiezer ontbreekt (uitgezet): de rest van de rondleiding blijft werken.
  assert.ok(!plan.some((step) => step.target === "content-switcher"));
});

test("doorlopen vooruit en terug slaat doelen over die ondertussen verdwenen zijn", () => {
  const plan = getTour("start")!.steps;
  const gone = new Set(["nav-learn"]);
  const exists = (target: string) => !gone.has(target);
  const entry = plan.findIndex((step) => step.target === "kompas-entry");
  const switcher = plan.findIndex((step) => step.target === "content-switcher");
  const play = plan.findIndex((step) => step.target === "nav-play");
  assert.equal(nextTourIndex(plan, switcher, 1, exists), play);
  assert.equal(nextTourIndex(plan, play, -1, exists), switcher);
  assert.equal(nextTourIndex(plan, entry, -1, exists), null);
  assert.equal(nextTourIndex(plan, plan.length - 1, 1, exists), null);
  assert.equal(nextTourIndex(plan, 0, 1, () => false), null);
});

test("elk doel van een rondleiding staat echt als data-kompas-target in de interface", () => {
  const sources = walk("src", (file) => /\.(tsx|ts)$/.test(file)).map((file) => readFileSync(file, "utf8")).join("\n");
  for (const tour of KOMPAS_TOURS) {
    for (const step of tour.steps) {
      const nav = /^nav-(.+)$/.exec(step.target);
      if (nav) {
        assert.ok(PRIMARY_NAV.some((item) => item.id === nav[1]), `${step.target}: geen navigatie-item`);
        assert.ok(sources.includes("data-kompas-target={`nav-${item.id}`}"), "de navigatie markeert zijn items niet meer");
      } else {
        assert.ok(sources.includes(`data-kompas-target="${step.target}"`), `${step.target} staat nergens in de interface`);
      }
    }
  }
});

test("een rondleiding hoort bij een gewone pagina", () => {
  for (const tour of KOMPAS_TOURS) {
    if (tour.route) assert.equal(shellModeForRoute(tour.route), "normal", tour.id);
    // De route van een rondleiding is ook de pagina van het onderdeel zelf, waar de gebruiker hem start.
    const topic = getTopic(tour.topicId)!;
    if (tour.route && topic.href) assert.equal(topic.href === tour.route || tour.route === "/dashboard", true, tour.id);
  }
});

// --- Plaatsing op kleine en grote schermen -------------------------------------

const PHONE: Viewport = { width: 360, height: 640 };
const PHONE_INSETS: Insets = { top: 118, bottom: 72 };
const DESKTOP: Viewport = { width: 1280, height: 800 };
const DESKTOP_INSETS: Insets = { top: 64, bottom: 0 };

function place(target: Rect, viewport: Viewport, insets: Insets, cardHeight: number, fixed: boolean) {
  const delta = scrollDeltaFor(target, viewport, insets, cardHeight, fixed);
  const moved = { ...target, top: target.top - delta };
  const layout = computeTourLayout({ target: moved, viewport, insets, card: { width: 380, height: cardHeight }, fixed });
  return { delta, moved, layout };
}

function assertCardFits(layout: ReturnType<typeof computeTourLayout>, viewport: Viewport, insets: Insets, label: string, cardHeight = 240) {
  const area = visibleArea(viewport, insets);
  const { card } = layout;
  const height = Math.min(cardHeight, card.maxHeight);
  assert.ok(card.left >= TOUR_GUTTER - 0.01, `${label}: links buiten beeld`);
  assert.ok(card.left + card.width <= viewport.width - TOUR_GUTTER + 0.01, `${label}: rechts buiten beeld`);
  assert.ok(card.top >= area.top - 0.01, `${label}: kaart achter de bovenbalk (${card.top} < ${area.top})`);
  assert.ok(card.top + height <= area.bottom + 0.01, `${label}: kaart achter de onderbalk of onder het scherm`);
}

test("een vast doel in de header krijgt de kaart eronder, nooit achter de terugbalk", () => {
  const switcher: Rect = { top: 8, left: 8, width: 150, height: 40 };
  const { delta, layout } = place(switcher, PHONE, PHONE_INSETS, 220, true);
  assert.equal(delta, 0);
  assert.equal(layout.placement, "below");
  assert.ok(layout.card.top >= PHONE_INSETS.top);
  assertCardFits(layout, PHONE, PHONE_INSETS, "header", 220);
});

test("een vast doel in de onderbalk krijgt de kaart erboven", () => {
  const nav: Rect = { top: 640 - 64, left: 90, width: 90, height: 56 };
  const { layout } = place(nav, PHONE, PHONE_INSETS, 220, true);
  assert.equal(layout.placement, "above");
  assert.ok(layout.card.top + 220 <= PHONE.height - PHONE_INSETS.bottom);
  assertCardFits(layout, PHONE, PHONE_INSETS, "onderbalk", 220);
});

test("een doel buiten beeld wordt in beeld gescrold, met ruimte voor de kaart", () => {
  const far: Rect = { top: 1500, left: 16, width: 328, height: 120 };
  const { delta, moved, layout } = place(far, PHONE, PHONE_INSETS, 220, false);
  assert.ok(delta > 0);
  const area = visibleArea(PHONE, PHONE_INSETS);
  assert.ok(moved.top >= area.top && moved.top + moved.height <= area.bottom, "doel niet in het zichtbare vlak");
  assert.notEqual(layout.placement, "sheet");
  assertCardFits(layout, PHONE, PHONE_INSETS, "ver doel", 220);
  const above: Rect = { top: -400, left: 16, width: 328, height: 120 };
  assert.ok(scrollDeltaFor(above, PHONE, PHONE_INSETS, 220, false) < 0);
});

test("een doel dat al goed in beeld staat laat de pagina met rust", () => {
  const ok: Rect = { top: 200, left: 16, width: 328, height: 100 };
  assert.equal(scrollDeltaFor(ok, PHONE, PHONE_INSETS, 220, false), 0);
});

test("een doel dat te groot is voor doel én kaart krijgt een blad onderaan het zichtbare vlak", () => {
  const tall: Rect = { top: 300, left: 16, width: 328, height: 800 };
  const { moved, layout } = place(tall, PHONE, PHONE_INSETS, 260, false);
  const area = visibleArea(PHONE, PHONE_INSETS);
  assert.equal(layout.placement, "sheet");
  assert.ok(Math.abs(moved.top - area.top) < 1);
  assert.equal(layout.highlight.top >= PHONE_INSETS.top, true);
  assert.ok(layout.highlight.top + layout.highlight.height <= PHONE.height - PHONE_INSETS.bottom + 0.01);
  assertCardFits(layout, PHONE, PHONE_INSETS, "groot doel", 260);
});

test("een zeer hoge kaart (groot lettertype, lange vertaling) scrolt zelf en blijft in het zichtbare vlak", () => {
  const target: Rect = { top: 300, left: 16, width: 328, height: 60 };
  const { layout } = place(target, PHONE, PHONE_INSETS, 2000, false);
  const area = visibleArea(PHONE, PHONE_INSETS);
  assert.ok(layout.card.maxHeight <= area.bottom - area.top + 0.01);
  assert.ok(layout.card.top >= area.top - 0.01);
  assert.ok(layout.card.top + layout.card.maxHeight <= area.bottom + 0.01);
});

test("plaatsing is op elk schermformaat binnen het scherm (rooster van doelen)", () => {
  const sizes: [Viewport, Insets][] = [
    [{ width: 320, height: 568 }, { top: 110, bottom: 70 }],
    [PHONE, PHONE_INSETS],
    [{ width: 430, height: 932 }, { top: 150, bottom: 100 }],
    [{ width: 820, height: 1180 }, { top: 120, bottom: 72 }],
    [DESKTOP, DESKTOP_INSETS],
  ];
  for (const [viewport, insets] of sizes) {
    for (let top = -300; top <= viewport.height + 600; top += 97) {
      for (const [left, width, height] of [[8, 120, 40], [16, viewport.width - 32, 180], [viewport.width - 140, 124, 56]] as const) {
        const target: Rect = { top, left, width, height };
        const { layout, moved, delta } = place(target, viewport, insets, 240, false);
        assertCardFits(layout, viewport, insets, `${viewport.width}x${viewport.height} top ${top}`);
        const area = visibleArea(viewport, insets);
        if (height + 240 + 12 <= area.bottom - area.top) {
          assert.ok(moved.top >= area.top - 0.5 && moved.top + moved.height <= area.bottom + 0.5, `doel niet zichtbaar (${delta})`);
        }
        // De markering ligt nooit achter de bovenbalk of onderbalk.
        assert.ok(layout.highlight.top >= insets.top - 0.01);
        assert.ok(layout.highlight.top + layout.highlight.height <= viewport.height - insets.bottom + 0.01);
      }
    }
  }
});

// --- Mascottes ---------------------------------------------------------------------

test("de gids gebruikt alleen bestaande poses van het gekozen personage", () => {
  for (const character of PERSONAL_MASCOTS) {
    const state = guideMascotState(character);
    assert.ok((mascotStates(character) as readonly string[]).includes(state), `${character}: ${state}`);
  }
  // Een toekomstige gids zonder eigen regel krijgt een geldige standaardpose.
  assert.equal(guideMascotState("onbekend" as never), "discovery");
});

// --- Regressies: navigatie, routering, onboarding, voortgang -----------------------

test("Ontdek Versado is geen extra tab: de onderbalk blijft zoals hij was", () => {
  assert.deepEqual(PRIMARY_NAV.map((item) => item.id), ["today", "learn", "play", "friends"]);
  assert.ok(!PRIMARY_NAV.some((item) => item.href.startsWith("/kompas") || item.match.some((prefix) => prefix.startsWith("/kompas"))));
  assert.equal(activeDestination("/kompas"), null);
});

test("Kompas-pagina's zijn neutraal voor de contentroutering en horen bij de gewone shell", () => {
  for (const route of ["/kompas", "/kompas/learn", "/kompas/play.word-search"]) {
    assert.deepEqual(classifyContentRoute(route), { kind: "neutral" }, route);
    assert.equal(shellModeForRoute(route), "normal", route);
  }
  // De bestaande indeling blijft: cursussen en spellen zijn nog steeds contentgebonden.
  assert.equal(classifyContentRoute("/courses").kind, "courses");
  assert.equal(classifyContentRoute("/word-search").kind, "game");
});

test("accountonboarding en vrijwillige Kompas-rondleiding blijven gescheiden", () => {
  const dashboard = read("src/app/dashboard/page.tsx");
  assert.match(dashboard, /if \(!user\.onboardingSeenAt\) redirect\("\/onboarding"\)/);
  const profile = read("src/components/ProfileClient.tsx");
  assert.match(profile, /label=\{t\("kompas\.entry\.title"\)\} href="\/kompas"/);
  assert.doesNotMatch(profile, /href="\/onboarding"/);
  const onboarding = read("src/app/onboarding/page.tsx");
  assert.match(onboarding, /if \(user\.onboardingSeenAt && !avatarOnly\) redirect\("\/kompas"\)/);
  const complete = read("src/app/api/onboarding/complete/route.ts");
  assert.match(complete, /onboardingSeenAt: new Date\(\)/);
  const client = read("src/components/OnboardingClient.tsx");
  const baseSteps = /const BASE_STEPS: StepId\[\] = (\[[^\]]+\])/.exec(client)?.[1] ?? "";
  for (const step of ["gids", "kompas", "webapp", "uitleg", "vrienden", "online-status", "notificaties"]) assert.ok(baseSteps.includes(`"${step}"`), step);
  assert.match(client, /"kennis"/);
  // Overslaan volgt pas na de verplichte keuzes voor gids, avatar en privacy.
  assert.match(client, /companionChosen && avatarChosen && privacyChosen && \(/);
  // De kennismaking staat vroeg (direct na de gids), zodat de rest niet langer wordt.
  assert.ok(baseSteps.indexOf('"kompas"') > baseSteps.indexOf('"gids"') && baseSteps.indexOf('"kompas"') < baseSteps.indexOf('"webapp"'));
});

test("de migratie geeft bestaande accounts geen automatische uitnodigingen en nieuwe accounts wel", () => {
  const migrations = readdirSync(path.join(root, "prisma/migrations")).filter((name) => name.endsWith("versado_kompas"));
  assert.equal(migrations.length, 1);
  const sql = read(`prisma/migrations/${migrations[0]}/migration.sql`);
  assert.match(sql, /ADD COLUMN "kompasOffersEnabled" BOOLEAN NOT NULL DEFAULT true/);
  assert.match(sql, /UPDATE "User" SET "kompasOffersEnabled" = false/);
  assert.ok(sql.indexOf("ADD COLUMN") < sql.indexOf("UPDATE"), "DDL eerst, backfill eronder");
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /kompasOffersEnabled Boolean @default\(true\)/);
  assert.match(schema, /model KompasProgress \{/);
  assert.match(schema, /@@unique\(\[userId, topicId, scope, kind\]\)/);
});

test("Kompas raakt nooit XP, reeksen, scores of voortgang: geen enkele import of schrijfactie daarheen", () => {
  const files = [
    ...walk("src/lib/kompas", (file) => file.endsWith(".ts")),
    ...walk("src/components/kompas", (file) => file.endsWith(".tsx")),
    ...walk("src/app/api/kompas", (file) => file.endsWith(".ts")),
    ...walk("src/app/kompas", (file) => file.endsWith(".tsx")),
  ];
  assert.ok(files.length > 10);
  const forbidden = /@\/lib\/(xp|xpRules|xpBroadcast|streak|streakCalendar|competitionXp|leagues|learning|challenges|scrabbleGame|wordGame|chapterGuess|snelleZendeling|mysteries|genees|study|social|shop)\b/;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.ok(!forbidden.test(source), `${file} importeert een voortgangs- of scoremodule`);
    assert.ok(!/announceXpChanged|recordLearningActivity|xpTransaction|streakDay|weeklyScore|invalidates:\s*"(activityCompleted|xpChanged)"/i.test(source), `${file} raakt XP of reeks`);
  }
  // De enige tabel die de opslag schrijft is KompasProgress.
  const store = read("src/lib/kompas/store.ts");
  assert.deepEqual([...new Set([...store.matchAll(/prisma\.(\w+)\.(?:create|update|upsert|delete)\w*/g)].map((m) => m[1]))], ["kompasProgress"]);
  // Een rondleiding en een uitnodiging legen alleen de eigen Kompas-gegevens.
  for (const file of ["src/components/kompas/ContextOffer.tsx", "src/components/kompas/KompasProvider.tsx", "src/lib/kompas/client.ts"]) {
    for (const [, event] of readFileSync(file, "utf8").matchAll(/invalidates:\s*"(\w+)"/g)) assert.ok(["kompasChanged", "settingsChanged"].includes(event), `${file}: ${event}`);
  }
});

test("een rondleiding klikt, navigeert en wijzigt niets: de overlay vangt tikken op en gebruikt geen click() of router in de stappen", () => {
  const overlay = read("src/components/kompas/TourOverlay.tsx");
  assert.ok(!/\.click\(|router\.|window\.location|fetch\(|jsonMutation/.test(overlay));
  assert.match(overlay, /Escape/);
  assert.match(overlay, /aria-modal="true"/);
});

test("de contextuele uitnodiging gebruikt de bestaande poortwachters en doet niets in activiteiten", () => {
  const source = read("src/components/kompas/ContextOffer.tsx");
  assert.match(source, /shellModeForRoute\(pathname\) === "normal"/);
  assert.match(source, /isActivityRoute\(pathname\)/);
  assert.match(source, /dialog\[open\]/);
  assert.match(source, /sessionStorage/);
});

test("de layout draagt Kompas: provider rond de app, uitnodiging naast de andere pop-ups, anker op de contentkiezer", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /<KompasProvider>/);
  assert.match(layout, /<ContextOffer work=\{workOf\(contentContext\.active\)\} \/>/);
  assert.match(read("src/components/ContentSwitcher.tsx"), /data-kompas-target="content-switcher"/);
  assert.match(read("src/components/SubpageBackBar.tsx"), /pathname === "\/kompas"/);
});

test("de ingang staat op Vandaag en op het profiel", () => {
  assert.match(read("src/app/dashboard/page.tsx"), /<KompasEntryCard \/>/);
  assert.match(read("src/components/ProfileClient.tsx"), /<KompasEntryCard \/>/);
});

test("elke visuele Kompas-pagina gebruikt de semantische Versado-tokens en geen vaste Nederlandse UI-tekst", () => {
  const files = [...walk("src/components/kompas", (f) => f.endsWith(".tsx")), ...walk("src/app/kompas", (f) => f.endsWith(".tsx"))];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/\b(bg|text|border)-(slate|gray|brand)-\d/.test(source), `${file}: losse kleur in plaats van een vs-token`);
    // Zichtbare tekst loopt via t(): geen Nederlandse woorden tussen tags of in aria-label/title.
    assert.ok(!/>\s*(Ontdek|Leren|Spelen|Volgende|Vorige|Overslaan|Sluiten|Klaar|Rondleiding)\b/.test(source), `${file}: vaste tekst tussen tags`);
    assert.ok(!/(aria-label|title|placeholder)="[A-Z][a-zé]+/.test(source), `${file}: vaste tekst in een attribuut`);
  }
});

// --- Nieuwe schriftbronnen en beschikbaarheid ----------------------------------

test("een nieuwe contentcollectie krijgt zonder codewijziging de algemene uitleg voor elk onderdeel", () => {
  for (const topic of KOMPAS_TOPICS) {
    const general = resolveExplanation(nl, topic.id);
    const fresh = resolveExplanation(nl, topic.id, { work: "nieuw-schriftwerk-zonder-uitleg" });
    assert.equal(fresh.scope, "", topic.id);
    assert.deepEqual(fresh.entry, general.entry, topic.id);
  }
  assert.deepEqual(resolveWorkIntro(nl, "nieuw-schriftwerk-zonder-uitleg"), { intro: undefined, contents: undefined });
});

test("de algemene uitleg belooft geen schriftwerk-specifieke functies en bronuitleg belooft geen spellen", () => {
  const texts = (tree: unknown): string[] => flatten(tree).map((key) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree) as string);
  const games = /\b(spel|spellen|game|games|spiel|spiele|jeu|jeux|juego|juegos|jugar|spielen|jouer|play)\b/i;
  for (const bundle of [kompasNl, kompasEn, kompasDe, kompasFr, kompasEs]) {
    for (const text of texts(bundle.work)) assert.ok(!games.test(text), `bronuitleg noemt spellen: ${text}`);
  }
  // Wat bij een bron hoort aan spellen komt uit de echte gegevens: zonder spellen toont Spelen de bestaande melding.
  const page = read("src/app/kompas/[topicId]/page.tsx");
  assert.match(page, /gamesHub\.noGames/);
  assert.match(read("src/app/kompas/page.tsx"), /noGames/);
  const none: KompasContext = { work: "podcasts", switcherEnabled: true, visibleGameIds: [] };
  assert.deepEqual(visibleChildren("play", none), []);
});

test("bestaande accounts: één rustig label en één eenmalige vraag, geen pop-up en geen nieuwe onboarding", () => {
  const entry = read("src/components/kompas/KompasEntryCard.tsx");
  assert.match(entry, /kompas\.entry\.new/);
  const hub = read("src/app/kompas/page.tsx");
  assert.match(hub, /firstVisit && !user\.kompasOffersEnabled/);
  assert.match(hub, /<MarkViewed topicId="versado"/);
  // De onboarding wordt niet opnieuw afgedwongen: de redirect hangt nog steeds alleen aan onboardingSeenAt.
  assert.doesNotMatch(read("src/app/dashboard/page.tsx"), /redirect\("\/kompas/);
});

test("toegankelijkheid van de rondleiding en uitnodiging: dialoog, focus, Escape, live-regio, reduced motion", () => {
  const overlay = read("src/components/kompas/TourOverlay.tsx");
  for (const needle of ['role="dialog"', 'aria-modal="true"', "aria-labelledby", "aria-describedby", "Escape", 'role="status"', "returnFocus", "vs-motion", "h-11"]) assert.ok(overlay.includes(needle), needle);
  const offer = read("src/components/kompas/ContextOffer.tsx");
  assert.match(offer, /aria-live="polite"/);
  assert.match(offer, /Escape/);
});
