"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useLiveQuery, useLiveTopic } from "@/lib/data/hooks";
import { jsonMutation } from "@/lib/data/mutation";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import { DORP_OBJECT_BY_ID } from "@/lib/dorp/catalog";
import type { DorpCommand, DorpSnapshot } from "@/lib/dorp/service";
import type { DorpWorldState } from "@/lib/dorp/types";
import DorpPrototypeClient from "./DorpPrototypeClient";

type Visit=DorpSnapshot & {giftAvailableAt?:string|null};
export default function ServerDorpClient({userId,groupId,ownerId}:{userId:string;groupId?:string;ownerId?:string}){
 useLiveTopic("dorp-access");
 const t=useT(),router=useRouter();
 const [confirmed,setConfirmed]=useState<Visit|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
 const [pending,setPending]=useState<unknown|null>(null),[confirmGift,setConfirmGift]=useState(false),[nextGift,setNextGift]=useState<string|null>(null),[clock,setClock]=useState(()=>Date.now()),[blocked,setBlocked]=useState(false);
 const inFlight=useRef(false),generation=useRef(0),mounted=useRef(false);
 const target=ownerId?`ownerId=${encodeURIComponent(ownerId)}`:confirmed?`villageId=${encodeURIComponent(confirmed.villageId)}`:"";
 const world=useLiveQuery<Visit>(["dorp-world",userId,target],()=>fetchJson(`/api/dorp?${target}`),{scopes:["dorp"],enabled:Boolean(target),discardOnRevalidate:Boolean(ownerId),staleTime:ownerId?0:30000,pollMs:ownerId?15000:undefined});
 const choices=useLiveQuery<{groups:{id:string;name:string}[]}>(["dorp-choices",userId],()=>fetchJson("/api/dorp"),{scopes:["dorp","groups"],enabled:!ownerId});
 const snapshot=ownerId?world.data:world.data&&(!confirmed||world.data.villageId===confirmed.villageId&&world.data.version>=confirmed.version)?world.data:confirmed;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const giftAt=nextGift??snapshot?.giftAvailableAt;
 useEffect(()=>{if(!giftAt)return;const remaining=new Date(giftAt).getTime()-Date.now();if(remaining>0){const timer=window.setTimeout(()=>setClock(Date.now()),Math.min(remaining+100,2147483647));return()=>clearTimeout(timer);}},[giftAt]);
 async function perform(payload:unknown,retry=false){
  if(inFlight.current||(!retry&&pending))return;
  inFlight.current=true;setBusy(true);setError(null);setMessage(null);setPending(payload);const epoch=generation.current;
  try{
   const data=await jsonMutation<Visit | {giftAvailableAt:string} | {left:true}>("/api/dorp",{json:payload},{invalidates:(payload as {type:string}).type==="gift"?"dorpGiftChanged":"dorpChanged"});
   if(!mounted.current||epoch!==generation.current)return;
   if((payload as {type:string}).type==="leave"){router.push("/dorp");return;}
   if("villageId"in data)setConfirmed(data);else if("giftAvailableAt"in data)setNextGift(data.giftAvailableAt??null);
   setPending(null);setConfirmGift(false);setMessage(t((payload as {type:string}).type==="gift"?"dorp2.giftSent":"dorp2.saved"));
  }catch(e){if(mounted.current&&epoch===generation.current){setError(e instanceof ApiRequestError&&e.status<500?e.message:t("dorp2.saveError"));if(e instanceof ApiRequestError&&e.status<500)setPending(null);if(e instanceof ApiRequestError&&e.status===404)setBlocked(true);}}
  finally{inFlight.current=false;if(mounted.current&&epoch===generation.current)setBusy(false);}
 }
 function command(operation:DorpCommand["operation"]){if(!snapshot||snapshot.readOnly||busy||pending)return;void perform({type:"mutate",command:{villageId:snapshot.villageId,expectedVersion:snapshot.version,actionId:crypto.randomUUID(),operation}});}
 function change(next:DorpWorldState){
  if(!snapshot||snapshot.readOnly||busy||pending)return;
  const previous=snapshot.world;
  for(const item of next.instances){
   const old=previous.instances.find(i=>i.instanceId===item.instanceId);if(!old)continue;
   if(item.level!==old.level){command({type:"upgrade",objectId:item.instanceId,expectedLevel:old.level});return;}
   if(JSON.stringify(item.position)!==JSON.stringify(old.position)){command(item.position?{type:"place",objectId:item.instanceId,position:item.position}:{type:"store",objectId:item.instanceId});return;}
  }
  const before=new Set(previous.paths.map(p=>`${p.u},${p.v}`)),after=new Set(next.paths.map(p=>`${p.u},${p.v}`));
  const added=next.paths.filter(p=>!before.has(`${p.u},${p.v}`)),removed=previous.paths.filter(p=>!after.has(`${p.u},${p.v}`));
  const tiles=added.length?added:removed;if(tiles.length>1024){setError(t("dorp2.saveError"));return;}if(tiles.length)command({type:"paths",tiles,erase:!added.length});
 }
 async function reload(){if(busy)return;generation.current++;setPending(null);setError(null);setBlocked(false);if(ownerId)await world.refetch();else await perform({type:"open",...(groupId?{groupId}:{})},true);}
 const cooling=Boolean(giftAt&&new Date(giftAt).getTime()>clock);
 const controls=<>
  <div className="flex flex-wrap items-center gap-2 text-sm">
   <span className="font-bold">{t(ownerId?"dorp2.visit":groupId?"dorp2.group":"dorp2.personal")}</span>
   <span role="status" className="min-w-0 break-words">{busy?t("dorp2.saving"):message}</span>
   <button className="btn min-h-11" disabled={busy} onClick={()=>void reload()}>{t("dorp2.reload")}</button>
  </div>
  {!ownerId&&snapshot?.inventoryPolicy==="ALPHA_PILOT_V1"&&<p data-dorp-inventory-policy="ALPHA_PILOT_V1" className="text-xs text-vs-fg-3">{t("dorp2.pilot")}</p>}
  {(error||world.error) && <p role="alert" className="text-sm text-vs-danger">{error??t("dorp2.unavailable")}</p>}
  {pending&&!busy&&<button className="btn min-h-11" onClick={()=>void perform(pending,true)}>{t("studyFolder.retry")}</button>}
  {!ownerId&&<details><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{t("dorp2.switchWorld")}</summary><nav className="flex flex-wrap gap-2">
   <Link className="btn min-h-11" href="/dorp">{t("dorp2.personal")}</Link>
   {choices.data?.groups.map(g=><Link className="btn min-h-11 max-w-full break-words" key={g.id} href={`/dorp/groups/${g.id}`}>{g.name}</Link>)}
   {groupId&&<button className="btn min-h-11" disabled={busy||Boolean(pending)} onClick={()=>void perform({type:"leave",villageId:snapshot?.villageId,expectedVersion:snapshot?.version,actionId:crypto.randomUUID()})}>{t("dorp2.leaveGroup")}</button>}
  </nav></details>}
  {snapshot?.requests.length? <details><summary className="min-h-11 cursor-pointer py-2 text-sm">{t("dorp2.requests")} ({snapshot.requests.length})</summary>{snapshot.requests.map(r=><div className="flex flex-wrap gap-2 py-1" key={r.id}><span>{DORP_OBJECT_BY_ID.get(snapshot.world.instances.find(i=>i.instanceId===r.objectId)?.objectId??"")?.name}</span><button className="btn min-h-11" onClick={()=>command({type:"store",objectId:r.objectId})}>{t("dorp2.erase")}</button><button className="btn min-h-11" onClick={()=>command({type:"dismiss",requestId:r.id})}>{t("common.close")}</button></div>)}</details>:null}
  {ownerId&&<div className="mt-2 flex flex-wrap gap-2">
   {cooling?<p className="text-sm">{t("dorp2.nextGift")} {new Date(giftAt!).toLocaleString()}</p>:<button className="btn min-h-11" disabled={busy||Boolean(pending)} onClick={()=>setConfirmGift(true)}>{t("dorp2.gift")}</button>}
   {confirmGift&&<div role="group" aria-label={t("dorp2.giftConfirm")} className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-vs-line p-2"><p className="w-full text-sm">{t("dorp2.giftConfirm")}</p><button className="btn-primary min-h-11" disabled={busy||Boolean(pending)} onClick={()=>void perform({type:"gift",receiverId:ownerId,actionId:crypto.randomUUID()})}>{t("dorp2.gift")}</button><button className="btn min-h-11" disabled={busy} onClick={()=>setConfirmGift(false)}>{t("common.cancel")}</button></div>}
  </div>}
 </>;
 if(blocked||world.error)return <div className="page-fill p-4"><p role="alert">{t("dorp2.unavailable")}</p><button className="btn min-h-11" onClick={()=>void reload()}>{t("dorp2.reload")}</button></div>;
 if(!snapshot)return <div className="page-fill mx-auto flex max-w-lg flex-col gap-3 p-4"><h1 className="text-xl font-bold">Versado Dorp</h1>{controls}{!ownerId&&<button className="btn-primary min-h-12" disabled={busy||Boolean(pending)} onClick={()=>void perform({type:"open",...(groupId?{groupId}:{})})}>{t("dorp2.open")}</button>}</div>;
 return <DorpPrototypeClient controlled={{snapshot,backHref:ownerId?`/friends/${ownerId}`:"/dashboard",busy:busy||Boolean(pending),onChange:change,onRequest:objectId=>command({type:"request",objectId}),controls}} />;
}
