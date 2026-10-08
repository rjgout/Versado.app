"use client";

import { useEffect, useState } from "react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { getLanguage } from "@/lib/languages";
import AdminSection from "@/components/admin/AdminSection";

interface GameView {
  id: string;
  code: string;
  status: "LOBBY" | "IN_PROGRESS";
  hostLabel: string;
  label: string;
  playerCount: number;
  createdAt: string;
}

export default function AdminLiveGamesClient() {
  const t = useT();
  const confirm = useConfirm();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [games, setGames] = useState<GameView[] | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/live-games");
    if (res.ok) setGames((await res.json()).games);
  }

  useEffect(() => {
    load();
  }, []);

  async function endGame(id: string, code: string) {
    if (!(await confirm(t("adminLive.confirmEnd", { code })))) return;
    setEndingId(id);
    await fetch(`/api/admin/live-games/${id}`, { method: "DELETE" }).catch(() => {});
    await load();
    setEndingId(null);
  }

  return (
    <AdminSection title={t("adminLive.title")}>

      <p className="text-sm text-vs-fg-2">
        {t("adminLive.intro")}
      </p>

      {!games ? (
        <p className="text-vs-fg-3">{t("common.loading")}</p>
      ) : games.length === 0 ? (
        <p className="text-vs-fg-3">{t("adminLive.none")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {games.map((g) => (
            <div
              key={g.id}
              className="border border-vs-line rounded-xl p-3 flex items-center justify-between gap-2 flex-wrap"
            >
              <div>
                <p className="font-bold text-sm text-vs-fg">
                  {g.label}{" "}
                  <span className="font-normal text-vs-fg-3">
                    ({t(g.playerCount === 1 ? "adminLive.playersOne" : "adminLive.playersMany", { status: t(`adminLive.status.${g.status}`), n: g.playerCount })})
                  </span>
                </p>
                <p className="text-xs text-vs-fg-3">
                  {t("adminLive.meta", { code: g.code, host: g.hostLabel, when: new Date(g.createdAt).toLocaleString(intlLocale) })}
                </p>
              </div>
              <button
                className="text-xs font-semibold text-vs-danger hover:underline shrink-0"
                disabled={endingId === g.id}
                onClick={() => endGame(g.id, g.code)}
              >
                {t("adminLive.end")}
              </button>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
