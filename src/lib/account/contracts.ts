import { z } from "zod";

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256), newPassword: z.string().min(8).max(256),
  code: z.string().min(1).max(100).optional(),
}).strict();
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
/** Zelf wissen vraagt altijd een vers bewijs (wachtwoord, plus TOTP- of herstelcode als 2FA aan staat) en een expliciete bevestiging. */
export const accountDeletionSchema = z.object({
  password: z.string().min(1).max(256),
  code: z.string().min(1).max(100).optional(),
  confirm: z.literal("DELETE"),
}).strict();
export type AccountDeletionInput = z.infer<typeof accountDeletionSchema>;
export interface AccountActions {
  changePassword(input: PasswordChangeInput): Promise<void>;
  deleteAccount(input: AccountDeletionInput): Promise<void>;
}
export class AccountActionError extends Error {
  constructor(readonly code: "wrong_password" | "wrong_code" | "two_factor_required" | "too_many_attempts" | "last_admin" | "reauthentication_unavailable" | "session_expired" | "network_unavailable" | "request_failed") { super(code); }
}
