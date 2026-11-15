"use client";

import {AppLink as Link} from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";

/** Zie useLobbyExit: kort zichtbaar voordat je terug naar Spelen gaat. */
export default function LobbyClosedNotice() {
  const t = useT();
  return (
    <div className="max-w-md mx-auto card text-center flex flex-col gap-3" role="status">
      <span className="text-4xl" aria-hidden>
        🚪
      </span>
      <p className="font-extrabold dark:text-slate-100">{t("lobby.closedByHost")}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("lobby.goingBack")}</p>
      <Link href="/live" className="btn-secondary self-center">
        {t("lobby.goNow")}
      </Link>
    </div>
  );
}
