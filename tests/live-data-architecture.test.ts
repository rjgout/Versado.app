import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_EVENTS, DATA_SCOPES, LIVE_TOPICS, SOCKET_EVENT_TO_DATA_EVENT } from "../src/lib/data/scopes";

// Afdwingbare grenzen voor de live-data-standaard (docs/DATA-REFRESH.md). Dit
// is bewust een gewone test: nieuwe code die eigen focus-, polling- of
// verversingslogica bouwt naast de centrale laag, laat `npm run test:live-data` falen.

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const root = process.cwd();
const sources = walk(path.join(root, "src")).map((file) => ({
  file: path.relative(root, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

// Een eigen verversingstrigger (focus, zichtbaarheid, netwerk, bfcache, interval) ...
const OWN_TRIGGER = /addEventListener\(\s*["'](visibilitychange|focus|online|pageshow)["']|setInterval\(/;
// ... in een bestand dat ook zelf data ophaalt of de serverpagina ververst.
const OWN_FETCH = /\bfetch\(|fetchJson\(|router\.refresh\(|\.refresh\(\)/;

/**
 * Bestanden die vóór de live-data-laag bestonden en nog een eigen trigger hebben.
 * Deze lijst mag alleen KRIMPEN: migreer je een bestand naar useLiveQuery/LiveRefresh,
 * haal het hier dan weg (de test dwingt dat af). Nieuwe bestanden komen hier nooit bij;
 * ze gebruiken useLiveQuery, LiveRefresh en liveMutation.
 */
const LEGACY: Record<string, string> = {
  "src/components/ActiveGamesBanner.tsx": "te migreren: hervatlink van lopende spellen",
  "src/components/FriendsClient.tsx": "te migreren: vriendenlijst en -reeksen",
  "src/components/social/GroupDetailClient.tsx": "te migreren: groepsdetail",
  "src/components/StreakContinuation.tsx": "eigen claim-logica (POST met bijwerking), bewust apart",
  "src/components/TimeZoneSync.tsx": "stuurt de tijdzone van het toestel; leest geen data",
  "src/components/ProfileClient.tsx": "timer voor het testbericht; profielgegevens volgen later",
  "src/components/GameRoom.tsx": "socket-gedreven spelsessie met eigen timers",
  "src/components/ChapterGuessGameRoom.tsx": "socket-gedreven spelsessie met eigen timers",
  "src/components/ScrabbleBoardClient.tsx": "socket-gedreven spelsessie met eigen timers",
  "src/components/study/StudyRoom.tsx": "socket-gedreven spelsessie met eigen timers",
  "src/components/AdminDeployClient.tsx": "beheer: voortgang van een lopende taak",
  "src/components/ReseedClient.tsx": "beheer: voortgang van een lopende taak",
  "src/lib/podcastPlayerContext.tsx": "afspeelstatus van de speler, geen servergegevens",
};

test("geen nieuwe eigen verversingslogica buiten de centrale laag", () => {
  const offenders = sources
    .filter(({ file, text }) => !file.startsWith("src/lib/data/") && OWN_TRIGGER.test(text) && OWN_FETCH.test(text))
    .map(({ file }) => file)
    .filter((file) => !(file in LEGACY));
  assert.deepEqual(
    offenders,
    [],
    `Eigen focus-/interval-/verversingslogica gevonden. Gebruik useLiveQuery, LiveRefresh en liveMutation (docs/DATA-REFRESH.md): ${offenders.join(", ")}`
  );
});

test("de legacy-lijst bevat alleen bestanden die nog echt een eigen trigger hebben", () => {
  const stale = Object.keys(LEGACY).filter((file) => {
    const source = sources.find((entry) => entry.file === file);
    return !source || !(OWN_TRIGGER.test(source.text) && OWN_FETCH.test(source.text));
  });
  assert.deepEqual(stale, [], `Gemigreerd of verwijderd: haal uit LEGACY in tests/live-data-architecture.test.ts: ${stale.join(", ")}`);
});

test("alleen de centrale laag praat rechtstreeks met de store en de browserluisteraars", () => {
  const allowed = new Set([
    "src/lib/data/hooks.ts",
    "src/lib/data/mutation.ts",
    "src/lib/data/client.ts",
    "src/lib/data/topics.ts",
    "src/components/LiveDataProvider.tsx",
    "src/components/LiveRefresh.tsx",
  ]);
  const offenders = sources.filter(({ file, text }) => !allowed.has(file) && /\bliveData\b/.test(text)).map(({ file }) => file);
  assert.deepEqual(offenders, [], `Gebruik de hooks (useLiveQuery, LiveRefresh, liveMutation) in plaats van liveData: ${offenders.join(", ")}`);
});

test("alles wat van de gekozen content afhangt, is contentScoped", () => {
  // Endpoints waarvan het antwoord door de actieve collectie en contenttaal bepaald wordt.
  const CONTENT_BOUND = ["/api/courses\"", "/api/courses`"];
  const problems: string[] = [];
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/useLiveQuery[^(]*\(/g)) {
      const start = match.index ?? 0;
      const block = text.slice(start, start + 1200);
      const end = block.search(/\n  \}\n|\n\);/);
      const call = end > 0 ? block.slice(0, end) : block;
      if (CONTENT_BOUND.some((endpoint) => call.includes(endpoint)) && !/contentScoped:\s*true/.test(call)) problems.push(file);
    }
  }
  assert.deepEqual(problems, [], `useLiveQuery op contentgebonden data zonder contentScoped: true: ${problems.join(", ")}`);
});

test("Vandaag en de woordspelkaart gebruiken de centrale laag", () => {
  const dashboard = sources.find((s) => s.file === "src/app/dashboard/page.tsx")!.text;
  assert.match(dashboard, /<LiveRefresh\b[^>]*scopes=\{\["today"\]\}/);
  const word = sources.find((s) => s.file === "src/components/WordGameClient.tsx")!.text;
  assert.match(word, /useLiveTopic\("word-game-ranking"/);
  const xp = sources.find((s) => s.file === "src/lib/xpBroadcast.ts")!.text;
  assert.match(xp, /invalidateData\("xpChanged"\)/);
  const layout = sources.find((s) => s.file === "src/app/layout.tsx")!.text;
  assert.match(layout, /<LiveDataProvider\b/);
});

test("de server stuurt alleen onderwerpen en gebeurtenissen die de client kent", () => {
  const gameServer = sources.find((s) => s.file === "src/server/gameServer.ts")!.text;
  assert.match(gameServer, /isLiveTopic\(payload\?\.topic\)/);
  for (const [topic, event] of Object.entries(LIVE_TOPICS)) {
    assert.ok(event in DATA_EVENTS, `${topic} → ${event}`);
  }
  for (const [socketEvent, event] of Object.entries(SOCKET_EVENT_TO_DATA_EVENT)) {
    assert.ok(event in DATA_EVENTS, `${socketEvent} → ${event}`);
  }
});

test("de documentatie beschrijft elke dataset en gebeurtenis", () => {
  const doc = readFileSync(path.join(root, "docs/DATA-REFRESH.md"), "utf8");
  for (const scope of DATA_SCOPES) assert.ok(doc.includes(`\`${scope}\``), `docs/DATA-REFRESH.md noemt scope ${scope} niet`);
  for (const event of Object.keys(DATA_EVENTS)) assert.ok(doc.includes(`\`${event}\``), `docs/DATA-REFRESH.md noemt gebeurtenis ${event} niet`);
});

test("het woord-van-de-dag-klassement komt zonder opnieuw spelen via een lichte route en een topic", () => {
  const route = sources.find((s) => s.file === "src/app/api/word-game/ranking/route.ts")!.text;
  assert.match(route, /getWordGameRanking/);
  assert.doesNotMatch(route, /getOrCreateTodayGame/, "het klassement mag nooit een potje aanmaken");
  const word = sources.find((s) => s.file === "src/lib/wordGame.ts")!.text;
  assert.match(word, /emitTopicEvent\("word-game-ranking"\)/);
});
