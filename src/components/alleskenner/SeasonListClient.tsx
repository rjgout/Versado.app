"use client";
import {applicationFetch} from "@/lib/data/applicationRuntime";


import { useEffect, useState, type FormEvent } from "react";
import {AppLink as Link} from "@/components/navigation/AppNavigation";
import {useGameRouter as useRouter} from "@/components/games/GameNavigation";
import { useT } from "@/components/I18nProvider";
import ToggleSwitch from "@/components/versado/ToggleSwitch";

interface SeasonSummary {
  id: string;
  name: string;
  status: "REGULAR" | "FINALE" | "FINISHED";
  host: string;
  champion: string | null;
  members: number;
  evenings: number;
}

export const SEASON_STATUS_KEY = { REGULAR: "regular", FINALE: "finale", FINISHED: "finished" } as const;

export default function SeasonListClient() {
  const t = useT();
  const router = useRouter();
  const [seasons, setSeasons] = useState<SeasonSummary[] | null>(null);
  const [name, setName] = useState("");
  const [joinAsPlayer, setJoinAsPlayer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    applicationFetch("/api/alleskenner/seasons")
      .then((r) => r.json())
      .then((d) => setSeasons(d.seasons ?? []))
      .catch(() => setSeasons([]));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await applicationFetch("/api/alleskenner/seasons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, joinAsPlayer }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? t("season.createFailed"));
      return;
    }
    router.push(`/alleskenner/seizoen/${data.id}`);
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("pages.alleskenner")}</p>
          <h1 className="text-3xl font-extrabold text-brand-800 dark:text-brand-300">{t("pages.seasons")}</h1>
        </div>
        <Link href="/alleskenner" className="btn-secondary !px-3 !py-1.5 !text-sm">
          {t("season.singleGame")}
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-3">
          {seasons === null && <p className="text-slate-400">{t("common.loading")}</p>}
          {seasons?.length === 0 && (
            <div className="card text-slate-500 dark:text-slate-400">
              {t("season.none")}
            </div>
          )}
          {seasons?.map((s) => (
            <Link key={s.id} href={`/alleskenner/seizoen/${s.id}`} className="card flex items-center gap-4 hover:shadow-md transition">
              <span className="text-3xl" aria-hidden>
                {s.status === "FINISHED" ? "👑" : s.status === "FINALE" ? "🏁" : "📅"}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold truncate dark:text-slate-100">{s.name}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">
                  {t(`season.status.${SEASON_STATUS_KEY[s.status]}`)} · {t("season.membersN", { n: s.members })} ·{" "}
                  {s.evenings === 1 ? t("season.eveningsOne", { n: s.evenings }) : t("season.eveningsMany", { n: s.evenings })} ·{" "}
                  {t("season.hostName", { name: s.host })}
                </span>
                {s.champion && <span className="block text-sm font-bold text-gold-600 dark:text-gold-400">{t("season.championShort", { name: s.champion })}</span>}
              </span>
            </Link>
          ))}
        </div>

        <form onSubmit={create} className="card flex flex-col gap-3 self-start">
          <h2 className="font-extrabold dark:text-slate-100">{t("season.newSeason")}</h2>
          <input
            className="input"
            placeholder={t("season.namePlaceholder")}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm dark:text-slate-200">
            <span className="min-w-0 flex-1">{t("season.joinAsPlayer")}</span>
            <ToggleSwitch checked={joinAsPlayer} onChange={setJoinAsPlayer} compact />
          </label>
          <button className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? t("courses.busy") : t("season.create")}
          </button>
          {error && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("season.rules")}
          </p>
        </form>
      </div>
    </div>
  );
}
