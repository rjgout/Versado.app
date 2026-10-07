"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PersonalMascot, { useCompanion } from "@/components/versado/PersonalMascot";
import { primaryButton, secondaryButton } from "@/components/versado/styles";
import { useT } from "@/components/I18nProvider";
import QuickMissionaryLeaderboard from "./Leaderboard";
import { quickMissionaryTitle } from "@/lib/gameCatalog";
import { QUICK_MISSIONARY_RANKING_HREF } from "@/lib/navigation";

export default function QuickMissionaryStartClient() {
  const t = useT();
  const router = useRouter();
  const { character } = useCompanion();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const [creatingTogether, setCreatingTogether] = useState(false);

  // Samen spelen: een lobby (LiveGame) waarin vrienden worden uitgenodigd; de run begint pas als de host start.
  async function startTogether() {
    if (creatingTogether) return;
    setCreatingTogether(true);
    setError(false);
    try {
      const response = await fetch("/api/snelle-zendeling/together", { method: "POST", credentials: "same-origin", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.code !== "string") {
        setError(true);
        return;
      }
      router.push(`/live/${data.code}`);
    } catch {
      setError(true);
    } finally {
      setCreatingTogether(false);
    }
  }

  async function start() {
    if (starting) return;
    setStarting(true);
    setError(false);
    try {
      const response = await fetch("/api/snelle-zendeling/runs", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.runId !== "string" || data.runId.length === 0) {
        setError(true);
        return;
      }
      // De startpagina is geen gewenste back-bestemming achter een lopende
      // run: Spelen moet na een beëindigde run de eerstvolgende parent zijn.
      router.replace(`/snelle-zendeling/run/${data.runId}`);
    } catch {
      setError(true);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className="card overflow-hidden !border-0 !bg-gradient-to-br from-sky-100 via-vs-surface to-vs-surface dark:from-sky-950/70">
        <div className="grid items-center gap-5 md:grid-cols-[1fr_14rem]">
          <div className="flex flex-col gap-4">
            <div><p className="text-sm font-bold uppercase tracking-wider text-vs-accent">{t("quickMissionary.eyebrow")}</p><h1 className="mt-1 text-3xl font-black text-vs-fg">{quickMissionaryTitle(t, character)}</h1></div>
            <p className="max-w-xl text-vs-fg-2">{t("quickMissionary.intro")}</p>
            <p className="text-sm font-semibold text-vs-fg-2">{t("quickMissionary.controls")}</p>
            <div className="flex flex-wrap gap-2"><button type="button" className={primaryButton} onClick={start} disabled={starting}>{starting ? t("quickMissionary.starting") : t("quickMissionary.start")}</button><button type="button" className={secondaryButton} onClick={startTogether} disabled={creatingTogether} data-together-open>{creatingTogether ? t("quickMissionary.together.creating") : t("quickMissionary.together.open")}</button><Link href={QUICK_MISSIONARY_RANKING_HREF} replace className={secondaryButton}>{t("quickMissionary.viewRanking")}</Link></div>
            <p className="text-xs text-vs-fg-3">{t("quickMissionary.together.openHint")}</p>
            {error && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{t("quickMissionary.startFailed")}</p>}
          </div>
          <div className="mx-auto flex aspect-square w-52 items-center justify-center rounded-[2rem] bg-sky-200/70 dark:bg-sky-900/50"><PersonalMascot state="playing" size={190} /></div>
        </div>
      </section>
      <QuickMissionaryLeaderboard />
    </div>
  );
}
