// Misbruikbudgetten van sociale endpoints (zonder Redis: dezelfde enkelvoudige teller als authBudget).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

delete process.env.REDIS_URL;
const load = async () => ({ ...(await import("../src/lib/social/abuseBudgets")) });

test("het friend-request-budget weigert na het maximum met 429 en Retry-After, per gebruiker", async () => {
  const { socialBudget, SOCIAL_BUDGETS } = await load();
  const user = `u-${Math.random()}`, other = `u-${Math.random()}`;
  for (let i = 0; i < SOCIAL_BUDGETS.friendRequest.max; i++) assert.equal(await socialBudget("friendRequest", user), null);
  const blocked = await socialBudget("friendRequest", user);
  assert.equal(blocked?.status, 429);
  assert.ok(Number(blocked?.headers.get("Retry-After")) >= 1);
  assert.equal(await socialBudget("friendRequest", other), null, "een andere gebruiker blijft ongemoeid");
});

test("zoeken en publieke uitnodigingen hebben eigen, gescheiden budgetten", async () => {
  const { socialBudget, SOCIAL_BUDGETS } = await load();
  const subject = `ip-${Math.random()}`;
  for (let i = 0; i < SOCIAL_BUDGETS.inviteLookup.max; i++) assert.equal(await socialBudget("inviteLookup", subject), null);
  assert.equal((await socialBudget("inviteLookup", subject))?.status, 429);
  assert.equal(await socialBudget("userSearch", subject), null);
});

test("de routes roepen het budget aan vóór ze gegevens lezen (regressie)", () => {
  const read = (p: string) => readFileSync(new URL(`../src/app/api/${p}`, import.meta.url), "utf8");
  const request = read("friends/request/route.ts");
  assert.ok(request.indexOf('socialBudget("friendRequest"') > request.indexOf("getCurrentUser()"));
  assert.ok(request.indexOf('socialBudget("friendRequest"') < request.indexOf("req.json()"));
  const search = read("users/search/route.ts");
  assert.ok(search.indexOf('socialBudget("userSearch"') < search.indexOf("prisma.user.findMany"));
  const invite = read("invite/[code]/route.ts");
  assert.ok(invite.includes('socialBudget("inviteLookup", clientIp(req))'));
  assert.ok(invite.includes('socialBudget("inviteAccept", user.id)'));
});
