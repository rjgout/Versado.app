import { fetchJson } from "@/lib/data/fetchJson";
import { AccountActionError, accountDeletionSchema, passwordChangeSchema, type AccountActions } from "./contracts";

const DELETION_CODES = new Set(["wrong_password", "wrong_code", "two_factor_required", "too_many_attempts", "last_admin", "reauthentication_unavailable", "session_expired"]);

export const webAccountActions: AccountActions = {
  async changePassword(input) {
    const { currentPassword, newPassword } = passwordChangeSchema.parse(input);
    await fetchJson("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
  },
  async deleteAccount(input) {
    const body = accountDeletionSchema.parse(input);
    let response: Response;
    try { response = await fetch("/api/account", { method: "DELETE", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new AccountActionError("network_unavailable"); }
    if (response.ok) return;
    const result = await response.json().catch(() => null) as { code?: unknown } | null;
    const code = typeof result?.code === "string" && DELETION_CODES.has(result.code) ? result.code as AccountActionError["code"] : response.status === 401 ? "session_expired" : response.status === 429 ? "too_many_attempts" : "request_failed";
    throw new AccountActionError(code);
  },
};
