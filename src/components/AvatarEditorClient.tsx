"use client";
import { setAvatarAppearance } from "@/components/UserAvatar";
import { fetchJson } from "@/lib/data/fetchJson";
import { useLiveQuery } from "@/lib/data/hooks";
import { liveMutation } from "@/lib/data/mutation";
import AvatarEditorView from "./profile/AvatarEditorView";
import type { ProfileData } from "./profile/profileData";
export default function AvatarEditorClient(){
  const profile=useLiveQuery<ProfileData>(["profile","me"],()=>fetchJson<ProfileData>("/api/profile"),{scopes:["profile","xp","streak","competition"]});
  return <AvatarEditorView data={profile.data} loadError={!!profile.error} onSave={async(patch,appearance)=>{
    await liveMutation(()=>fetchJson("/api/account",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)}),{invalidates:["profile","friends","today","competition","activity"]});
    if(profile.data){profile.setData({...profile.data,...appearance});setAvatarAppearance(profile.data.id,appearance);}
  }}/>;
}
