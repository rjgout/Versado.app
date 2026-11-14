"use client";
import { AppNavigationProvider,LocalAppImage,useAppImageSource,type AppImageProps,useAppNavigationAdapter } from "@/components/navigation/AppNavigation";
import AvatarEditorView from "@/components/profile/AvatarEditorView";
import TimeZoneRow from "@/components/profile/TimeZoneRow";
import TwoFactorSettingsView from "@/components/profile/TwoFactorSettingsView";
import { nativeTodayImageSource } from "@/lib/native/todayAssets";
import { focusNativeRouteHeading } from "@/lib/native/routeFocus";
import { nativeProfileImageSource } from "@/lib/native/profileAssets";
import { nativeProfileErrorText } from "@/lib/native/profileErrors";
import { useCallback,useMemo,type ReactNode } from "react";

import { ConfirmProvider,useConfirm } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import CompanionPreference from "@/components/profile/CompanionPreference";
import LanguageSettingsView from "@/components/profile/LanguageSettingsView";
import { AchievementsView,CompetitionView } from "@/components/profile/ProfileContentViews";
import ProfileOverview from "@/components/profile/ProfileOverview";
import ProfilePageView from "@/components/profile/ProfilePageView";
import { GameFeedbackView,NotificationsView,PresenceView,PrivacyView,ReadAloudView,ReadingView,WhatsNewView } from "@/components/profile/ProfileSettingsViews";
import { SettingsButton,SettingsStatus } from "@/components/profile/settings";
import { CompanionProvider } from "@/components/versado/PersonalMascot";
import { useNativeData,useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { getLanguage } from "@/lib/languages";
import { nativeVoicesSchema,type NativeDeviceVoice } from "@/lib/native/audioBridge";
import { NativeReadAloudOutput } from "@/lib/native/audioOutput";
import { NativeClientError } from "@/lib/native/client";
import { nativeContentSelectionSchema,type NativeAccount,type NativeContentState } from "@/lib/native/contract";
import { nativeRoute } from "@/lib/native/navigation";
import type { NativeProfileMutation } from "@/lib/native/profileContract";
import type { ProfileSettingsPatch } from "@/lib/profile/settingsContract";
import { parseProfileView,PROFILE_VIEWS,profileViewHref } from "@/lib/profileViews";
import { useReadAloudPlayer } from "@/lib/readAloudPlayerContext";
import { useEffect,useRef,useState } from "react";

function ProfileImage(props:AppImageProps) {
  const src=useAppImageSource(props.src);
  return src?<LocalAppImage {...props} src={src}/>:null;
}

export default function NativeProfileView(props: { account:NativeAccount; content?:NativeContentState; onLogout():Promise<void>; onAccountChanged():void; accountExtras?:ReactNode; onError(error:unknown):void }) {
  const navigation=useAppNavigationAdapter();
  const adapter=useMemo(()=>({...navigation,Image:ProfileImage,imageSource:(src:string)=>nativeProfileImageSource(src) ?? nativeTodayImageSource(src) ?? (navigation.imageSource?navigation.imageSource(src):src)}),[navigation]);
  return <AppNavigationProvider adapter={adapter}><ConfirmProvider nativeDialogs><NativeProfileContent {...props}/></ConfirmProvider></AppNavigationProvider>;
}
function NativeProfileContent({ account, content, onLogout, onAccountChanged, accountExtras, onError }: { account:NativeAccount; content?:NativeContentState; onLogout():Promise<void>; onAccountChanged():void; accountExtras?:ReactNode; onError(error:unknown):void }) {
  const t=useT(), confirm=useConfirm(), navigation=useAppNavigation(), runtime=useNativeData();
  const epoch=runtime.getSnapshot();
  const reportSessionError=useCallback((reason:unknown)=>{
    if(reason instanceof NativeClientError && (reason.status===401 || reason.code.startsWith("access_")))onError(reason);
  },[onError]);
  const actions=useMemo(()=>{void epoch;return runtime.profileActions(account.id);},[runtime,account.id,epoch]);
  const view=parseProfileView(new URLSearchParams(navigation.pathname.split("?")[1] ?? "").get("view"));
  const query=useNativeLiveQuery(["profile",account.id],()=>actions.read(),{scopes:["profile","xp","streak","competition","content"],staleTime:30_000});
  const state=query.data?.userId===account.id?query.data:undefined, data=state?.profile;
  const profileReady=data!==undefined;
  useEffect(()=>focusNativeRouteHeading(),[navigation.pathname,profileReady]);
  const [busy,setBusy]=useState(false), [error,setError]=useState<string|null>(null);
  const [editing,setEditing]=useState(false), [handle,setHandle]=useState(""), [handleError,setHandleError]=useState<string|null>(null);
  const [resetMessage,setResetMessage]=useState<string|null>(null);
  const alive=useRef(true), locked=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(query.error)reportSessionError(query.error);},[query.error,reportSessionError]);
  const seen=useRef(false);
  useEffect(()=>{
    if(view!=="about"){seen.current=false;return;}
    if(state && !seen.current){seen.current=true;void actions.mutate({kind:"changelog-seen"}).catch(reason=>{if(alive.current && epoch===runtime.getSnapshot()){setError(nativeProfileErrorText(reason,t));reportSessionError(reason);}});}
  },[view,state,actions,reportSessionError,t,epoch,runtime]);
  async function commit(action:NativeProfileMutation) {
    if(!alive.current)throw new NativeClientError("session_changed",409);
    if(locked.current)throw new NativeClientError("request_in_progress",409);
    const epoch=runtime.getSnapshot();locked.current=true;setBusy(true);setError(null);
    try {
      await actions.mutate(action);
      const updated=await actions.read();
      if(!alive.current || epoch!==runtime.getSnapshot())throw new NativeClientError("session_changed",409);
      query.setData(updated);
      if(action.kind==="settings" && ["handle","uiLanguage","companion","avatarCharacterId","avatarEmoji"].some(field=>field in action.patch))onAccountChanged();
      return updated;
    } catch(reason) {
      if(alive.current && epoch===runtime.getSnapshot()) { setError(nativeProfileErrorText(reason,t));reportSessionError(reason); }
      throw new Error(nativeProfileErrorText(reason,t));
    } finally { if(alive.current){locked.current=false;setBusy(false);} }
  }
  const patch=(value:ProfileSettingsPatch)=>commit({kind:"settings",patch:value});
  const save=(value:ProfileSettingsPatch)=>{void patch(value).catch(()=>{});};
  async function saveHandle() {
    setHandleError(null);
    try{await patch({handle});if(alive.current)setEditing(false);}
    catch(reason){if(alive.current)setHandleError(reason instanceof Error?reason.message:t("profile.handleSaveFailed"));}
  }
  async function resetReading() {
    if(!await confirm(t("profile.readingResetConfirm"),{title:t("profile.readingReset"),confirmLabel:t("profile.readingReset"),destructive:true}))return;
    try{await commit({kind:"reading-reset"});if(alive.current)setResetMessage(t("profile.readingResetDone"));}catch{}
  }
  async function logout() {
    if(locked.current || !alive.current)return;
    const stamp=runtime.client.getSessionStamp();
    if(!await confirm(t("profile.logoutConfirm"),{title:t("profile.logout"),confirmLabel:t("profile.logoutYes")}))return;
    if(locked.current || !alive.current || stamp!==runtime.client.getSessionStamp())return;
    locked.current=true;setBusy(true);setError(null);
    try{await actions.logoutAll();await onLogout();}
    catch(reason){if(alive.current && stamp===runtime.client.getSessionStamp()){setError(nativeProfileErrorText(reason,t));reportSessionError(reason);}}
    finally{if(alive.current && stamp===runtime.client.getSessionStamp()){locked.current=false;setBusy(false);}}
  }
  async function selectLanguage(language:string) {
    if(!content || locked.current)return;
    const epoch=runtime.getSnapshot();locked.current=true;setBusy(true);setError(null);
    try {
      await actions.contentLanguage(nativeContentSelectionSchema.parse({contentLanguage:language,expectedSelection:content.picker.selection,expectedSelectionVersion:content.picker.selectionVersion,location:"/profile"}));
      const updated=await actions.read();
      if(alive.current && epoch===runtime.getSnapshot())query.setData(updated);
    }catch(reason){if(alive.current && epoch===runtime.getSnapshot()){setError(t("languageSettings.saveFailed"));reportSessionError(reason);}}
    finally{if(alive.current){locked.current=false;setBusy(false);}}
  }
  if(!data || !state)return <ProfilePageView title={t("nav.profile")}><SettingsStatus kind={query.error?"error":"info"}>{t(query.error?"nativeFoundation.error":"common.loading")}</SettingsStatus>{!!query.error&&<SettingsButton onClick={()=>void query.refetch()}>{t("nativeFoundation.retry")}</SettingsButton>}</ProfilePageView>;
  const failed=error ?? (query.error?t("nativeFoundation.error"):null);
  return <CompanionProvider character={data.companion}>
    {failed&&<SettingsStatus kind="error">{failed}</SettingsStatus>}
    {navigation.pathname==="/profile/avatar" ? <AvatarEditorView data={data} loadError={!!query.error} onSave={async patch=>{await commit({kind:"settings",patch});}}/> : view ? <ProfilePageView title={t(PROFILE_VIEWS[view].title)}>
      {view==="competition"&&<CompetitionView data={data}/>}
      {view==="achievements"&&<AchievementsView data={data} onSaveFeatured={async achievementIds=>{await commit({kind:"featured-achievements",achievementIds});}}/>}
      {view==="reading"&&<ReadingView resetting={busy} message={resetMessage} error={error} onReset={()=>void resetReading()}/>}
      {view==="guide"&&<CompanionPreference current={data.companion} onSave={async companion=>{await patch({companion});}}/>}
      {view==="language"&&<LanguageSettingsView uiLanguage={data.uiLanguage} isAdmin={data.isAdmin} contentLanguage={state.contentLanguage} contentLanguages={state.contentLanguages} saving={busy} error={error} onUiLanguage={uiLanguage=>save({uiLanguage})} onContentLanguage={language=>void selectLanguage(language)}/>}
      {view==="gameFeedback"&&<GameFeedbackView/>}
      {view==="readAloud"&&<NativeVoicePreferences/>}
      {view==="notifications"&&<NotificationsView data={data} saving={busy} pushAvailable={false} pushUnavailableMessage={t("nativeProfile.pushUnavailable")} pushError={null} testingPush={false} pushCountdown={null} pushTestMessage={null} onEmail={()=>save({emailNotificationsEnabled:!data.emailNotificationsEnabled})} onPush={()=>setError(t("profile.pushUnsupported"))} onTest={()=>setError(t("profile.pushUnsupported"))} onCategory={field=>save({[field]:!data[field]})} onReminder={dailyReminderTime=>save({dailyReminderTime})} onDailyText={dailyTextTime=>save({dailyTextTime})} onDailyTextSource={dailyTextSource=>save({dailyTextSource})} dailyTextSourceError={error} onPodcast={podcastId=>{const item=data.podcastNotifications.find(item=>item.podcastId===podcastId);if(item)void commit({kind:"podcast-notification",podcastId,enabled:!item.enabled}).catch(()=>{});}}/>}
      {view==="privacy"&&<PrivacyView recordsHref={null} data={data} saving={busy} onToggleSearchable={()=>save({searchableByEmail:!data.searchableByEmail})} onToggleAchievements={()=>save({shareAchievements:!data.shareAchievements})} onTogglePuzzleRecords={()=>save({sharePuzzleRecords:!data.sharePuzzleRecords})} onToggleVillage={()=>save({shareVillageWithFriends:!data.shareVillageWithFriends})} villageError={error}/>}
      {view==="presence"&&<PresenceView data={data} saving={busy} onOnline={()=>save({shareOnlineStatus:!data.shareOnlineStatus,...(data.shareOnlineStatus?{shareCurrentActivity:false}:{})})} onActivity={()=>save({shareCurrentActivity:!data.shareCurrentActivity})} onIncognito={incognitoHours=>save({incognitoHours})} onIncognitoOff={()=>save({incognitoHours:null})}/>}
      {view==="twoFactor"&&<TwoFactorSettingsView isAdmin={data.isAdmin} initialEnabled={data.totpEnabled} request={async(kind,code)=>{
        try{const result=await actions.twoFactor(kind==="setup"?{kind}:{kind,code:code??""});onAccountChanged();return Response.json(result);}
        catch(reason){if(alive.current && epoch===runtime.getSnapshot())reportSessionError(reason);return Response.json({error:nativeProfileErrorText(reason,t,15)},{status:400});}
      }}/>}
      {view==="about"&&<WhatsNewView entries={state.changelog} enabled={data.changelogEnabled} saving={busy} onToggle={()=>save({changelogEnabled:!data.changelogEnabled})}/>}
    </ProfilePageView> : <ProfileOverview data={data} editingHandle={editing} handleInput={handle} savingHandle={busy} handleError={handleError} startEditingHandle={()=>{setHandle(data.handle);setEditing(true);}} setHandleInput={setHandle} setEditingHandle={setEditing} saveHandle={saveHandle} openView={next=>navigation.push(profileViewHref(next))} savingNotifications={busy} toggleCategory={async field=>{await patch({[field]:!data[field]}).catch(()=>{});}} logout={logout} deleteAccount={()=>navigation.push("/account-verwijderen")} canNavigate={href=>nativeRoute(href)!==null && (href!=="/change-password" || account.passwordLoginEnabled)} accountExtras={accountExtras} timeZone={<TimeZoneRow known={data.timeZone} label={t("profile.timeZone")} format={zone=>t("profile.timeZoneAuto",{zone})} locale={getLanguage(data.uiLanguage).intlLocale}/>}/>}
  </CompanionProvider>;
}
function NativeVoicePreferences() {
  const player=useReadAloudPlayer(),t=useT();
  const [voices,setVoices]=useState<NativeDeviceVoice[]|null>(null),[voice,setVoice]=useState(""),[speed,setSpeed]=useState(1),[failed,setFailed]=useState(false),[reload,setReload]=useState(0);
  useEffect(()=>{
    let live=true;
    const output=player.output;
    const load=async()=>{
      try{
        if(!(output instanceof NativeReadAloudOutput))throw new NativeClientError("audio_unavailable");
        const value=nativeVoicesSchema.parse(await output.bridge.audioVoices()).voices.filter(item=>/^nl(?:-|$)/i.test(item.language));
        if(live){
          setVoices(value);setFailed(false);
          try{setVoice(localStorage.getItem("jehovaapp-read-aloud-device-voice-nl")??"");const saved=Number(localStorage.getItem("jehovaapp-read-aloud-speed"));setSpeed([0.75,1,1.25,1.5,2].includes(saved)?saved:1);}catch{}
        }
      }catch{if(live)setFailed(true);}
    };
    void load();
    return()=>{live=false;};
  },[player.output,reload]);
  if(failed)return <><SettingsStatus kind="error">{t("nativeFoundation.error")}</SettingsStatus><SettingsButton onClick={()=>setReload(value=>value+1)}>{t("nativeFoundation.retry")}</SettingsButton></>;
  if(voices===null)return <SettingsStatus>{t("common.loading")}</SettingsStatus>;
  return <ReadAloudView voices={voices.map(item=>({voiceURI:item.id,name:item.name}))} selectedVoice={voice} speed={speed} testing={false} previewAvailable={false} onVoice={value=>{setVoice(value);player.stop();try{localStorage.setItem("jehovaapp-read-aloud-device-voice-nl",value);}catch{}}} onSpeed={value=>{setSpeed(value);player.setSpeed(value);}}/>;
}
