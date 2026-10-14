import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { constantTempo } from "../src/lib/hymns/eval/synth";
import { ChromaExtractor } from "../src/lib/hymns/audio/features";
import { HymnFollowSession } from "../src/lib/hymns/follow/session";
import { MicListener, type MicState } from "../src/lib/hymns/audio/micListener";
import { SAMPLE_RATE, makeScenario } from "./helpers/hymnScenario";

// Privacy en opruimen: het geluid blijft lokaal, er wordt niets opgeslagen of verzonden, en de microfoon
// gaat uit wanneer dat hoort. Dit bewaakt de architectuureis uit docs/hymns/02-ARCHITECTURE.md.

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const root = process.cwd();
const ENGINE_FILES = [...walk(path.join(root, "src/lib/hymns")), ...walk(path.join(root, "src/components/hymns-poc")), path.join(root, "src/app/dev/lofzangen/page.tsx")];

test("statisch: de lofzangmodules gebruiken geen netwerk, geen opslag en geen analytics", () => {
  const FORBIDDEN =
    /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|socket\.io|io\(\s*["'`]|EventSource|indexedDB|localStorage|sessionStorage|document\.cookie|navigator\.storage|caches\.|MediaRecorder|createMediaStreamDestination|analytics|gtag\(|posthog|sentry/i;
  for (const file of ENGINE_FILES) {
    // de beschrijvende commentaarregels mogen de verboden woorden noemen; alleen code telt
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n");
    assert.equal(FORBIDDEN.test(code), false, `${path.relative(root, file)} gebruikt een verboden netwerk-, opslag- of opname-API`);
  }
});

test("statisch: de lofzangmodules importeren geen Prisma, sessie of Socket.io-server en raken geen XP, reeks of competitie", () => {
  const FORBIDDEN_IMPORT = /from\s+["'](?:@\/lib\/(?:db|streak|xp|competitionXp|leagues|scheduler|notify)|@\/server\/|@\/generated\/prisma|socket\.io)/;
  for (const file of ENGINE_FILES.filter((f) => !f.endsWith("page.tsx"))) {
    assert.equal(FORBIDDEN_IMPORT.test(readFileSync(file, "utf8")), false, `${path.relative(root, file)} importeert een server- of voortgangsmodule`);
  }
});

test("dynamisch: een volledige sessie werkt met fetch, WebSocket en XMLHttpRequest uitgeschakeld", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { fetch: g.fetch, WebSocket: g.WebSocket, XMLHttpRequest: g.XMLHttpRequest };
  let calls = 0;
  const boom = () => {
    calls += 1;
    throw new Error("netwerktoegang tijdens een lofzangsessie");
  };
  g.fetch = boom;
  g.WebSocket = boom;
  g.XMLHttpRequest = boom;
  try {
    const sc = makeScenario(82, { tempoSegments: constantTempo(100), laps: 1 });
    const session = new HymnFollowSession(sc.hymn);
    // ruwe samples door dezelfde ingang als de microfoon
    for (let i = 0; i < sc.synth.samples.length; i += 2048) session.pushAudio(sc.synth.samples.subarray(i, i + 2048), SAMPLE_RATE);
    assert.equal(session.snapshotNow.status === "idle", false);
    assert.equal(calls, 0);
  } finally {
    Object.assign(g, saved);
  }
});

test("resources: het geheugen en de rekentijd per frame blijven constant over een lange sessie", () => {
  const sc = makeScenario(82, { tempoSegments: constantTempo(100), laps: 1 });
  const session = new HymnFollowSession(sc.hymn);
  const frames = sc.frames;
  // ~10 minuten audio aan frames: dezelfde frames herhaald met doorlopende tijd
  const total = 13000;
  const heap = () => {
    globalThis.gc?.();
    return process.memoryUsage().heapUsed;
  };
  for (let i = 0; i < 1500; i += 1) session.pushFrame({ ...frames[i % frames.length], time: i * 0.046 });
  const before = heap();
  const t0 = process.hrtime.bigint();
  for (let i = 1500; i < total; i += 1) session.pushFrame({ ...frames[i % frames.length], time: i * 0.046 });
  const perFrameMs = Number(process.hrtime.bigint() - t0) / 1e6 / (total - 1500);
  const growthMb = (heap() - before) / 1024 / 1024;
  // één frame komt elke 46 ms binnen; de tracker mag daar maar een klein deel van gebruiken
  assert.ok(perFrameMs < 5, `rekentijd per frame ${perFrameMs.toFixed(2)} ms`);
  // events groeien alleen met statuswissels en rondes, niet met de duur
  assert.ok(session.events.length < 400, `${session.events.length} events`);
  assert.ok(growthMb < 25, `heapgroei ${growthMb.toFixed(1)} MB over ${(total * 0.046 / 60).toFixed(0)} minuten`);
});

test("de extractor bewaart geen audio: zijn geheugen is vast, ongeacht hoeveel samples erdoorheen gaan", () => {
  const ex = new ChromaExtractor({ sampleRate: SAMPLE_RATE });
  const chunk = new Float32Array(4096).fill(0.01);
  for (let i = 0; i < 200; i += 1) ex.push(chunk);
  const own = Object.values(ex as unknown as Record<string, unknown>).filter((v) => v instanceof Float32Array || v instanceof Float64Array) as (Float32Array | Float64Array)[];
  const bytes = own.reduce((s, a) => s + a.byteLength, 0);
  // een paar vensters, geen seconden aan opname (22050 Hz * 4 B * 10 s = 880 kB)
  assert.ok(bytes < 400_000, `${bytes} bytes aan buffers`);
});

// --- microfoon: nepomgeving voor getUserMedia en Web Audio -----------------------------------------------

class FakeTrack {
  stopped = false;
  onended: (() => void) | null = null;
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}
class FakePort {
  onmessage: ((e: { data: Float32Array }) => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
}
const created: { ctx: FakeCtx[]; node: FakeNode[]; stream: FakeStream[]; urls: string[]; revoked: string[] } = { ctx: [], node: [], stream: [], urls: [], revoked: [] };
class FakeNode {
  port = new FakePort();
  disconnected = false;
  constructor() {
    created.node.push(this);
  }
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
}
class FakeCtx {
  sampleRate = 44100;
  state = "running";
  closed = false;
  audioWorklet = { addModule: async () => {} };
  destination = {};
  constructor() {
    created.ctx.push(this);
  }
  createMediaStreamSource() {
    return new FakeNode();
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: { value: 1 } });
  }
  async resume() {}
  async close() {
    this.closed = true;
  }
}

function installFakes(options: { deny?: boolean } = {}) {
  const g = globalThis as unknown as Record<string, unknown>;
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    hidden: false,
    addEventListener: (t: string, f: () => void) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: () => void) => listeners.get(t)?.delete(f),
  };
  const original = { navigator: Object.getOwnPropertyDescriptor(g, "navigator"), window: g.window, document: g.document, AudioWorkletNode: g.AudioWorkletNode, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  Object.defineProperty(g, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          if (options.deny) throw new DOMException("denied", "NotAllowedError");
          const s = new FakeStream();
          created.stream.push(s);
          return s;
        },
      },
    },
  });
  g.window = { AudioContext: FakeCtx };
  g.document = doc;
  g.AudioWorkletNode = FakeNode;
  URL.createObjectURL = () => {
    const u = `blob:fake-${created.urls.length}`;
    created.urls.push(u);
    return u;
  };
  URL.revokeObjectURL = (u: string) => void created.revoked.push(u);
  created.ctx.length = created.node.length = created.stream.length = created.urls.length = created.revoked.length = 0;
  return {
    doc,
    listeners,
    restore() {
      if (original.navigator) Object.defineProperty(g, "navigator", original.navigator);
      g.window = original.window;
      g.document = original.document;
      g.AudioWorkletNode = original.AudioWorkletNode;
      URL.createObjectURL = original.createObjectURL;
      URL.revokeObjectURL = original.revokeObjectURL;
    },
  };
}

test("microfoon: starten vraagt toestemming, luistert en stop() zet alles uit (tracks, nodes, context, blob-url)", async () => {
  const env = installFakes();
  try {
    const states: MicState[] = [];
    const mic = new MicListener({ onSamples: () => {}, onState: (s) => states.push(s) });
    await mic.start();
    assert.deepEqual(states, ["requesting", "listening"]);
    assert.equal(created.stream[0].track.stopped, false);
    mic.stop();
    assert.equal(created.stream[0].track.stopped, true, "microfoontrack is niet gestopt");
    assert.ok(created.ctx[0].closed, "AudioContext is niet gesloten");
    assert.ok(created.node.every((n) => n.disconnected), "een audio-node is niet losgekoppeld");
    assert.ok(created.node.some((n) => n.port.closed), "de worklet-poort is niet gesloten");
    assert.deepEqual(created.revoked, created.urls, "de blob-url van de worklet is niet vrijgegeven");
    assert.equal(states[states.length - 1], "idle");
    assert.equal(env.listeners.get("visibilitychange")?.size ?? 0, 0, "luisteraar bleef hangen");
  } finally {
    env.restore();
  }
});

test("microfoon: geen toestemming wordt netjes gemeld en laat niets achter", async () => {
  const env = installFakes({ deny: true });
  try {
    const states: MicState[] = [];
    const mic = new MicListener({ onSamples: () => {}, onState: (s) => states.push(s) });
    await mic.start();
    assert.equal(states[states.length - 1], "denied");
    assert.equal(mic.listening, false);
    assert.equal(created.stream.length, 0);
  } finally {
    env.restore();
  }
});

test("microfoon: naar de achtergrond gaan stopt het luisteren (geen verborgen opname)", async () => {
  const env = installFakes();
  try {
    const states: MicState[] = [];
    const details: (string | undefined)[] = [];
    const mic = new MicListener({ onSamples: () => {}, onState: (s, d) => (states.push(s), details.push(d)) });
    await mic.start();
    env.doc.hidden = true;
    for (const f of env.listeners.get("visibilitychange") ?? []) f();
    assert.equal(mic.listening, false);
    assert.equal(created.stream[0].track.stopped, true);
    assert.ok(created.ctx[0].closed);
    assert.match(details[details.length - 1] ?? "", /achtergrond/);
  } finally {
    env.restore();
  }
});

test("microfoon: stoppen door het systeem (track eindigt) ruimt ook alles op", async () => {
  const env = installFakes();
  try {
    const mic = new MicListener({ onSamples: () => {}, onState: () => {} });
    await mic.start();
    created.stream[0].track.onended?.();
    assert.equal(mic.listening, false);
    assert.ok(created.ctx[0].closed);
  } finally {
    env.restore();
  }
});

test("microfoon: opnieuw starten na stoppen levert een schone nieuwe sessie zonder lekkende resources", async () => {
  const env = installFakes();
  try {
    const mic = new MicListener({ onSamples: () => {}, onState: () => {} });
    for (let i = 0; i < 3; i += 1) {
      await mic.start();
      mic.stop();
    }
    assert.equal(created.ctx.length, 3);
    assert.ok(created.ctx.every((c) => c.closed));
    assert.ok(created.stream.every((s) => s.track.stopped));
    assert.deepEqual(created.revoked, created.urls);
  } finally {
    env.restore();
  }
});

// --- toegang -------------------------------------------------------------------------------------------

import { hymnsPocAccess } from "../src/lib/hymns/access";

test("toegang: in productie voor admins, noodstop en gewone gebruikers geblokkeerd", () => {
  assert.equal(hymnsPocAccess({ production: true, flag: undefined, loggedIn: true, isAdmin: true }), "allow");
  assert.equal(hymnsPocAccess({ production: true, flag: "0", loggedIn: true, isAdmin: true }), "hidden");
  assert.equal(hymnsPocAccess({ production: true, flag: undefined, loggedIn: true, isAdmin: false }), "hidden");
  assert.equal(hymnsPocAccess({ production: true, flag: "1", loggedIn: true, isAdmin: false }), "hidden");
  assert.equal(hymnsPocAccess({ production: true, flag: "1", loggedIn: false, isAdmin: false }), "login");
  assert.equal(hymnsPocAccess({ production: true, flag: "1", loggedIn: true, isAdmin: true }), "allow");
});

test("toegang: in ontwikkeling voor elke ingelogde gebruiker", () => {
  assert.equal(hymnsPocAccess({ production: false, flag: undefined, loggedIn: true, isAdmin: false }), "allow");
  assert.equal(hymnsPocAccess({ production: false, flag: undefined, loggedIn: false, isAdmin: false }), "login");
});

test("de route is alleen gelinkt vanuit de admin-sectie van de contentkiezer, nergens in navigatie, shell of sitemap", () => {
  // focusMode.ts en SubpageBackBar.tsx zijn de centrale shellregisters voor focus mode en de terugbalk: ze noemen
  // de route om de shell goed te zetten, maar linken er niet naartoe (zie de volgende test).
  const SHELL_REGISTRIES = [`${path.sep}lib${path.sep}focusMode.ts`, `${path.sep}components${path.sep}SubpageBackBar.tsx`];
  const files = [...walk(path.join(root, "src/components")), ...walk(path.join(root, "src/lib")), ...walk(path.join(root, "src/app"))]
    .filter((f) => !f.includes(`${path.sep}hymns-poc${path.sep}`) && !f.includes(`${path.sep}hymns${path.sep}`) && !f.includes(`${path.sep}dev${path.sep}lofzangen`) && !f.endsWith("FullscreenContentPicker.tsx") && !f.endsWith(`${path.sep}content${path.sep}page.tsx`) && !SHELL_REGISTRIES.some((r) => f.endsWith(r)));
  for (const file of files) {
    assert.equal(/dev\/lofzangen/.test(readFileSync(file, "utf8")), false, `${path.relative(root, file)} verwijst naar de proefroute`);
  }
});

test("de shellregisters noemen de route alleen voor focus mode en de terugbalk, ze linken er niet naartoe", () => {
  for (const rel of ["src/lib/focusMode.ts", "src/components/SubpageBackBar.tsx"]) {
    const lines = readFileSync(path.join(root, rel), "utf8").split("\n").filter((l) => /dev\\?\/lofzangen/.test(l));
    assert.ok(lines.length > 0, `${rel} noemt de route niet meer`);
    for (const line of lines) assert.equal(/href|<Link|router\.(push|replace)/.test(line), false, `${rel} linkt naar de route: ${line.trim()}`);
  }
});
