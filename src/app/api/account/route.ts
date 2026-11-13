import { accountDeletionSchema } from "@/lib/account/contracts";
import { AccountDeletionError,deleteAccountWithReauthentication } from "@/lib/account/deletion";
import { AccountPasswordError,changeAccountPassword } from "@/lib/account/password";
import { apiError,apiErrorText } from "@/lib/apiError";
import { SESSION_COOKIE,createSessionToken,sessionCookieOptions } from "@/lib/auth";
import { authBudget,authBudgetKey } from "@/lib/authBudget";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { ProfileSettingsError,patchProfileSettings } from "@/lib/profile/settings";
import { profilePatchSchema } from "@/lib/profile/settingsContract";
import { boundedJson } from "@/lib/requestBody";
import { requestSecurityError } from "@/lib/requestSecurity";
import { getCurrentUser } from "@/lib/session";
import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Vul je huidige (of tijdelijke) wachtwoord in.").max(256),
  newPassword: z.string().min(8, "Nieuw wachtwoord moet minstens 8 tekens zijn.").max(256),
});

// Zelf je wachtwoord wijzigen — ook het verplichte pad na een
// admin-wachtwoordreset (zie /api/admin/users/[userId]/reset-password).
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const limited = await authBudget(authBudgetKey("password-change", user.id), 10, 15 * 60_000);
  if (limited) return limited;

  const body = await boundedJson(req);
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0].message, 400);
  }

  try {
    await changeAccountPassword(user, parsed.data.currentPassword, parsed.data.newPassword);
  } catch (error) {
    if (!(error instanceof AccountPasswordError)) throw error;
    return await apiError(error.code === "wrong_password" ? "apiErrors.currentPasswordWrong" : "apiErrors.notLoggedIn", 401);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
  return res;
}

// Privacy-instelling: standaard uit. Alleen als een gebruiker dit zelf
// aanzet, kan zijn/haar exacte e-mailadres gebruikt worden om diegene te
// vinden bij het toevoegen van vrienden (zie /api/users/search).
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = profilePatchSchema.safeParse(await boundedJson(req));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (parsed.data.shareVillageWithFriends !== undefined && !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return await apiError("apiErrors.forbidden", 403);
  try { return NextResponse.json(await patchProfileSettings({ userId: user.id }, parsed.data)); }
  catch (error) {
    if (!(error instanceof ProfileSettingsError)) throw error;
    return error.text ? await apiErrorText(error.text, error.status) : await apiError(error.key, error.status);
  }
}

// AVG: een gebruiker moet zijn account (en alle bijbehorende gegevens)
// kunnen verwijderen. Alle relaties naar User staan op onDelete: Cascade
// (of SetNull voor freeze-gift-verwijzingen), dus dit verwijdert ook
// voortgang, XP-historie, vriendschappen, quizresultaten en meer.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  // server.ts past dezelfde controle toe voor elke API-mutatie; hier nogmaals, zodat dit verwijderpad nooit
  // alleen van die ene laag afhangt (cross-origin, same-site en niet-JSON worden geweigerd).
  const securityError = requestSecurityError("DELETE", "/api/account", req.headers);
  if (securityError) return await apiError("apiErrors.forbidden", securityError);

  const limited = await authBudget(authBudgetKey("account-delete", user.id), 5, 15 * 60_000);
  if (limited) return limited;

  const parsed = accountDeletionSchema.safeParse(await boundedJson(req));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  try {
    // Altijd een vers bewijs, nooit alleen de sessiecookie; daarna de bestaande gedeelde verwijderprocedure.
    await deleteAccountWithReauthentication(user, parsed.data);
  } catch (error) {
    if (!(error instanceof AccountDeletionError)) throw error;
    const failure = {
      wrong_password: ["apiErrors.currentPasswordWrong", 401],
      wrong_code: ["apiErrors.codeWrong", 401],
      two_factor_required: ["apiErrors.enterVerificationOrRecovery", 400],
      too_many_attempts: ["apiErrors.tooManyAttemptsMany", 429],
      session_changed: ["apiErrors.notLoggedIn", 401],
      last_admin: ["accountDeletion.lastAdmin", 409],
      reauthentication_unavailable: ["accountDeletion.reauthenticationUnavailable", 409],
    } as const;
    const [key, status] = failure[error.code];
    const response = await apiError(key, status, key === "apiErrors.tooManyAttemptsMany" ? { n: 15 } : undefined);
    // Machineleesbare code naast de vertaalde tekst, zodat de client geen tekst hoeft te vergelijken.
    const body = await response.json();
    return NextResponse.json({ ...body, code: error.code === "session_changed" ? "session_expired" : error.code }, { status, headers: { "Cache-Control": "no-store" } });
  }

  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
