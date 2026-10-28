"use client";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import type { AudioOverview } from "@/lib/audio/library";
import AdminPageHeader from "./AdminPageHeader";
import AdminSection from "./AdminSection";
import AdminNotice from "./AdminNotice";
import OfficialAudioClient from "./OfficialAudioClient";
import type { OfficialOverview } from "@/lib/audio/officialJobs";
export default function AdminAudioClient({ initialData, initialOfficial, sessionKey }: { initialData: AudioOverview; initialOfficial: OfficialOverview; sessionKey: string }) {
  const t = useT(), confirm = useConfirm(), mutex = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const query = useLiveQuery<AudioOverview>(["admin", "audio", sessionKey], () => fetchJson("/api/admin/audio"), { scopes: ["content"], initialData, staleTime: 0, pollMs: 30000 });
  const data = query.error ? null : query.data ?? initialData;
  async function publish(recordingId: string, expectedVersion: number, label: string) {
    if (mutex.current) return;
    mutex.current = true;
    try {
      if (!(await confirm(`${t("audioLibrary.confirm")}\n\n${label}`, { title: t("audioLibrary.publish"), confirmLabel: t("audioLibrary.publish"), native: true }))) return;
      setBusy(true); setError(false);
      await jsonMutation("/api/admin/audio", { json: { recordingId, expectedVersion } }, { invalidates: ["content"] });
    } catch { setError(true); } finally { mutex.current = false; setBusy(false); }
  }
  return <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-4">
    <AdminPageHeader title={t("audioLibrary.title")} text={t("audioLibrary.intro")} />
    <OfficialAudioClient initialData={initialOfficial} sessionKey={sessionKey} />
    {(error || Boolean(query.error)) && <AdminNotice kind="error">{t("audioLibrary.failed")}</AdminNotice>}
    <p className="text-sm text-vs-fg-2">{t("audioLibrary.legacy")}</p>
    {data?.collections.map((c) => <AdminSection key={c.id} title={`${c.name} · ${c.language}`} description={`${c.editionKey} · ${c.publicationState}`}>
      <dl className="grid grid-cols-2 gap-2 text-sm">{[["chapters",c.total],["recordings",c.available],["missing",c.missing],["local", c.local], ["legacyCount", c.legacy], ["storage",`${(c.bytes / 1048576).toFixed(1)} MiB`]].map(([key,value]) => <div key={key}><dt className="text-vs-fg-2">{t(`audioLibrary.${key}` as "audioLibrary.chapters")}</dt><dd className="font-bold">{value}</dd></div>)}</dl>
      <details><summary className="cursor-pointer font-bold">{t("audioLibrary.view")}</summary>
        {!c.recordings.length && <p>{t("audioLibrary.empty")}</p>}
        <ul className="divide-y divide-vs-line">{c.recordings.map((r) => {
          const quality = (r.quality as {status?:string}).status;
          const current = c.recordings.find((other) => other.targetKey === r.targetKey && other.publication)?.publication;
          return <li key={r.id} className="flex min-w-0 flex-col gap-2 py-3 text-sm">
            <p className="break-words font-bold">{r.chapter?.book.name} {r.chapter?.number}</p>
            <p>{t("audioLibrary.source")}: {r.sourceKind} · {String((r.voice as {name?:string}).name ?? "")} · {t("audioLibrary.import")}: {r.package.status} · {t("audioLibrary.quality")}: {quality}</p>
            <a className="min-h-11 break-all text-vs-accent underline" href={`/api/audio/recordings/${r.id}?preview=1`} target="_blank" rel="noreferrer">{t("audioLibrary.view")}</a>
            {r.publication ? <p>{t("audioLibrary.active")}</p> : quality === "VALIDATED" ? <button className="btn-secondary min-h-12 whitespace-normal" disabled={busy || query.updatedAt === null} onClick={() => void publish(r.id, current?.version ?? 0, `${r.chapter?.book.name} ${r.chapter?.number} · ${c.language}`)}>{t("audioLibrary.publish")}</button> : <p>{t("audioLibrary.review")}</p>}
          </li>;
        })}</ul>
      </details>
    </AdminSection>)}
    <AdminSection title={t("audioLibrary.errors")} defaultOpen>
      {data?.errors.length ? <ul>{data.errors.map((e) => <li key={e.id} className="break-all text-sm">{e.id}: {e.errorCode} ({e.attempts})</li>)}</ul> : <p>{t("audioLibrary.noErrors")}</p>}
    </AdminSection>
  </div>;
}
