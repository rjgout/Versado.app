import assert from "node:assert/strict";
import test from "node:test";
import { nativeAccountActions } from "../src/lib/native/account";
import { NativeClientError, type NativeSessionClient } from "../src/lib/native/client";
import { AccountActionError } from "../src/lib/account/contracts";
import { ACCOUNT_ERROR_KEYS } from "../src/components/account/accountErrorKeys";
import { nl } from "../src/lib/i18n/messages/nl";

function fakeClient(api: () => Promise<unknown>) {
  const calls = { api: [] as unknown[][], logout: 0 };
  const client = {
    api: async (...args: unknown[]) => { calls.api.push(args); return api(); },
    logout: async (committed?: () => void) => { calls.logout++; committed?.(); },
  } as unknown as NativeSessionClient;
  return { client, calls };
}
const valid = { password: "Synthetic-1", confirm: "DELETE" as const };

test("native verwijderen: strikt contract, één verzoek, daarna lokale sessie en weergave opruimen", async () => {
  const events: string[] = [];
  const { client, calls } = fakeClient(async () => ({ ok: true }));
  await nativeAccountActions(client, () => events.push("expired"), () => events.push("deleted")).deleteAccount({ ...valid, code: "123456" });
  assert.deepEqual(calls.api, [["account", { ...valid, code: "123456" }, "DELETE"]], "precies één DELETE, geen herhaling");
  assert.equal(calls.logout, 1); assert.deepEqual(events, ["deleted"]);
});

test("native verwijderen: ongeldige invoer gaat nooit het netwerk op", async () => {
  const { client, calls } = fakeClient(async () => ({ ok: true }));
  const actions = nativeAccountActions(client);
  await assert.rejects(actions.deleteAccount({ password: "x" } as never));
  await assert.rejects(actions.deleteAccount({ ...valid, confirm: "ja" } as never));
  await assert.rejects(actions.deleteAccount({ ...valid, extra: 1 } as never));
  await assert.rejects(actions.deleteAccount({ password: "", confirm: "DELETE" }));
  assert.equal(calls.api.length, 0); assert.equal(calls.logout, 0);
});

test("native verwijderen: foutcodes worden vertaald, sessieverlies meldt zich, en bij een fout blijft de sessie bestaan", async () => {
  const cases: [string, number, AccountActionError["code"]][] = [
    ["wrong_credentials", 401, "wrong_password"], ["two_factor_required", 400, "two_factor_required"], ["too_many_attempts", 429, "too_many_attempts"],
    ["last_admin", 409, "last_admin"], ["reauthentication_unavailable", 409, "reauthentication_unavailable"], ["session_expired", 401, "session_expired"],
    ["session_changed", 409, "session_expired"], ["network_unavailable", 0, "network_unavailable"], ["onbekend", 500, "request_failed"],
  ];
  for (const [code, status, expected] of cases) {
    const events: string[] = [];
    const { client, calls } = fakeClient(async () => { throw new NativeClientError(code, status); });
    await assert.rejects(nativeAccountActions(client, () => events.push("expired"), () => events.push("deleted")).deleteAccount(valid), (error: unknown) => error instanceof AccountActionError && error.code === expected, code);
    assert.equal(calls.logout, 0, `${code}: geen uitlog bij een mislukte verwijdering`);
    assert.equal(events.includes("deleted"), false);
    assert.equal(events.includes("expired"), ["session_expired"].includes(code) && status === 401, `${code}: sessieverlies-melding`);
  }
});

test("elke accountfout heeft een vertaalde tekst in de bronbundel", () => {
  for (const [code, key] of Object.entries(ACCOUNT_ERROR_KEYS)) {
    const [group, name] = key.split(".");
    const value = (nl as unknown as Record<string, Record<string, unknown>>)[group]?.[name];
    assert.equal(typeof value, "string", `${code} → ${key}`);
  }
});
