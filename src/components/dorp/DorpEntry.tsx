"use client";
import Link from "next/link";
import { Home } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { useLiveQuery, useLiveTopic } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
/** Dezelfde serverguard als de pagina, zonder tweede instelling. */
export default function DorpEntry({userId}:{userId:string}){
 const t=useT(); useLiveTopic("dorp-access");
 const access=useLiveQuery(["dorp-entry",userId],()=>fetchJson("/api/dorp"),{scopes:["dorp"],discardOnRevalidate:true,staleTime:0});
 if(!access.data||access.error)return null;
 return <Link href="/dorp" className="flex min-h-14 items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface p-4 font-bold text-vs-accent"><Home className="h-5 w-5 shrink-0" aria-hidden/>{t("dorp2.personal")}</Link>;
}
