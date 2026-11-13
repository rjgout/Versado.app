"use client";
import LanguageSettingsView from "@/components/profile/LanguageSettingsView";

import { useT } from "@/components/I18nProvider";
import { useEffect,useState } from "react";

// Twee losse keuzes (zie User.uiLanguage / contentLanguage): de taal van de
// app en de taal waarin je de Schriften leest en speelt. Een taal staat
// alleen in de lijst als er echt iets in die taal is: app-teksten die af zijn
// (Language.uiReady; beheerders zien alles, om een vertaling te bekijken), of
// minstens één uitgave die je kunt kiezen.
export default function LanguageSettings({ uiLanguage, isAdmin }: { uiLanguage: string; isAdmin: boolean }) {
  const t = useT();
  const [contentLanguage, setContentLanguage] = useState<string | null>(null);
  const [contentLanguages, setContentLanguages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/content-context")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { contentLanguage: string; contentLanguages: string[] } | null) => {
        if (!data) return;
        setContentLanguage(data.contentLanguage);
        setContentLanguages(data.contentLanguages);
      })
      .catch(() => {});
  }, []);

  // Een volledige herlaadbeurt: menu's, cursussen en teksten komen van de server.
  async function save(url: string, method: "PATCH" | "PUT", body: object) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? t("languageSettings.saveFailed"));
        return;
      }
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  return <LanguageSettingsView uiLanguage={uiLanguage} isAdmin={isAdmin} contentLanguage={contentLanguage} contentLanguages={contentLanguages} saving={saving} error={error}
    onUiLanguage={value => void save("/api/account","PATCH",{uiLanguage:value})} onContentLanguage={value => void save("/api/content-context","PUT",{contentLanguage:value})}/>;
}
