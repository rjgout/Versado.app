import { z } from "zod";
import { passwordResetSchema, type PasswordResetActions } from "@/lib/account/passwordReset";
import type { NativeSessionClient } from "./client";

export function nativePasswordResetActions(client: NativeSessionClient): PasswordResetActions {
  return {
    async reset(input) {
      z.object({ ok: z.literal(true), reauthenticationRequired: z.literal(true) }).strict().parse(await client.publicRequest("reset-password", passwordResetSchema.parse(input)));
      return {};
    },
    async verify() { throw new Error("native_login_required"); },
  };
}
