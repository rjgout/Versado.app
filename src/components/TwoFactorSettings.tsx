"use client";
import { useEffect,useState } from "react";
import { useT } from "./I18nProvider";
import TwoFactorSettingsView from "./profile/TwoFactorSettingsView";
import { SettingsButton,SettingsStatus } from "./profile/settings";
export default function TwoFactorSettings({isAdmin}:{isAdmin:boolean}){
  const t=useT(),[enabled,setEnabled]=useState<boolean|null>(null),[failed,setFailed]=useState(false),[reload,setReload]=useState(0);
  useEffect(()=>{let live=true;void fetch("/api/profile").then(async response=>{if(!response.ok)throw Error();const data=await response.json();if(live){setEnabled(!!data.totpEnabled);setFailed(false);}}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;};},[reload]);
  if(enabled===null)return <><SettingsStatus kind={failed?"error":"info"}>{t(failed?"nativeFoundation.error":"common.loading")}</SettingsStatus>{failed&&<SettingsButton onClick={()=>setReload(value=>value+1)}>{t("nativeFoundation.retry")}</SettingsButton>}</>;
  return <TwoFactorSettingsView isAdmin={isAdmin} initialEnabled={enabled} request={(kind,code)=>fetch(`/api/account/totp/${kind}`,{method:"POST",...(code===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify({code})})})}/>;
}
