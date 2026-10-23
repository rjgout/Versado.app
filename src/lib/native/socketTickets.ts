import { randomBytes } from "node:crypto";
import { z } from "zod";
import Redis from "ioredis";
import { hashSecret, NativeAuthError, nativeSessionIdentity, type NativeSessionBinding } from "./sessions";

export const SOCKET_TICKET_TTL_SECONDS = 60;
export interface SocketTicketStore {
  put(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  take(key: string): Promise<string | null>;
}
const ticketFormat = /^[A-Za-z0-9_-]{43}$/;
const bindingSchema = z.object({ userId: z.string().min(1).max(128), sessionId: z.uuid(), sessionVersion: z.number().int().nonnegative() }).strict();
const recordSchema = bindingSchema.extend({ purpose: z.literal("native-socket-v1"), issuedAt: z.number().int(), expiresAt: z.number().int() }).strict();
export const socketTicketKey = (raw: string) => `native-socket:v1:${hashSecret(raw)}`;
const shared = globalThis as typeof globalThis & { __versadoSocketTickets?: Promise<Redis> };
async function redisCommand<T>(run: (client: Redis) => Promise<T>): Promise<T> {
  if (!process.env.REDIS_URL) throw new NativeAuthError("native_realtime_unavailable", 503);
  let slot: Promise<Redis> | undefined;
  try {
    shared.__versadoSocketTickets ??= (async () => {
      const client = new Redis(process.env.REDIS_URL!, { lazyConnect: true, connectTimeout: 1500, commandTimeout: 2000, maxRetriesPerRequest: 1, retryStrategy: () => null, enableOfflineQueue: false });
      client.on("error", () => {});
      try { await client.connect(); return client; } catch { client.disconnect(); throw new Error("unavailable"); }
    })();
    slot = shared.__versadoSocketTickets;
    return await run(await slot);
  } catch {
    if (shared.__versadoSocketTickets === slot) shared.__versadoSocketTickets = undefined;
    void slot?.then(client => client.disconnect()).catch(() => {});
    throw new NativeAuthError("native_realtime_unavailable", 503);
  }
}
export const redisSocketTicketStore: SocketTicketStore = {
  put: (key, value, ttl) => redisCommand(async client => await client.set(key, value, "EX", ttl, "NX") === "OK"),
  // GETDEL is atomair in de bestaande ondersteunde Redis 7, ook tussen processen.
  take: key => redisCommand(client => client.getdel(key)),
};
export async function closeSocketTicketStore() {
  const pending = shared.__versadoSocketTickets; shared.__versadoSocketTickets = undefined;
  await pending?.then(client => client.disconnect()).catch(() => {});
}
export async function createSocketTicket(binding: NativeSessionBinding, store: SocketTicketStore = redisSocketTicketStore, now = Date.now()) {
  const value = recordSchema.parse({ ...binding, purpose: "native-socket-v1", issuedAt: now, expiresAt: now + SOCKET_TICKET_TTL_SECONDS * 1000 });
  const ticket = randomBytes(32).toString("base64url");
  if (!await store.put(socketTicketKey(ticket), JSON.stringify(value), SOCKET_TICKET_TTL_SECONDS)) throw new NativeAuthError("native_realtime_unavailable", 503);
  return { socketTicket: ticket, expiresIn: SOCKET_TICKET_TTL_SECONDS };
}
export async function consumeSocketTicket(raw: unknown, store: SocketTicketStore = redisSocketTicketStore, now = Date.now()): Promise<NativeSessionBinding> {
  if (typeof raw !== "string" || !ticketFormat.test(raw)) throw new NativeAuthError("socket_ticket_invalid");
  const stored = await store.take(socketTicketKey(raw));
  let record: unknown; try { record = stored && JSON.parse(stored); } catch { throw new NativeAuthError("socket_ticket_invalid"); }
  const result = recordSchema.safeParse(record);
  if (!result.success || result.data.issuedAt > now || result.data.expiresAt <= now || result.data.expiresAt - result.data.issuedAt > SOCKET_TICKET_TTL_SECONDS * 1000) throw new NativeAuthError("socket_ticket_invalid");
  const { userId, sessionId, sessionVersion } = result.data;
  return { userId, sessionId, sessionVersion };
}
export async function issueSocketTicket(accessToken: string) {
  const { binding } = await nativeSessionIdentity(accessToken);
  return createSocketTicket(binding);
}
