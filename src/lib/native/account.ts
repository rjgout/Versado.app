import { z } from "zod";
import { AccountActionError, passwordChangeSchema, type AccountActions } from "@/lib/account/contracts";
import { NativeClientError, type NativeSessionClient } from "./client";

export function nativeAccountActions(client: NativeSessionClient, onSessionExpired?: () => void): AccountActions {
  return { async changePassword(input) {
    try {
      const result = await client.api("account/password", passwordChangeSchema.parse(input));
      z.object({ ok: z.literal(true), reauthenticationRequired: z.literal(true) }).parse(result);
    } catch (error) {
      if (error instanceof NativeClientError && error.status === 401 && ["session_expired", "session_changed"].includes(error.code)) onSessionExpired?.();
      const code = error instanceof NativeClientError ? error.code : "request_failed";
      throw new AccountActionError(code === "wrong_credentials" ? "wrong_password" : code === "two_factor_required" ? code : code === "session_expired" || code === "session_changed" ? "session_expired" : code === "network_unavailable" ? code : "request_failed");
    }
  } };
}
