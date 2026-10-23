"use client";
import { useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import MailLinkForm from "@/components/account/MailLinkForm";
import PasswordResetForm from "@/components/account/PasswordResetForm";
import { AppLink } from "@/components/navigation/AppNavigation";
import { SettingsStatus } from "@/components/profile/settings";
import { NativeClientError, type NativeSessionClient } from "@/lib/native/client";
import { nativePasswordResetLink } from "@/lib/native/navigation";
import { nativePasswordResetActions } from "@/lib/native/passwordReset";

export default function NativePasswordReset({ client, initialToken, onTokenCleared, onContinue }: { client: NativeSessionClient; initialToken: string | null; onTokenCleared: () => void; onContinue: () => void }) {
  const t = useT();
  const [token, setToken] = useState(initialToken), [done, setDone] = useState(false);
  const actions = useMemo(() => nativePasswordResetActions(client), [client]);
  if (done) return <>
    <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("password.setNewTitle")}</h1>
    <SettingsStatus kind="success">{t("password.resetCompleteSignIn")}</SettingsStatus>
    <button className="btn-primary" onClick={onContinue}>{t("password.backToLogin")}</button>
  </>;
  if (token) return <PasswordResetForm token={token} actions={actions} onCompleted={() => { setToken(null); setDone(true); onTokenCleared(); }} errorText={error => t(error instanceof NativeClientError && error.code === "invalid_reset_link" ? "apiErrors.linkInvalid" : error instanceof NativeClientError && error.code === "network_unavailable" ? "nativeFoundation.offline" : "nativeFoundation.error")} />;
  return <>
    <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("password.setNewTitle")}</h1>
    <MailLinkForm label={t("password.resetLinkLabel")} button={t("password.openResetLink")} parseLink={raw => nativePasswordResetLink(raw, client.baseUrl)} onToken={setToken} />
    <AppLink href="/forgot-password" className="btn-secondary">{t("password.requestNew")}</AppLink>
  </>;
}
