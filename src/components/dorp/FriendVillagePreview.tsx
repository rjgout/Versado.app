"use client";
import Link from "next/link";
import {useT} from "@/components/I18nProvider";
import {useLiveQuery} from "@/lib/data/hooks";
import {fetchJson} from "@/lib/data/fetchJson";
import type {DorpSnapshot} from "@/lib/dorp/service";
import {DorpCanvas} from "./DorpPrototypeClient";
const noop=()=>{};
export default function FriendVillagePreview({userId}:{userId:string}){
 const t=useT(),query=useLiveQuery<DorpSnapshot>(["friend-dorp",userId],()=>fetchJson(`/api/dorp?ownerId=${encodeURIComponent(userId)}`),{scopes:["dorp","friends","profile"]});
 if(!query.data||query.error)return null;
 return <Link href={`/dorp/visit/${userId}`} className="card block overflow-hidden p-3" aria-label={t("dorp2.visit")}>
  <p className="mb-2 font-bold">{t("dorp2.visit")}</p><div className="pointer-events-none relative h-52 overflow-hidden rounded-xl" aria-hidden><DorpCanvas compact world={query.data.world} editableIds={new Set()} placement={null} selectedId={null} onPlacementMove={noop} onSelectObject={noop} pathMode={null} onPathStroke={noop} onDragPreview={noop} onDragEnd={noop} onExplore={noop} onCameraChange={noop} cameraCommand={{id:1,kind:"current"}}/></div>
 </Link>;
}
