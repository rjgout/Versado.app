import type { AccountActionError } from "@/lib/account/contracts";
import type { MessageKey } from "@/lib/i18n/core";

/** Eén tekstkeuze per accountfout, gedeeld door alle accountformulieren (web en native). */
export const ACCOUNT_ERROR_KEYS: Record<AccountActionError["code"], MessageKey> = {
  wrong_password: "apiErrors.currentPasswordWrong",
  wrong_code: "apiErrors.codeWrong",
  two_factor_required: "nativeFoundation.twoFactorRequired",
  too_many_attempts: "accountDeletion.tooManyAttempts",
  last_admin: "accountDeletion.lastAdmin",
  reauthentication_unavailable: "accountDeletion.reauthenticationUnavailable",
  session_expired: "nativeFoundation.sessionExpired",
  network_unavailable: "nativeFoundation.offline",
  request_failed: "nativeFoundation.error",
};
