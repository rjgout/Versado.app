"use client";
import { useEffect,useState } from "react";
import { WhatsNewView,type ChangelogEntryView } from "./ProfileSettingsViews";
export default function WebWhatsNewView(props:{enabled:boolean;saving:boolean;onToggle:()=>void}){
  const [entries,setEntries]=useState<ChangelogEntryView[]|null>(null);
  useEffect(()=>{let live=true;void fetch("/api/changelog").then(response=>response.ok?response.json():{entries:[]}).then(body=>{if(live)setEntries(body.entries??[]);}).catch(()=>{if(live)setEntries([]);});void fetch("/api/changelog/seen",{method:"POST"}).catch(()=>{});return()=>{live=false;};},[]);
  return <WhatsNewView {...props} entries={entries}/>;
}
