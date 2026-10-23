import { z } from "zod";

export const passwordResetSchema = z.object({ token: z.string().min(1).max(128), newPassword: z.string().min(8).max(256) }).strict();
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
export interface PasswordResetActions {
  reset(input: PasswordResetInput): Promise<{ challengeToken?: string }>;
  verify(challengeToken: string, code: string): Promise<void>;
}
