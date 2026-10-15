import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// De productieproxy (deploy/nginx/nginx.conf) staat tussen Cloudflare en de app en zet de beveiligingsheaders op ELKE response.
// Een "Permissions-Policy: microphone=()" daar blokkeert getUserMedia volledig voor de hele site (gemeten op https://versado.app op
// 15 oktober 2026, zie docs/hymns/19-REGRESSIE-LIVE-AUDIO.md). Lofzangen luistert lokaal mee en heeft de microfoon nodig.
// Deze test houdt die afspraak vast: de microfoon is toegestaan voor de eigen oorsprong, nooit voor derden; camera en locatie blijven dicht.

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function policyValues(source: string): string[] {
  return [...source.matchAll(/add_header\s+Permissions-Policy\s+"([^"]*)"/gi)].map((m) => m[1]);
}

/** Directive -> allowlist, bijvoorbeeld { microphone: "(self)", camera: "()" }. */
function parsePolicy(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(",")) {
    const m = /^\s*([a-z-]+)\s*=\s*(.*?)\s*$/.exec(part);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test("proxy: er is precies één Permissions-Policy en die staat de microfoon toe voor de eigen oorsprong", () => {
  const values = policyValues(read("deploy/nginx/nginx.conf"));
  assert.equal(values.length, 1, "verwacht één Permissions-Policy in nginx.conf");
  const policy = parsePolicy(values[0]);
  assert.equal(policy.microphone, "(self)", `microphone staat op ${policy.microphone}; Lofzangen heeft (self) nodig`);
});

test("proxy: de microfoon wordt nooit voor derden of voor alles opengezet, en camera en locatie blijven dicht", () => {
  const policy = parsePolicy(policyValues(read("deploy/nginx/nginx.conf"))[0]);
  assert.doesNotMatch(policy.microphone, /\*|https?:/, "de microfoon mag niet voor andere oorsprongen openstaan");
  assert.equal(policy.camera, "()", "camera moet dicht blijven");
  assert.equal(policy.geolocation, "()", "geolocatie moet dicht blijven");
});

test("proxy: de beveiligingsheaders staan op serverniveau en worden niet door een locatie met eigen add_header overschreven voor de app", () => {
  const conf = read("deploy/nginx/nginx.conf");
  // add_header in een location vervangt de geërfde headers van de server; de hoofdlocatie naar de app mag er dus geen hebben
  const appLocation = conf.slice(conf.indexOf("location / {"), conf.indexOf("location @maintenance"));
  assert.doesNotMatch(appLocation, /add_header/, "location / (de app) mag geen eigen add_header hebben: dan verdwijnt de rest van de beveiligingsheaders");
  assert.match(conf, /add_header X-Frame-Options "DENY"/);
});

test("app: er is geen tweede plek die de microfoon via een header of metatag blokkeert", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, name);
      const full = path.join(root, rel);
      if (name === "node_modules" || name === ".next" || name === "generated" || name === ".git") continue;
      if (statSync(full).isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|mjs|conf|json)$/.test(name) && !rel.startsWith("tests/") && !rel.startsWith("docs/")) {
        // commentaarregels tellen niet mee: ze mogen de header noemen om uit te leggen waarom hij er niet staat
        const text = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line))
          .join("\n");
        // micListener.ts noemt de header alleen in zijn foutmelding en het e2e-script zet hem opzettelijk om de blokkade te bewijzen; beide zetten hem nergens in productie
        if (/microphone\s*=\s*\(\s*\)/i.test(text) && !rel.endsWith("audio/micListener.ts") && !rel.endsWith("e2e-live-failures.mjs")) offenders.push(rel);
      }
    }
  };
  for (const dir of ["src", "deploy", "scripts"]) walk(dir);
  for (const file of ["next.config.js", "server.ts"]) if (/microphone\s*=\s*\(\s*\)/i.test(read(file))) offenders.push(file);
  assert.deepEqual(offenders, [], `deze bestanden zetten microphone=(): ${offenders.join(", ")}`);
});

test("de microfoonklasse herkent een blokkerende Permissions-Policy en meldt die als eigen oorzaak", () => {
  const mic = read("src/lib/hymns/audio/micListener.ts");
  assert.match(mic, /export function microphonePolicyAllows/);
  assert.match(mic, /allowsFeature\("microphone"\)/);
  assert.match(mic, /microphonePolicyAllows\(\) === false/);
  assert.match(mic, /Permissions-Policy: microphone=\(\)/);
});
