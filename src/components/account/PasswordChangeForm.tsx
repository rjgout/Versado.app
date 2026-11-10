"use client";

import { useId, useState, FormEvent } from "react";
import { useT } from "@/components/I18nProvider";
import { useAccountActions } from "./AccountActionsProvider";
import { AccountActionError } from "@/lib/account/contracts";
import { ACCOUNT_ERROR_KEYS } from "./accountErrorKeys";
import { ApiRequestError } from "@/lib/data/fetchJson";
import { ProfileCard, SettingsActions, SettingsButton, SettingsField, SettingsStatus, settingsFieldClass } from "@/components/profile/settings";

export default function PasswordChangeForm({ forced, currentPasswordRequired = true, requiresSecondFactor = false, onChanged }: { forced: boolean; currentPasswordRequired?: boolean; requiresSecondFactor?: boolean; onChanged?: () => void | Promise<void> }) {
  const actions = useAccountActions();
  const t = useT();
  const id = useId();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirmPassword) {
      setError(t("password.newMismatch"));
      return;
    }
    setLoading(true);
    try {
      await actions.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword, ...(requiresSecondFactor ? { code } : {}) });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" }); setCode("");
      await onChanged?.();
    } catch (error) {
      if (error instanceof AccountActionError) {
        setError(t(ACCOUNT_ERROR_KEYS[error.code]));
      } else setError(error instanceof ApiRequestError && !error.message.startsWith("HTTP ") ? error.message : t("wordOfTheDay.somethingWrong"));
    } finally { setLoading(false); }
  }

  // Echte labels en autocomplete: een wachtwoordmanager vult dan het huidige
  // wachtwoord in en stelt bij het nieuwe een sterk wachtwoord voor.
  const fields = [
    { key: "currentPassword", label: forced ? t("password.temporary") : t("password.current"), autoComplete: "current-password", minLength: undefined },
    { key: "newPassword", label: t("password.new"), autoComplete: "new-password", minLength: 8 },
    { key: "confirmPassword", label: t("password.confirmNew"), autoComplete: "new-password", minLength: 8 },
  ] as const;

  return (
    <>
      {forced && (
        <SettingsStatus kind="warning" boxed>
          {t("password.forcedReset")}
        </SettingsStatus>
      )}
      <ProfileCard>
        <form onSubmit={onSubmit} className="flex flex-col">
          {fields.filter(field => currentPasswordRequired || field.key !== "currentPassword").map((field) => (
            <SettingsField key={field.key} label={field.label} htmlFor={`${id}-${field.key}`}>
              <input
                id={`${id}-${field.key}`}
                className={settingsFieldClass}
                type="password"
                autoComplete={field.autoComplete}
                required
                maxLength={256}
                minLength={field.minLength}
                value={form[field.key]}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              />
            </SettingsField>
          ))}
          {requiresSecondFactor && <SettingsField label={t("nativeFoundation.code")} htmlFor={`${id}-code`}>
            <input id={`${id}-code`} className={settingsFieldClass} value={code} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" maxLength={100} required />
          </SettingsField>}
          {error && (
            <div className="px-2 pt-1">
              <SettingsStatus kind="error">{error}</SettingsStatus>
            </div>
          )}
          <SettingsActions>
            <SettingsButton type="submit" variant="primary" disabled={loading}>
              {loading ? t("courses.busy") : t("password.save")}
            </SettingsButton>
          </SettingsActions>
        </form>
      </ProfileCard>
    </>
  );
}
