import { z } from "zod";
import type { Socket } from "socket.io";
import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { parseCookieHeader } from "@/lib/parseCookieHeader";
import { nativeOriginAllowed } from "./origin";
import { consumeSocketTicket } from "./socketTickets";
import { activeNativeSession, hashSecret, NativeAuthError, type NativeSessionBinding } from "./sessions";

const handshakeSchema = z.object({ client: z.literal("native-v1"), ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export function nativeSocketEnabled() { return process.env.NATIVE_API_ENABLED === "1" && (process.env.NATIVE_SESSION_SECRET?.length ?? 0) >= 32 && !!process.env.REDIS_URL; }
export function socketOriginAllowed(origin: string | undefined, webOrigin: string) {
  return !origin || origin === webOrigin || nativeSocketEnabled() && nativeOriginAllowed(origin);
}
/** Bestaande webcookie of expliciete native handshake; nooit onderling terugvallen. */
export async function authenticateRealtimeSocket(socket: Socket): Promise<User | null> {
  const { headers, auth, query } = socket.handshake;
  const native = nativeOriginAllowed(headers.origin) || auth?.client === "native-v1" || Object.hasOwn(auth ?? {}, "ticket");
  if (["ticket", "socketTicket", "accessToken", "token", "authorization"].some(key => Object.hasOwn(query, key))) return null;
  if (native) {
    const parsed = handshakeSchema.safeParse(auth);
    try {
      if (!nativeSocketEnabled() || !nativeOriginAllowed(headers.origin) || headers.authorization || !parsed.success) return null;
      // WebSockets kunnen ambient cookies meesturen. Native gebruikt die
      // nooit als identiteit of terugval, ook niet wanneer ze van B zijn.
      const binding = await consumeSocketTicket(parsed.data.ticket);
      const user = await activeNativeSession(binding);
      socket.data.nativeSession = binding;
      return user;
    } finally {
      // Na de eenmalige claim is alleen de sessiebinding nodig, nooit het bewijs.
      if (auth && typeof auth === "object") delete auth.ticket;
    }
  }
  const token = parseCookieHeader(headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = await verifySessionToken(token);
  return session ? prisma.user.findUnique({ where: { id: session.userId } }) : null;
}
/** Alleen een verbindingssnapshot; identiteit/geldigheid blijven uit NativeSession komen. */
export function socketSecurityState(user: User) {
  return hashSecret(JSON.stringify([user.passwordHash, user.passwordLoginEnabled, user.totpEnabled, user.totpSecretEncrypted, user.isAdmin, user.email, user.emailVerifiedAt?.toISOString()]));
}
export async function validateNativeSocket(binding: NativeSessionBinding, securityState: string) {
  if (!nativeSocketEnabled()) throw new NativeAuthError("session_expired");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let user: User;
  try {
    user = await Promise.race([
      activeNativeSession(binding),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new NativeAuthError("session_expired")), 2000); }),
    ]);
  } finally { clearTimeout(timeout); }
  if (socketSecurityState(user) !== securityState) throw new NativeAuthError("session_expired");
  return user;
}
