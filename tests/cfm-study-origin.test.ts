import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  noteStudyRouteChange,
  originIsPreviousEntry,
  resolveReturnToPath,
  resolveStudyBack,
  safeStudyOrigin,
  settleStudyTraverse,
  studyBaseOf,
  type StudyOriginStorage,
} from "../src/lib/studyOrigin";

const memory = (): StudyOriginStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const L1 = "/study-lesson/l1/c1";
const L2 = "/study-lesson/l2/c1";
const PATH = "/courses/cfm/pad";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Simpel model van de browser: geschiedenisstapel, Navigation API wel of niet, en de routebewaker. */
class Browser {
  storage = memory();
  entries: string[];
  index: number;
  navApi: boolean;
  constructor(start: string, navApi = true) { this.entries = [start]; this.index = 0; this.navApi = navApi; }
  get url() { return this.entries[this.index]; }
  get pathname() { return this.url.split("?")[0]; }
  probe() {
    const history = { historyLength: this.entries.length };
    if (!this.navApi) return history;
    return { ...history, previousEntry: this.index > 0 ? this.entries[this.index - 1].replace(/\?$/, "") : null };
  }
  push(url: string) {
    const from = this.url;
    this.entries = [...this.entries.slice(0, this.index + 1), url]; this.index++;
    noteStudyRouteChange(this.storage, { from, toPathname: url.split("?")[0], historyLength: this.entries.length, traverse: false });
  }
  replace(url: string) {
    const from = this.url;
    this.entries[this.index] = url;
    noteStudyRouteChange(this.storage, { from, toPathname: url.split("?")[0], historyLength: this.entries.length, traverse: false });
  }
  /** Terug/vooruit: met Navigation API weet de bewaker het vooraf, zonder (oudere Safari) pas na de routewissel. */
  traverse(delta: number) {
    const from = this.url;
    this.index += delta;
    const to = this.pathname;
    if (this.navApi) noteStudyRouteChange(this.storage, { from, toPathname: to, historyLength: this.entries.length, traverse: true });
    else {
      noteStudyRouteChange(this.storage, { from, toPathname: to, historyLength: this.entries.length, traverse: false });
      settleStudyTraverse(this.storage, to, this.entries.length);
    }
  }
  /** Volledig herladen: het geheugen is weg, sessionStorage en geschiedenis blijven. */
  reload() { /* niets te doen: de herkomst staat in storage, de stapel blijft */ }
  back(fallback: string) {
    const result = resolveStudyBack(this.storage, this.pathname, this.probe(), fallback);
    if (result.action === "back") this.traverse(-1);
    else this.entries[this.index] = result.href;
    return this.url;
  }
  returnToPath(pathHref: string) {
    const result = resolveReturnToPath(this.storage, this.pathname, this.probe(), pathHref);
    if (result.action === "back") this.traverse(-1);
    else this.entries[this.index] = result.href;
    return this.url;
  }
}

for (const navApi of [true, false]) {
  const label = navApi ? "met Navigation API" : "zonder Navigation API (oudere Safari)";

  test(`Vandaag → studieles → stappen → terug = Vandaag, ook na herladen (${label})`, () => {
    const b = new Browser("/dashboard", navApi);
    b.push(`${L1}/stappen/1`);
    b.replace(`${L1}/stappen/2`);
    b.replace(`${L1}/stappen/3`);
    b.reload();
    assert.equal(b.back(PATH), "/dashboard");
  });

  test(`Leren → weekpad → studieles → terug = weekpad → terug = Leren (${label})`, () => {
    const b = new Browser("/courses", navApi);
    b.push(PATH);
    b.push(`${L1}/stappen/1`);
    assert.equal(b.back("/courses"), PATH);
    assert.equal(b.pathname, PATH);
  });

  test(`Mijn studiemap → studieles → terug = Mijn studiemap (${label})`, () => {
    const b = new Browser("/study-folder?kleur=geel", navApi);
    b.push(L1);
    assert.equal(b.back(PATH), "/study-folder?kleur=geel");
  });

  test(`twee studieactiviteiten vanuit verschillende ingangen gebruiken elk hun eigen herkomst (${label})`, () => {
    const b = new Browser("/dashboard", navApi);
    b.push(`${L1}/stappen/1`);
    b.back(PATH);
    assert.equal(b.pathname, "/dashboard");
    b.push("/courses");
    b.push(PATH);
    b.push(`${L2}/stappen/1`);
    assert.equal(b.back("/courses"), PATH, "de herkomst van de vorige activiteit werkt niet door");
    // Dezelfde les nu opnieuw, vanuit Vandaag in plaats van het weekpad.
    b.traverse(-1);
    b.push("/dashboard");
    b.push(`${L2}/stappen/2`);
    assert.equal(b.back(PATH), "/dashboard");
  });

  test(`browser-terug en -vooruit houden de herkomst intact (${label})`, () => {
    const b = new Browser("/dashboard", navApi);
    b.push(`${L1}/stappen/1`);
    b.replace(`${L1}/stappen/2`);
    b.traverse(-1);
    assert.equal(b.pathname, "/dashboard");
    b.traverse(1);
    assert.equal(b.pathname, `${L1}/stappen/2`);
    assert.equal(b.back(PATH), "/dashboard");
  });

  test(`een verwijzing openen en terugkeren verandert de herkomst niet (${label})`, () => {
    const b = new Browser("/dashboard", navApi);
    b.push(`${L1}/stappen/1`);
    b.push("/scripture/abc");
    b.traverse(-1);
    assert.equal(b.pathname, `${L1}/stappen/1`);
    assert.equal(b.back(PATH), "/dashboard");
    // Ook als de terugkeer een gewone navigatie is in plaats van terug.
    const c = new Browser("/dashboard", navApi);
    c.push(`${L1}/stappen/1`);
    c.push("/scripture/abc");
    c.push(`${L1}/stappen/1`);
    assert.equal(c.storage.data.size > 0, true);
    assert.equal(JSON.parse(c.storage.data.get("vs-study-origin")!).record.origin, "/dashboard");
  });

  test(`een uitstapje naar een andere pagina en terug met browser-terug houdt de herkomst (${label})`, () => {
    const b = new Browser("/dashboard", navApi);
    b.push(`${L1}/stappen/1`);
    b.push("/profile");
    b.traverse(-1);
    assert.equal(b.pathname, `${L1}/stappen/1`);
    assert.equal(b.back(PATH), "/dashboard");
  });

  test(`stap 6 → terug naar het weekpad: geen dubbel geschiedenisitem (${label})`, () => {
    // Vanuit het weekpad: terug in plaats van een tweede weekpad.
    const a = new Browser("/courses", navApi);
    a.push(PATH);
    a.push(`${L1}/stappen/1`);
    for (let n = 2; n <= 6; n++) a.replace(`${L1}/stappen/${n}`);
    const before = a.entries.length;
    assert.equal(a.returnToPath(PATH), PATH);
    assert.equal(a.index, 1);
    assert.equal(a.entries.filter((u) => u === PATH).length, 1, "het weekpad staat één keer op de stapel");
    assert.equal(a.entries.length, before);
    // Vanuit Vandaag: vervangt de les door het weekpad (Vandaag, weekpad) en terug gaat naar Vandaag.
    const b = new Browser("/dashboard", navApi);
    b.push(`${L1}/stappen/6`);
    assert.equal(b.returnToPath(PATH), PATH);
    assert.deepEqual(b.entries, ["/dashboard", PATH]);
  });
}

test("directe link of nieuw tabblad: geen herkomst, dus de veilige terugval", () => {
  const b = new Browser(`${L1}/stappen/2`);
  assert.equal(b.back(PATH), PATH);
  const safari = new Browser(`${L1}/stappen/2`, false);
  assert.equal(safari.back(PATH), PATH);
});

test("een oude herkomst van een andere les, een gewijzigde geschiedenis of een verlopen record telt niet", () => {
  const b = new Browser("/dashboard", false);
  b.push(`${L1}/stappen/1`);
  assert.ok(originIsPreviousEntry(b.storage, `${L1}/stappen/1`, b.probe()));
  assert.equal(originIsPreviousEntry(b.storage, `${L2}/stappen/1`, b.probe()), null, "andere les");
  assert.equal(originIsPreviousEntry(b.storage, `${L1}/stappen/1`, { historyLength: 9 }), null, "geschiedenis is veranderd");
  assert.equal(originIsPreviousEntry(b.storage, `${L1}/stappen/1`, b.probe(), Date.now() + 13 * 3600_000), null, "verlopen");
  const withApi = new Browser("/dashboard", true);
  withApi.push(`${L1}/stappen/1`);
  assert.equal(originIsPreviousEntry(withApi.storage, `${L1}/stappen/1`, { historyLength: 2, previousEntry: "/courses" }), null, "vorige item is niet de herkomst");
  // Beschadigde opslag geeft de veilige terugval, geen fout.
  const broken = memory();
  broken.setItem("vs-study-origin", "{niet json");
  assert.equal(resolveStudyBack(broken, `${L1}`, { historyLength: 2 }, PATH).action, "replace");
});

test("alleen veilige interne routes worden als herkomst bewaard", () => {
  assert.equal(safeStudyOrigin("/dashboard?"), "/dashboard");
  assert.equal(safeStudyOrigin("/courses/abc/pad"), "/courses/abc/pad");
  assert.equal(safeStudyOrigin("/study-folder?kleur=geel&q=a%20b"), "/study-folder?kleur=geel&q=a%20b");
  for (const bad of ["//evil.example/x", "https://evil.example", "/dashboard/../admin", "/adminbackend", "/login", "javascript:alert(1)", "/dashboard?x=<script>", "", "/study-folder?" + "a".repeat(300)])
    assert.equal(safeStudyOrigin(bad), null, bad);
  assert.equal(studyBaseOf("/study-lesson/abc/def/stappen/3"), "/study-lesson/abc/def");
  assert.equal(studyBaseOf("/courses/x"), null);
  const storage = memory();
  noteStudyRouteChange(storage, { from: "https://evil.example/x", toPathname: `${L1}/stappen/1`, historyLength: 2, traverse: false });
  assert.equal(resolveStudyBack(storage, L1, { historyLength: 2 }, PATH).action, "replace", "onveilige herkomst geeft geen record");
});

test("de bedrading: centrale routebewaker, zachte terugknop en een stap-6-knop zonder tweede navigatielaag", () => {
  const scroll = read("src/components/shell/NavigationScroll.tsx");
  assert.match(scroll, /recordStudyRouteChange\(previous, pathname, Boolean\(pendingPop\.current\)\)/);
  assert.match(scroll, /settleStudyTraverseInBrowser\(\)/);
  const target = read("src/components/ReaderBackTarget.tsx");
  assert.match(target, /useStudyBack\(pathname, href, studyOrigin\)/);
  assert.match(target, /useSetBackTarget\(pathname, href, parent, studyOrigin \? goBack : undefined, true, soft\)/);
  const reader = read("src/components/study/StudyReader.tsx");
  assert.match(reader, /useStudyReturnToPath\(pathname, personal\.coursePath \?\? "\/courses"\)/);
  assert.match(reader, /data-step-to-path[\s\S]{0,200}event\.preventDefault\(\);\s*returnToPath\(\);/);
  const originModule = read("src/lib/studyOrigin.ts");
  assert.match(originModule, /sessionStorage/);
  assert.doesNotMatch(originModule, /localStorage|document\.cookie|searchParams|location\.search\b.*redirect/);
});
