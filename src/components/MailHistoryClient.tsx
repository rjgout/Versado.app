"use client";

import { useState, type FormEvent } from "react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import AdminSection from "@/components/admin/AdminSection";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { MAIL_KINDS, MAIL_STATUSES, type MailKind, type MailStatus } from "@/lib/mailHistoryTypes";
import { getLanguage } from "@/lib/languages";

interface MailRow {
  id: string; recipient: string; subject: string; previewText: string; kind: MailKind; status: MailStatus;
  error: string | null; smtpMessageId: string | null; smtpResponse: string | null; createdAt: string;
  completedAt: string | null; tracking: boolean; firstOpenedAt: string | null; lastOpenedAt: string | null;
  openCount: number; actor: string | null; resendOfId: string | null; canResend: boolean;
}
interface History { items: MailRow[]; total: number; failures: number }
const initial = { q: "", status: "", kind: "", from: "", until: "" };

export default function MailHistoryClient() {
  const t = useT(), confirm = useConfirm(), locale = getLanguage(useUiLanguage()).intlLocale;
  const [draft, setDraft] = useState(initial), [filters, setFilters] = useState(initial), [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState("");
  const params = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const query = useLiveQuery<History>(["admin", "mail-history", filters, page], () => fetchJson(`/api/admin/mail-history?${params}`), { scopes: ["mailLog"], pollMs: 60_000 });
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale) : "–";
  function apply(event: FormEvent) { event.preventDefault(); setFilters({ ...draft, q: draft.q.trim() }); setPage(0); }
  async function resend(row: MailRow) {
    if (busy || !await confirm(t("mailLog.confirmResend", { email: row.recipient }))) return;
    setBusy(row.id); setMessage("");
    try {
      await jsonMutation(`/api/admin/mail-history/${row.id}/resend`, { method: "POST" }, { invalidates: ["mailLog"] });
      setMessage(t("mailLog.resent"));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("mailLog.failed")); }
    finally { setBusy(null); }
  }
  const diagnostic = (value: string) => ({ CONFIGURATION: t("mailLog.reasonConfiguration"), PREFERENCES: t("mailLog.reasonPreferences"), ONLINE: t("mailLog.reasonOnline"), INTERRUPTED: t("mailLog.reasonInterrupted") }[value] ?? value);
  return <AdminSection title={t("mailLog.title")} description={t("mailLog.intro")} defaultOpen id="mail-history">
    <p className="text-sm text-vs-fg-2">{t("mailLog.acceptedHelp")}</p>
    <p className="text-sm text-vs-fg-2">{t("mailLog.openingHelp")}</p>
    <form onSubmit={apply} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm">{t("mailLog.search")}<input className="input mt-1 w-full min-w-0" value={draft.q} maxLength={200} placeholder={t("mailLog.searchHint")} onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
      <label className="min-w-0 text-sm">{t("mailLog.statusFilter")}<select className="input mt-1 w-full min-w-0" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">{t("mailLog.all")}</option>{MAIL_STATUSES.map(status => <option key={status} value={status}>{t(`mailLog.status.${status}`)}</option>)}</select></label>
      <label className="min-w-0 text-sm">{t("mailLog.kindFilter")}<select className="input mt-1 w-full min-w-0" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}><option value="">{t("mailLog.all")}</option>{MAIL_KINDS.map(kind => <option key={kind} value={kind}>{t(`mailLog.kind.${kind}`)}</option>)}</select></label>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">{(["from", "until"] as const).map(key => <label key={key} className="min-w-0 text-sm">{t(`mailLog.${key}`)}<input type="date" className="input mt-1 w-full min-w-0" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div>
      <button type="submit" className="btn-primary min-h-11">{t("mailLog.apply")}</button>
      <button type="button" className="btn-secondary min-h-11" onClick={() => void query.refetch()}>{t("mailLog.refresh")}</button>
    </form>
    <p role="status" className="break-words text-sm empty:hidden">{message}</p>
    {Boolean(query.error) && <p role="alert" className="text-vs-danger">{t("mailLog.error")}</p>}
    {!query.data && !query.error && <p>{t("mailLog.loading")}</p>}
    {query.data && <>
      <div className="flex flex-wrap gap-3 text-sm font-bold"><span>{t("mailLog.total", { n: query.data.total })}</span><span>{t("mailLog.failures", { n: query.data.failures })}</span></div>
      {query.data.items.length === 0 && <p>{t("mailLog.empty")}</p>}
      {query.data.items.map(row => <article key={row.id} data-mail-entry={row.id} className="min-w-0 rounded-2xl border border-vs-line p-3 [overflow-wrap:anywhere]">
        <p className="font-bold">{row.subject}</p><p className="text-sm">{row.recipient}</p><p className="mt-1 text-sm text-vs-fg-2">{date(row.createdAt)}</p>
        <p className={`mt-2 text-sm font-bold ${row.status === "FAILED" || row.status === "UNKNOWN" ? "text-vs-danger" : "text-vs-fg"}`}>{t(`mailLog.status.${row.status}`)} · {t(`mailLog.kind.${row.kind}`)}</p>
        <p className="mt-1 text-sm">{row.tracking ? row.openCount ? t("mailLog.openCount", { n: row.openCount }) : t("mailLog.noOpening") : t("mailLog.trackingOff")}</p>
        <details className="mt-3"><summary className="min-h-11 cursor-pointer font-bold">{t("mailLog.details")}</summary>
          <dl className="space-y-2 text-sm">
            {[[t("mailLog.completed"), date(row.completedAt)], [t("mailLog.firstOpen"), date(row.firstOpenedAt)], [t("mailLog.lastOpen"), date(row.lastOpenedAt)], [t("mailLog.smtpId"), row.smtpMessageId], [t("mailLog.smtpResponse"), row.smtpResponse], [t("mailLog.diagnostic"), row.error ? diagnostic(row.error) : null], [t("mailLog.by"), row.actor], [t("mailLog.resendOf"), row.resendOfId]].map(([label, value]) => value && <div key={label}><dt className="font-bold">{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <h3 className="mt-4 font-bold">{t("mailLog.preview")}</h3><p className="mt-1 text-sm text-vs-fg-2">{t("mailLog.previewHelp")}</p>
          <pre data-mail-preview className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-vs-subtle p-3 font-sans text-sm">{row.previewText}</pre>
        </details>
        {row.canResend ? <button type="button" className="btn-secondary mt-3 min-h-11" disabled={Boolean(busy)} onClick={() => void resend(row)}>{t("mailLog.resend")}</button> : <p className="mt-2 text-xs text-vs-fg-2">{t("mailLog.noResend")}</p>}
      </article>)}
      <nav className="flex flex-wrap items-center justify-between gap-2" aria-label={t("mailLog.title")}><button type="button" className="btn-secondary min-h-11" disabled={!page} onClick={() => setPage(page - 1)}>{t("mailLog.previous")}</button><span className="text-sm">{t("mailLog.page", { n: page + 1 })}</span><button type="button" className="btn-secondary min-h-11" disabled={(page + 1) * 25 >= query.data.total || page >= 1000} onClick={() => setPage(page + 1)}>{t("mailLog.next")}</button></nav>
    </>}
  </AdminSection>;
}
