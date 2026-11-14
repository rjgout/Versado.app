import { activeNativeSession, type NativeSessionBinding } from "@/lib/native/sessions";
import { verifyPassword } from "@/lib/auth";
import { AccountDeletionConflict, deleteUserAccount } from "@/lib/accountDeletion";
import { consumeRecoveryCode, decryptTotpSecret, TWO_FACTOR_MAX_FAILURES, TWO_FACTOR_WINDOW_MS, twoFactorFailureKey, verifyTotpCode } from "@/lib/totp";
import { clearFailures, failureLockSeconds, registerFailure } from "@/lib/rateLimit";
import type { AccountDeletionInput } from "./contracts";

export type AccountDeletionErrorCode =
  | "wrong_password" | "wrong_code" | "two_factor_required" | "too_many_attempts"
  | "session_changed" | "last_admin" | "reauthentication_unavailable";
export class AccountDeletionError extends Error {
  constructor(readonly code: AccountDeletionErrorCode) { super(code); }
}

/**
 * Eén herauthenticatie-en-verwijderprocedure voor web en native. Controleert onder
 * dezelfde User-lock als wachtwoordwijziging en native refresh en gebruikt binnen dezelfde transactie de
 * bestaande gedeelde `deleteUserAccount` aan.
 *
 * - Accounts zonder wachtwoord (alleen Apple) kunnen hier bewust nog niet verwijderd
 *   worden: een veilig bewijs vraagt een verse Apple-identiteit en tokenintrekking
 *   (docs/NATIVE-WP4-ACCOUNTVERWIJDERING.md). Er wordt niets verwijderd.
 * - De laatste beheerder kan zichzelf niet verwijderen (geen beheer zonder herstelpad).
 * - Het aanvrager-/sessiebewijs is gebonden aan `actor.id` en `actor.sessionVersion`.
 *
 * De aanroeper past eerst `authBudget` toe; deze functie telt alleen foute tweede factoren.
 */
export async function deleteAccountWithReauthentication(actor: { id: string; sessionVersion: number }, input: AccountDeletionInput, nativeSession?: NativeSessionBinding): Promise<void> {
  const failureKey = twoFactorFailureKey(actor.id);
  let expiresAt: Date | undefined;
  try {
    await deleteUserAccount(actor.id, {
      expectedSessionVersion: actor.sessionVersion,
      authorize: async tx => {
        if (nativeSession) {
          if (nativeSession.userId !== actor.id || nativeSession.sessionVersion !== actor.sessionVersion) throw new AccountDeletionError("session_changed");
          await tx.$queryRaw`SELECT "id" FROM "NativeSession" WHERE "id" = ${nativeSession.sessionId}::uuid FOR UPDATE`;
          expiresAt = (await tx.nativeSession.findUnique({ where: { id: nativeSession.sessionId }, select: { expiresAt: true } }))?.expiresAt;
          try { await activeNativeSession(nativeSession, tx); }
          catch { throw new AccountDeletionError("session_changed"); }
        }
        const user = await tx.user.findUnique({ where: { id: actor.id } });
        if (!user || user.sessionVersion !== actor.sessionVersion) throw new AccountDeletionError("session_changed");
        if (!user.passwordLoginEnabled) throw new AccountDeletionError("reauthentication_unavailable");
        if (user.isAdmin && await tx.user.count({ where: { isAdmin: true, id: { not: user.id } } }) === 0) throw new AccountDeletionError("last_admin");
        if (!await verifyPassword(input.password, user.passwordHash)) throw new AccountDeletionError("wrong_password");
        if (!user.totpEnabled) return;
        if (!input.code) throw new AccountDeletionError("two_factor_required");
        if (failureLockSeconds(failureKey, TWO_FACTOR_MAX_FAILURES) > 0) throw new AccountDeletionError("too_many_attempts");
        const valid = !!user.totpSecretEncrypted && verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted), input.code);
        if (!valid) {
          const remaining = await consumeRecoveryCode(user.totpRecoveryCodes, input.code);
          // Een herstelcode is eenmalig: alleen geldig als hij hier atomair wordt verbruikt.
          const consumed = remaining !== null && (await tx.user.updateMany({ where: { id: user.id, totpRecoveryCodes: user.totpRecoveryCodes }, data: { totpRecoveryCodes: remaining } })).count === 1;
          if (!consumed) { registerFailure(failureKey, TWO_FACTOR_WINDOW_MS); throw new AccountDeletionError("wrong_code"); }
        }
        clearFailures(failureKey);
      },
      beforeCommit: async () => {
        // De sessierij is door de cascade weg; de lock voorkwam intrekking.
        // De klok loopt wel door, ook tijdens een trage DELETE/trigger.
        if (nativeSession && (!expiresAt || expiresAt <= new Date())) throw new AccountDeletionError("session_changed");
      },
    });
  } catch (error) {
    if (error instanceof AccountDeletionConflict) throw new AccountDeletionError("session_changed");
    throw error;
  }
}
