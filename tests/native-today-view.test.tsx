import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/components/I18nProvider";
import { AppNavigationProvider, type AppLinkProps } from "../src/components/navigation/AppNavigation";
import { getT, messagesFor } from "../src/lib/i18n";
import WebTodayView from "../src/components/today/WebTodayView";
import NativeTodayView from "../src/components/native/NativeTodayView";
import { todayFixture } from "./fixtures/native-today";
const navigation={pathname:"/dashboard",push(){},replace(){},back(){},canGoBack:()=>false,refresh(){},Link:({href,replace,prefetch,onNavigate,...props}:AppLinkProps)=>{void replace;void prefetch;void onNavigate;return <a {...props} href={href}/>;}};
const daily=(html:string)=>html.match(/<section aria-labelledby="today-daily"[\s\S]*?<\/section>/)?.[0]??"";
const text=(html:string)=>html.replace(/<[^>]+>/g,"");
test("web/native adapters share daily status, completed-day and Sunday rendering in five languages (60 states)",()=>{
 for(const language of ["nl","en","de","fr","es"] as const)for(const status of ["todo","in-progress","done"] as const)for(const sunday of [false,true])for(const won of [false,true]){
  const state=todayFixture();state.language=language;state.data.wordGame!.status=status;state.data.wordGame!.won=won;state.data.dailyQuiz!.status=status;state.data.sundayHymns=sunday;state.data.streak.studiedToday=status==="done";
  const render=(native:boolean)=>renderToStaticMarkup(<I18nProvider language={language} messages={messagesFor(language)}><AppNavigationProvider adapter={navigation}>{native?<NativeTodayView state={state}/>:<WebTodayView data={state.data} language={language} serverNow={state.serverNow} countdownEnabled={state.countdownEnabled}/>}</AppNavigationProvider></I18nProvider>);
  const web=daily(render(false)),native=daily(render(true)),t=getT(language);
  assert.ok(web&&native);assert.equal(text(native),text(web));assert.equal(native.includes("data-today-hymns"),sunday);
  assert.equal(text(native).includes(t("today.dayComplete")),status==="done");
  assert.ok(text(native).includes(t(status==="todo"?"today.wordGame.todo":status==="in-progress"?"today.wordGame.inProgress":won?"today.wordGame.won":"today.wordGame.lost")));
 }
});

import TodayProgramView from "../src/components/today/TodayProgramView";
import StreakContinuationCardView from "../src/components/today/StreakContinuationCardView";
import KompasEntryCardView from "../src/components/kompas/KompasEntryCardView";
test("the same programme, return card and active conference countdown render without native cookie-media access",()=>{
 const state=todayFixture();state.serverNow=Date.parse("2026-10-02T10:00:00Z");state.countdownEnabled=true;
 state.continuation={...state.continuation,status:"INTERRUPTED",interruptedDay:"2026-10-01",completed:1,required:3};
 state.program={token:"1",body:{kind:"cfm",props:{programName:"Kom dan en volg Mij",mode:"STEPS",weeksHref:"/courses/cfm/pad",resumeReason:"calendar",week:{lessonId:"week-one",collectionId:"cfm-edition",title:"Deze gepubliceerde week",startsOn:"2026-09-28",endsOnExclusive:"2026-10-05",imageMediaId:"private-cover",started:true}}}};
 const render=(native:boolean)=>renderToStaticMarkup(<I18nProvider language="nl" messages={messagesFor("nl")}><AppNavigationProvider adapter={navigation}>{native?<NativeTodayView state={state}/>:<WebTodayView data={state.data} language="nl" serverNow={state.serverNow} countdownEnabled before={<><StreakContinuationCardView value={state.continuation}/><TodayProgramView program={state.program}/><KompasEntryCardView isNew/></>}/>}</AppNavigationProvider></I18nProvider>);
 const web=render(false),native=render(true);
 assert.equal(text(native).replace(getT("nl")("nativeToday.unavailable"),""),text(web));
 assert.ok(native.includes(getT("nl")("today.conference.title")));assert.ok(native.includes('data-cfm-today-primary'));
 assert.ok(web.includes('src="/api/study-media/private-cover"'));assert.equal(native.includes('src="/api/study-media/'),false);
 assert.ok(native.includes('data-native-unavailable-href="/study-lesson/week-one/cfm-edition/stappen"'));
});
