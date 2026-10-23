"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import MailLinkForm from "@/components/account/MailLinkForm";
import EmailConfirmationCard from "@/components/account/EmailConfirmationCard";
import { SettingsStatus } from "@/components/profile/settings";
import { NativeClientError, type NativeSessionClient } from "@/lib/native/client";
import { nativeEmailConfirmationLink } from "@/lib/native/navigation";
import { confirmNativeEmail, type EmailConfirmationStatus } from "@/lib/native/emailConfirmation";

export default function NativeEmailConfirmation({ client, initialToken, onTokenCleared, onContinue }: { client: NativeSessionClient; initialToken: string | null; onTokenCleared: () => void; onContinue: () => void }) {
  const t = useT();
  const [token, setToken] = useState(initialToken), [status, setStatus] = useState<EmailConfirmationStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true), submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function confirm() {
    if (!token || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await confirmNativeEmail(client, token);
      if (!mounted.current) return;
      setStatus(result); setToken(null); onTokenCleared();
    } catch (error) {
      if (mounted.current) setError(t(error instanceof NativeClientError && error.code === "network_unavailable" ? "nativeFoundation.offline" : "nativeFoundation.error"));
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  if (status) return <EmailConfirmationCard status={status} title={t(status === "confirmed" ? "verify.confirmed" : status === "already" ? "verify.alreadyTitle" : status === "expired" ? "verify.expiredTitle" : "verify.invalid")}>
    <p className="text-sm text-vs-fg-2">{t(status === "confirmed" || status === "already" ? "verify.alreadyText" : "verify.newLinkViaLogin")}</p>
    <button type="button" className="btn-primary self-center" onClick={onContinue}>{t("auth.logIn")}</button>
  </EmailConfirmationCard>;
  return <>
    <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("verify.title")}</h1>
    {token ? <button type="button" className="btn-primary" disabled={busy} onClick={() => void confirm()}>{t(busy ? "courses.busy" : "verify.continue")}</button> : <MailLinkForm label={t("verify.linkLabel")} button={t("verify.openLink")} parseLink={raw => nativeEmailConfirmationLink(raw, client.baseUrl)} onToken={setToken} />}
    {error && <SettingsStatus kind="error">{error}</SettingsStatus>}
  </>;
}
