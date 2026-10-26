"use client";
import { useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import type { MessageKey } from "@/lib/i18n/core";
import { amsterdamNow } from "@/lib/dates";
import { primaryButton, secondaryButton, dangerButton } from "@/components/versado/styles";
import type { OfficialOverview } from "@/lib/audio/officialJobs";
import AdminSection from "./AdminSection";
import AdminNotice from "./AdminNotice";

function checkedTime(value:string) {
  const d=amsterdamNow(new Date(value)),pad=(n:number)=>String(n).padStart(2,"0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)} ${pad(d.hour)}:${pad(d.minute)} (Amsterdam)`;
}

export default function OfficialAudioClient({initialData,sessionKey}:{initialData:OfficialOverview;sessionKey:string}) {
  const t=useT(),confirm=useConfirm(),mutex=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const query=useLiveQuery<OfficialOverview>(["admin","official-audio",sessionKey],()=>fetchJson("/api/admin/audio/official"),{scopes:["content"],initialData,staleTime:0,pollMs:5000});
  const data=query.error?null:query.data??initialData;
  const disabled=busy||!data||!data.storageAvailable||query.updatedAt===null;
  const statuses:Record<string,MessageKey>={NOT_CHECKED:"officialAudio.notChecked",QUEUED:"officialAudio.queued",RUNNING:"officialAudio.running",VALIDATED:"officialAudio.validated",REGISTERED:"officialAudio.registered",FAILED:"officialAudio.failed"};
  const statusText=(status:string)=>t(statuses[status]??"officialAudio.failed");
  const reasons:Record<string,MessageKey>={TARGET_MISSING:"officialAudio.editionMissing",SOURCE_MISMATCH:"officialAudio.sourceChanged",FORBIDDEN:"officialAudio.forbidden",SOURCE_PROTECTED:"officialAudio.protection",LEGACY_PROTECTED:"officialAudio.protection",CACHE_MISSING:"officialAudio.missingFile",PILOT_REQUIRED:"officialAudio.bulkLocked",STORAGE_UNAVAILABLE:"officialAudio.storageMissing",STORAGE_FULL:"officialAudio.storageFull",STORAGE_PERMISSION:"officialAudio.storagePermission",SOURCE_HTTP:"officialAudio.sourceUnavailable",SOURCE_ADDRESS:"officialAudio.sourceUnavailable",SOURCE_REDIRECT:"officialAudio.sourceUnavailable",SOURCE_SIZE:"officialAudio.invalidAudio",SOURCE_AUDIO_IDENTITY:"officialAudio.sourceChanged",SOURCE_IDENTITY:"officialAudio.sourceChanged",SOURCE_TYPE:"officialAudio.invalidAudio",AUDIO_CHECKSUM:"officialAudio.invalidAudio",AUDIO_DURATION_FORMAT:"officialAudio.invalidAudio",CACHE_CORRUPT:"officialAudio.invalidAudio"};
  const reason=(code:string)=>t(reasons[code]??"officialAudio.failed");
  async function act(action:"download"|"register"|"resume"|"approvePilot",ids:string[],label:string) {
    if(mutex.current)return;mutex.current=true;
    try {
      const message=t(action==="register"?"officialAudio.confirmRegister":action==="approvePilot"?"officialAudio.confirmApprove":action==="resume"?"officialAudio.confirmResume":"officialAudio.confirmDownload");
      if(!await confirm(`${message}\n\n${label}`,{title:t(`officialAudio.${action}`),confirmLabel:t(`officialAudio.${action}`),destructive:action==="approvePilot",native:true}))return;
      setBusy(true);setError(null);
      await jsonMutation("/api/admin/audio/official",{json:{action,ids}},{invalidates:["content"]});
    } catch(e){setError(e instanceof Error?e.message:t("officialAudio.failed"));}
    finally{mutex.current=false;setBusy(false);}
  }
  async function publishPilot() {
    if(mutex.current||!data)return;mutex.current=true;
    const selected=data.pilot.filter((r)=>r.recordingId&&!r.published);
    try {
      if(!await confirm(`${t("officialAudio.confirmPublish")}\n\n${selected.map((r)=>`${t("officialAudio.ether")} 1 · ${r.language}`).join("\n")}`,{title:t("audioLibrary.publish"),confirmLabel:t("audioLibrary.publish"),destructive:true,native:true}))return;
      setBusy(true);setError(null);
      for(const row of selected)await jsonMutation("/api/admin/audio",{json:{recordingId:row.recordingId,expectedVersion:row.pointerVersion}},{invalidates:["content"]});
    }catch(e){setError(e instanceof Error?e.message:t("officialAudio.failed"));}
    finally{mutex.current=false;setBusy(false);}
  }
  const selectionLabel=(ids:string[])=>data?.pilot.filter((r)=>ids.includes(r.id)).map((r)=>`${t("officialAudio.ether")} 1 · ${r.language}`).join("\n")??"";
  const pilotLabel=`${t("officialAudio.ether")} 1 · nl, en, de, fr, es`;
  const downloading=data?.pilot.filter((r)=>!r.blockReason&&!r.recordingId&&r.status==="NOT_CHECKED").map((r)=>r.id)??[];
  const registering=data?.pilot.filter((r)=>!r.blockReason&&!r.recordingId&&r.status==="VALIDATED"&&r.local&&r.cachePresent).map((r)=>r.id)??[];
  return <>
    {data&&!data.storageAvailable&&<AdminNotice kind="error">{t("officialAudio.storageMissing")}</AdminNotice>}
    {data?.freeBytes!==null&&data?.freeBytes!==undefined&&<p className="text-sm text-vs-fg-2">{t("officialAudio.freeSpace")}: {Math.floor(data.freeBytes/1073741824)} GiB</p>}
    {(error||query.error)&&<AdminNotice kind="error">{error??t("officialAudio.failed")}</AdminNotice>}
    <AdminSection title={t("officialAudio.title")} description={t("officialAudio.intro")} defaultOpen id="official-audio-pilot">
      <p className="text-sm text-vs-fg-2">{t("officialAudio.protection")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={primaryButton} disabled={disabled||!downloading.length} onClick={()=>void act("download",downloading,selectionLabel(downloading))}>{t("officialAudio.downloadPilot")}</button>
        <button className={secondaryButton} disabled={disabled||!registering.length} onClick={()=>void act("register",registering,selectionLabel(registering))}>{t("officialAudio.registerPilot")}</button>
        <button className={dangerButton} disabled={disabled||data?.pilot.length!==5||data.pilot.some((r)=>!r.recordingId||!r.local||!!r.blockReason)||data.pilot.every((r)=>r.published)} onClick={()=>void publishPilot()}>{t("officialAudio.publishPilot")}</button>
      </div>
      <ul className="divide-y divide-vs-line" aria-live="polite">{data?.pilot.map((r)=><li key={r.id} className="flex min-w-0 flex-col gap-2 py-3 text-sm" data-official-language={r.language}>
        <p className="font-bold">{t("officialAudio.ether")} 1 · {r.language} · {t(r.voice==="male"?"officialAudio.male":"officialAudio.officialVoice")}</p>
        <p>{statusText(r.status)}{r.published?` · ${t("audioLibrary.published")}`:""}</p>
        {r.recovering&&<p>{t("officialAudio.recovering")}</p>}
        {r.waiting&&<p>{t("officialAudio.waiting")}</p>}
        {r.status==="FAILED"&&<p>{t(r.phase==="REGISTER"?"officialAudio.registerPhase":"officialAudio.downloadPhase")}</p>}
        {r.status==="RUNNING"&&<><p>{t(r.phase==="REGISTER"?"officialAudio.registerPhase":"officialAudio.downloadPhase")}</p><progress className="w-full" aria-label={t("officialAudio.progress")} max={r.bytes} value={Math.min(r.bytesDownloaded,r.bytes)} /></>}
        {(r.blockReason||r.errorCode)&&<AdminNotice kind="error">{reason(r.blockReason??r.errorCode!)}</AdminNotice>}
        {r.recordingId&&!r.local&&<AdminNotice kind="error">{t("officialAudio.missingFile")}</AdminNotice>}
        {r.checkedAt&&<p className="break-words text-xs text-vs-fg-2">{t("officialAudio.checked")}: <time dateTime={r.checkedAt}>{checkedTime(r.checkedAt)}</time></p>}
        {r.recordingId&&r.local&&<a className="min-h-11 break-words text-vs-accent underline" href={`/api/audio/recordings/${r.recordingId}?preview=1`} target="_blank" rel="noreferrer">{t("audioLibrary.view")}</a>}
        {r.status==="FAILED"&&<button className={secondaryButton} disabled={disabled||!!r.blockReason} onClick={()=>void act("resume",[r.id],`${t("officialAudio.ether")} 1 · ${r.language}`)}>{t("officialAudio.resume")}</button>}
        {!r.blockReason&&((r.recordingId&&!r.local)||(["VALIDATED","FAILED"].includes(r.status)&&(!r.cachePresent||!r.local)))&&<button className={secondaryButton} disabled={disabled} onClick={()=>void act("download",[r.id],`${t("officialAudio.ether")} 1 · ${r.language}`)}>{t("officialAudio.repair")}</button>}
      </li>)}</ul>
      <button className={secondaryButton} disabled={disabled||data?.pilot.length!==5||data.pilot.some((r)=>!r.published||!r.local||!!r.blockReason)||data.pilotApproved} onClick={()=>void act("approvePilot",[],pilotLabel)}>{t("officialAudio.approvePilot")}</button>
      {!data?.pilotApproved&&<AdminNotice kind="info">{t("officialAudio.bulkLocked")}</AdminNotice>}
    </AdminSection>
    <AdminSection title={t("officialAudio.catalogue")} description={t("officialAudio.catalogueHint")} id="official-audio-catalogue">
      {data?.groups.map((g)=><section className="min-w-0 border-b border-vs-line py-3" key={`${g.work}:${g.language}`}>
        <h3 className="break-words font-bold">{t(g.work==="bofm"?"officialAudio.bofm":g.work==="pgp"?"officialAudio.pgp":"officialAudio.dc")} · {g.language}</h3>
        <dl className="my-3 grid grid-cols-2 gap-2 text-sm">{[["targets",g.targets],["missingText",g.missingText],["checked",g.checked],["registered",g.registered],["published",g.published],["missing",g.missing],["review",g.review],["protectedCount",g.protected]].map(([label,count])=><div className="min-w-0 break-words" key={label}><dt className="text-vs-fg-2">{t(`officialAudio.${label}` as "officialAudio.targets")}</dt><dd className="font-bold">{count}</dd></div>)}</dl>
        {!g.editionPresent&&<p className="text-sm">{t("officialAudio.editionMissing")}</p>}
        {data.pilotApproved&&<div className="flex flex-wrap gap-2">
          <button className={secondaryButton} disabled={disabled||!g.editionPresent||!g.downloadIds.length} onClick={()=>void act("download",g.downloadIds,`${g.work} · ${g.language} · ${g.downloadIds.length}`)}>{t("officialAudio.download")}</button>
          <button className={secondaryButton} disabled={disabled||!g.registerIds.length} onClick={()=>void act("register",g.registerIds,`${g.work} · ${g.language} · ${g.registerIds.length}`)}>{t("officialAudio.register")}</button>
          <button className={secondaryButton} disabled={disabled||!g.resumeIds.length} onClick={()=>void act("resume",g.resumeIds,`${g.work} · ${g.language} · ${g.resumeIds.length}`)}>{t("officialAudio.resume")}</button>
        </div>}
        {g.jobs.some((j)=>j.status==="FAILED")&&<ul className="mt-2 text-sm">{g.jobs.filter((j)=>j.status==="FAILED").map((j)=><li className="break-words" key={j.id}>{j.bookKey} {j.chapterNumber}: {reason(j.errorCode??"AUDIO_TASK_FAILED")}</li>)}</ul>}
      </section>)}
    </AdminSection>
  </>;
}
