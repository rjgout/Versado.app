import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HANDLE_MIN_LENGTH, HANDLE_MAX_LENGTH } from "@/lib/handle";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { completeChapterReading, getChapterState } from "@/lib/learning/contentProgress";
import { clientIp, failureLockSeconds, registerFailure } from "@/lib/rateLimit";
import { hashSecret, issueNativeSession, nativeUser, NativeAuthError, rotateNativeSession } from "./sessions";
import { nativePasswordLogin, nativePasswordProof } from "./password";
import { cancelNativeSecuritySetup, finishNativeSecuritySetup, nativeSignInResult } from "./securitySetup";
import { nativeSetupFinishSchema } from "./contract";
import { AccountPasswordError, changeAccountPassword } from "@/lib/account/password";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { findOpenPendingRegistration, resendPendingVerification } from "@/lib/registration";
import { isEmailConfigured } from "@/lib/email";
import { getBaseUrl } from "@/lib/baseUrl";
import { confirmAccountEmail } from "@/lib/account/emailConfirmation";
import { passwordResetSchema } from "@/lib/account/passwordReset";
import { resetPasswordWithToken } from "@/lib/authTokens";
import { disconnectUserSockets } from "@/lib/realtime";
import { passwordChangeSchema } from "@/lib/account/contracts";
import { authBudget, authBudgetKey } from "@/lib/authBudget";
import { appleConfiguration, createAppleChallenge, finishAppleChallenge, unlinkApple } from "./apple";

export const NATIVE_ORIGINS = ["capacitor://localhost", "https://localhost"] as const;
export function nativeOriginAllowed(origin: string | null) { return !!origin && (NATIVE_ORIGINS as readonly string[]).includes(origin); }
const credentials = { password: z.string().min(1).max(256), code: z.string().min(1).max(100).optional() };
const refresh = z.object({ refreshToken: z.string().min(1).max(128), actionId: z.uuid() }).strict();
const budgets = new Map<string, { n: number; until: number }>();
function challengeBudget(ip: string) {
  const now = Date.now(), stored = budgets.get(ip), budget = stored && stored.until > now ? stored : { n: 0, until: now + 900_000 };
  if (budget.n++ >= 30) throw new NativeAuthError("too_many_attempts", 429);
  if (budgets.size > 5000) for (const [key, value] of budgets) if (value.until <= now) budgets.delete(key);
  budgets.set(ip, budget);
}
async function body(req: NextRequest): Promise<unknown> {
  const reader = req.body?.getReader(); if (!reader) throw new NativeAuthError("invalid_input", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > 16_384) { await reader.cancel(); throw new NativeAuthError("request_too_large", 413); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) { if (error instanceof NativeAuthError) throw error; throw new NativeAuthError("invalid_input", 400); }
}
async function authenticated(req: NextRequest) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.length > 2048) throw new NativeAuthError("session_expired");
  return nativeUser(header.slice(7));
}
export async function nativeApi(req: NextRequest, parts: string[]): Promise<NextResponse> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { "Cache-Control": "private, no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
  if (nativeOriginAllowed(origin)) Object.assign(headers, { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Versado-Client", "Access-Control-Max-Age": "600" });
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
  if (!nativeOriginAllowed(origin)) return json({ error: "origin_not_allowed" }, 403);
  if (process.env.NATIVE_API_ENABLED !== "1") return json({ error: "native_not_enabled" }, 503);
  if (!process.env.NATIVE_SESSION_SECRET || process.env.NATIVE_SESSION_SECRET.length < 32) return json({ error: "native_not_configured" }, 503);
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
  if (req.headers.get("x-versado-client") !== "native-v1") return json({ error: "client_version_required" }, 400);
  const path = parts.join("/"), mutation = req.method !== "GET";
  const ip = hashSecret(clientIp(req)), failureKey = `native-auth:${ip}`;
  try {
    if (mutation && req.headers.get("content-type")?.split(";")[0] !== "application/json") throw new NativeAuthError("json_required", 415);
    if (req.method === "GET" && path === "capabilities") return json({ apiVersion: 1, apple: !!appleConfiguration(), registration: true, features: ["security-setup-v1", "account-password-v1", "password-reset-v1", "email-confirmation-v1"] });
    if (req.method === "POST" && path === "login") {
      if (failureLockSeconds(failureKey, 30)) throw new NativeAuthError("too_many_attempts", 429);
      const input = z.object({ identifier: z.string().trim().min(1).max(320), ...credentials, supportsSecuritySetup: z.boolean().optional() }).strict().parse(await body(req));
      const accountKey = `${failureKey}:${hashSecret(input.identifier.toLowerCase())}`;
      if (failureLockSeconds(accountKey, 10)) throw new NativeAuthError("too_many_attempts", 429);
      try {
        if (input.supportsSecuritySetup) return json(await nativeSignInResult(await nativePasswordProof(input.identifier, input.password), input.code));
        const user = await nativePasswordLogin(input.identifier, input.password, input.code);
        return json(await issueNativeSession(user.id, user.sessionVersion));
      } catch (error) {
        if (error instanceof NativeAuthError && error.code === "wrong_credentials") {
          const existing = await prisma.user.findUnique({ where: { email: input.identifier.toLowerCase() }, select: { id: true } });
          const pending = existing ? null : await findOpenPendingRegistration(input.identifier.toLowerCase());
          if (pending && await verifyPassword(input.password, pending.passwordHash)) {
            const sent = await isEmailConfigured() && await resendPendingVerification(pending, getBaseUrl(req));
            throw new NativeAuthError(sent ? "email_confirmation_sent" : "email_confirmation_required", 403);
          }
          registerFailure(accountKey, 900_000);
        }
        throw error;
      }
    }
    if (req.method === "POST" && path === "security-setup/complete") {
      challengeBudget(ip);
      return json(await finishNativeSecuritySetup(nativeSetupFinishSchema.parse(await body(req))));
    }
    if (req.method === "POST" && path === "security-setup/cancel") {
      challengeBudget(ip);
      const input = z.object({ challengeToken: z.string().min(1).max(128) }).strict().parse(await body(req));
      await cancelNativeSecuritySetup(input.challengeToken); return json({ ok: true });
    }
    if (req.method === "POST" && (path === "register" || path === "forgot-password")) {
      challengeBudget(ip);
      // Bestaande registratie/mailflow; geen tweede account- of resetservice.
      const input = path === "register"
        ? z.object({ email: z.email().max(320), handle: z.string().min(HANDLE_MIN_LENGTH).max(HANDLE_MAX_LENGTH), password: z.string().min(8).max(256), inviteCode: z.string().max(32).optional(), next: z.string().max(512).optional() }).strict().parse(await body(req))
        : z.object({ identifier: z.string().trim().min(1).max(320) }).strict().parse(await body(req));
      const forwarded = new NextRequest(req.url, { method: "POST", headers: { "content-type": "application/json", host: req.headers.get("host") ?? req.nextUrl.host, "x-real-ip": clientIp(req) }, body: JSON.stringify(input) });
      const handler = path === "register" ? (await import("@/app/api/auth/register/route")).POST : (await import("@/app/api/auth/forgot-password/route")).POST;
      const response = await handler(forwarded);
      return json(await response.json(), response.status);
    }
    if (req.method === "POST" && path === "verify-email") {
      const limited = await authBudget(authBudgetKey("verify-ip", clientIp(req)), 30, 15 * 60_000);
      if (limited) throw new NativeAuthError(limited.status === 503 ? "security_check_unavailable" : "too_many_attempts", limited.status);
      const input = z.object({ token: z.string().min(1).max(128) }).strict().parse(await body(req));
      const result = await confirmAccountEmail(input.token);
      // Geen User, returnTo, cookie of NativeSession naar een publieke client.
      return json({ status: result.status });
    }
    if (req.method === "POST" && path === "reset-password") {
      const limited = await authBudget(authBudgetKey("reset-ip", clientIp(req)), 30, 15 * 60_000);
      if (limited) throw new NativeAuthError(limited.status === 503 ? "security_check_unavailable" : "too_many_attempts", limited.status);
      const input = passwordResetSchema.parse(await body(req));
      const changed = await resetPasswordWithToken(input.token, await hashPassword(input.newPassword));
      if (!changed) throw new NativeAuthError("invalid_reset_link", 400);
      disconnectUserSockets(changed.id);
      // Een resetbewijs is geen loginbewijs. Ook bij TOTP volgt altijd een
      // nieuwe login via de bestaande wachtwoord-/Apple-/setup-poort.
      return json({ ok: true, reauthenticationRequired: true });
    }
    if (req.method === "POST" && (path === "refresh" || path === "logout")) {
      if (failureLockSeconds(failureKey, 30)) throw new NativeAuthError("too_many_attempts", 429);
      const input = refresh.parse(await body(req));
      return json((await rotateNativeSession(input.refreshToken, input.actionId, path === "logout")) ?? { ok: true });
    }
    if (req.method === "POST" && path === "apple/challenge") {
      challengeBudget(ip);
      const input = z.object({ intent: z.enum(["signin", "link"]), password: z.string().min(1).max(256).optional(), code: credentials.code }).strict().parse(await body(req));
      if (input.intent === "signin") return json(await createAppleChallenge("signin"));
      const user = await authenticated(req);
      if (!input.password) throw new NativeAuthError("reauthentication_required");
      await nativePasswordLogin(user.email, input.password, input.code, user.id);
      return json(await createAppleChallenge("link", user.id));
    }
    if (req.method === "POST" && path === "apple/complete") {
      if (failureLockSeconds(failureKey, 30)) throw new NativeAuthError("too_many_attempts", 429);
      const { HANDLE_REGEX, containsForbiddenEmoji } = await import("@/lib/handle");
      const input = z.object({ uiLanguage: z.enum(["nl", "en", "de", "fr", "es"]).optional(), challengeId: z.uuid(), state: z.string().min(32).max(128), identityToken: z.string().min(1).max(8192), handle: z.string().trim().min(HANDLE_MIN_LENGTH).max(HANDLE_MAX_LENGTH).regex(HANDLE_REGEX).refine(v => !containsForbiddenEmoji(v)).optional(), displayName: z.string().trim().max(100).optional(), code: credentials.code, supportsSecuritySetup: z.boolean().optional() }).strict().parse(await body(req));
      const owner = req.headers.has("authorization") ? await authenticated(req) : undefined;
      const setup = !!input.supportsSecuritySetup && !owner;
      const user = await finishAppleChallenge(input, owner, undefined, setup);
      if (setup) return json(await nativeSignInResult(user, input.code));
      return json(owner ? { ok: true } : await issueNativeSession(user.id, user.sessionVersion));
    }
    const user = await authenticated(req);
    if (req.method === "DELETE" && path === "apple") {
      const input = z.object(credentials).strict().parse(await body(req));
      await nativePasswordLogin(user.email, input.password, input.code, user.id);
      await unlinkApple(user); return json({ ok: true });
    }
    if (req.method === "POST" && path === "account/password") {
      const input = passwordChangeSchema.parse(await body(req));
      const limited = await authBudget(authBudgetKey("password-change", user.id), 10, 15 * 60_000);
      if (limited) throw new NativeAuthError(limited.status === 503 ? "security_check_unavailable" : "too_many_attempts", limited.status);
      await nativePasswordLogin(user.email, input.currentPassword, input.code, user.id);
      try { await changeAccountPassword(user, input.currentPassword, input.newPassword); }
      catch (error) { if (!(error instanceof AccountPasswordError)) throw error; throw new NativeAuthError(error.code === "wrong_password" ? "wrong_credentials" : "session_changed"); }
      return json({ ok: true, reauthenticationRequired: true });
    }
    if (req.method === "GET" && path === "me") return json({ id: user.id, handle: user.handle, uiLanguage: user.uiLanguage, onboardingRequired: !user.onboardingSeenAt, passwordLoginEnabled: user.passwordLoginEnabled, totpEnabled: user.totpEnabled, appleLinked: !!(await prisma.externalIdentity.findFirst({ where: { userId: user.id, provider: "APPLE" }, select: { id: true } })) });
    if (req.method === "GET" && path === "today") {
      // Geen impliciete bronwissel of synthetische BOM-fallback.
      const course = !user.activeContentCollectionId && user.activeCourseId ? await prisma.course.findUnique({ where: { id: user.activeCourseId }, select: { contentCollectionId: true } }) : null;
      const collectionId = user.activeContentCollectionId ?? course?.contentCollectionId;
      const chapter = collectionId ? await prisma.chapter.findFirst({ where: { book: { contentCollectionId: collectionId, contentCollection: readingAccessWhere(user) } }, orderBy: [{ book: { order: "asc" } }, { order: "asc" }], select: { id: true, number: true, book: { select: { name: true } } } }) : null;
      return json({ activity: chapter ? { id: chapter.id, title: `${chapter.book.name} ${chapter.number}` } : null });
    }
    if (parts[0] === "chapters" && parts[1] && parts[1].length <= 128) {
      const chapter = await prisma.chapter.findFirst({ where: { id: parts[1], book: { contentCollection: readingAccessWhere(user) } }, select: { id: true, number: true, book: { select: { name: true } } } });
      if (!chapter) throw new NativeAuthError("content_unavailable", 404);
      if (req.method === "GET" && parts.length === 2) {
        const verses = await prisma.verse.findMany({ where: { chapterId: chapter.id }, orderBy: { number: "asc" }, take: 500, select: { number: true, text: true } });
        if (!verses.length || verses.length >= 500) throw new NativeAuthError("content_unavailable", 404);
        return json({ id: chapter.id, title: `${chapter.book.name} ${chapter.number}`, verses, state: await getChapterState(prisma, user.id, chapter.id) });
      }
      if (req.method === "POST" && parts.length === 3 && parts[2] === "complete") {
        z.object({}).strict().parse(await body(req));
        return json(await completeChapterReading(user.id, chapter.id));
      }
    }
    return json({ error: "endpoint_unavailable" }, 404);
  } catch (error) {
    const status = error instanceof NativeAuthError ? error.status : error instanceof z.ZodError ? 400 : 500;
    if (status === 400 || status === 401) registerFailure(failureKey, 900_000);
    return json({ error: error instanceof NativeAuthError ? error.code : status === 400 ? "invalid_input" : "native_request_failed" }, status);
  }
}
