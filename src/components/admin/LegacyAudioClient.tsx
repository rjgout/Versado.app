"use client";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { secondaryButton, dangerButton } from "@/components/versado/styles";
import type { legacyInventory, prepareLegacyConversion } from "@/lib/audio/legacyConversion";
import {officialReasons} from "@/lib/audio/officialControls";
import AdminNotice from "./AdminNotice";
import AdminSection from "./AdminSection";
type Inventory=Awaited<ReturnType<typeof legacyInventory>>;
export default function LegacyAudioClient({sessionKey}:{sessionKey:string}) {
  const t=useT(),confirm=useConfirm(),mutex=useRef(false);
  const [opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<string[]>([]),[page,setPage]=useState(0);
  const [pollMs,setPollMs]=useState(120000);
  const [plan,setPlan]=useState<Awaited<ReturnType<typeof prepareLegacyConversion>>|null>(null);
  const query=useLiveQuery<Inventory>(["admin","legacy-audio",sessionKey],async()=>{const result=await fetchJson<Inventory>("/api/admin/audio/legacy");setPollMs(result.rows.some(r=>["RUNNING","QUEUED"].includes(r.status))?15000:120000);return result;},{scopes:["content"],enabled:opened,pollMs:opened?pollMs:undefined});
  const data=query.data,rows=data?.rows??[],choices=rows.filter(r=>selected.includes(r.id)),disabled=busy||!!query.error||!data;
  const label=choices.map(r=>`${r.bookName} ${r.chapterNumber} · nl`).join("\n");
  async function act(action:"download"|"register"|"resume"|"publish"|"approve") {
    if(mutex.current)return;mutex.current=true;setError(null);
    try {
      setBusy(true);
      let planHash:string|undefined;
      if(action==="download") {
        const next=await jsonMutation<Awaited<ReturnType<typeof prepareLegacyConversion>>>("/api/admin/audio/legacy",{json:{action:"prepare",ids:selected}},{invalidates:[]});
        setPlan(next);planHash=next.planHash;
      }
      if(!await confirm(`${t(action==="approve"?"legacyAudio.confirmAcceptance":"legacyAudio.confirmAction")}\n\n${action==="approve"?rows.filter(r=>r.pilot).map(r=>`${r.bookName} ${r.chapterNumber} · nl`).join("\n"):label}`,{title:action==="approve"?t("legacyAudio.accept"):t(`officialAudio.${action==="publish"?"publishSelected":action}`),confirmLabel:action==="approve"?t("legacyAudio.accept"):t(`officialAudio.${action==="publish"?"publishSelected":action}`),destructive:action==="publish",native:true}))return;
      const response=await jsonMutation<{errorCode?:string|null;results?:{id:string;status:string;errorCode:string|null}[]}>("/api/admin/audio/legacy",{json:action==="approve"?{action,confirmed:true}:action==="publish"?{action,selections:choices.map(r=>({id:r.id,recordingId:r.recordingId})),confirmed:true}:{action,ids:selected,...(planHash?{planHash}:{}),confirmed:true}},{invalidates:["content"]});
      if(response.errorCode)setError(t(officialReasons[response.errorCode]??"officialAudio.serviceError"));
      const failures=response.results?.filter(r=>r.status==="FAILED")??[];
      if(failures.length)setError(failures.map(f=>{const row=rows.find(r=>r.id===f.id);return `${row?.bookName} ${row?.chapterNumber}: ${t(officialReasons[f.errorCode??""]??"officialAudio.serviceError")}`;}).join("\n"));
    }catch(e){setError(e instanceof Error?e.message:t("officialAudio.serviceError"));}
    finally{mutex.current=false;setBusy(false);void query.refetch().catch(()=>{});}
  }
  return <AdminSection title={t("legacyAudio.title")} description={t("legacyAudio.intro")} id="legacy-audio-conversion">
    <p className="my-2 text-sm">{t("legacyAudio.safety")}</p>
    <button className={secondaryButton} disabled={busy||query.isFetching} onClick={()=>{setOpened(true);if(opened)void query.refetch().catch(()=>{});}}>{t("legacyAudio.inventory")}</button>
    {(error||!!query.error)&&<AdminNotice kind="error">{error??t("officialAudio.serviceError")}</AdminNotice>}
    {busy&&<p role="status">{t("legacyAudio.checking")}</p>}
    {data&&<>
      <p className="my-3 text-sm">{t("legacyAudio.summary",{total:rows.length,registered:rows.filter(r=>r.recordingId).length,published:rows.filter(r=>r.published).length,review:rows.filter(r=>r.review).length})}</p>
      <p className="my-2 text-sm">{t(data.pilotApproved?"legacyAudio.unlocked":"legacyAudio.pilot")}</p>
      <div className="my-3 flex flex-wrap gap-2">
        <button className={secondaryButton} disabled={disabled} onClick={()=>setSelected(rows.filter(r=>r.pilot&&!r.review&&r.textMatches).map(r=>r.id))}>{t("legacyAudio.selectPilot")}</button>
        {data.pilotApproved&&<button className={secondaryButton} disabled={disabled} onClick={()=>setSelected(rows.filter(r=>!r.review&&r.textMatches&&!r.recordingId&&!["QUEUED","RUNNING"].includes(r.status)).slice(0,3).map(r=>r.id))}>{t("legacyAudio.selectNext")}</button>}
      </div>
      <p className="my-2 whitespace-pre-line text-sm">{label}</p>
      <div className="my-3 flex flex-wrap gap-2">
        <button className={secondaryButton} disabled={disabled||!choices.length||choices.some(r=>!r.textMatches||r.review||(!r.pilot&&!data.pilotApproved))} onClick={()=>void act("download")}>{t("officialAudio.download")} ({selected.length}/3)</button>
        <button className={secondaryButton} disabled={disabled||!choices.length||choices.some(r=>r.status!=="VALIDATED")} onClick={()=>void act("register")}>{t("officialAudio.register")}</button>
        <button className={secondaryButton} disabled={disabled||!choices.length||choices.some(r=>!["FAILED","RUNNING","QUEUED"].includes(r.status))} onClick={()=>void act("resume")}>{t("officialAudio.resume")}</button>
        <button className={dangerButton} disabled={disabled||!choices.length||choices.some(r=>r.status!=="REGISTERED"||!r.recordingId||r.occupied)} onClick={()=>void act("publish")}>{t("officialAudio.publishSelected")}</button>
      </div>
      {!data.pilotApproved&&<button className={secondaryButton} disabled={disabled||rows.filter(r=>r.pilot&&r.published).length!==3} onClick={()=>void act("approve")}>{t("legacyAudio.accept")}</button>}
      {plan&&<details className="my-3 text-sm"><summary>{t("legacyAudio.baseline")}</summary><p className="break-all">{plan.planHash}</p>{plan.baselines.map(b=><p className="my-2 break-all" key={b.sourceId}>{rows.find(r=>r.id===b.sourceId)?.bookName} {rows.find(r=>r.id===b.sourceId)?.chapterNumber}: {b.file?`${b.file.bytes} bytes · SHA-256 ${b.file.sha256}`:t("legacyAudio.noLocal")} · {b.verseStarts.length} {t("legacyAudio.verses")}</p>)}</details>}
      <ul className="divide-y divide-vs-line">{rows.slice(page*25,(page+1)*25).map(row=><li key={row.id} className="flex min-w-0 flex-col gap-2 py-3 text-sm">
        <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1" checked={selected.includes(row.id)} disabled={busy||row.review||!row.textMatches||(!row.pilot&&!data.pilotApproved)||(!selected.includes(row.id)&&selected.length>=3)} onChange={()=>setSelected(previous=>previous.includes(row.id)?previous.filter(id=>id!==row.id):[...previous,row.id])}/><span>{row.bookName} {row.chapterNumber} · {Math.ceil(row.duration/60)} min {row.pilot&&`· ${t("legacyAudio.pilotChapter")}`}</span></label>
        <p>{row.review?t("audioLibrary.review"):row.published?t("audioLibrary.published"):row.status==="VALIDATED"?t("officialAudio.validated"):row.recordingId?t("officialAudio.registered"):row.status==="RUNNING"?t("officialAudio.running"):row.status==="QUEUED"?t("officialAudio.queued"):row.status==="FAILED"?t("officialAudio.failed"):t("officialAudio.notChecked")}</p>
        {!row.filePresent&&<p>{t("legacyAudio.noLocal")}</p>}
        {!row.textMatches&&<p>{t("officialAudio.sourceChanged")}</p>}
        {row.errorCode&&<AdminNotice kind="error">{t("legacyAudio.taskError")}</AdminNotice>}
        {row.recordingId&&<a className="min-h-11 underline" href={`/api/audio/recordings/${row.recordingId}?preview=1`} target="_blank" rel="noreferrer">{t("audioLibrary.view")}</a>}
        <details><summary>{t("legacyAudio.sourceDetails")}</summary><dl className="space-y-2 break-all"><dt>{t("legacyAudio.legacySource")}</dt><dd>{row.legacyUrl??"—"}</dd><dt>{t("legacyAudio.newSource")}</dt><dd>{row.url}</dd><dt>SHA-256</dt><dd>{row.sha256}</dd><dt>{t("legacyAudio.textIdentity")}</dt><dd>{row.sourceHash}</dd><dt>{t("legacyAudio.verses")}</dt><dd>{row.verseStarts.map(v=>`${v.number}: ${v.audioStart??"—"}`).join(" · ")}</dd></dl></details>
      </li>)}</ul>
      <div className="flex items-center gap-3"><button className={secondaryButton} disabled={!page} aria-label={t("officialAudio.previousPage")} onClick={()=>setPage(p=>p-1)}>←</button><span>{page+1}/{Math.ceil(rows.length/25)}</span><button className={secondaryButton} disabled={(page+1)*25>=rows.length} aria-label={t("officialAudio.nextPage")} onClick={()=>setPage(p=>p+1)}>→</button></div>
    </>}
  </AdminSection>;
}
