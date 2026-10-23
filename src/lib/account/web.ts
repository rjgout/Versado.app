import { fetchJson } from "@/lib/data/fetchJson";
import { passwordChangeSchema, type AccountActions } from "./contracts";

export const webAccountActions: AccountActions = {
  async changePassword(input) {
    const { currentPassword, newPassword } = passwordChangeSchema.parse(input);
    await fetchJson("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
  },
};
