// Fase 5E: de feedbacklaag (geluid en haptiek) met nagebootste browseromgeving. Geen echte audio of trilling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPuzzleFeedback, FEEDBACK_STORAGE_KEYS, type AudioContextLike, type FeedbackEnvironment } from "../src/lib/puzzle/feedback";

function fake(options: { storage?: boolean; audio?: boolean; state?: string; native?: boolean; vibrate?: boolean; reduced?: boolean; throwAudio?: boolean } = {}) {
  const store = new Map<string, string>(); const log = { contexts: 0, oscillators: 0, closed: 0, resumed: 0, vibrations: [] as number[][], native: 0, changes: 0, timers: [] as { fn: () => void; ms: number; live: boolean }[] };
  let clock = 1000;
  const ctx = (): AudioContextLike => ({
    currentTime: 0, state: options.state ?? "running", destination: {},
    createOscillator: () => { log.oscillators++; return { type: "", frequency: { value: 0 }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; },
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    resume: async () => { log.resumed++; }, close: async () => { log.closed++; },
  });
  const env: FeedbackEnvironment = {
    storage: () => options.storage === false ? null : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); } },
    createAudioContext: () => { if (options.throwAudio) throw new Error("geblokkeerd"); if (options.audio === false) return null; log.contexts++; return ctx(); },
    canAudio: () => options.audio !== false, canVibrate: () => options.vibrate !== false,
    vibrate: (pattern) => { if (options.vibrate === false) return false; log.vibrations.push(pattern); return true; },
    nativeHaptic: async () => { log.native++; }, isNative: () => !!options.native, reducedMotion: () => !!options.reduced,
    now: () => clock, setTimer: (fn, ms) => { const timer = { fn, ms, live: true }; log.timers.push(timer); return timer; }, clearTimer: (h) => { (h as { live: boolean }).live = false; },
    emitChange: () => { log.changes++; },
  };
  return { env, log, store, advance: (ms: number) => { clock += ms; }, fire: () => { for (const timer of log.timers) if (timer.live) { timer.live = false; timer.fn(); } } };
}

test("beide voorkeuren staan standaard uit en het spel is dan volledig stil", () => {
  const { env, log } = fake(); const f = createPuzzleFeedback(env);
  assert.equal(f.isEnabled("sound"), false); assert.equal(f.isEnabled("haptics"), false);
  f.noteGesture(); for (const event of ["pickup", "place", "connect", "complete", "record"] as const) assert.equal(f.play(event), false);
  assert.equal(log.contexts, 0); assert.equal(log.oscillators, 0); assert.equal(log.vibrations.length, 0);
});

test("geluid en haptiek zijn onafhankelijk in en uit te schakelen en blijven bewaard", () => {
  const a = fake(); const f = createPuzzleFeedback(a.env);
  assert.ok(f.setEnabled("sound", true)); assert.equal(f.isEnabled("sound"), true); assert.equal(f.isEnabled("haptics"), false);
  assert.ok(f.setEnabled("haptics", true)); assert.equal(a.store.get(FEEDBACK_STORAGE_KEYS.haptics), "1");
  f.setEnabled("sound", false); assert.equal(f.isEnabled("sound"), false); assert.equal(f.isEnabled("haptics"), true);
  assert.ok(a.log.changes >= 3);
  // "Herstart": een nieuwe instantie op dezelfde opslag ziet dezelfde keuze.
  const again = createPuzzleFeedback(a.env); assert.equal(again.isEnabled("haptics"), true); assert.equal(again.isEnabled("sound"), false);
});

test("geluid aan, haptiek uit: wel tonen, geen trilling; en omgekeerd", () => {
  const s = fake(); const f = createPuzzleFeedback(s.env); f.setEnabled("sound", true); f.noteGesture();
  assert.ok(f.play("connect")); assert.ok(s.log.oscillators >= 2); assert.equal(s.log.vibrations.length, 0);
  const h = fake(); const g = createPuzzleFeedback(h.env); g.setEnabled("haptics", true); g.noteGesture();
  assert.ok(g.play("connect")); assert.equal(h.log.contexts, 0); assert.equal(h.log.vibrations.length, 1);
  const both = fake(); const b = createPuzzleFeedback(both.env); b.setEnabled("sound", true); b.setEnabled("haptics", true); b.noteGesture();
  assert.ok(b.play("complete")); assert.ok(both.log.oscillators >= 3); assert.equal(both.log.vibrations.length, 1);
});

test("localStorage, AudioContext of haptiek ontbreekt: geen fout, gewoon stil", () => {
  const none = createPuzzleFeedback(fake({ storage: false }).env);
  assert.equal(none.isEnabled("sound"), false); assert.equal(none.setEnabled("sound", true), false); assert.equal(none.play("connect"), false);
  const noAudio = fake({ audio: false }); const f = createPuzzleFeedback(noAudio.env); f.setEnabled("sound", true); f.noteGesture();
  assert.equal(f.play("connect"), false); assert.equal(f.soundSupported(), false);
  const thrown = fake({ throwAudio: true }); const g = createPuzzleFeedback(thrown.env); g.setEnabled("sound", true); assert.doesNotThrow(() => g.noteGesture()); assert.equal(g.play("connect"), false);
  const noHaptics = fake({ vibrate: false }); const h = createPuzzleFeedback(noHaptics.env); h.setEnabled("haptics", true);
  assert.equal(h.play("connect"), false); assert.equal(h.hapticsSupported(), false);
});

test("een geblokkeerde (suspended) AudioContext geeft geen fout en wordt hersteld bij een gebaar", () => {
  const s = fake({ state: "suspended" }); const f = createPuzzleFeedback(s.env); f.setEnabled("sound", true);
  assert.doesNotThrow(() => f.play("connect")); assert.equal(s.log.contexts, 0, "zonder gebaar geen context");
  f.noteGesture(); assert.equal(s.log.contexts, 1); assert.ok(s.log.resumed >= 1);
});

test("geluid pas na een gebruikersgebaar en nooit bij laden", () => {
  const s = fake(); const f = createPuzzleFeedback(s.env); f.setEnabled("sound", true);
  assert.equal(f.play("connect"), false); assert.equal(s.log.contexts, 0);
  f.noteGesture(); assert.equal(s.log.contexts, 1); assert.ok(f.play("connect"));
});

test("niets is blijvend actief: de context sluit na stilte en bij dispose, en er is hooguit één tegelijk", () => {
  const s = fake(); const f = createPuzzleFeedback(s.env); f.setEnabled("sound", true); f.noteGesture();
  f.play("connect"); s.advance(500); f.play("pickup"); f.noteGesture(); assert.equal(f.stats().contexts, 1);
  assert.equal(s.log.timers.filter((t) => t.live).length, 1, "één wachtende sluit-timer, geen opstapeling");
  assert.equal(f.stats().openContext, true); s.fire(); assert.equal(s.log.closed, 1); assert.equal(f.stats().openContext, false);
  f.noteGesture(); f.play("connect"); f.dispose(); assert.equal(f.stats().openContext, false); assert.equal(s.log.timers.filter((t) => t.live).length, 0);
  f.setEnabled("sound", false); // uitzetten sluit ook
});

test("een cooldown voorkomt een opeenstapeling van dezelfde effecten", () => {
  const s = fake(); const f = createPuzzleFeedback(s.env); f.setEnabled("sound", true); f.noteGesture();
  assert.ok(f.play("connect")); assert.equal(f.play("connect"), false); s.advance(60); assert.equal(f.play("connect"), false);
  s.advance(200); assert.ok(f.play("connect"));
});

test("voltooiing en record spelen één keer per sleutel, ook bij herhaalde meldingen", () => {
  const s = fake(); const f = createPuzzleFeedback(s.env); f.setEnabled("sound", true); f.setEnabled("haptics", true); f.noteGesture();
  assert.ok(f.play("complete", "sessie-1")); s.advance(5000); assert.equal(f.play("complete", "sessie-1"), false);
  assert.ok(f.play("record", "sessie-1")); s.advance(5000); assert.equal(f.play("record", "sessie-1"), false);
  assert.ok(f.play("complete", "sessie-2"));
});

test("place geeft bewust geen effect en pickup trilt niet", () => {
  const s = fake(); const f = createPuzzleFeedback(s.env); f.setEnabled("sound", true); f.setEnabled("haptics", true); f.noteGesture();
  assert.equal(f.play("place"), false); const before = s.log.vibrations.length; assert.ok(f.play("pickup")); assert.equal(s.log.vibrations.length, before);
});

test("haptiek: lichte pulsen, bij reduced motion één, en natief via de bestaande lichte haptiek", async () => {
  const web = fake({ reduced: true }); const f = createPuzzleFeedback(web.env); f.setEnabled("haptics", true); f.play("record");
  assert.deepEqual(web.log.vibrations[0], [14]);
  const long = fake(); const g = createPuzzleFeedback(long.env); g.setEnabled("haptics", true); g.play("complete");
  assert.ok(long.log.vibrations[0].every((ms) => ms <= 60) && long.log.vibrations[0].reduce((a, b) => a + b, 0) < 150, "kort patroon");
  const native = fake({ native: true }); const n = createPuzzleFeedback(native.env); n.setEnabled("haptics", true); assert.ok(n.play("connect"));
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(native.log.native, 1); assert.equal(native.log.vibrations.length, 0);
});

test("de feedbacklaag zit niet in de engine en wordt alleen na bevestigde gebeurtenissen aangeroepen", () => {
  for (const file of ["src/lib/puzzle/engine.ts", "src/lib/puzzle/nearSnap.ts", "src/lib/puzzle/motion.ts", "src/lib/puzzle/solo.ts", "src/lib/puzzle/coop.ts", "src/lib/puzzle/match.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /puzzleFeedback|puzzle\/feedback|feedback\.play/, file);
  const table = readFileSync("src/components/PuzzleTable.tsx", "utf8");
  // Geen feedback in de handlers van binnenkomende (remote) sleepbewegingen of deltas.
  for (const marker of ["remoteDrags", "onDrag", "puzzle:drag", "onDelta"]) { for (const line of table.split("\n").filter((l) => l.includes(marker))) assert.doesNotMatch(line, /feedback\.play/, marker); }
  assert.match(table, /if \(!changed\) break;[\s\S]{0,260}feedback\.play\("connect"\)/, "connect pas na bevestigde commit");
  const solo = readFileSync("src/components/JigsawV2Client.tsx", "utf8");
  assert.match(solo, /joined\.status === "ACTIVE"[^\n]*feedback\.play\("connect"\)/); assert.match(solo, /result\.record\.result !== "UNCHANGED"\) feedback\.play\("record"/);
  assert.match(solo, /stageRef\.current === "BOARD"/, "voltooiing alleen vanaf het bord");
  const coop = readFileSync("src/components/puzzle/CoopClient.tsx", "utf8"); assert.match(coop, /!openedCompleted\.current\) puzzleFeedback\(\)\.play\("complete"/);
});

test("de instellingen en het spel gebruiken geen netwerk, database of nieuwe API", () => {
  assert.doesNotMatch(readFileSync("src/lib/puzzle/feedback.ts", "utf8"), /fetch\(|XMLHttpRequest|WebSocket|prisma|new Audio\(|\.mp3|\.wav/);
});
