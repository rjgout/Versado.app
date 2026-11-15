import { nativeGameRequestUser } from "@/lib/games/requestIdentity.server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { createHash } from "node:crypto";

/** Opaque tabcontextbinding; geen sessietoken of bruikbaar authenticatiemiddel. */
export async function navigationSessionKey(): Promise<string> {
  return createHash("sha256").update((await cookies()).get(SESSION_COOKIE)?.value ?? "anonymous").digest("hex");
}

export async function getCurrentUserId(): Promise<string | null> {
  const actor = await nativeGameRequestUser();
  if (actor !== undefined) return actor?.id ?? null;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  return session?.userId ?? null;
}

export async function getCurrentUser() {
  const actor = await nativeGameRequestUser();
  if (actor !== undefined) return actor;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

