import { z } from "zod";
import { fetchJson } from "@/lib/data/fetchJson";
import { passwordResetSchema, type PasswordResetActions } from "./passwordReset";

const resultSchema = z.discriminatedUnion("requiresTwoFactor", [
  z.object({ ok: z.literal(true), requiresTwoFactor: z.literal(true), challengeToken: z.string().min(1).max(2048) }),
  z.object({ ok: z.literal(true), requiresTwoFactor: z.undefined().optional() }),
]);
export const webPasswordResetActions: PasswordResetActions = {
  async reset(input) {
    const result = resultSchema.parse(await fetchJson("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(passwordResetSchema.parse(input)) }));
    return result.requiresTwoFactor ? { challengeToken: result.challengeToken } : {};
  },
  async verify(challengeToken, code) {
    z.object({ ok: z.literal(true) }).parse(await fetchJson("/api/auth/login/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken, code }) }));
  },
};
