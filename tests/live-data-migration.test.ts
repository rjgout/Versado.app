import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LiveDataStore, type LiveEnvironment } from "../src/lib/data/store";
import { DATA_EVENTS, SOCKET_EVENT_TO_DATA_EVENT, dataEventsForSocketEvent, scopesForEvent, type DataScope } from "../src/lib/data/scopes";

// Gerichte tests voor de vier gemigreerde componenten (ActiveGamesBanner, FriendsClient,
// GroupDetailClient, ProfileClient): dezelfde scopes en keys als in de componenten, met de
// echte store en een nepomgeving. De componenten zelf zijn browsercode; hun bedrading staat
// in de broncontroles onderaan.

function makeEnv() {
  const state = { now: 1_000_000, visible: true, online: true };
  const env: LiveEnvironment = {
    now: () => state.now,
    isVisible: () => state.visible,
    isOnline: () => state.online,
    random: () => 0,
    schedule: (fn) => {
      fn();
      return () => {};
    },
  };
  return { env, state, advance: (ms: number) => void (state.now += ms) };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function source<T>(read: () => T) {
  let calls = 0;
  return { fetcher: async () => (calls += 1, read()), calls: () => calls };
}

// Zelfde queries als in de componenten.
const QUERY = {
  activeGames: { key: ["games", "activity", { content: "bom", language: "nl" }], scopes: ["games"] as DataScope[], staleTime: 1_000 },
  friends: { key: ["friends", "list"], scopes: ["friends"] as DataScope[], staleTime: 1_000 },
  friendStreaks: { key: ["friends", "streaks"], scopes: ["friends", "streak"] as DataScope[], staleTime: 1_000 },
  group: { key: ["groups", "detail", "g1"], scopes: ["groups", "streak"] as DataScope[], staleTime: 1_000 },
  profile: { key: ["profile", "me"], scopes: ["profile", "xp", "streak", "competition"] as DataScope[], staleTime: undefined },
};

test("ActiveGamesBanner: een spelgebeurtenis ververst de actieve spellen, zonder eigen luisteraar", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let games = [{ id: "a", myTurn: false }];
  const s = source(() => games);
  const o = store.observe(QUERY.activeGames.key, { fetcher: s.fetcher, scopes: QUERY.activeGames.scopes, staleTime: QUERY.activeGames.staleTime });
  await flush();
  // Elke bestaande socket-gebeurtenis van de banner is gekoppeld aan de centrale laag.
  for (const socketEvent of ["game_cancelled", "game_left", "game_invite", "game_invite_revoked", "scrabble_updated"] as const) {
    const events = dataEventsForSocketEvent(socketEvent);
    assert.ok(events.includes("gamesChanged"), `${socketEvent} moet gamesChanged geven`);
  }
  games = [{ id: "a", myTurn: true }];
  for (const event of dataEventsForSocketEvent("game_invite")) store.invalidate(event);
  await flush();
  assert.deepEqual(store.getSnapshot(o.entryKey).data, [{ id: "a", myTurn: true }]);
  assert.equal(s.calls(), 2);
});

test("ActiveGamesBanner: terugkeren (focus) toont de actuele status, ook zonder gebeurtenis", async () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  let state = "wacht";
  const s = source(() => state);
  const o = store.observe(QUERY.activeGames.key, { fetcher: s.fetcher, scopes: QUERY.activeGames.scopes, staleTime: QUERY.activeGames.staleTime });
  await flush();
  state = "jouw beurt"; // de tegenstander speelde terwijl de gebruiker weg was
  advance(5_000);
  store.revalidate();
  await flush();
  assert.equal(store.getSnapshot(o.entryKey).data, "jouw beurt");
});

test("ActiveGamesBanner: een geannuleerde uitnodiging raakt alleen games en Vandaag, niet vrienden of profiel", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const games = source(() => 1);
  const friends = source(() => 1);
  const profile = source(() => 1);
  store.observe(QUERY.activeGames.key, { fetcher: games.fetcher, scopes: QUERY.activeGames.scopes });
  store.observe(QUERY.friends.key, { fetcher: friends.fetcher, scopes: QUERY.friends.scopes });
  store.observe(QUERY.profile.key, { fetcher: profile.fetcher, scopes: QUERY.profile.scopes });
  await flush();
  store.invalidate("gamesChanged");
  await flush();
  assert.equal(games.calls(), 2);
  assert.equal(friends.calls(), 1);
  assert.equal(profile.calls(), 1);
  assert.deepEqual([...scopesForEvent("gamesChanged")].sort(), ["games", "today"]);
});

test("ActiveGamesBanner: een andere contentselectie is een andere key (geen oude status)", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const bom = store.observe(["games", "activity", { content: "bom", language: "nl" }], { fetcher: async () => "bom-spellen", scopes: ["games"] });
  await flush();
  const dc = store.observe(["games", "activity", { content: "dc", language: "nl" }], { fetcher: async () => "dc-spellen", scopes: ["games"] });
  assert.equal(store.getSnapshot(dc.entryKey).data, undefined);
  await flush();
  assert.equal(store.getSnapshot(dc.entryKey).data, "dc-spellen");
  assert.equal(store.getSnapshot(bom.entryKey).data, "bom-spellen");
});

test("FriendsClient: een vriendschapsmutation ververst lijst en vriendenreeksen, en de lijst is direct bij te werken", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let friends: string[] = ["Anna"];
  const list = source(() => friends);
  const streaks = source(() => ({ activeCount: 0 }));
  const unrelated = source(() => "x");
  const l = store.observe(QUERY.friends.key, { fetcher: list.fetcher, scopes: QUERY.friends.scopes, staleTime: QUERY.friends.staleTime });
  store.observe(QUERY.friendStreaks.key, { fetcher: streaks.fetcher, scopes: QUERY.friendStreaks.scopes, staleTime: QUERY.friendStreaks.staleTime });
  store.observe(["groups", "detail", "g1"], { fetcher: unrelated.fetcher, scopes: ["groups"] });
  await flush();
  // Verzoek geaccepteerd: lokaal direct zichtbaar (zoals de presence-updates), daarna gevalideerd.
  store.setData<string[]>(QUERY.friends.key, (previous) => [...(previous ?? []), "Ben"]);
  assert.deepEqual(store.getSnapshot(l.entryKey).data, ["Anna", "Ben"]);
  friends = ["Anna", "Ben"];
  store.invalidate("friendsChanged");
  await flush();
  assert.deepEqual(store.getSnapshot(l.entryKey).data, ["Anna", "Ben"]);
  assert.equal(list.calls(), 2);
  assert.equal(streaks.calls(), 2, "vriendenreeksen horen bij scope friends en worden mee ververst");
  assert.equal(unrelated.calls(), 1, "een groep (scope groups) wordt door een vriendschapswijziging niet opnieuw opgehaald");
});

test("FriendsClient: terugkeer/focus controleert verouderde vrienden opnieuw, en friends_changed van de server ook", async () => {
  const { env, advance } = makeEnv();
  const store = new LiveDataStore(env);
  let pending = 1;
  const s = source(() => pending);
  const o = store.observe(QUERY.friends.key, { fetcher: s.fetcher, scopes: QUERY.friends.scopes, staleTime: QUERY.friends.staleTime });
  await flush();
  pending = 0; // de ander heeft geaccepteerd terwijl de app op de achtergrond stond
  advance(10_000);
  store.revalidate();
  await flush();
  assert.equal(store.getSnapshot(o.entryKey).data, 0);
  pending = 2;
  for (const event of dataEventsForSocketEvent("friends_changed")) store.invalidate(event);
  await flush();
  assert.equal(store.getSnapshot(o.entryKey).data, 2);
});

test("FriendsClient: een geschonken bevriezing ververst reeks en profiel, niet de vriendenlijst", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const list = source(() => 1);
  const profile = source(() => 1);
  store.observe(QUERY.friends.key, { fetcher: list.fetcher, scopes: QUERY.friends.scopes });
  store.observe(QUERY.profile.key, { fetcher: profile.fetcher, scopes: QUERY.profile.scopes });
  await flush();
  store.invalidate(["streak", "profile", "today"]);
  await flush();
  assert.equal(list.calls(), 1);
  assert.equal(profile.calls(), 2);
});

test("GroupDetailClient: een groepsmutation ververst alleen groepsdata, niet vrienden of cursussen", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let members = 3;
  const group = source(() => ({ members }));
  const otherGroup = source(() => "andere groep");
  const courses = source(() => "cursussen");
  const friends = source(() => "vrienden");
  const g = store.observe(QUERY.group.key, { fetcher: group.fetcher, scopes: QUERY.group.scopes, staleTime: QUERY.group.staleTime });
  store.observe(["groups", "detail", "g2"], { fetcher: otherGroup.fetcher, scopes: ["groups", "streak"] });
  store.observe(["courses", "list"], { fetcher: courses.fetcher, scopes: ["courses", "progress"] });
  store.observe(QUERY.friends.key, { fetcher: friends.fetcher, scopes: QUERY.friends.scopes });
  await flush();
  members = 4; // toegangsverzoek goedgekeurd
  store.invalidate("groupsChanged");
  await flush();
  assert.deepEqual(store.getSnapshot(g.entryKey).data, { members: 4 });
  assert.equal(courses.calls(), 1);
  assert.equal(friends.calls(), 1);
});

test("GroupDetailClient: activiteit van leden (groepsreeks) ververst de groep via scope streak; verborgen tab niet", async () => {
  const { env, state } = makeEnv();
  const store = new LiveDataStore(env);
  const group = source(() => 1);
  store.observe(QUERY.group.key, { fetcher: group.fetcher, scopes: QUERY.group.scopes, staleTime: QUERY.group.staleTime });
  await flush();
  state.visible = false;
  store.invalidate("activityCompleted");
  await flush();
  assert.equal(group.calls(), 1, "geen aanvraag in een verborgen tab");
  state.visible = true;
  store.revalidate();
  await flush();
  assert.equal(group.calls(), 2);
});

test("ProfileClient: XP, reeks en activiteit elders maken het profiel verouderd; terug op het profiel is het actueel", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  let profile = { xpTotal: 100, currentStreak: 3 };
  const s = source(() => ({ ...profile }));
  const o = store.observe(QUERY.profile.key, { fetcher: s.fetcher, scopes: QUERY.profile.scopes });
  await flush();
  // De gebruiker verlaat het profiel (geen observer), rondt elders een activiteit af, en komt terug.
  const release = store.observe(QUERY.profile.key, { fetcher: s.fetcher, scopes: QUERY.profile.scopes }).release;
  release();
  profile = { xpTotal: 150, currentStreak: 4 };
  for (const event of ["xpChanged", "activityCompleted"] as const) assert.ok(scopesForEvent(event).includes("profile"), `${event} raakt het profiel`);
  store.invalidate("xpChanged");
  await flush();
  assert.deepEqual(store.getSnapshot(o.entryKey).data, { xpTotal: 150, currentStreak: 4 });
});

test("ProfileClient: een eigen instelling is direct zichtbaar zonder extra profielaanvraag; Vandaag wordt wel verouderd", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const profile = source(() => ({ shareOnlineStatus: true }));
  const today = source(() => "vandaag");
  const o = store.observe(QUERY.profile.key, { fetcher: profile.fetcher, scopes: QUERY.profile.scopes });
  store.observe(["today"], { fetcher: today.fetcher, scopes: ["today"] });
  await flush();
  store.setData<{ shareOnlineStatus: boolean }>(QUERY.profile.key, (previous) => ({ ...previous!, shareOnlineStatus: false }));
  assert.deepEqual(store.getSnapshot(o.entryKey).data, { shareOnlineStatus: false });
  store.invalidate(["today"]);
  await flush();
  assert.equal(profile.calls(), 1, "geen extra profielaanvraag na een optimistische update");
  assert.equal(today.calls(), 2);
});

test("ProfileClient: een updater zonder bestaande data laat het profiel ongemoeid", async () => {
  const { env } = makeEnv();
  const store = new LiveDataStore(env);
  const o = store.observe(QUERY.profile.key, { fetcher: async () => ({ a: 1 }), scopes: QUERY.profile.scopes });
  await flush();
  store.setData<{ a: number }>(QUERY.profile.key, (previous) => (previous ? { a: previous.a + 1 } : previous));
  assert.deepEqual(store.getSnapshot(o.entryKey).data, { a: 2 });
});

test("de gamesChanged-koppeling en alle andere socket-gebeurtenissen verwijzen naar bestaande gebeurtenissen", () => {
  assert.ok("gamesChanged" in DATA_EVENTS);
  for (const socketEvent of Object.keys(SOCKET_EVENT_TO_DATA_EVENT) as Array<keyof typeof SOCKET_EVENT_TO_DATA_EVENT>) {
    for (const event of dataEventsForSocketEvent(socketEvent)) assert.ok(event in DATA_EVENTS);
  }
});

// --- Bedrading van de componenten zelf ------------------------------------------------------

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const FORBIDDEN = /addEventListener\(\s*["'](visibilitychange|focus|online|pageshow)["']|setInterval\(|window\.location\.reload\(|socket\.on\(\s*["']friends_changed["']/;

const MIGRATED: Record<string, { key: string; scopes: string[] }> = {
  "src/components/ActiveGamesBanner.tsx": { key: '["games", "activity"]', scopes: ['scopes: ["games"]'] },
  "src/components/FriendsClient.tsx": { key: '["friends", "list"]', scopes: ['scopes: ["friends"]', 'scopes: ["friends", "streak"]'] },
  "src/components/social/GroupDetailClient.tsx": { key: '["groups", "detail", groupId]', scopes: ['scopes: ["groups", "streak"]'] },
  "src/components/ProfileClient.tsx": { key: '["profile", "me"]', scopes: ['scopes: ["profile", "xp", "streak", "competition"]'] },
};

for (const [file, expected] of Object.entries(MIGRATED)) {
  test(`${path.basename(file)} gebruikt de centrale laag en heeft geen eigen verversingslogica meer`, () => {
    const text = read(file);
    assert.match(text, /useLiveQuery</);
    assert.ok(text.includes(expected.key), `${file}: key ${expected.key}`);
    for (const scope of expected.scopes) assert.ok(text.includes(scope), `${file}: ${scope}`);
    assert.doesNotMatch(text, FORBIDDEN, `${file} bevat nog eigen refresh-/focus-/pollinglogica`);
    assert.doesNotMatch(text, /useState<[^>]*(Data|Status|Loaded)[^>]*\| null>\(null\)/, `${file}: data hoort in useLiveQuery, niet in useState`);
  });
}

test("ActiveGamesBanner is contentgebonden en ververst na een annulering via de mutation-laag", () => {
  const text = read("src/components/ActiveGamesBanner.tsx");
  assert.match(text, /contentScoped:\s*true/);
  assert.match(text, /invalidates:\s*"gamesChanged"/);
});

test("ProfileClient heeft geen router.refresh() voor dataverversing en zijn aftelling staat buiten het component", () => {
  const text = read("src/components/ProfileClient.tsx");
  const reset = text.slice(text.indexOf("async function resetReadingProgress"), text.indexOf("async function changeReminderTime"));
  assert.ok(reset.length > 100 && !reset.includes("router.refresh"), "reset-reading verversen gaat via invalidatie");
  assert.match(reset, /invalidates:\s*\["progress", "courses", "profile", "today"\]/);
  assert.match(text, /startCountdown\(/);
  assert.match(read("src/lib/countdown.ts"), /setInterval\(/);
});

test("FriendsClient zendt na elke vriendenaanvraag nog steeds om de live-status (presence), maar ververst niet zelf", () => {
  const text = read("src/components/FriendsClient.tsx");
  assert.match(text, /friend_statuses_request/);
  assert.match(text, /friend_status_update/);
  assert.doesNotMatch(text, /function load\(|async function load\(|loadStreaks/);
});
