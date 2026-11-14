"use client";
import { useT } from "@/components/I18nProvider";
import CompanionPicker,{ companionName } from "@/components/versado/CompanionPicker";
import { useCompanion } from "@/components/versado/PersonalMascot";
import type { PersonalMascotCharacter } from "@/lib/mascots";
import { useState } from "react";
import { ProfileCard } from "./settings";
/**
 * Jouw gids: dezelfde keuze als bij de onboarding. Opslaan gebeurt meteen;
 * pas na een bevestigd antwoord wisselt de gids in de hele app (useCompanion),
 * zodat het scherm nooit een keuze toont die niet is opgeslagen.
 */
export default function CompanionPreference({ current, onChanged, onSave }: { current: PersonalMascotCharacter; onSave:(choice:PersonalMascotCharacter)=>Promise<void>; onChanged?: (companion: PersonalMascotCharacter) => void }) {
  const t = useT();
  const { setCharacter } = useCompanion();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);

  async function choose(choice: PersonalMascotCharacter) {
    if (choice === current || saving) return;
    setSaving(true);
    setStatus(null);
    try { await onSave(choice); }
    catch { setSaving(false); setStatus({ kind:"error", text:t("companion.saveFailed") }); return; }
    setSaving(false);
    setCharacter(choice);
    onChanged?.(choice);
    setStatus({ kind: "saved", text: t("companion.saved", { name: companionName(choice) }) });
  }

  return (
    <ProfileCard description={t("companion.profileIntro")}>
      <div className="mt-1">
        <CompanionPicker name="profile-companion" legend={t("companion.profileTitle")} value={current} onSelect={choose} busy={saving} size="carousel" />
      </div>
      <p role="status" className={`mt-3 min-h-5 text-sm font-semibold ${status?.kind === "error" ? "text-vs-danger" : "text-vs-success"}`}>
        {status?.text}
      </p>
    </ProfileCard>
  );
}
