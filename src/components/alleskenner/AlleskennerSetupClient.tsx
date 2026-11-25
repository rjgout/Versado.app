"use client";
import {applicationFetch} from "@/lib/data/applicationRuntime";


import { useState } from "react";
import {AppLink as Link} from "@/components/navigation/AppNavigation";
import {useGameRouter as useRouter} from "@/components/games/GameNavigation";
import { useT } from "@/components/I18nProvider";

const ROUNDS = [
  { icon: "3️⃣", key: "threeSixNine", full: false },
  { icon: "🚪", key: "openDoor", full: true },
  { icon: "🧩", key: "puzzle", full: false },
  { icon: "🖼️", key: "gallery", full: true },
  { icon: "📖", key: "collectiveMemory", full: true },
  { icon: "🏁", key: "final", full: false },
] as const;

export default function AlleskennerSetupClient() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await applicationFetch("/api/live/create-alleskenner", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? t("gamesHub.createFailed"));
      return;
    }
    router.push(`/live/${data.code}`);
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="card !bg-gradient-to-br from-brand-600 to-brand-800 text-white flex flex-col gap-3 !border-0">
        <p className="text-4xl" aria-hidden>
          🧠
        </p>
        <h1 className="text-3xl font-extrabold">{t("pages.alleskenner")}</h1>
        <p className="text-brand-100">
          {t("alleskenner.setupIntro")}
        </p>
        <button className="btn-primary !bg-gold-500 !text-brand-900 self-start mt-1" onClick={create} disabled={busy}>
          {busy ? t("courses.busy") : t("alleskenner.createGame")}
        </button>
        {error && <p className="text-sm font-semibold text-red-200">{error}</p>}
      </div>

      <Link href="/alleskenner/alleen" className="card flex items-center gap-4 hover:shadow-md transition">
        <span className="text-3xl" aria-hidden>
          🧠
        </span>
        <span className="flex-1">
          <span className="block font-extrabold dark:text-slate-100">{t("pages.playAlone")}</span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">
            {t("alleskenner.soloCardText")}
          </span>
        </span>
        <span className="text-slate-400" aria-hidden>
          →
        </span>
      </Link>

      <Link href="/alleskenner/seizoen" className="card flex items-center gap-4 hover:shadow-md transition">
        <span className="text-3xl" aria-hidden>
          📅
        </span>
        <span className="flex-1">
          <span className="block font-extrabold dark:text-slate-100">{t("alleskenner.seasonCardTitle")}</span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">
            {t("alleskenner.seasonCardText")}
          </span>
        </span>
        <span className="text-slate-400" aria-hidden>
          →
        </span>
      </Link>

      <div className="grid gap-3 sm:grid-cols-3">
        {ROUNDS.map((round) => (
          <div key={round.key} className="card flex flex-col gap-1">
            <p className="text-2xl" aria-hidden>
              {round.icon}
            </p>
            <h2 className="font-extrabold dark:text-slate-100">{t(`alleskenner.rounds.${round.key}.title`)}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t(`alleskenner.rounds.${round.key}.text`)}</p>
            <p className="mt-auto pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {round.full ? t("alleskenner.fullOnly") : t("alleskenner.shortAndFull")}
            </p>
          </div>
        ))}
      </div>

      <div className="card flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
        <h2 className="font-extrabold text-base dark:text-slate-100">{t("alleskenner.hostTitle")}</h2>
        <p>
          <strong>{t("alleskenner.withHostLabel")}</strong> {t("alleskenner.withHostText")}
        </p>
        <p>
          <strong>{t("alleskenner.withoutHostLabel")}</strong> {t("alleskenner.withoutHostText")}
        </p>
        <p>
          <strong>{t("alleskenner.teamsLabel")}</strong> {t("alleskenner.teamsText")}
        </p>
        <p>{t("alleskenner.spectators")}</p>
      </div>
    </div>
  );
}
