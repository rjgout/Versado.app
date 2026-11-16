/* Tweede/derde client voor de runtime-test: gewone clients buiten de app, tegen dezelfde echte backend.
 *   listen-bob <bestand>   native sessie van Bob; schrijft het bestand zodra friends_changed binnenkomt
 *   dave-request           Dave (webclient, cookie) zoekt Alice en stuurt een vriendenverzoek
 *   verify                 server-effect van het accepteren in de app: Bob en Alice zijn vrienden
 *   verify-reader present|cleared   server-effect van markeren/notitie in de lezer: Alice' annotaties volgens de server
 *   verify-study present|cleared    server-effect in de studieles: Gerda's annotaties volgens de server (door de server geplaatst) */
import { writeFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { createAppSession } from "@poc/core/session";
import { loadFriends } from "@poc/core/friends";
import { highlightsByVerse, loadBundle, notesByVerse } from "@poc/reader/api";
import { loadStudy } from "@poc/study/api";
import type { SecureSessionStore } from "@/lib/native/client";

const base = process.env.POC_BASE_URL ?? "http://127.0.0.1:3100";
const pw = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
const memory = (): SecureSessionStore => { let v: string | null = null; return { read: async () => v, write: async x => { v = x; }, clear: async () => { v = null; } }; };

async function nativeAs(email: string) { const s = createAppSession(base, memory()); await s.signIn(email, pw); return s; }

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "listen-bob") {
    const bob = await nativeAs("bob@example.invalid");
    bob.onFriendsChanged(() => { writeFileSync(arg!, String(Date.now())); console.log("Bob ontving friends_changed"); });
    console.log("Bob luistert"); setTimeout(() => process.exit(0), 20 * 60_000); return;
  }
  if (cmd === "dave-request") {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ identifier: "dave@example.invalid", password: pw }) });
    assert.equal(login.status, 200, `Dave web-login ${login.status}`);
    const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const h = { cookie, origin: base, "content-type": "application/json" };
    const search = await (await fetch(`${base}/api/users/search?q=${encodeURIComponent("Alice#01")}`, { headers: h })).json() as { results: { id: string }[] };
    assert.equal(search.results.length, 1, "Alice gevonden op tag");
    const res = await fetch(`${base}/api/friends/request`, { method: "POST", headers: h, body: JSON.stringify({ targetUserId: search.results[0]!.id }) });
    assert.equal(res.status, 200, `verzoek ${res.status}`);
    console.log("Dave stuurde een vriendenverzoek naar Alice"); return;
  }
  if (cmd === "verify") {
    const bob = await nativeAs("bob@example.invalid"), alice = await nativeAs("alice@example.invalid");
    const b = await loadFriends(bob.gameFetch), a = await loadFriends(alice.gameFetch);
    assert.ok(b.friends.some(f => f.user.handle === "Alice"), "Bob ziet Alice als vriend (server-effect van accepteren in de app)");
    assert.ok(a.friends.some(f => f.user.handle === "Bob"), "Alice ziet Bob als vriend");
    assert.ok(!a.incoming.some(r => r.from.handle === "Bob"), "verzoek van Bob is niet meer openstaand");
    assert.ok(a.incoming.some(r => r.from.handle === "Dave"), "verzoek van Dave staat nog open");
    if (arg) assert.ok(existsSync(arg), "Bob ontving friends_changed op zijn tweede client");
    console.log("server-effect en realtime op tweede client bevestigd"); return;
  }
  if (cmd === "verify-reader") {
    const alice = await nativeAs("alice@example.invalid");
    const { reader, annotations } = await loadBundle(alice.client);
    const hl = highlightsByVerse(annotations.annotations), notes = notesByVerse(annotations.annotations);
    const id = (n: number) => reader.verses[n - 1]!.id;
    if (arg === "present") assert.deepEqual(Object.keys(hl).sort(), [5, 6, 7].map(id).sort(), "server heeft de markering op vers 5–7 (gezet in de app)");
    else assert.deepEqual(Object.keys(hl), [], "server heeft geen markeringen meer (gewist in de app)");
    assert.equal(notes[id(8)], "Proefnotitie bij vers 8", "server heeft de notitie bij vers 8 (opgeslagen in de app)");
    console.log(`server-effect van de lezer bevestigd (${arg})`); return;
  }
  if (cmd === "verify-study") {
    const gerda = await nativeAs("gerda@example.invalid");
    const { annotations } = await loadStudy(gerda.client);
    const live = annotations.annotations.filter(r => !r.deleted);
    if (arg === "present") {
      const hl = live.filter(r => r.kind === "highlight"), notes = live.filter(r => r.kind === "note");
      assert.equal(hl.length, 1, "server heeft één markering over twee blokken (gezet in de app)");
      assert.deepEqual(hl[0]!.target.selector.ranges.map(r => r.blockId), ["b-p1", "b-p2"], "de markering ligt op de twee alinea's");
      assert.equal(hl[0]!.placement?.status, "EXACT", "de server plaatst de markering exact in de gepubliceerde revisie");
      assert.equal(notes.length, 1);
      assert.equal(notes[0]!.text, "Proefnotitie bij de les");
    } else assert.equal(live.filter(r => r.kind === "highlight").length, 0, "server heeft geen markering meer (gewist in de app)");
    console.log(`server-effect van de studieles bevestigd (${arg})`); return;
  }
  throw new Error(`onbekend commando ${cmd}`);
}
main().then(() => cmd0() , e => { console.error("✗", e); process.exit(1); });
function cmd0() { if (process.argv[2] !== "listen-bob") process.exit(0); }
