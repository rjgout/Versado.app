import { z } from "zod";
import { AccountActionError, accountDeletionSchema, passwordChangeSchema, type AccountActions } from "@/lib/account/contracts";
import { NativeClientError, type NativeSessionClient } from "./client";

export function nativeAccountActions(client: NativeSessionClient, onSessionExpired?: () => void, onAccountDeleted?: () => void): AccountActions {
  return { async changePassword(input) {
    try {
      const result = await client.api("account/password", passwordChangeSchema.parse(input));
      z.object({ ok: z.literal(true), reauthenticationRequired: z.literal(true) }).parse(result);
    } catch (error) {
      if (error instanceof NativeClientError && error.status === 401 && ["session_expired", "session_changed"].includes(error.code)) onSessionExpired?.();
      const code = error instanceof NativeClientError ? error.code : "request_failed";
      throw new AccountActionError(code === "wrong_credentials" ? "wrong_password" : code === "two_factor_required" ? code : code === "session_expired" || code === "session_changed" ? "session_expired" : code === "network_unavailable" ? code : "request_failed");
    }
  },
  async deleteAccount(input) {
    try {
      // De server wist het account; daarna zijn sessie en sockets ongeldig. Geen herhaling bij een netwerkfout:
      // een onbedoelde tweede poging krijgt dan hooguit "sessie verlopen" terug, nooit een tweede verwijdering.
      const result = await client.api("account", accountDeletionSchema.parse(input), "DELETE");
      z.object({ ok: z.literal(true) }).parse(result);
    } catch (error) {
      const code = error instanceof NativeClientError ? error.code : "request_failed";
      if (error instanceof NativeClientError && error.status === 401 && ["session_expired", "session_changed"].includes(error.code)) onSessionExpired?.();
      throw new AccountActionError(NATIVE_DELETION_CODES[code] ?? "request_failed");
    }
    // Het account is weg: ook de lokale sessie in Keychain/Keystore en de weergave ruimen op, vóór een volgende actie.
    await client.logout(() => onAccountDeleted?.()).catch(() => {});
  } };
}

const NATIVE_DELETION_CODES: Record<string, AccountActionError["code"]> = {
  wrong_credentials: "wrong_password",
  two_factor_required: "two_factor_required",
  too_many_attempts: "too_many_attempts",
  last_admin: "last_admin",
  reauthentication_unavailable: "reauthentication_unavailable",
  session_expired: "session_expired",
  session_changed: "session_expired",
  network_unavailable: "network_unavailable",
};
