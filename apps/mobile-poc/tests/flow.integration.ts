/* Volledige gebruikersstroom tegen de echte lokale backend (geen mocks van de server):
 * login → Vandaag → vriendenlijst → verzoek accepteren → realtime op tweede client →
 * verlopen sessie → dubbel tikken → uitloggen/accountwissel zonder restdata.
 * Draaien: POC_BASE_URL=http://127.0.0.1:3100 npm run test:flow */
import assert from "node:assert/strict";
import { createAppSession } from "@poc/core/session";
import { acceptFriend, ActionGate, loadFriends } from "@poc/core/friends";
import type { SecureSessionStore } from "@/lib/native/client";

const base = process.env.POC_BASE_URL ?? "http://127.0.0.1:3100";
const pw = process.env.POC_PASSWORD ?? "PocPassw0rd!2026";
const memory = (): SecureSessionStore & { value: string | null } => {
  const s = { value: null as string | null, async read() { return s.value; }, async write(v: string) { s.value = v; }, async clear() { s.value = null; } };
  return s;
};
const log = (m: string) => console.log(`✓ ${m}`);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const aliceStore = memory(), bobStore = memory();
  const alice = createAppSession(base, aliceStore);
  const bob = createAppSession(base, bobStore);

  // 1. inloggen + Vandaag met echte data
  await alice.signIn("alice@example.invalid", pw);
  const today = await alice.today();
  assert.equal(today.userId, alice.actor()!.id);
  log(`Alice ingelogd, Vandaag geladen (collectie ${today.activeCollectionId})`);
  assert.ok(aliceStore.value, "sessie staat in de veilige opslag");

  // 2. vrienden + inkomend verzoek
  const before = await loadFriends(alice.gameFetch);
  assert.equal(before.friends.length, 1); assert.equal(before.incoming.length, 1);
  const request = before.incoming[0]!;
  log(`Vriendenlijst: ${before.friends.length} vriend, ${before.incoming.length} inkomend verzoek (${request.from.handle}#${request.from.discriminator})`);

  // 3. tweede client (Bob) luistert realtime
  await bob.signIn("bob@example.invalid", pw);
  const bobBefore = await loadFriends(bob.gameFetch);
  assert.equal(bobBefore.friends.length, 0);
  let bobSignals = 0, aliceSignals = 0;
  bob.onFriendsChanged(() => { bobSignals++; });
  alice.onFriendsChanged(() => { aliceSignals++; });
  await wait(1500);

  // 4. dubbel tikken op "Accepteren": één server-aanroep, beide tikken krijgen hetzelfde resultaat
  const gate = new ActionGate();
  let calls = 0;
  const tap = () => gate.run(request.friendshipId, async () => { calls++; await acceptFriend(alice.gameFetch, request.friendshipId); });
  await Promise.all([tap(), tap(), tap()]);
  assert.equal(calls, 1);
  log("Dubbel/driedubbel tikken → precies één accept-verzoek");
  // ook een herhaling na afloop (netwerk-retry) is idempotent aan de serverkant
  await acceptFriend(alice.gameFetch, request.friendshipId);
  log("Herhaald accepteren is idempotent (geen fout)");

  // 5. servereffect + realtime op beide clients
  const after = await loadFriends(alice.gameFetch);
  assert.equal(after.incoming.length, 0); assert.equal(after.friends.length, 2);
  const bobAfter = await loadFriends(bob.gameFetch);
  assert.equal(bobAfter.friends.length, 1); assert.equal(bobAfter.friends[0]!.user.handle, "Alice");
  for (let i = 0; i < 40 && (!bobSignals || !aliceSignals); i++) await wait(100);
  assert.ok(bobSignals >= 1, "Bob kreeg friends_changed"); assert.ok(aliceSignals >= 1, "Alice kreeg friends_changed");
  log(`Servereffect + realtime: Bob ziet Alice als vriend; signalen Alice=${aliceSignals} Bob=${bobSignals}`);

  // 6. verlopen sessie: access token ongeldig → automatisch vernieuwen, daarna werkt het weer
  (alice.client as unknown as { access: string | null }).access = "verlopen.token.x";
  const refreshed = await alice.today();
  assert.equal(refreshed.userId, alice.actor()!.id);
  log("Verlopen/ongeldig access token → stil vernieuwd via refresh-token");

  // 7. intrekking: na uitloggen is dezelfde refresh-token onbruikbaar en zijn de gegevens weg
  const staleSaved = aliceStore.value!;
  await alice.signOut();
  assert.equal(aliceStore.value === null || !JSON.parse(aliceStore.value).refreshToken, true, "geen refresh-token meer in opslag");
  assert.equal(alice.actor(), null);
  await assert.rejects(() => alice.gameFetch("/api/friends"), /session_changed|access_request_invalid|session/);
  log("Uitloggen: opslag leeg, actor weg, vervolgaanroepen geweigerd");
  const replay = createAppSession(base, Object.assign(memory(), { value: staleSaved }));
  assert.equal(await replay.client.restore().catch(() => false), false);
  log("Oude refresh-token na uitloggen is ingetrokken (restore() mislukt)");

  // 8. accountwissel op hetzelfde apparaat: Carol zonder restdata van Alice
  const store = memory();
  const device = createAppSession(base, store);
  await device.signIn("carol@example.invalid", pw);
  const carol = await loadFriends(device.gameFetch);
  assert.ok(carol.friends.every(f => f.user.handle !== "Carol"));
  assert.equal(JSON.stringify(carol).includes("alice@example"), false);
  const carolId = device.actor()!.id;
  await device.signOut();
  await device.signIn("bob@example.invalid", pw);
  assert.notEqual(device.actor()!.id, carolId);
  const bobOnDevice = await loadFriends(device.gameFetch);
  assert.equal(bobOnDevice.friends.some(f => f.user.handle === "Carol"), false);
  log("Accountwissel Carol → Bob: andere actor, geen data van de vorige gebruiker");

  await bob.signOut(); await device.signOut();
  console.log("\nALLE STAPPEN GESLAAGD");
  process.exit(0);
}
main().catch(e => { console.error("✗ FOUT", e); process.exit(1); });
