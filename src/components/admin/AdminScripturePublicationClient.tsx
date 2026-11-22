"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { LANGUAGES } from "@/lib/languages";
import type { ScripturePublicationEntry } from "@/lib/scripturePublication";

const endpoint = "/api/admin/content-switcher/publication";
export default function AdminScripturePublicationClient() {
  const t = useT(), confirm = useConfirm();
  const query = useLiveQuery<{ editions: ScripturePublicationEntry[] }>(["admin", "scripture-publication"], () => fetchJson(endpoint), { scopes: ["content"], staleTime: 30_000 });
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"success" | "failed" | null>(null), mutex = useRef(false);
  const editions = query.data?.editions ?? [];
  const eligible = editions.filter(item => item.canPublish && item.releaseToken);
  const chosen = eligible.filter(item => selected.includes(item.id));
  const language = (code: string) => LANGUAGES.find(item => item.code === code)?.nativeName ?? code;
  async function publish(items: ScripturePublicationEntry[]) {
    if (mutex.current || !items.length) return;
    mutex.current = true; setBusy(true); setMessage(null);
    try {
      // Bewaar exact de bekeken tokens. Een verversing tijdens het bevestigen mag de selectie niet vervangen.
      const request = { actionId: crypto.randomUUID(), confirmation: "PUBLICEREN", editions: items.map(item => ({ id: item.id, releaseToken: item.releaseToken })) };
      const names = items.map(item => `${item.name} (${language(item.language)})`).join("; ");
      if (!await confirm(t("scripturePublication.confirm", { names }), { title: t("common.confirm"), confirmLabel: t("scripturePublication.publish"), native: true })) return;
      await jsonMutation(endpoint, { json: request }, { invalidates: "contentChanged" });
      setSelected([]); setMessage("success");
    } catch { setSelected([]); setMessage("failed"); }
    finally { mutex.current = false; setBusy(false); await query.refetch(); }
  }
  return <section aria-labelledby="scripture-publication-title" className="mt-6 min-w-0 border-t border-vs-line pt-5" data-scripture-publication aria-busy={busy}>
    <h3 id="scripture-publication-title" className="text-lg font-bold">{t("scripturePublication.title")}</h3>
    <p className="mt-2 text-sm text-vs-fg-2">{t("scripturePublication.intro")}</p>
    <p className="mt-2 text-sm text-vs-fg-2">{t("scripturePublication.visibility")}</p>
    <button type="button" className="btn-secondary mt-3 min-h-11 max-w-full" disabled={busy || query.isLoading} onClick={() => { setSelected([]); setMessage(null); void query.refetch(); }}>{t("scripturePublication.check")}</button>
    {!!query.error && <p role="alert" className="mt-3 text-vs-danger">{t("scripturePublication.failed")}</p>}
    {!query.data && !query.error && <p role="status">{t("common.loading")}</p>}
    {query.data && !editions.length && <p className="mt-3">{t("scripturePublication.empty")}</p>}
    {(["old-testament", "new-testament", "other"] as const).map(work => {
      const rows = editions.filter(item => work === "other" ? !["old-testament", "new-testament"].includes(item.work ?? "") : item.work === work);
      if (!rows.length) return null;
      const candidates = rows.filter(item => item.canPublish && item.releaseToken);
      return <fieldset key={work} disabled={busy} className="mt-5 min-w-0 rounded-xl border border-vs-line p-3">
        <legend className="max-w-full px-1 font-bold [overflow-wrap:anywhere]">{t(`scripturePublication.${work}`)}</legend>
        {candidates.length > 0 && <button type="button" className="btn-secondary mb-2 min-h-11 max-w-full" onClick={() => setSelected([...new Set([...selected, ...candidates.map(item => item.id)])])}>{t("scripturePublication.selectGroup")}</button>}
        <div className="divide-y divide-vs-line">{rows.map(item => <article key={item.id} className="min-w-0 py-3 [overflow-wrap:anywhere]" data-scripture-edition={item.id}>
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-vs-accent" checked={selected.includes(item.id) && item.canPublish} disabled={!item.canPublish} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
            <span className="min-w-0 font-semibold">{item.name}<span className="block text-sm font-normal text-vs-fg-2">{language(item.language)}</span></span>
          </label>
          <dl className="mt-2 grid min-w-0 grid-cols-1 gap-1 text-sm">
            <div><dt className="inline font-semibold">{t("scripturePublication.status")}: </dt><dd className="inline">{t(item.publicationState === "DRAFT" ? "scripturePublication.draft" : "scripturePublication.published")}</dd></div>
            <div><dt className="inline font-semibold">{t("scripturePublication.source")}: </dt><dd className="inline">{t(item.enabled ? "scripturePublication.on" : "scripturePublication.off")}</dd></div>
            <div><dt className="inline font-semibold">{t("scripturePublication.visible")}: </dt><dd className="inline">{t(item.visibleToUsers ? "scripturePublication.yes" : "scripturePublication.no")}</dd></div>
          </dl>
          {item.found && item.expected && <p className="mt-2 text-sm text-vs-fg-2">{t("scripturePublication.counts", { books: `${item.found.books}/${item.expected.books}`, chapters: `${item.found.chapters}/${item.expected.chapters}`, verses: `${item.found.verses}/${item.expected.verses}` })}</p>}
          <p className="mt-2 text-sm font-semibold">{t(item.verified ? "scripturePublication.verified" : "scripturePublication.blocked")}</p>
          {item.reasons.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-vs-fg-2">{item.reasons.map(reason => <li key={reason}>{t(`scripturePublication.reasons.${reason}`)}</li>)}</ul>}
          {item.canPublish && <button type="button" className="btn-secondary mt-3 min-h-11 max-w-full" onClick={() => void publish([item])}>{t("scripturePublication.publish")}</button>}
        </article>)}</div>
      </fieldset>;
    })}
    {eligible.length > 0 && <button type="button" className="btn-primary mt-4 min-h-12 max-w-full" disabled={busy || !chosen.length} onClick={() => void publish(chosen)}>{t("scripturePublication.publishSelected", { count: chosen.length })}</button>}
    {message && <p role={message === "failed" ? "alert" : "status"} className="mt-3 text-sm font-semibold">{t(`scripturePublication.${message}`)}</p>}
  </section>;
}
