"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { MessageKey } from "@/lib/i18n/core";
import ToggleSwitch from "@/components/versado/ToggleSwitch";

interface SettingsView {
  wordGameEnabled: boolean;
  scrabbleEnabled: boolean;
  gezinsavondEnabled: boolean;
  chapterGuessEnabled: boolean;
  challengesEnabled: boolean;
  liveExercisesEnabled: boolean;
  alleskennerEnabled: boolean;
  jigsawEnabled: boolean;
  wordSearchEnabled: boolean;
  quickMissionaryEnabled: boolean;
  mysteryEnabled: boolean;
}

// Icoon los van de naam: de naam is dezelfde vertaling als elders in de app.
// gameKey: de sleutel in GameContentScope (bij welke content-uitgave een spel staat).
const GAMES: { key: keyof SettingsView; gameKey: string; icon: string; labelKey: MessageKey }[] = [
  { key: "jigsawEnabled", gameKey: "jigsaw", icon: "🧩", labelKey: "jigsaw.title" },
  { key: "wordSearchEnabled", gameKey: "word-search", icon: "🔎", labelKey: "pages.wordSearch" },
  { key: "wordGameEnabled", gameKey: "word-game", icon: "🟩", labelKey: "pages.wordOfTheDay" },
  { key: "scrabbleEnabled", gameKey: "scrabble", icon: "🔤", labelKey: "pages.wordGame" },
  { key: "gezinsavondEnabled", gameKey: "gezinsavond", icon: "🎉", labelKey: "pages.familyNight" },
  { key: "chapterGuessEnabled", gameKey: "chapter-guess", icon: "🔎", labelKey: "pages.chapterGuess" },
  { key: "challengesEnabled", gameKey: "challenges", icon: "⚔️", labelKey: "pages.challenges" },
  { key: "liveExercisesEnabled", gameKey: "live-exercises", icon: "", labelKey: "adminGames.liveExercises" },
  { key: "alleskennerEnabled", gameKey: "alleskenner", icon: "🧠", labelKey: "pages.alleskenner" },
  { key: "quickMissionaryEnabled", gameKey: "quick-missionary", icon: "", labelKey: "pages.quickMissionary" },
  { key: "mysteryEnabled", gameKey: "mystery", icon: "", labelKey: "pages.mystery" },
];

interface ScopesView {
  collections: { id: string; name: string; icon: string; language: string | null }[];
  scopes: { gameKey: string; contentCollectionId: string }[];
}

export default function AdminGameSettingsClient() {
  const t = useT();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [scopes, setScopes] = useState<ScopesView | null>(null);

  useEffect(() => {
    fetch("/api/admin/game-settings")
      .then((r) => r.json())
      .then(setSettings);
    fetch("/api/admin/game-scopes")
      .then((r) => (r.ok ? r.json() : null))
      .then(setScopes)
      .catch(() => {});
  }, []);

  async function toggleScope(gameKey: string, contentCollectionId: string, enabled: boolean) {
    setSaving(true);
    const response = await fetch("/api/admin/game-scopes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameKey, contentCollectionId, enabled }),
    }).catch(() => null);
    if (response?.ok) setScopes(await response.json());
    setSaving(false);
  }

  async function toggle(key: keyof SettingsView) {
    if (!settings) return;
    const next = !settings[key];
    setSettings({ ...settings, [key]: next });
    setSaving(true);
    await fetch("/api/admin/game-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    }).catch(() => {});
    setSaving(false);
  }

  return (
    <details className="group card flex flex-col gap-4">
      <summary className="font-extrabold text-lg dark:text-slate-100 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
        {t("adminGames.title")}
        <span className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("adminGames.intro")}
      </p>

      {!settings ? (
        <p className="text-slate-400 dark:text-slate-500">{t("common.loading")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {GAMES.map((g) => (
            <label key={g.key} className="flex min-h-11 cursor-pointer items-center gap-3">
              <span className="min-w-0 flex-1 text-sm dark:text-slate-200">{g.icon ? `${g.icon} ${t(g.labelKey)}` : t(g.labelKey)}</span>
              {!settings[g.key] && (
                <span className="text-xs font-bold uppercase text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950 rounded-full px-2 py-0.5">
                  {t("adminContent.disabled")}
                </span>
              )}
              <ToggleSwitch checked={settings[g.key]} onChange={() => toggle(g.key)} disabled={saving} compact />
            </label>
          ))}
        </div>
      )}

      {scopes && (
        <div className="flex flex-col gap-3 border-t border-slate-100 dark:border-slate-700 pt-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t("adminGames.perContent")}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("adminGames.perContentHint")}</p>
          {GAMES.map((g) => (
            <div key={g.gameKey} className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold dark:text-slate-200">{g.icon ? `${g.icon} ${t(g.labelKey)}` : t(g.labelKey)}</span>
              <div className="flex flex-wrap gap-2">
                {scopes.collections.map((collection) => {
                  const on = scopes.scopes.some((s) => s.gameKey === g.gameKey && s.contentCollectionId === collection.id);
                  return (
                    <label
                      key={collection.id}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs cursor-pointer ${
                        on
                          ? "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-slate-700 dark:text-brand-200"
                          : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"
                      }`}
                    >
                      <ToggleSwitch checked={on} disabled={saving} onChange={(enabled) => toggleScope(g.gameKey, collection.id, enabled)} compact />
                      <span aria-hidden>{collection.icon}</span>
                      {collection.name}
                      {collection.language && <span className="font-bold uppercase">{collection.language}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
