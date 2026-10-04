"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { canShareContent, shareContent } from "@/lib/platform";

/**
 * Persoonlijke uitnodigingslink op de Vrienden-pagina (zie
 * src/lib/friendInvite.ts): wie via die link een account maakt, is meteen je
 * vriend.
 */
export default function FriendInviteCard({ appName }: { appName: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    fetch("/api/friends/invite")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.code && setCode(d.code));
    // Pas na het laden bepalen: op de server bestaat navigator niet, en een
    // verschil tussen server- en clientweergave geeft een hydratatiefout.
    setCanShare(canShareContent());
  }, []);

  const link = code ? `${window.location.origin}/uitnodiging/${code}` : null;

  async function share() {
    if (!link) return;
    await shareContent({
      title: appName,
      text: t("friendInvite.shareText", { app: appName }),
      url: link,
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setMessage(t("friendInvite.copied"));
    } catch {
      setMessage(t("friendInvite.copyFailed"));
    }
  }

  async function regenerate() {
    if (!(await confirm(t("friendInvite.confirmRegenerate")))) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/friends/invite", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !body.code) {
      setMessage(body.error ?? t("friendInvite.regenerateFailed"));
      return;
    }
    setCode(body.code);
    setMessage(t("friendInvite.regenerated"));
  }

  return (
    <div className="card flex flex-col gap-2.5 !p-4 sm:gap-3 sm:!p-5">
      <p className="font-bold text-sm dark:text-slate-100 flex items-center gap-2">
        <span aria-hidden>💌</span> {t("friendInvite.title")}
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("friendInvite.text")}
      </p>
      {link ? (
        <>
          <p className="text-xs font-mono break-all bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl px-3 py-2 select-all">
            {link}
          </p>
          <div className="flex gap-2 flex-wrap">
            {canShare && (
              <button className="btn-primary !px-4 !py-1.5" onClick={share}>
                {t("friendInvite.share")}
              </button>
            )}
            <button className={`${canShare ? "btn-secondary" : "btn-primary"} !px-4 !py-1.5`} onClick={copy}>
              {t("friendInvite.copy")}
            </button>
            <button className="btn-secondary !px-4 !py-1.5" disabled={busy} onClick={regenerate}>
              {busy ? t("courses.busy") : t("friendInvite.regenerate")}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 dark:text-slate-500">{t("common.loading")}</p>
      )}
      {message && <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">{message}</p>}
    </div>
  );
}
