"use client";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import type { MessageKey } from "@/lib/i18n/core";
import { secondaryButton, dangerButton } from "@/components/versado/styles";
import type { OfficialOverview } from "@/lib/audio/officialJobs";
import { officialBatches, officialReasons } from "@/lib/audio/officialControls";
import LegacyAudioClient from "./LegacyAudioClient";
import AdminSection from "./AdminSection";
import AdminNotice from "./AdminNotice";

export default function OfficialAudioClient({initialData,sessionKey}:{initialData:OfficialOverview;sessionKey:string}) {
  const t=useT(),confirm=useConfirm(),mutex=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [pollMs,setPollMs]=useState(initialData.active?15000:120000);
  const [progress,setProgress]=useState<{done:number;total:number}|null>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const query=useLiveQuery<OfficialOverview>(["admin","official-audio",sessionKey],async()=>{const overview=await fetchJson<OfficialOverview>("/api/admin/audio/official");setPollMs(overview.active?15000:120000);return overview;},{scopes:["content"],initialData,staleTime:0,pollMs});
  const data=query.data??initialData;
  const disabled=busy||!!query.error||!data||!data.storageAvailable||query.updatedAt===null;
  const statuses:Record<string,MessageKey>={NOT_CHECKED:"officialAudio.notChecked",QUEUED:"officialAudio.queued",RUNNING:"officialAudio.running",VALIDATED:"officialAudio.validated",REGISTERED:"officialAudio.registered",FAILED:"officialAudio.failed"};
  const statusText=(status:string)=>t(statuses[status]??"officialAudio.failed");
  const reasons:Record<string,MessageKey>={TARGET_MISSING:"officialAudio.editionMissing",SOURCE_MISMATCH:"officialAudio.sourceChanged",FORBIDDEN:"officialAudio.forbidden",SOURCE_PROTECTED:"officialAudio.protection",LEGACY_PROTECTED:"officialAudio.protection",CACHE_MISSING:"officialAudio.missingFile",STORAGE_UNAVAILABLE:"officialAudio.storageMissing",STORAGE_FULL:"officialAudio.storageFull",STORAGE_PERMISSION:"officialAudio.storagePermission",SOURCE_HTTP:"officialAudio.sourceUnavailable",SOURCE_ADDRESS:"officialAudio.sourceUnavailable",SOURCE_REDIRECT:"officialAudio.sourceUnavailable",SOURCE_SIZE:"officialAudio.invalidAudio",SOURCE_AUDIO_IDENTITY:"officialAudio.sourceChanged",SOURCE_IDENTITY:"officialAudio.sourceChanged",SOURCE_TYPE:"officialAudio.invalidAudio",AUDIO_CHECKSUM:"officialAudio.invalidAudio",AUDIO_DURATION_FORMAT:"officialAudio.invalidAudio",CACHE_CORRUPT:"officialAudio.invalidAudio"};
  const reason=(code:string)=>t(officialReasons[code]??reasons[code]??"officialAudio.serviceError");
  async function act(action:"download"|"register"|"resume",ids:string[],label:string) {
    if(mutex.current)return;mutex.current=true;
    try {
      const message=t(action==="register"?"officialAudio.confirmRegister":action==="resume"?"officialAudio.confirmResume":"officialAudio.confirmDownload");
      if(!await confirm(`${message}\n\n${label}`,{title:t(`officialAudio.${action}`),confirmLabel:t(`officialAudio.${action}`),native:true}))return;
      setBusy(true);setError(null);setProgress({done:0,total:ids.length});
      const batches=officialBatches(ids);
      let done=0;
      for(const batch of batches) {
        const result=await jsonMutation<{accepted:number;errorCode?:string|null}>("/api/admin/audio/official",{json:{action,ids:batch}},{invalidates:["content"]});
        done+=result.accepted;setProgress({done:Math.min(done,ids.length),total:ids.length});
        if(result.errorCode)throw Error(reason(result.errorCode));
      }
    } catch(e){setError(e instanceof Error?e.message:t("officialAudio.failed"));}
    finally{mutex.current=false;setBusy(false);void query.refetch().catch(()=>{});}
  }
  async function publishSelected() {
    if(mutex.current||!data)return;mutex.current=true;
    const rows=data.groups.flatMap(g=>g.jobs).filter(r=>selected.includes(r.id)&&r.publishable&&r.recordingId);
    try {
      if(!rows.length)return;
      const label=rows.map(r=>`${r.bookName} ${r.chapterNumber} · ${r.language} · ${r.voice}`).join("\n");
      if(!await confirm(`${t("officialAudio.confirmPublishSelection")}\n\n${label}`,{title:t("officialAudio.publishSelected"),confirmLabel:t("audioLibrary.publish"),destructive:true,native:true}))return;
      setBusy(true);setError(null);setProgress({done:0,total:rows.length});
      let done=0;const failures:string[]=[];
      for(const batch of officialBatches(rows)) {
        const response=await jsonMutation<{results:{id:string;status:string;errorCode:string|null}[]}>("/api/admin/audio/official",{json:{action:"publish",selections:batch.map(r=>({id:r.id,recordingId:r.recordingId}))}},{invalidates:["content"]});
        for(const result of response.results) {
          if(result.status==="FAILED") {const row=rows.find(r=>r.id===result.id);failures.push(`${row?.bookName} ${row?.chapterNumber} · ${row?.language}: ${reason(result.errorCode??"AUDIO_TASK_FAILED")}`);}
          else setSelected(previous=>previous.filter(id=>id!==result.id));
        }
        done+=batch.length;setProgress({done,total:rows.length});
      }
      if(failures.length)setError(`${t("officialAudio.partialFailure")}\n${failures.join("\n")}`);
    }catch(e){setError(e instanceof Error?e.message:t("officialAudio.serviceError"));}
    finally{mutex.current=false;setBusy(false);void query.refetch().catch(()=>{});}
  }
  function toggleSelection(id:string) {
    setSelected(previous=>{
      if(previous.includes(id))return previous.filter(value=>value!==id);
      const rows=data?.groups.flatMap(g=>g.jobs)??[],row=rows.find(r=>r.id===id);
      // Hoogstens één stem per hoofdstuk in hetzelfde expliciete besluit.
      return [...previous.filter(value=>{const other=rows.find(r=>r.id===value);return !row||!other||other.work!==row.work||other.language!==row.language||other.bookKey!==row.bookKey||other.chapterNumber!==row.chapterNumber;}),id];
    });
  }
  function selectGroup(rows:OfficialOverview["groups"][number]["jobs"]) {
    const seen=new Set<string>();
    const choices=rows.filter(row=>{const key=`${row.bookKey}:${row.chapterNumber}`;if(!row.publishable||seen.has(key))return false;seen.add(key);return true;}).map(row=>row.id);
    const groupIds=new Set(rows.map(row=>row.id));
    setSelected(previous=>[...previous.filter(id=>!groupIds.has(id)),...choices]);
  }
  return <>
    <LegacyAudioClient sessionKey={sessionKey}/>
    {data&&!data.storageAvailable&&<AdminNotice kind="error">{t("officialAudio.storageMissing")}</AdminNotice>}
    {data?.freeBytes!==null&&data?.freeBytes!==undefined&&<p className="text-sm text-vs-fg-2">{t("officialAudio.freeSpace")}: {Math.floor(data.freeBytes/1073741824)} GiB</p>}
    {(error||query.error)&&<AdminNotice kind="error"><span className="whitespace-pre-line">{error??t("officialAudio.failed")}</span></AdminNotice>}
    {progress&&<p role="status" className="text-sm">{t("officialAudio.batchProgress",{done:progress.done,total:progress.total})}</p>}
    <p className="text-sm text-vs-fg-2">{t("officialAudio.refreshHint")}</p>
    <button className={secondaryButton} disabled={busy||query.isFetching} onClick={()=>void query.refetch().catch(()=>{})}>{t("officialAudio.refresh")}</button>
    <AdminSection title={t("officialAudio.catalogue")} description={t("officialAudio.intro")} defaultOpen id="official-audio-catalogue">
      <p className="text-sm text-vs-fg-2">{t("officialAudio.protection")}</p>
      {data&&<button className={dangerButton} disabled={disabled||!data.groups.some(g=>g.jobs.some(r=>r.publishable&&selected.includes(r.id)))} onClick={()=>void publishSelected()}>{t("officialAudio.publishSelected")} ({data.groups.flatMap(g=>g.jobs).filter(r=>r.publishable&&selected.includes(r.id)).length})</button>}
      {data?.groups.map((g)=><section data-official-group={`${g.work}:${g.language}`} className="min-w-0 border-b border-vs-line py-3" key={`${g.work}:${g.language}`}>
        <h3 className="break-words font-bold">{t(g.work==="bofm"?"officialAudio.bofm":g.work==="pgp"?"officialAudio.pgp":"officialAudio.dc")} · {g.language}</h3>
        <dl className="my-3 grid grid-cols-2 gap-2 text-sm">{[["targets",g.targets],["legacyConfigured",g.legacyConfigured],["legacyLocal",g.legacyLocal],["v2Registered",g.registered],["v2Published",g.published],["missing",g.missing],["review",g.review],["missingText",g.missingText]].map(([label,count])=><div className="min-w-0 break-words" key={label}><dt className="text-vs-fg-2">{t(`officialAudio.${label}` as "officialAudio.targets")}</dt><dd className="font-bold">{count}</dd></div>)}</dl>
        <p className="my-3 text-sm" data-audio-progress>{t("officialAudio.collectionProgress",{legacy:g.legacyConfigured,registered:g.registeredTargets,additional:g.additionalTargets,unpublished:g.unpublishedTargets})}</p>
        {g.pending>0&&<p className="my-2 text-sm">{t("officialAudio.pendingTasks",{count:g.pending})}</p>}
        {!g.editionPresent&&<p className="text-sm">{t("officialAudio.editionMissing")}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButton} disabled={disabled||!g.editionPresent||!g.downloadIds.length} onClick={()=>void act("download",g.downloadIds,`${t(g.work==="bofm"?"officialAudio.bofm":g.work==="pgp"?"officialAudio.pgp":"officialAudio.dc")} · ${g.language} · ${g.downloadIds.length}`)}>{t("officialAudio.download")}</button>
          <button className={secondaryButton} disabled={disabled||!g.registerIds.length} onClick={()=>void act("register",g.registerIds,`${t(g.work==="bofm"?"officialAudio.bofm":g.work==="pgp"?"officialAudio.pgp":"officialAudio.dc")} · ${g.language} · ${g.registerIds.length}`)}>{t("officialAudio.register")}</button>
          <button className={secondaryButton} disabled={disabled||!g.resumeIds.length} onClick={()=>void act("resume",g.resumeIds,`${t(g.work==="bofm"?"officialAudio.bofm":g.work==="pgp"?"officialAudio.pgp":"officialAudio.dc")} · ${g.language} · ${g.resumeIds.length}`)}>{t("officialAudio.resume")}</button>
        </div>
        {g.registeredTargets===g.additionalTargets&&g.additionalTargets>0&&!g.downloadIds.length&&!g.registerIds.length&&!g.resumeIds.length&&!g.pending&&!g.missing&&<p className="my-2 text-sm">{t(g.unpublishedTargets>0?"officialAudio.alreadyRegistered":"officialAudio.allPublished")}</p>}
        {g.jobs.length>0&&<PublicationRows rows={g.jobs} selected={selected} toggle={toggleSelection} selectAll={()=>selectGroup(g.jobs)} clear={()=>setSelected(previous=>previous.filter(id=>!g.jobs.some(row=>row.id===id)))} disabled={disabled} resume={row=>void act("resume",[row.id],`${row.bookName} ${row.chapterNumber} · ${row.language}`)} repair={row=>void act("download",[row.id],`${row.bookName} ${row.chapterNumber} · ${row.language}`)} register={row=>void act("register",[row.id],`${row.bookName} ${row.chapterNumber} · ${row.language}`)} statusText={statusText} reason={reason} />}
        {g.jobs.some((j)=>j.status==="FAILED")&&<ul className="mt-2 text-sm">{g.jobs.filter((j)=>j.status==="FAILED").map((j)=><li className="break-words" key={j.id}>{j.bookKey} {j.chapterNumber}: {reason(j.errorCode??"AUDIO_TASK_FAILED")}</li>)}</ul>}
      </section>)}
    </AdminSection>
  </>;
}

/** Inklapbare mobiele lijst; maximaal 25 rijen tegelijk, geen brede tabel. */
type AudioRow=OfficialOverview["groups"][number]["jobs"][number];
function PublicationRows({rows,selected,toggle,selectAll,clear,disabled,resume,repair,register,statusText,reason}:{rows:OfficialOverview["groups"][number]["jobs"];selected:string[];toggle:(id:string)=>void;selectAll:()=>void;clear:()=>void;disabled:boolean;resume:(row:AudioRow)=>void;repair:(row:AudioRow)=>void;register:(row:AudioRow)=>void;statusText:(s:string)=>string;reason:(s:string)=>string}) {
  const t=useT(),[page,setPage]=useState(0),pages=Math.max(1,Math.ceil(rows.length/25)),current=Math.min(page,pages-1);
  return <details className="my-3"><summary className="cursor-pointer py-2 font-bold">{t("officialAudio.selectPublications")} ({rows.length})</summary>
    <div className="my-2 flex flex-wrap gap-2"><button className={secondaryButton} disabled={disabled||!rows.some(row=>row.publishable)} onClick={selectAll}>{t("officialAudio.selectAll")}</button><button className={secondaryButton} disabled={disabled||!rows.some(row=>selected.includes(row.id))} onClick={clear}>{t("officialAudio.clearSelection")}</button></div>
    <ul className="divide-y divide-vs-line">{rows.slice(current*25,(current+1)*25).map(row=><li key={row.id} className="flex min-w-0 flex-col gap-2 py-3 text-sm">
      <label className="flex min-h-11 items-start gap-3 break-words"><input type="checkbox" className="mt-1 shrink-0" disabled={disabled||!row.publishable} checked={row.publishable&&selected.includes(row.id)} onChange={()=>toggle(row.id)} /><span>{row.bookName} {row.chapterNumber} · {row.language} · {row.voice}</span></label>
      <p>{row.recordingId?t("officialAudio.registered"):statusText(row.status)} · {t(row.published?"audioLibrary.published":row.pointerVersion?"officialAudio.otherPublished":"officialAudio.unpublished")}</p>
      {row.status==="RUNNING"&&<progress className="w-full" aria-label={t("officialAudio.progress")} max={row.bytes} value={Math.min(row.bytesDownloaded,row.bytes)} />}
      {row.waiting&&<p>{t("officialAudio.waiting")}</p>}
      {row.recordingId&&!row.local&&<AdminNotice kind="error">{t("officialAudio.missingFile")}</AdminNotice>}
      {row.recordingId&&row.local&&<a className="min-h-11 underline text-vs-accent" href={`/api/audio/recordings/${row.recordingId}?preview=1`} target="_blank" rel="noreferrer">{t("audioLibrary.view")}</a>}
      {row.recovering&&<p>{t("officialAudio.recovering")}</p>}
      {!row.protected&&!row.review&&!row.blockReason&&<div className="flex flex-wrap gap-2">
        {row.resumable&&<button className={secondaryButton} disabled={disabled} onClick={()=>resume(row)}>{t("officialAudio.resume")}</button>}
        {((row.recordingId&&!row.local)||(row.status==="VALIDATED"&&(!row.local||!row.cachePresent)))&&<button className={secondaryButton} disabled={disabled} onClick={()=>repair(row)}>{t("officialAudio.repair")}</button>}
        {row.status==="VALIDATED"&&row.local&&row.cachePresent&&!row.recordingId&&<button className={secondaryButton} disabled={disabled} onClick={()=>register(row)}>{t("officialAudio.register")}</button>}
      </div>}
      {(row.errorCode||row.blockReason)&&<AdminNotice kind="error">{reason(row.blockReason??row.errorCode!)}</AdminNotice>}
    </li>)}</ul>
    <div className="flex flex-wrap items-center gap-2"><button className={secondaryButton} disabled={current===0} aria-label={t("officialAudio.previousPage")} onClick={()=>setPage(current-1)}>←</button><span>{current+1} / {pages}</span><button className={secondaryButton} disabled={current===pages-1} aria-label={t("officialAudio.nextPage")} onClick={()=>setPage(current+1)}>→</button></div>
  </details>;
}
