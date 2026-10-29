"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { secondaryButton } from "@/components/versado/styles";
import { nativeBridge } from "@/lib/native/bridge";

const statusSchema = z.object({ enabled: z.boolean(), configured: z.boolean() }).strict();
const changeSchema = z.object({ changed: z.boolean() }).strict();
/** Alleen in de expliciete interne build. De velden voor credentials bestaan uitsluitend native. */
export default function NativeAccessPanel({ onChanged, onBeforeClear }: { onChanged: () => Promise<void>; onBeforeClear: () => Promise<void> }) {
  const t = useT(), language = useUiLanguage();
  const [status, setStatus] = useState<z.infer<typeof statusSchema> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void nativeBridge.accessStatus().then(value => { const status = statusSchema.parse(value); if (active) setStatus(status); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  async function change(clear: boolean) {
    setBusy(true); setError(false);
    try {
      if (clear) await onBeforeClear(); // Eerst bestaande logout proberen zolang de huidige toegang nog beschikbaar is.
      const result = changeSchema.parse(await (clear ? nativeBridge.clearAccess() : nativeBridge.enrollAccess({ language })));
      if (result.changed) await onChanged();
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <section aria-label={t("nativeAccess.title")} className="rounded-xl border border-vs-line bg-vs-surface p-4">
    <h2 className="text-lg font-bold">{t("nativeAccess.title")}</h2>
    <p className="mt-2">{t("nativeAccess.help")}</p>
    <p role="status" className="mt-2">{busy ? t("nativeAccess.busy") : status?.enabled === false ? t("nativeAccess.disabled") : status?.configured ? t("nativeAccess.configured") : t("nativeAccess.missing")}</p>
    <p className="mt-2 text-vs-fg-3">{t("nativeAccess.realtime")}</p>
    {error && <p role="alert" className="mt-2">{t("nativeAccess.error")}</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      <button type="button" disabled={busy || status?.enabled === false} className={`${secondaryButton} min-h-12 whitespace-normal`} onClick={() => { void change(false); }}>{t("nativeAccess.enroll")}</button>
      <button type="button" disabled={busy || status?.enabled === false} className={`${secondaryButton} min-h-12 whitespace-normal`} onClick={() => { void change(true); }}>{t("nativeAccess.clear")}</button>
    </div>
  </section>;
}
