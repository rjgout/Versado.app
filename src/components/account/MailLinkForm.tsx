"use client";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { SettingsStatus } from "@/components/profile/settings";

/** Links uit bestaande mails, uitsluitend na expliciete invoer/actie. */
export default function MailLinkForm({ label, button, parseLink, onToken }: { label: string; button: string; parseLink: (raw: string) => string | null; onToken: (token: string) => void }) {
  const t = useT();
  const [link, setLink] = useState(""), [invalid, setInvalid] = useState(false);
  return <form className="flex flex-col gap-4" onSubmit={event => {
    event.preventDefault(); const token = parseLink(link); setLink(""); setInvalid(!token); if (token) onToken(token);
  }}>
    <label>{label}<input className="input mt-1 w-full" type="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={link} maxLength={2048} required onChange={event => setLink(event.target.value)} /></label>
    {invalid && <SettingsStatus kind="error">{t("apiErrors.linkInvalid")}</SettingsStatus>}
    <button className="btn-primary" type="submit">{button}</button>
  </form>;
}
