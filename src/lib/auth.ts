import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "bvm_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dagen

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET ontbreekt of is te kort. Zet 'm in .env.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  if (!user) throw new Error("Gebruiker niet gevonden.");

  return new SignJWT({ userId, sessionVersion: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.purpose !== undefined || payload.aud !== undefined || payload.iss !== undefined) return null;
    if (typeof payload.userId !== "string") return null;
    if (typeof payload.sessionVersion !== "number") return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { sessionVersion: true },
    });
    if (!user || user.sessionVersion !== payload.sessionVersion) return null;

    return { userId: payload.userId };
  } catch {
    return null;
  }
}


export async function createTwoFactorChallengeToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  if (!user) throw new Error("Gebruiker niet gevonden.");

  return new SignJWT({ userId, sessionVersion: user.sessionVersion, purpose: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getSecretKey());
}

export async function verifyTwoFactorChallengeToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      payload.purpose !== "2fa" ||
      typeof payload.userId !== "string" ||
      typeof payload.sessionVersion !== "number"
    ) return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { sessionVersion: true, totpEnabled: true },
    });
    if (!user?.totpEnabled || user.sessionVersion !== payload.sessionVersion) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

// Cookies met Secure worden door de browser genegeerd op een pagina die
// zelf over plain http geladen is (bv. testen via het LAN-IP van je NAS in
// plaats van je https-domein). ALLOW_INSECURE_COOKIES=true zet Secure uit
// voor dat geval — nooit gebruiken zodra de app op het internet staat.
const allowInsecureCookies = process.env.ALLOW_INSECURE_COOKIES === "true";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" && !allowInsecureCookies,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
