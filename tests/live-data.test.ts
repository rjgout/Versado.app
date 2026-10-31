import assert from "node:assert/strict";
import test from "node:test";
import { LiveDataStore, DEFAULT_STALE_TIME, GC_TIME, PAGE_MIN_REFRESH_INTERVAL, type LiveEnvironment } from "../src/lib/data/store";
import { DATA_EVENTS, DATA_SCOPES, LIVE_TOPICS, SOCKET_EVENT_TO_DATA_EVENT, dataEventsForSocketEvent, isDataEvent, isLiveTopic, scopesForEvent } from "../src/lib/data/scopes";

// Een nepomgeving: eigen klok, zichtbaarheid, netwerk en timers, zodat het
// gedrag van de store (focus, offline, verborgen tab) deterministisch te testen is.
function makeEnv() {
  const state = { now: 1_000_000, visible: true, online: true, timers: [] as { at: number; fn: () => void; cancelled: boolean }[] };
  const env: LiveEnvironment = {
    now: () => state.now,
    isVisible: () => state.visible,
    isOnline: () => state.online,
    random: () => 0.5,
    schedule: (fn, ms) => {
      const timer = { at: state.now + ms, fn, cancelled: false };
      state.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  const advance = (ms: number) => {
    state.now += ms;
    for (const timer of state.timers.filter((t) => !t.cancelled && t.at <= state.now)) {
      timer.cancelled = true;
      timer.fn();
    }
  };
  return { env, state, advance };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function counter<T>(value: () => T) {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return value();
  };
  return { fetcher, calls: () => calls };
}

test("de gebeurtenistabel verwijst alleen naar bestaande datasets", () => {
  for (const [event, scopes] of Object.entries(DATA_EVENTS)) {
    assert.ok(scopes.length > 0, `${event} maakt niets ongeldig`);
    for (const scope of scopes) assert.ok((DATA_SCOPES as readonly string[]).includes(scope), `${event}: onbekende scope ${scope}`);
  }
  for (const event of Object.values(LIVE_TOPICS)) assert.ok(isDataEvent(event));
  for (const socketEvent of Object.keys(SOCKET_EVENT_TO_DATA_EVENT) as Array<keyof typeof SOCKET_EVENT_TO_DATA_EVENT>) {
    for (const event of dataEventsForSocketEvent(socketEvent)) assert.ok(isDataEvent(event));
  }
  assert.equal(isLiveTopic("word-game-ranking"), true);
  assert.equal(isLiveTopic("admin-secrets"), false);
  assert.equal(isDataEvent("__proto__"), false);
});

test("E: meerdere componenten met dezelfde key halen één keer op", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const source = counter(() => ({ xp: 10 }));
  const a = store.observe(["xp"], { fetcher: source.fetcher, scopes: ["xp"] });
  const b = store.observe(["xp"], { fetcher: source.fetcher, scopes: ["xp"] });
  const c = store.observe(["xp"], { fetcher: source.fetcher, scopes: ["xp"] });
  await flush();
  assert.equal(source.calls(), 1);
  assert.equal(a.entryKey, b.entryKey);
  assert.deepEqual(store.getSnapshot(c.entryKey).data, { xp: 10 });
  // Verse data wordt niet opnieuw opgehaald door een volgende component.
  store.observe(["xp"], { fetcher: source.fetcher, scopes: ["xp"] });
  await flush();
  assert.equal(source.calls(), 1);
});

test("B: een afgeronde activiteit ververst alleen de in beeld zijnde, gerelateerde data", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let progress = 1;
  const courses = counter(() => ({ done: progress }));
  const settings = counter(() => ({ theme: "dark" }));
  const catalog = counter(() => ["a"]);
  const c = store.observe(["courses"], { fetcher: courses.fetcher, scopes: ["courses", "progress"] });
  const s = store.observe(["settings"], { fetcher: settings.fetcher, scopes: ["profile"] });
  const hidden = store.observe(["catalog"], { fetcher: catalog.fetcher, scopes: ["courses"] });
  await flush();
  hidden.release(); // niet meer in beeld
  progress = 2;
  store.invalidate("activityCompleted");
  await flush();
  assert.deepEqual(store.getSnapshot(c.entryKey).data, { done: 2 });
  assert.equal(courses.calls(), 2);
  // Profiel hoort ook bij activityCompleted (statistieken) en wordt dus ververst; de ongezien catalogus niet.
  assert.equal(settings.calls(), 2);
  assert.equal(catalog.calls(), 1);
  // De catalogus is wel als verouderd gemarkeerd, en wordt pas opgehaald zodra hij weer in beeld komt.
  assert.equal(store.getSnapshot(hidden.entryKey).invalidated, true);
  store.observe(["catalog"], { fetcher: catalog.fetcher, scopes: ["courses"] });
  await flush();
  assert.equal(catalog.calls(), 2);
  void s;

  // Ongerelateerde gebeurtenis: niets opnieuw.
  const before = courses.calls();
  store.invalidate("wordGameScored");
  await flush();
  assert.equal(courses.calls(), before);
});

test("een invalidatie tijdens een lopende fetch wordt niet verloren", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let serverValue = 1;
  let release: (() => void) | null = null;
  let calls = 0;
  const fetcher = () => {
    calls += 1;
    const answer = serverValue;
    return new Promise<number>((resolve) => {
      release = () => resolve(answer);
    });
  };
  const o = store.observe(["slow"], { fetcher, scopes: ["xp"] });
  await flush();
  serverValue = 2; // de server verandert terwijl de eerste aanvraag onderweg is
  store.invalidate(["xp"]);
  release!();
  await flush();
  await flush();
  assert.equal(calls, 2, "na het binnenkomen van het achterhaalde antwoord volgt een tweede ronde");
  release!();
  await flush();
  assert.equal(store.getSnapshot<number>(o.entryKey).data, 2);
  assert.equal(store.getSnapshot(o.entryKey).invalidated, false);
});

test("app hervatten tijdens een aanvraag bewaart één hercontrole zonder parallelle fetch", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let serverValue = 1;
  let release: (() => void) | undefined;
  let calls = 0;
  const o = store.observe(["readingPosition", "edition"], {
    scopes: ["readingPosition"],
    fetcher: () => {
      calls += 1;
      const answer = serverValue;
      return new Promise<number>((resolve) => { release = () => resolve(answer); });
    },
  });
  await flush();
  serverValue = 2;
  store.revalidate({ force: true });
  store.revalidate({ force: true });
  assert.equal(calls, 1, "hervatsignalen starten geen parallelle aanvragen");
  release!();
  await flush();
  assert.equal(calls, 2, "het oude antwoord wordt gevolgd door één hercontrole");
  release!();
  await flush();
  assert.equal(store.getSnapshot<number>(o.entryKey).data, 2);
  assert.equal(store.getSnapshot(o.entryKey).invalidated, false);
  assert.equal(calls, 2, "geen permanente herhaallus");
});

test("C: tab terug naar voren controleert alleen verouderde data opnieuw", async () => {
  const { env, state, advance } = makeEnv();
  const store = new LiveDataStore(env);
  const fresh = counter(() => 1);
  const old = counter(() => 1);
  store.observe(["old"], { fetcher: old.fetcher, scopes: ["xp"], staleTime: 5_000 });
  await flush();
  advance(20_000);
  store.observe(["fresh"], { fetcher: fresh.fetcher, scopes: ["xp"], staleTime: 60_000 });
  await flush();
  state.visible = false;
  store.revalidate();
  await flush();
  assert.equal(old.calls(), 1, "verborgen: geen requests");
  state.visible = true;
  store.revalidate();
  await flush();
  assert.equal(old.calls(), 2, "verouderd: opnieuw");
  assert.equal(fresh.calls(), 1, "vers: niet opnieuw");
});

test("D: een verborgen tab doet geen requests, ook niet bij invalidatie of polling", async () => {
  const { env, state, advance } = makeEnv();
  const store = new LiveDataStore(env);
  const polled = counter(() => 1);
  store.observe(["polled"], { fetcher: polled.fetcher, scopes: ["activity"], pollMs: 10_000 });
  await flush();
  state.visible = false;
  advance(60_000);
  store.tick();
  store.invalidate("activityCompleted");
  await flush();
  assert.equal(polled.calls(), 1);
  // Bij terugkeer volgt direct één verversing, omdat hij ongeldig is verklaard.
  state.visible = true;
  store.revalidate();
  await flush();
  assert.equal(polled.calls(), 2);
});

test("polling gebeurt alleen voor wie erom vraagt en hooguit zo vaak als gevraagd", async () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  const polled = counter(() => 1);
  const plain = counter(() => 1);
  store.observe(["polled"], { fetcher: polled.fetcher, scopes: ["activity"], pollMs: 30_000 });
  store.observe(["plain"], { fetcher: plain.fetcher, scopes: ["profile"] });
  await flush();
  advance(10_000);
  store.tick();
  await flush();
  assert.equal(polled.calls(), 1, "nog niet aan de beurt");
  advance(25_000);
  store.tick();
  await flush();
  assert.equal(polled.calls(), 2);
  assert.equal(plain.calls(), 1, "zonder pollMs nooit via de klok");
});

test("H: offline wacht, terug online synchroniseert alles dat in beeld is", async () => {
  const { env, state } = makeEnv();
  const store = new LiveDataStore(env);
  const a = counter(() => "a");
  const b = counter(() => "b");
  store.observe(["a"], { fetcher: a.fetcher, scopes: ["xp"] });
  store.observe(["b"], { fetcher: b.fetcher, scopes: ["friends"] });
  await flush();
  state.online = false;
  store.invalidate("xpChanged");
  await flush();
  assert.equal(a.calls(), 1, "offline: geen poging");
  state.online = true;
  store.revalidate({ force: true });
  await flush();
  assert.equal(a.calls(), 2);
  assert.equal(b.calls(), 2, "force controleert ook verse data: er kan iets gemist zijn");
});

test("een fout laat eerder geldige data staan en probeert het later opnieuw", async () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  let fail = false;
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (fail) throw new Error("netwerk");
    return calls;
  };
  const o = store.observe(["x"], { fetcher, scopes: ["xp"] });
  await flush();
  fail = true;
  store.invalidate(["xp"]);
  await flush();
  const snapshot = store.getSnapshot<number>(o.entryKey);
  assert.equal(snapshot.data, 1, "oude data blijft zichtbaar");
  assert.equal(snapshot.status, "success");
  assert.ok(snapshot.error instanceof Error);
  assert.equal(snapshot.invalidated, true, "blijft verouderd, dus later opnieuw");
  assert.equal(calls, 2, "geen lus bij een fout");
  fail = false;
  advance(DEFAULT_STALE_TIME);
  store.revalidate();
  await flush();
  assert.equal(store.getSnapshot<number>(o.entryKey).data, 3);
  assert.equal(store.getSnapshot(o.entryKey).error, null);
});

test("een fout zonder data wordt status error en bij de volgende trigger opnieuw geprobeerd", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let fail = true;
  const o = store.observe(["x"], { fetcher: async () => { if (fail) throw new Error("x"); return 1; }, scopes: ["xp"] });
  await flush();
  assert.equal(store.getSnapshot(o.entryKey).status, "error");
  fail = false;
  store.revalidate();
  await flush();
  assert.equal(store.getSnapshot(o.entryKey).status, "success");
});

test("G: een andere content-identiteit is een andere entry; oude data verschijnt niet", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const bom = store.observe(["courses", { content: "bom", language: "nl" }], { fetcher: async () => ["1 Nephi"], scopes: ["courses"] });
  await flush();
  const dc = store.observe(["courses", { content: "dc", language: "nl" }], { fetcher: async () => ["Afdeling 1"], scopes: ["courses"] });
  // Direct na de wissel: nog geen data van de nieuwe key, zeker niet die van de oude.
  assert.equal(store.getSnapshot(dc.entryKey).data, undefined);
  assert.equal(store.getSnapshot(dc.entryKey).status, "loading");
  await flush();
  assert.deepEqual(store.getSnapshot(dc.entryKey).data, ["Afdeling 1"]);
  assert.deepEqual(store.getSnapshot(bom.entryKey).data, ["1 Nephi"]);
  assert.notEqual(bom.entryKey, dc.entryKey);
});

test("setData toont het antwoord van een mutation direct, invalidate valideert daarna", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let server = { xp: 10 };
  const o = store.observe(["xp"], { fetcher: async () => server, scopes: ["xp"] });
  await flush();
  store.setData<{ xp: number }>(["xp"], (previous) => ({ xp: (previous?.xp ?? 0) + 5 }));
  assert.deepEqual(store.getSnapshot(o.entryKey).data, { xp: 15 });
  server = { xp: 15 };
  store.invalidate("xpChanged");
  await flush();
  assert.deepEqual(store.getSnapshot(o.entryKey).data, { xp: 15 });
});

test("realtime-invalidatie met jitter spreidt de aanvragen", async () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  const ranking = counter(() => []);
  store.observe(["ranking"], { fetcher: ranking.fetcher, scopes: ["wordGameRanking"] });
  await flush();
  store.invalidate("wordGameScored", { jitterMs: 2_000 });
  await flush();
  assert.equal(ranking.calls(), 1, "nog niet: wacht op de eigen jitter");
  advance(1_000);
  await flush();
  assert.equal(ranking.calls(), 2);
});

test("F: een externe score-update ververst het klassement dat in beeld is", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let board = ["A"];
  const o = store.observe(["wordGame", "ranking"], { fetcher: async () => board, scopes: scopesForEvent(LIVE_TOPICS["word-game-ranking"]) });
  await flush();
  board = ["B", "A"];
  store.invalidate(LIVE_TOPICS["word-game-ranking"]); // zo reageert de client op de server-gebeurtenis
  await flush();
  assert.deepEqual(store.getSnapshot(o.entryKey).data, ["B", "A"]);
});

test("data met een verloopmoment is daarna verouderd, ook als staleTime nog niet om is", async () => {
  const { env, state, advance } = makeEnv();
  const store = new LiveDataStore(env);
  const source = counter(() => ({ releaseAt: state.now + 90_000 }));
  const o = store.observe(["word"], {
    fetcher: source.fetcher,
    scopes: ["wordGame"],
    staleTime: 10 * 60_000,
    validUntil: (data, fetchedAt) => fetchedAt + (data.releaseAt - fetchedAt),
  });
  await flush();
  advance(60_000);
  store.tick();
  await flush();
  assert.equal(source.calls(), 1, "nog geldig");
  advance(40_000);
  store.tick();
  await flush();
  assert.equal(source.calls(), 2, "na het verloopmoment haalt de volgende klokslag opnieuw op");
  assert.ok(store.getSnapshot(o.entryKey).data);
  // Een tab die over het verloopmoment heen verborgen was, controleert bij terugkeer.
  state.visible = false;
  advance(200_000);
  state.visible = true;
  store.revalidate();
  await flush();
  assert.equal(source.calls(), 3);
});

test("ongebruikte data wordt na verloop van tijd opgeruimd, gebruikte niet", async () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  const kept = store.observe(["kept"], { fetcher: async () => 1, scopes: ["xp"] });
  const dropped = store.observe(["dropped"], { fetcher: async () => 2, scopes: ["xp"] });
  await flush();
  dropped.release();
  advance(GC_TIME + 1);
  store.tick();
  assert.equal(store.getSnapshot(dropped.entryKey).status, "loading");
  assert.equal(store.getSnapshot(kept.entryKey).data, 1);
});

test("reset (uitloggen) laat niets van de vorige gebruiker achter", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const o = store.observe(["me"], { fetcher: async () => ({ secret: 1 }), scopes: ["profile"] });
  await flush();
  store.reset();
  assert.equal(store.getSnapshot(o.entryKey).data, undefined);
});

// --- Serverpagina's (router.refresh) ----------------------------------------

test("A: Vandaag vraagt na een afgeronde activiteit een verse server-render, ook bij terugnavigeren uit de cache", () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  // 1. Vandaag wordt getoond (verse render, token t1).
  assert.equal(store.noteServerRender("/dashboard", "t1", ["today"]), false);
  // 2. De gebruiker verlaat de pagina en rondt een activiteit af.
  store.invalidate("activityCompleted");
  // 3. Terug (routercache): zelfde token, maar de dataset is ongeldig verklaard.
  assert.equal(store.noteServerRender("/dashboard", "t1", ["today"]), true);
  // 4. Na de verse render (nieuwe token) is er niets meer te doen, en een volgende terugkeer ook niet.
  assert.equal(store.noteServerRender("/dashboard", "t2", ["today"]), false);
  assert.equal(store.noteServerRender("/dashboard", "t2", ["today"]), false);
  // Een te oude cachepagina wordt ook zonder gebeurtenis ververst.
  advance(DEFAULT_STALE_TIME + 1);
  assert.equal(store.noteServerRender("/dashboard", "t2", ["today"]), true);
});

test("een serverpagina ververst zichzelf bij een relevante invalidatie, bij focus als hij verouderd is, en nooit verborgen", () => {
  const { env, state, advance } = makeEnv();
  const store = new LiveDataStore(env);
  let refreshes = 0;
  const handle = store.observePage("/dashboard", { scopes: ["today"], refresh: () => { refreshes += 1; } });

  store.invalidate("wordGameScored");
  assert.equal(refreshes, 0, "ongerelateerd");

  store.invalidate("activityCompleted");
  assert.equal(refreshes, 1);
  handle.markFresh();

  // Focus terwijl de pagina vers is: niets.
  advance(PAGE_MIN_REFRESH_INTERVAL + 1);
  store.revalidate();
  assert.equal(refreshes, 1);

  // Verouderd + focus: wel.
  advance(DEFAULT_STALE_TIME);
  store.revalidate();
  assert.equal(refreshes, 2);
  handle.markFresh();

  // Verborgen tab: wel gemarkeerd, geen verversing; bij zichtbaar volgt die.
  advance(PAGE_MIN_REFRESH_INTERVAL + 1);
  state.visible = false;
  store.invalidate("xpChanged");
  assert.equal(refreshes, 2);
  state.visible = true;
  store.revalidate();
  assert.equal(refreshes, 3);
  handle.release();
});

test("meerdere invalidaties vlak na elkaar leveren één verversing plus een laatste ronde, nooit een storm", () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  let refreshes = 0;
  const handle = store.observePage("/dashboard", { scopes: ["today", "xp"], refresh: () => { refreshes += 1; } });
  store.invalidate("xpChanged");
  store.invalidate("activityCompleted"); // streak_changed volgt vlak na announceXpChanged
  store.invalidate("activityCompleted");
  assert.equal(refreshes, 1);
  handle.markFresh(); // de render van ronde één komt binnen
  advance(PAGE_MIN_REFRESH_INTERVAL);
  assert.equal(refreshes, 2, "één laatste ronde voor wat er tijdens de wachttijd binnenkwam");
  handle.markFresh();
  advance(PAGE_MIN_REFRESH_INTERVAL * 5);
  assert.equal(refreshes, 2);
});

test("een invalidatie terwijl de verversing loopt wordt na de verse render nogmaals verwerkt", () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  let refreshes = 0;
  const handle = store.observePage("/dashboard", { scopes: ["today"], refresh: () => { refreshes += 1; } });
  store.invalidate("activityCompleted");
  assert.equal(refreshes, 1);
  advance(PAGE_MIN_REFRESH_INTERVAL + 1);
  store.invalidate("activityCompleted"); // tijdens de lopende verversing
  handle.markFresh(); // de render van de eerste ronde komt binnen
  assert.equal(refreshes, 2, "de tweede invalidatie is nog niet verwerkt");
  handle.markFresh();
  advance(PAGE_MIN_REFRESH_INTERVAL * 3);
  assert.equal(refreshes, 2);
});

test("een serverpagina met verloopmoment (nieuw woord om 18:00) ververst op de eerstvolgende klokslag, niet eerder", () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  let refreshes = 0;
  const handle = store.observePage("/dashboard", { scopes: ["today"], staleTime: 10 * 60_000, refresh: () => { refreshes += 1; } });
  handle.markFresh();
  handle.setExpiry(env.now() + 90_000);
  advance(60_000);
  store.tick();
  assert.equal(refreshes, 0);
  advance(40_000);
  store.tick();
  assert.equal(refreshes, 1);
  // De nieuwe render heeft een nieuw (of geen) verloopmoment: geen herhaling.
  handle.markFresh();
  advance(PAGE_MIN_REFRESH_INTERVAL * 10);
  store.tick();
  assert.equal(refreshes, 1);
});


test("beschermde bezoekcache verdwijnt onmiddellijk, ook bij jitter, late response en heropenen",async()=>{
 const {env,advance}=makeEnv(),store=new LiveDataStore(env);
 let release:(value:unknown)=>void=()=>{};
 let calls=0;
 const key=["private-visit"],entryKey=JSON.stringify(key);
 const fetcher=()=>{calls++;return calls===1?Promise.resolve({secret:"old"}):calls===2?new Promise(r=>{release=r;}):Promise.reject(Error("revoked"));};
 const first=store.observe(key,{fetcher,scopes:["dorp"],discardOnRevalidate:true});await flush();
 assert.deepEqual(store.getSnapshot(entryKey).data,{secret:"old"});
 store.invalidate("dorpAccessChanged",{jitterMs:1500});
 assert.equal(store.getSnapshot(entryKey).data,undefined);advance(2000);await flush();
 store.invalidate("dorpAccessChanged");release({secret:"late"});await flush();await flush();
 assert.equal(store.getSnapshot(entryKey).data,undefined);assert.ok(store.getSnapshot(entryKey).error);
 first.release();assert.equal(store.getSnapshot(entryKey).data,undefined);
 const reopened=store.observe(key,{fetcher:async()=>({secret:"fresh"}),scopes:["dorp"],discardOnRevalidate:true});await flush();
 assert.deepEqual(store.getSnapshot(entryKey).data,{secret:"fresh"});reopened.release();assert.equal(store.getSnapshot(entryKey).data,undefined);
});

test("beschermde bezoekcache ververst opnieuw na unmount tijdens een lopende aanvraag",async()=>{
 const {env}=makeEnv(),store=new LiveDataStore(env),key=["visit-race"],entryKey=JSON.stringify(key);
 let release:(v:unknown)=>void=()=>{};
 const first=store.observe(key,{fetcher:()=>new Promise(r=>{release=r;}),scopes:["dorp"],discardOnRevalidate:true});
 first.release();store.observe(key,{fetcher:async()=>({fresh:true}),scopes:["dorp"],discardOnRevalidate:true});
 release({stale:true});await flush();await flush();assert.deepEqual(store.getSnapshot(entryKey).data,{fresh:true});
});

test("een mislukte poll blijft begrensd op het gevraagde interval, zonder één aanvraag per klokslag", async () => {
  const { env, advance } = makeEnv(), store = new LiveDataStore(env);
  let calls = 0;
  store.observe(["failed-context"], { scopes: ["content"], pollMs: 15_000, fetcher: async () => { calls++; throw Error("synthetic unavailable"); } });
  await flush(); assert.equal(calls, 1);
  for (let second = 0; second < 14; second++) { advance(1000); store.tick(); await flush(); }
  assert.equal(calls, 1, "Fout veroorzaakt geen versnelde automatische GET-retries");
  advance(1000); store.tick(); await flush(); assert.equal(calls, 2);
  advance(1000); store.tick(); await flush(); assert.equal(calls, 2);
  store.revalidate({ force: true }); await flush(); assert.equal(calls, 3, "Bewust hervatten mag wel direct herstellen");
  store.reset();
});

for (const outcome of ["success", "error"] as const) test(`bevestigde setData overleeft een oudere GET-${outcome}; een nieuwe GET blijft leidend`, async () => {
  const { env } = makeEnv(), store = new LiveDataStore(env);
  let finish!: (value: number) => void, fail!: (error: Error) => void;
  const key = ["confirmed-result"];
  const observer = store.observe(key, { scopes: ["content"], fetcher: () => new Promise<number>((resolve, reject) => { finish = resolve; fail = reject; }) });
  store.setData(key, 2);
  if (outcome === "success") finish(1); else fail(Error("synthetic old read failed"));
  await flush();
  const confirmed = store.getSnapshot(observer.entryKey);
  assert.equal(confirmed.data, 2);
  if (outcome === "success") assert.equal(confirmed.error, null); else assert.ok(confirmed.error instanceof Error);
  assert.equal(confirmed.isFetching, false);
  const newer = store.refetch(observer.entryKey); finish(3); await newer;
  assert.equal(store.getSnapshot(observer.entryKey).data, 3, "Na de bevestiging gestarte GET wordt normaal verwerkt");
  observer.release(); store.reset();
});
