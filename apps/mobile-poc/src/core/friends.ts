import { z } from "zod";

const person = z.object({ id: z.string(), handle: z.string(), discriminator: z.string(), avatarEmoji: z.string().nullable() });
/** Alleen de velden die dit scherm gebruikt; het bestaande antwoord (`GET /api/friends` via games/friends) is leidend. */
export const friendsSchema = z.object({
  friends: z.array(z.object({ friendshipId: z.string(), user: person })),
  incoming: z.array(z.object({ friendshipId: z.string(), from: person })),
  outgoing: z.array(z.object({ friendshipId: z.string(), to: person })).default([]),
});
export type FriendsData = z.infer<typeof friendsSchema>;

export async function loadFriends(gameFetch: typeof fetch, signal?: AbortSignal): Promise<FriendsData> {
  const res = await gameFetch("/api/friends", { signal });
  if (!res.ok) throw new Error(`friends_${res.status}`);
  return friendsSchema.parse(await res.json());
}

/** Dubbel tikken: per verzoek maximaal één verzoek tegelijk; de tweede tik krijgt hetzelfde resultaat. */
export class ActionGate {
  private inflight = new Map<string, Promise<unknown>>();
  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const next = action().finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, next);
    return next;
  }
  get pending() { return this.inflight.size; }
}

export async function acceptFriend(gameFetch: typeof fetch, friendshipId: string): Promise<void> {
  const res = await gameFetch(`/api/friends/${encodeURIComponent(friendshipId)}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  // 200 = nu geaccepteerd of al eerder (idempotent); 404 = verzoek bestaat niet meer, ook geen fout voor de gebruiker.
  if (!res.ok && res.status !== 404) throw new Error(`accept_${res.status}`);
}
