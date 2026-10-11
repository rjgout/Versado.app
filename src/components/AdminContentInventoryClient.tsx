"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import AdminSection from "@/components/admin/AdminSection";
import AdminTable from "@/components/admin/AdminTable";
import AdminNotice from "@/components/admin/AdminNotice";
import { primaryButton, secondaryButton } from "@/components/versado/styles";
import type { ContentInventory } from "@/lib/content-inventory/core";

export default function AdminContentInventoryClient() {
  const t = useT();
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ContentInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null); setReport(null);
    try {
      const response = await fetch("/api/admin/content-inventory", { method: "POST", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? t("adminInventory.failed")); return; }
      setReport(result);
    } catch { setError(t("adminInventory.failed")); }
    finally { busy.current = false; setLoading(false); }
  }
  function download() {
    if (!report) return;
    // Alleen de gesaneerde serverresponse, in geheugen. Geen opslag op server/localStorage.
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `versado-content-inventory-${report.capturedAt.replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const yesNo = (flag: boolean) => t(flag ? "adminInventory.yes" : "adminInventory.no");
  const tableStyle = "w-max min-w-full [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-bold [&_tbody_tr]:border-t [&_tbody_tr]:border-vs-line";
  const unfinished = report?.migrations.filter((m) => !m.finished_at && !m.rolled_back_at) ?? [];
  const relationIssues = Object.entries(report?.integrity ?? {}).filter(([, count]) => count !== "0");
  return (
    <AdminSection id="database-inventory" title={t("adminInventory.title")} description={t("adminInventory.intro")}>
      <div data-content-inventory className="flex min-w-0 flex-col gap-4" aria-busy={loading}>
        <div className="-mx-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
          <button type="button" className={`${primaryButton} w-full !px-2 [overflow-wrap:normal]`} disabled={loading} onClick={run}>
            {t(loading ? "adminInventory.loading" : "adminInventory.run")}
          </button>
          {report && <button type="button" className={`${secondaryButton} w-full !px-2 [overflow-wrap:normal]`} onClick={download}>{t("adminInventory.download")}</button>}
        </div>
        {loading && <AdminNotice kind="info">{t("adminInventory.loading")}</AdminNotice>}
        {error && <AdminNotice kind="error">{error}</AdminNotice>}
        {report && <>
          <AdminNotice kind="success">{t("adminInventory.success")}</AdminNotice>
          <p className="text-sm text-vs-fg-2">{t("adminInventory.capturedAt")}: <time dateTime={report.capturedAt}>{new Date(report.capturedAt).toLocaleString()}</time></p>
          <h3 className="font-bold text-vs-fg">{t("adminInventory.collections")}: {report.collections.length}</h3>
          {report.collections.length === 0 ? <AdminNotice kind="info">{t("adminInventory.empty")}</AdminNotice> :
            <AdminTable label={t("adminInventory.collections")}><table className={tableStyle}>
              <thead><tr><th>{t("adminInventory.collectionWork")}</th><th>{t("adminInventory.editionLanguage")}</th><th>{t("adminInventory.enabled")}</th><th>{t("adminInventory.visible")}</th><th>{t("adminInventory.publication")}</th></tr></thead>
              <tbody>{report.collections.map((c) => <tr key={c.id}><td><strong>{c.id}</strong><br />{c.slug}<br />{c.work ?? "—"}</td><td>{c.editionKey} / {c.language}</td><td>{yesNo(c.enabled)}</td><td>{yesNo(c.visibleToUsers)}</td><td>{c.publicationState ?? t("adminInventory.legacy")}</td></tr>)}</tbody>
            </table></AdminTable>}
          <details><summary className="cursor-pointer font-bold text-vs-fg">{t("adminInventory.identities")} ({report.identities.works.length})</summary>
            <p className="my-2 text-sm text-vs-fg-2">{t("adminInventory.kindAdvice")}</p>
            <ul className="divide-y divide-vs-line text-sm">{report.identities.works.map((w) => <li className="py-2" key={w.key}><strong>{w.key}</strong> · {w.suggestedKind} · {w.origin}<br />{w.collections.join(", ")}</li>)}</ul>
          </details>
          <h3 className="font-bold text-vs-fg">{t("adminInventory.fsy")}</h3>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm text-vs-fg">
            {([ ["lessons", report.fsy.total], ["publishedCopies", report.fsy.published], ["publishedStatus", report.fsy.publishedStatus], ["drafts", report.fsy.drafts], ["draftWithCopy", report.fsy.draftWithPublishedCopy] ] as const).map(([key, value]) => <div key={key} className="contents"><dt>{t(`adminInventory.${key}`)}</dt><dd>{value}</dd></div>)}
          </dl>
          <details><summary className="cursor-pointer font-bold text-vs-fg">{t("adminInventory.counts")}</summary><dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm">{Object.entries(report.counts).map(([key, count]) => <div className="contents" key={key}><dt>{key}</dt><dd>{count}</dd></div>)}</dl></details>
          <details><summary className="cursor-pointer font-bold text-vs-fg">{t("adminInventory.integrity")}</summary><dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm">{Object.entries(report.integrity).map(([key, count]) => <div className="contents" key={key}><dt>{key}</dt><dd>{count}</dd></div>)}</dl></details>
          <details><summary className="cursor-pointer font-bold text-vs-fg">{t("adminInventory.migrations")} ({report.migrations.length})</summary>
            <AdminTable label={t("adminInventory.migrations")}><table className={tableStyle}>
              <thead><tr><th>{t("adminInventory.migration")}</th><th>{t("adminInventory.dates")}</th><th>{t("adminInventory.rolledBack")}</th><th>{t("adminInventory.steps")}</th></tr></thead>
              <tbody>{report.migrations.map((m) => <tr key={`${m.migration_name}-${m.started_at}`}><td>{m.migration_name}</td><td>{m.started_at}<br />{m.finished_at ?? "—"}</td><td>{m.rolled_back_at ?? "—"}</td><td>{m.applied_steps_count}</td></tr>)}</tbody>
            </table></AdminTable>
          </details>
          <h3 className="font-bold text-vs-fg">{t("adminInventory.attention")}</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm text-vs-fg-2">
            {!report.publicationFieldPresent && <li>{t("adminInventory.publicationAdvice")}</li>}
            {report.identities.nullWorkCollectionIds.length > 0 && <li>{t("adminInventory.nullWorks", { n: report.identities.nullWorkCollectionIds.length })}</li>}
            {report.identities.issues.map((issue, i) => <li key={i}>{t(`adminInventory.${issue.type}`)}: {issue.collectionId ?? issue.key}</li>)}
            {relationIssues.map(([key, count]) => <li key={key}>{key}: {count}</li>)}
            {unfinished.map((m) => <li key={m.migration_name}>{t("adminInventory.unfinished", { name: m.migration_name })}</li>)}
            {!report.identities.issues.length && !relationIssues.length && !unfinished.length && <li>{t("adminInventory.noIssues")}</li>}
          </ul>
        </>}
      </div>
    </AdminSection>
  );
}
