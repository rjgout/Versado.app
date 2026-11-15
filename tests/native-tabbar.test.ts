import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NativeTabBar, TAB_BAR_CALL_TIMEOUT_MS, tabBarLayoutSchema, tabBarSupportSchema, type NativeTabBarBridge, type NativeTabBarState } from "../src/lib/native/tabBar";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 3; i++) { await flush(); await new Promise(resolve => setTimeout(resolve, 3)); } };

const items = [
  { id: "today", title: "Vandaag", href: "/dashboard" },
  { id: "learn", title: "Leren", href: "/courses" },
] as const;
const state = (patch: Partial<NativeTabBarState> = {}): NativeTabBarState => ({ items, selectedId: "today", visible: true, style: "light", ...patch });

function fixture(options: {
  platform?: string; support?: unknown; sync?: (payload: unknown, call: number) => Promise<unknown> | unknown;
  clear?: (call: number) => Promise<void> | void; listen?: () => Promise<void> | void; supportFn?: () => Promise<unknown> | unknown;
} = {}) {
  const attributes = new Map<string, string>(), styles = new Map<string, string>();
  const log: string[] = [], payloads: Array<{ items: unknown[]; selectedId: string | null; visible: boolean; style: string }> = [];
  const hrefs: string[] = [], clearSawAttribute: boolean[] = [];
  let changes = 0, removed = 0, select: (value: unknown) => void = () => {}, layout: (value: unknown) => void = () => {};
  const bridge: NativeTabBarBridge = {
    support: async () => { log.push("support"); if (options.supportFn) return options.supportFn(); return options.support ?? { version: 1, available: true }; },
    sync: async payload => {
      log.push("sync"); payloads.push(payload as never);
      return options.sync ? options.sync(payload, payloads.length) : { height: 83 };
    },
    clear: async () => {
      log.push("clear"); clearSawAttribute.push(attributes.get("data-vs-native-tabbar") === "true");
      await options.clear?.(log.filter(entry => entry === "clear").length);
    },
    listen: async callbacks => { log.push("listen"); await options.listen?.(); select = callbacks.select; layout = callbacks.layout; return { remove: async () => { removed++; } }; },
  };
  const root = {
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => { attributes.set(key, value); },
    removeAttribute: (key: string) => { attributes.delete(key); },
    style: {
      setProperty: (key: string, value: string) => { styles.set(key, value); },
      getPropertyValue: (key: string) => styles.get(key) ?? "",
      removeProperty: (key: string) => { const old = styles.get(key) ?? ""; styles.delete(key); return old; },
    },
  };
  const bar = new NativeTabBar(bridge, { platform: options.platform ?? "ios", root, onSelectHref: href => { hrefs.push(href); }, onChange: () => { changes++; } });
  return { bar, attributes, styles, log, payloads, hrefs, clearSawAttribute, changes: () => changes, removed: () => removed, select: (v: unknown) => select(v), layout: (v: unknown) => layout(v) };
}

test("web en Android doen niets: geen bridge, geen attributen", async () => {
  for (const platform of ["web", "android"]) {
    const f = fixture({ platform });
    f.bar.start(); f.bar.update(state()); await settle();
    assert.deepEqual(f.log, []); assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0);
    f.bar.dispose();
    assert.deepEqual(f.log, []);
  }
});

test("zonder systeemtabbalk (iOS 15–25) blijft de React-balk volledig staan", async () => {
  const f = fixture({ support: { version: 1, available: false } });
  f.bar.start(); f.bar.update(state()); await settle();
  assert.deepEqual(f.log, ["listen", "clear", "support"]);
  assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0); assert.equal(f.changes(), 0);
});

test("ongeldig of ontbrekend supportantwoord telt als niet beschikbaar", async () => {
  for (const support of [{ version: 2, available: true }, { version: 1, available: "yes" }, { version: 1, available: true, extra: 1 }, "onbekend"]) {
    const f = fixture({ support });
    f.bar.start(); f.bar.update(state()); await settle();
    assert.equal(f.payloads.length, 0, JSON.stringify(support)); assert.equal(f.attributes.size, 0);
  }
  assert.equal(tabBarSupportSchema.safeParse({ version: 1, available: true }).success, true);
});

test("eerst luisteren, dan vragen; eerst ruimte vrijhouden, dan pas tonen", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  assert.deepEqual(f.log.slice(0, 3), ["listen", "clear", "support"], "eerst luisteren, dan een achtergebleven native balk opruimen, dan vragen");
  assert.equal(f.payloads[0].visible, false, "de eerste synchronisatie toont de native balk nog niet");
  assert.equal(f.payloads.length, 2);
  assert.equal(f.payloads[1].visible, true, "pas na het vrijhouden van de ruimte verschijnt de native balk");
  assert.equal(f.attributes.get("data-vs-native-tabbar"), "true");
  assert.equal(f.styles.get("--vs-native-tabbar-height"), "83px");
  assert.ok(f.changes() >= 1, "ShellMetrics moet opnieuw meten");
  assert.deepEqual(f.payloads[1].items, [{ id: "today", title: "Vandaag" }, { id: "learn", title: "Leren" }]);
  assert.equal(f.payloads[1].selectedId, "today");
});

test("identieke staat wordt niet opnieuw verstuurd; een wijziging wel (nieuwste wint)", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  const before = f.payloads.length;
  f.bar.update(state()); await settle();
  assert.equal(f.payloads.length, before);
  f.bar.update(state({ selectedId: "learn" })); f.bar.update(state({ selectedId: "learn", style: "dark" })); await settle();
  const last = f.payloads.at(-1)!;
  assert.equal(last.selectedId, "learn"); assert.equal(last.style, "dark");
});

test("een verborgen React-balk (toetsenbord, focus mode) verbergt ook de native balk, de ruimte blijft", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  f.bar.update(state({ visible: false })); await settle();
  assert.equal(f.payloads.at(-1)!.visible, false);
  assert.equal(f.attributes.get("data-vs-native-tabbar"), "true");
  f.bar.update(state({ visible: true })); await settle();
  assert.equal(f.payloads.at(-1)!.visible, true);
});

test("een tik navigeert via de bestaande href en zet een afwijkende native selectie terug", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  const before = f.payloads.length;
  f.select({ id: "learn" }); await settle();
  assert.deepEqual(f.hrefs, ["/courses"]);
  assert.ok(f.payloads.length > before, "de gewenste selectie wordt opnieuw gesynchroniseerd, ook bij een geblokkeerde navigatie");
  assert.equal(f.payloads.at(-1)!.selectedId, "today");
});

test("ongeldige of onbekende selecties en lay-outs worden genegeerd", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  const before = f.payloads.length;
  for (const raw of [{ id: "profile" }, { id: "today", extra: 1 }, { id: 5 }, null, "today", {}]) f.select(raw);
  await settle();
  assert.deepEqual(f.hrefs, []); assert.equal(f.payloads.length, before);
  f.select({ id: "play" }); await settle();
  assert.deepEqual(f.hrefs, [], "een bestemming die niet in de huidige balk staat navigeert niet");
  for (const raw of [{ height: -1 }, { height: Infinity }, { height: 9999 }, { height: "83" }, { height: 83, extra: true }]) f.layout(raw);
  assert.equal(f.styles.get("--vs-native-tabbar-height"), "83px");
  assert.equal(tabBarLayoutSchema.safeParse({ height: 83 }).success, true);
});

test("een lay-outwijziging (draaien, grotere tekst) werkt de ruimtehouder bij", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  const before = f.changes();
  f.layout({ height: 70.4 });
  assert.equal(f.styles.get("--vs-native-tabbar-height"), "71px");
  assert.equal(f.changes(), before + 1);
});

test("elke fout in de native balk laat de React-balk terugkeren zonder herhaalpoging", async () => {
  const f = fixture({ sync: (_payload, call) => { if (call === 2) throw new Error("tabbar_unavailable"); return { height: 83 }; } });
  f.bar.start(); f.bar.update(state()); await settle();
  assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0);
  const calls = f.payloads.length;
  f.bar.update(state({ selectedId: "learn" })); await settle();
  assert.equal(f.payloads.length, calls, "na een fout wordt de native balk niet opnieuw geprobeerd");
});

test("een latere fout na een zichtbare native balk ruimt eerst de native balk op, dan pas keert de React-balk terug", async () => {
  // Aanroep 1 = verborgen eerste sync, 2 = zichtbaar; de derde (selectiewijziging) faalt.
  const f = fixture({ sync: (_payload, call) => { if (call === 3) throw new Error("tabbar_unavailable"); return { height: 83 }; } });
  f.bar.start(); f.bar.update(state()); await settle();
  assert.equal(f.payloads.at(-1)!.visible, true, "de native balk was zichtbaar");
  assert.equal(f.attributes.get("data-vs-native-tabbar"), "true");
  f.bar.update(state({ selectedId: "learn" })); await settle();
  assert.equal(f.log.at(-1), "clear", "de native balk wordt opgeruimd");
  assert.deepEqual(f.clearSawAttribute.slice(-1), [true], "de React-balk blijft een ruimtehouder tot de native balk weg is");
  assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0);
  const calls = f.payloads.length;
  f.bar.update(state({ selectedId: "today" })); await settle();
  assert.equal(f.payloads.length, calls, "na een fout geen nieuwe poging");
});

test("een native balk zonder hoogte is een fout: nooit de React-balk verbergen zonder zichtbare bediening", async () => {
  for (const height of [0, 0.4]) {
    const f = fixture({ sync: () => ({ height }) });
    f.bar.start(); f.bar.update(state()); await settle();
    assert.equal(f.attributes.size, 0, `hoogte ${height}`); assert.equal(f.log.at(-1), "clear");
  }
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  f.layout({ height: 0 });
  assert.equal(f.styles.get("--vs-native-tabbar-height"), "83px", "een lay-outmelding zonder hoogte wordt genegeerd");
  assert.equal(tabBarLayoutSchema.safeParse({ height: 0 }).success, false);
});

test("een ongeldig lay-outantwoord telt als fout", async () => {
  const f = fixture({ sync: () => ({ height: -5 }) });
  f.bar.start(); f.bar.update(state()); await settle();
  assert.equal(f.attributes.size, 0);
});

test("zonder bestemmingen (uitgelogd) wordt de native balk opgeruimd en komt de ruimte vrij", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  f.bar.update(state({ items: [], selectedId: null, visible: false })); await settle();
  assert.equal(f.log.at(-1), "clear");
  assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0);
  f.bar.update(state()); await settle();
  assert.equal(f.attributes.get("data-vs-native-tabbar"), "true", "na opnieuw inloggen keert de native balk terug");
});

test("opruimen verwijdert luisteraars, native balk en alle attributen; late antwoorden doen niets", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  f.bar.dispose(); await settle();
  assert.equal(f.removed(), 1); assert.equal(f.log.at(-1), "clear");
  assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0);
  const calls = f.payloads.length;
  f.select({ id: "learn" }); f.layout({ height: 90 }); f.bar.update(state()); await settle();
  assert.deepEqual(f.hrefs, []); assert.equal(f.payloads.length, calls); assert.equal(f.attributes.size, 0);
  f.bar.dispose();
});

test("opruimen vóór het supportantwoord zet niets meer en verwijdert de luisteraar", async () => {
  const f = fixture();
  f.bar.start(); f.bar.dispose(); await settle();
  assert.equal(f.removed(), 1); assert.equal(f.payloads.length, 0); assert.equal(f.attributes.size, 0);
});

test("een bestaand attribuut of hoogte wordt na opruimen hersteld", async () => {
  const f = fixture();
  f.attributes.set("data-vs-native-tabbar", "preset"); f.styles.set("--vs-native-tabbar-height", "10px");
  f.bar.start(); f.bar.update(state()); await settle();
  f.bar.dispose(); await settle();
  assert.equal(f.attributes.get("data-vs-native-tabbar"), "preset"); assert.equal(f.styles.get("--vs-native-tabbar-height"), "10px");
});

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test("scenario: native balk verschijnt, de gebruiker navigeert, een volgende synchronisatie faalt, native balk weg en React-balk volledig terug", async () => {
  // Aanroepen: 1 verborgen, 2 zichtbaar, 3 na de navigatie (selectiewijziging): die faalt.
  const f = fixture({ sync: (_payload, call) => { if (call === 3) throw new Error("tabbar_unavailable"); return { height: 83 }; } });
  f.bar.start(); f.bar.update(state()); await settle();
  assert.equal(f.payloads.at(-1)!.visible, true);
  assert.equal(f.attributes.get("data-vs-native-tabbar"), "true", "1. native balk is zichtbaar, React-balk is ruimtehouder");
  f.select({ id: "learn" }); await settle();
  assert.deepEqual(f.hrefs, ["/courses"], "2. de tik navigeert via de bestaande href");
  f.bar.update(state({ selectedId: "learn" })); await settle();
  // 3. de synchronisatie na de navigatie faalde; 4. de native balk is eerst verwijderd
  assert.equal(f.log.at(-1), "clear");
  assert.deepEqual(f.clearSawAttribute.slice(-1), [true], "de ruimtehouder stond nog toen de native balk werd verwijderd");
  // 5. de React-balk is weer volledig beschikbaar: geen attribuut, geen hoogtevariabele
  assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0);
  assert.ok(f.changes() >= 2, "ShellMetrics meet opnieuw");
});

test("eerste initialisatie: een mislukte luisteraar, support of onverwacht antwoord laat de React-balk staan", async () => {
  const failures: Array<ReturnType<typeof fixture>> = [
    fixture({ listen: () => { throw new Error("listen_failed"); } }),
    fixture({ supportFn: () => { throw new Error("support_failed"); } }),
    fixture({ supportFn: () => undefined }),
    fixture({ supportFn: () => ({ version: 1, available: true, junk: 1 }) }),
  ];
  for (const f of failures) {
    f.bar.start(); f.bar.update(state()); await settle();
    assert.equal(f.payloads.length, 0); assert.equal(f.attributes.size, 0); assert.equal(f.styles.size, 0);
  }
});

test("een achtergebleven native balk (na een WebView-herlaad) wordt bij het opstarten opgeruimd, ook als dat faalt", async () => {
  const ok = fixture();
  ok.bar.start(); await settle();
  assert.deepEqual(ok.log.slice(0, 3), ["listen", "clear", "support"]);
  const failing = fixture({ clear: () => { throw new Error("clear_failed"); } });
  failing.bar.start(); failing.bar.update(state()); await settle();
  assert.equal(failing.attributes.get("data-vs-native-tabbar"), "true", "een mislukte opruiming bij het opstarten blokkeert de systeemtabbalk niet");
});

test("een hangende bridge (support, sync of clear) houdt de React-balk niet langer dan de time-out verborgen", async () => {
  const hang = new Promise<never>(() => {});
  const support = fixture({ supportFn: () => hang });
  support.bar.start(); support.bar.update(state());
  await wait(TAB_BAR_CALL_TIMEOUT_MS + 200);
  assert.equal(support.payloads.length, 0); assert.equal(support.attributes.size, 0);

  const sync = fixture({ sync: (_payload, call) => (call === 2 ? hang : { height: 83 }) });
  sync.bar.start(); sync.bar.update(state()); await settle();
  assert.equal(sync.attributes.get("data-vs-native-tabbar"), "true");
  await wait(TAB_BAR_CALL_TIMEOUT_MS + 300);
  assert.equal(sync.attributes.size, 0, "na de time-out van de tweede synchronisatie is de React-balk terug");
});

test("opruimen: een falende of hangende clear laat de React-balk toch terugkeren", async () => {
  const failing = fixture({ clear: call => { if (call > 1) throw new Error("clear_failed"); } });
  failing.bar.start(); failing.bar.update(state()); await settle();
  failing.bar.dispose(); await settle();
  assert.equal(failing.attributes.size, 0); assert.equal(failing.styles.size, 0);

  const hang = new Promise<never>(() => {});
  const hanging = fixture({ clear: call => (call > 1 ? hang : undefined) });
  hanging.bar.start(); hanging.bar.update(state()); await settle();
  hanging.bar.dispose();
  assert.equal(hanging.attributes.get("data-vs-native-tabbar"), "true", "de ruimtehouder blijft staan zolang de native balk nog verdwijnt");
  await wait(TAB_BAR_CALL_TIMEOUT_MS + 300);
  assert.equal(hanging.attributes.size, 0, "maar nooit langer dan de time-out");
});

test("een vertraagd native antwoord na opruimen of terugval herstelt geen oude balk", async () => {
  let release!: (value: unknown) => void;
  const late = fixture({ sync: (_payload, call) => (call === 1 ? new Promise(resolve => { release = resolve; }) : { height: 83 }) });
  late.bar.start(); late.bar.update(state()); await settle();
  late.bar.dispose(); await settle();
  release({ height: 83 }); await settle();
  assert.equal(late.attributes.size, 0, "een antwoord ná dispose zet niets terug");
  assert.equal(late.payloads.length, 1, "en veroorzaakt geen vervolgsynchronisatie");

  // Terugval tijdens een lopend verzoek: het late antwoord van het eerdere verzoek is verlopen.
  let resolveFirst!: (value: unknown) => void;
  const stale = fixture({ sync: (_payload, call) => (call === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : { height: 83 }) });
  stale.bar.start(); stale.bar.update(state()); await settle();
  stale.layout({ height: 90 });
  assert.equal(stale.attributes.size, 0, "een lay-outmelding vóór de bevestiging telt niet");
  resolveFirst({ height: 83 }); await settle();
  assert.equal(stale.attributes.get("data-vs-native-tabbar"), "true");
});

test("terugkeer uit de achtergrond: resync stuurt de gewenste staat opnieuw, zonder dubbele balk of verloren selectie", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state({ selectedId: "learn" })); await settle();
  const before = f.payloads.length;
  f.bar.resync(); await settle();
  assert.equal(f.payloads.length, before + 1);
  assert.equal(f.payloads.at(-1)!.selectedId, "learn"); assert.equal(f.payloads.at(-1)!.visible, true);
  assert.equal(f.attributes.get("data-vs-native-tabbar"), "true");
});

test("rotatie en Dynamic Type: elke hoogtewijziging werkt de ruimtehouder bij, ongeldige hoogtes niet", async () => {
  const f = fixture();
  f.bar.start(); f.bar.update(state()); await settle();
  for (const [height, expected] of [[83, "83px"], [49, "49px"], [96.2, "97px"], [0, "97px"], [-5, "97px"], [Number.NaN, "97px"], [500, "97px"]] as const) {
    f.layout({ height });
    assert.equal(f.styles.get("--vs-native-tabbar-height"), expected, `hoogte ${height}`);
  }
});

test("iOS 15–25 en Android: React-navigatie blijft volledig werken zonder native ondersteuning", async () => {
  const old = fixture({ support: { version: 1, available: false } });
  old.bar.start(); old.bar.update(state()); old.select({ id: "learn" }); await settle();
  assert.equal(old.attributes.size, 0); assert.equal(old.payloads.length, 0); assert.deepEqual(old.hrefs, ["/courses"].slice(0, 0));
  const android = fixture({ platform: "android" });
  android.bar.start(); android.bar.update(state()); await settle();
  assert.deepEqual(android.log, []);
});

test("contract: de plugin registreert de methoden, beperkt tot de lokale client, en meldt alleen id's en hoogtes", () => {
  const swift = readFileSync("ios/App/App/VersadoNativePlugin.swift", "utf8");
  for (const name of ["tabBarSupport", "tabBarSync", "tabBarClear"]) {
    assert.ok(swift.includes(`CAPPluginMethod(name: "${name}"`), `${name} geregistreerd`);
    assert.match(swift, new RegExp(`@objc func ${name}[\\s\\S]*?guard localOnly\\(call\\)`), `${name} is localOnly`);
  }
  assert.ok(swift.includes('notifyListeners("tabBarSelect", data: ["id": id])'));
  assert.ok(swift.includes('notifyListeners("tabBarLayout", data: ["height": Double(height)])'));
  assert.ok(swift.includes("NativeTabBarPolicy.parse"), "payload wordt strikt gevalideerd vóór UIKit");
  const policy = readFileSync("ios/App/App/NativeTabBarPolicy.swift", "utf8");
  assert.ok(policy.includes("majorVersion >= 26"), "alleen iOS 26 en nieuwer");
  assert.doesNotMatch(policy, /import UIKit|import Capacitor/, "beleid blijft zuiver Foundation (macOS-policyproef)");
  const view = readFileSync("ios/App/App/NativeTabBar.swift", "utf8");
  assert.match(view, /NativeTabBarPolicy\.symbols\[entry\.id\]/, "symbolen volgen uit het id, nooit uit JavaScript");
});

test("contract: nieuwe Swift-bestanden en accentkleur zitten in het Xcode-project", () => {
  const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");
  for (const file of ["NativeTabBarPolicy.swift", "NativeTabBar.swift"]) {
    // Eén keer als PBXBuildFile en één keer in de Sources-fase van het doel.
    assert.equal((project.match(new RegExp(`${file.replace(".", "\\.")} in Sources`, "g")) ?? []).length, 2, `${file} in Sources`);
    assert.ok(project.includes(`path = ${file};`));
  }
  const colors = JSON.parse(readFileSync("ios/App/App/Assets.xcassets/AccentColor.colorset/Contents.json", "utf8")) as { colors: Array<{ appearances?: unknown[]; color: { components: Record<string, string> } }> };
  assert.equal(colors.colors.length, 2);
  const [light, dark] = [colors.colors.find(c => !c.appearances)!, colors.colors.find(c => c.appearances)!];
  const px = (c: typeof light) => ["red", "green", "blue"].map(k => Math.round(parseFloat(c.color.components[k]) * 255));
  const css = readFileSync("src/app/globals.css", "utf8");
  const accent = (block: string) => block.match(/--vs-accent:\s*(\d+) (\d+) (\d+);/)!.slice(1).map(Number);
  const rootBlock = css.slice(css.indexOf("--vs-accent:") - 40);
  const darkIndex = css.indexOf("--vs-accent:", css.indexOf("--vs-accent:") + 1);
  assert.deepEqual(px(light), accent(rootBlock));
  assert.deepEqual(px(dark), accent(css.slice(darkIndex - 40)));
});

test("contract: de React-balk wordt alleen een ruimtehouder na bevestigde native balk, en ShellMetrics meldt elke meting", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const rule = css.slice(css.indexOf('html[data-vs-native-tabbar="true"] nav[data-main-nav] {'));
  assert.match(rule, /height: var\(--vs-native-tabbar-height, 0px\) !important;/);
  assert.match(rule, /pointer-events: none;/);
  assert.match(css, /html\[data-vs-native-tabbar="true"\] nav\[data-main-nav\] > \* \{\s*visibility: hidden;/);
  assert.match(readFileSync("src/components/shell/ShellMetrics.tsx", "utf8"), /dispatchEvent\(new Event\("vs-shell-metrics"\)\)/);
  const foundation = readFileSync("src/components/native/NativeFoundation.tsx", "utf8");
  assert.ok(foundation.includes("<NativeTabBarSync items={destinations} />"));
  const sync = readFileSync("src/components/native/NativeTabBarSync.tsx", "utf8");
  assert.ok(sync.includes('appPlatform() === "ios"'));
  assert.ok(sync.includes("t(item.labelKey)"), "labels volgen de bestaande i18n-sleutels van BottomNav");
});

test("contract: een open modaal paneel of rondleiding verbergt de native balk", () => {
  const source = readFileSync(new URL("../src/components/native/NativeTabBarSync.tsx", import.meta.url), "utf8");
  assert.match(source, /dialog\[open\], \[aria-modal="true"\]/);
  assert.match(source, /navVisible && !modalOpen/);
});
