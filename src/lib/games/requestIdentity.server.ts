import { nativeOriginAllowed } from "@/lib/native/origin";
import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "@/generated/prisma/client";

// Alleen de begrensde native speladapter opent deze scope, na de gewone
// Bearer-/NativeSession-verificatie. Geen cookie, userId uit invoer of tweede
// sessie. Elke lezing verifieert opnieuw; werk ná het antwoord verliest toegang.
const actors = new AsyncLocalStorage<{ active: boolean; origin?: string; verify: () => Promise<User | null> }>();
export async function nativeGameRequestUser(): Promise<User | null | undefined> {
  const actor = actors.getStore();
  if (!actor) return undefined;
  if (!actor.active) return null;
  const user = await actor.verify();
  return actor.active ? user : null;
}
export async function withNativeGameIdentity<T>(verify: () => Promise<User | null>, run: () => Promise<T>, origin?: string): Promise<T> {
  const scope = { active: true, verify, origin: nativeOriginAllowed(origin) ? origin : undefined };
  return actors.run(scope, async () => {
    try { return await run(); }
    finally { scope.active = false; }
  });
}

/** Native Origin is uitsluitend geldig binnen de geverifieerde spelrequestscope.
 * Webrequests (ook met een nagemaakte native Origin) houden de bestaande CSRF-poort. */
export async function nativeGameOriginAllowed(headers: Headers): Promise<boolean> {
  const actor = actors.getStore();
  if (!actor?.active || !actor.origin || headers.get("origin") !== actor.origin) return false;
  return (await nativeGameRequestUser()) != null;
}

export function isNativeGameRequest(): boolean { return actors.getStore()?.active === true; }
