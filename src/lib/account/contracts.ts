import { z } from "zod";

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256), newPassword: z.string().min(8).max(256),
  code: z.string().min(1).max(100).optional(),
}).strict();
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export interface AccountActions { changePassword(input: PasswordChangeInput): Promise<void> }
export class AccountActionError extends Error {
  constructor(readonly code: "wrong_password" | "two_factor_required" | "session_expired" | "network_unavailable" | "request_failed") { super(code); }
}
