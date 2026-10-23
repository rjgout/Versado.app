"use client";

import { useId, useState, FormEvent } from "react";
import { useT } from "@/components/I18nProvider";
import { useAccountActions } from "./AccountActionsProvider";
import { ACCOUNT_ERROR_KEYS } from "./accountErrorKeys";
import { AccountActionError } from "@/lib/account/contracts";
import { ProfileCard, SettingsActions, SettingsButton, SettingsField, SettingsStatus, settingsFieldClass } from "@/components/profile/settings";

/**
 * Account verwijderen met een vers bewijs, gedeeld door web en native (via AccountActionsProvider).
 * Verwijderen zonder wachtwoord (alleen Apple) is bewust nog niet mogelijk: zie docs/NATIVE-WP4-ACCOUNTVERWIJDERING.md.
 */
export default function AccountDeletionForm({ passwordLoginEnabled, totpEnabled, onDeleted }: { passwordLoginEnabled: boolean; totpEnabled: boolean; onDeleted?: () => void | Promise<void> }) {
  const actions = useAccountActions();
  const t = useT();
  const id = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!passwordLoginEnabled) return <SettingsStatus kind="warning" boxed>{t("accountDeletion.reauthenticationUnavailable")}</SettingsStatus>;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return; // Geen tweede verzoek zolang het eerste loopt.
    setError(null);
    setLoading(true);
    try {
      await actions.deleteAccount({ password, ...(totpEnabled ? { code } : {}), confirm: "DELETE" });
      setPassword(""); setCode("");
      await onDeleted?.();
    } catch (failure) {
      setError(t(ACCOUNT_ERROR_KEYS[failure instanceof AccountActionError ? failure.code : "request_failed"]));
      setLoading(false);
    }
  }

  return (
    <>
      <SettingsStatus kind="warning" boxed>{t("profile.deleteWarning")}</SettingsStatus>
      <ProfileCard>
        <form onSubmit={onSubmit} className="flex flex-col">
          <p className="px-2 pb-2 text-sm text-vs-fg-2">{t("accountDeletion.intro")}{totpEnabled ? ` ${t("accountDeletion.withCode")}` : ""}</p>
          <SettingsField label={t("password.current")} htmlFor={`${id}-password`}>
            <input id={`${id}-password`} className={settingsFieldClass} type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} />
          </SettingsField>
          {totpEnabled && <SettingsField label={t("nativeFoundation.code")} htmlFor={`${id}-code`}>
            <input id={`${id}-code`} className={settingsFieldClass} autoComplete="one-time-code" required maxLength={100} value={code} onChange={event => setCode(event.target.value)} />
          </SettingsField>}
          {error && <div className="px-2 pt-1"><SettingsStatus kind="error">{error}</SettingsStatus></div>}
          <SettingsActions>
            <SettingsButton type="submit" variant="danger" disabled={loading || !password || (totpEnabled && !code)}>
              {loading ? t("courses.busy") : t("accountDeletion.submit")}
            </SettingsButton>
          </SettingsActions>
        </form>
      </ProfileCard>
    </>
  );
}
