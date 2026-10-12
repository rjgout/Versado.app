"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminSection from "@/components/admin/AdminSection";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { getLanguage } from "@/lib/languages";
import type { AdminContentInspection } from "@/lib/adminContentInspection";

export default function AdminContentInspectionClient({ initialData, sessionKey }: { initialData: AdminContentInspection; sessionKey: string }) {
  const t = useT();
  const [work, setWork] = useState(""); const [family, setFamily] = useState(""); const [language, setLanguage] = useState("");
  const query = useLiveQuery<AdminContentInspection>(["admin", "content-inspection", sessionKey], () => fetchJson("/api/admin/content-inspection"), { scopes: ["content"], initialData, staleTime: 0 });
  // Een ingetrokken adminrecht mag oude metadata niet als succesvolle response blijven tonen.
  const data = query.error ? null : query.data ?? initialData;
  const eligible = data?.collections.filter(c => !work || c.work === work) ?? [];
  const families = [...new Set(eligible.map(c => c.editionKey))];
  const languages = [...new Set(eligible.filter(c => !family || c.editionKey === family).map(c => c.language))];
  const filtered = eligible.filter(c => (!family || c.editionKey === family) && (!language || c.language === language));
  return <div data-admin-content-inspection className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-6">
    <AdminPageHeader title={t("adminContentInspect.title")} text={t("adminContentInspect.intro")} />
    {Boolean(query.error) && <p role="alert" className="text-vs-danger">{t("adminContentInspect.failed")}</p>}
    {data && <>
      <div className="grid min-w-0 gap-3 rounded-2xl border border-vs-line bg-vs-surface p-4 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-bold text-vs-fg">{t("adminContentInspect.work")}<select className="input mt-1 w-full min-w-0" value={work} onChange={e => { setWork(e.target.value); setFamily(""); setLanguage(""); }}><option value="">{t("adminContentInspect.all")}</option>{data.works.map(w => <option key={w.key} value={w.key}>{eligible.find(c => c.work === w.key)?.name ?? data.collections.find(c => c.work === w.key)?.name ?? w.key} · {w.key} ({w.kind})</option>)}</select></label>
        <label className="min-w-0 text-sm font-bold text-vs-fg">{t("adminContentInspect.edition")}<select className="input mt-1 w-full min-w-0" value={family} onChange={e => { setFamily(e.target.value); setLanguage(""); }}><option value="">{t("adminContentInspect.all")}</option>{families.map(f => <option key={f}>{f}</option>)}</select></label>
        <label className="min-w-0 text-sm font-bold text-vs-fg">{t("adminContentInspect.language")}<select className="input mt-1 w-full min-w-0" value={language} onChange={e => setLanguage(e.target.value)}><option value="">{t("adminContentInspect.all")}</option>{languages.map(l => <option key={l} value={l}>{getLanguage(l).nativeName} ({l})</option>)}</select></label>
      </div>
      <p className="text-sm font-bold text-vs-fg-2">{t("adminContentInspect.collections")}: {filtered.length}</p>
      {filtered.map(c => <AdminSection key={c.id} id={`inspect-${c.id}`} defaultOpen title={c.name} description={`${c.work ?? t("adminContentInspect.unmapped")} · ${c.editionKey} · ${c.language}`}>
        <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-vs-fg-2"><div><dt>{t("adminContentInspect.publication")}</dt><dd className="font-bold text-vs-fg">{c.publicationState}</dd></div><div><dt>{c.enabled ? t("adminContentInspect.enabled") : t("adminContentInspect.disabled")}</dt><dd>{c.visibleToUsers ? t("adminContentInspect.visible") : t("adminContentInspect.hidden")}</dd></div></dl>
        <p className="text-sm text-vs-fg-2">{t(c.previewHref ? "adminContentInspect.previewAvailable" : "adminContentInspect.previewUnsupported")}</p>
        {c.previewHref ? <Link className="btn-secondary self-start" href={c.previewHref}>{t("adminContentInspect.preview")}</Link> : <p className="text-sm text-vs-fg-3">{t("adminContentInspect.unsupported")}</p>}
        {c.managementHref && <Link className="text-sm font-bold text-vs-accent underline" href={c.managementHref}>{t("adminContentInspect.fsy")}</Link>}
      </AdminSection>)}
      {!filtered.length && <p className="text-sm text-vs-fg-3">{t("adminContentInspect.empty")}</p>}
    </>}
  </div>;
}
