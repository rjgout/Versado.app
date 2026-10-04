"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Copy, Download, Link2, QrCode, Share2, X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { iconButton, primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import { socialRequest } from "@/components/social/shared";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import { canShareContent, shareContent } from "@/lib/platform";

/** De groepslink zoals hij gedeeld wordt; de QR-code bevat precies deze tekst. */
export function groupLinkUrl(token: string): string {
  return `${window.location.origin}/uitnodiging/groep/${token}`;
}

/**
 * QR-matrix met foutcorrectie Q (blijft leesbaar met een vlek of vouw op een
 * poster) en de standaard stille rand van 4 modules.
 */
function qrMatrix(text: string): { size: number; dark: (x: number, y: number) => boolean } {
  const qr = qrcode(0, "Q");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  return {
    size: count + quiet * 2,
    dark: (x, y) => x >= quiet && y >= quiet && x < count + quiet && y < count + quiet && qr.isDark(y - quiet, x - quiet),
  };
}

/** Altijd zwart op wit, ook in donkere modus: anders scannen veel camera's hem niet. */
function QrSvg({ text, label }: { text: string; label: string }) {
  const { size, dark } = useMemo(() => qrMatrix(text), [text]);
  const cells: string[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (dark(x, y)) cells.push(`M${x} ${y}h1v1h-1z`);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="h-auto w-full rounded-xl" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={cells.join("")} fill="#000000" />
    </svg>
  );
}

/** PNG in hoge resolutie (ruim genoeg voor een A4-poster). */
function downloadPng(text: string, fileName: string) {
  const { size, dark } = qrMatrix(text);
  const scale = Math.max(8, Math.ceil(1600 / size));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (dark(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = fileName;
  a.click();
}

function fileNameFor(groupName: string): string {
  const slug = groupName.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "groep";
  return `${slug}-qr.png`;
}

/**
 * Groepslink en QR-code in de groepsinstellingen (alleen beheerders; de
 * server controleert dat ook). Intrekken maakt het token meteen ongeldig;
 * opnieuw aanzetten geeft altijd een nieuw token.
 */
export default function GroupLinkSettings({ groupId, groupName, token, onChanged }: { groupId: string; groupName: string; token: string | null; onChanged: () => unknown }) {
  const t = useT();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // Het vinkje volgt meteen de keuze; na het antwoord van de server geldt weer de echte stand.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const url = token ? groupLinkUrl(token) : null;

  useEffect(() => setCanShare(canShareContent()), []);

  async function setActive(active: boolean) {
    if (!active && !(await confirm(t("together.link.revokeConfirm")))) return;
    setOptimistic(active);
    setBusy(true);
    setError(null);
    const result = await socialRequest(`/api/groups/${groupId}/link`, { action: active ? "enable" : "revoke" });
    setBusy(false);
    if (!result.ok) setError(result.error ?? t("together.common.error"));
    if (!active) setShowQr(false);
    await onChanged();
    setOptimistic(null);
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (!url) return;
    await shareContent({ title: groupName, text: t("together.link.shareText", { group: groupName }), url });
  }

  return (
    <section aria-labelledby="group-link" className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
      <h2 id="group-link" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-vs-fg">
        <Link2 className="h-5 w-5 text-vs-accent" aria-hidden />
        {t("together.link.title")}
      </h2>
      <p className="text-sm text-vs-fg-2">{t("together.link.intro")}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-vs-fg">{t("together.link.active")}</span>
          <span className="block text-xs text-vs-fg-2">{t("together.link.activeHint")}</span>
        </span>
        <ToggleSwitch checked={optimistic ?? !!token} disabled={busy} onChange={setActive} />
      </label>
      {error && (
        <p role="alert" className="text-sm font-semibold text-vs-danger">
          {error}
        </p>
      )}
      {url && (
        <>
          <p className="break-all rounded-xl bg-vs-subtle px-3 py-2 font-mono text-xs text-vs-fg-2">{url}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} onClick={() => setShowQr(true)}>
              <QrCode className="h-4 w-4" aria-hidden />
              {t("together.link.qr")}
            </button>
            <button type="button" className={secondaryButton} onClick={copy}>
              <Copy className="h-4 w-4" aria-hidden />
              {copied ? t("together.link.copied") : t("together.link.copy")}
            </button>
            {canShare && (
              <button type="button" className={secondaryButton} onClick={share}>
                <Share2 className="h-4 w-4" aria-hidden />
                {t("together.link.share")}
              </button>
            )}
            <button type="button" className={`${secondaryButton} !border-vs-danger/40 !text-vs-danger`} disabled={busy} onClick={() => setActive(false)}>
              {t("together.link.revoke")}
            </button>
          </div>
        </>
      )}

      {showQr && url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-vs-overlay/60 px-4" role="dialog" aria-modal="true" aria-labelledby="qr-title">
          <div className={`${surfaceCard} flex w-full max-w-sm flex-col gap-3 p-5 shadow-xl`}>
            <div className="flex items-start justify-between gap-3">
              <h3 id="qr-title" className="text-lg font-extrabold text-vs-fg">
                {t("together.link.qrTitle", { group: groupName })}
              </h3>
              <button type="button" className={iconButton} aria-label={t("together.link.close")} onClick={() => setShowQr(false)}>
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="rounded-2xl bg-white p-3">
              <QrSvg text={url} label={t("together.link.qrTitle", { group: groupName })} />
            </div>
            <p className="text-xs text-vs-fg-2">{t("together.link.qrHint")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} onClick={() => downloadPng(url, fileNameFor(groupName))}>
                <Download className="h-4 w-4" aria-hidden />
                {t("together.link.download")}
              </button>
              {canShare && (
                <button type="button" className={secondaryButton} onClick={share}>
                  <Share2 className="h-4 w-4" aria-hidden />
                  {t("together.link.share")}
                </button>
              )}
              <button type="button" className={secondaryButton} onClick={copy}>
                <Copy className="h-4 w-4" aria-hidden />
                {copied ? t("together.link.copied") : t("together.link.copy")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
