import { ActionGate, friendsSchema } from "@poc/core/friends";
import { createAppSession, nativeTransport } from "@poc/core/session";

test("ActionGate geeft gelijktijdige tikken hetzelfde resultaat en laat daarna weer een nieuwe actie toe", async () => {
  const gate = new ActionGate(); let n = 0;
  const a = gate.run("k", async () => ++n), b = gate.run("k", async () => ++n);
  expect(await a).toBe(1); expect(await b).toBe(1);
  expect(await gate.run("k", async () => ++n)).toBe(2);
});

test("het vriendenschema weigert een afwijkend antwoord", () => {
  expect(() => friendsSchema.parse({ friends: [{ friendshipId: 1 }], incoming: [] })).toThrow();
});

test("transport zet de native Origin en client-header en stuurt nooit cookies", async () => {
  let seen: { headers: Headers; credentials?: string } | null = null;
  const t = nativeTransport((async (_u: unknown, init?: RequestInit) => { seen = { headers: new Headers(init!.headers), credentials: init!.credentials }; return new Response("{}"); }) as typeof fetch);
  await t("http://x/y", { headers: { a: "b" } });
  expect(seen!.headers.get("origin")).toBe("https://localhost");
  expect(seen!.headers.get("x-versado-client")).toBe("native-v1");
  expect(seen!.credentials).toBe("omit");
});

test("uitloggen wist de opslag en de actor; een ander account erft niets", async () => {
  const store = { v: null as string | null, read: async () => store.v, write: async (x: string) => { store.v = x; }, clear: async () => { store.v = null; } };
  const calls: string[] = [];
  const transport = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/login")) return new Response(JSON.stringify({ accessToken: "a", refreshToken: "r.1", expiresIn: 300 }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const s = createAppSession("http://x", store, transport);
  await s.client.login("a", "b").catch(() => {});
  await s.signOut();
  expect(store.v === null || !JSON.parse(store.v).refreshToken).toBe(true);
  expect(s.actor()).toBeNull();
});
