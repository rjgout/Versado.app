import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/components/I18nProvider";
import { messagesFor } from "../src/lib/i18n";
import { AppNavigationProvider, type AppLinkProps } from "../src/components/navigation/AppNavigation";
import CoursesView from "../src/components/CoursesView";
import ReadingCourseView from "../src/components/ReadingCourseView";
import ChapterListCourseView from "../src/components/ChapterListCourseView";
import { NativeDataRuntime, nativeContentQueryKey } from "../src/lib/data/native";
import { nativeCoursesSchema, nativeCoursePathSchema } from "../src/lib/native/coursesContract";
import { nativePrimaryNav } from "../src/lib/native/shell";
import { accessRouteAllowed } from "../src/lib/native/access";
import { nativeRoute } from "../src/lib/native/navigation";
import { nativeTodayDestination } from "../src/lib/native/todayDestinations";
import type { NativeSessionClient } from "../src/lib/native/client";
import type { LiveEnvironment } from "../src/lib/data/store";
const context={version:1 as const,userId:"A",activeCollectionId:"source-nl",selectionVersion:1,language:"nl" as const};
const card={id:"course",slug:"course",type:"READING_LESSONS" as const,name:"Stap voor stap",description:null,totalChapters:2,completedCount:1,xpAvailable:5,isActive:true,currentChapter:{id:"alma32",bookName:"Alma",number:32},resumeHref:"/reading-lesson/exact-step",artwork:[]};
const response={...context,courses:[card],catalog:[]};
function render(node:React.ReactNode){const Link=({replace,prefetch,onNavigate,...props}:AppLinkProps)=>{void replace;void prefetch;void onNavigate;return <a {...props}/>;};return renderToStaticMarkup(<I18nProvider language="nl" messages={messagesFor("nl")}><AppNavigationProvider adapter={{pathname:"/courses",Link,push(){},replace(){},back(){},refresh(){},canGoBack:()=>false}}>{node}</AppNavigationProvider></I18nProvider>);}
test("actual shared cards and all reading paths retain cursor, progress and locks; no native clone",()=>{
 const html=render(<CoursesView courses={[card]}/>);assert.match(html,/Alma 32/);assert.match(html,/reading-lesson\/exact-step/);assert.doesNotMatch(html,/aria-label="Kaart beheren"/);
 const chapter={id:"alma32",number:32,bookName:"Alma",bookKey:"bofm/alma",read:"UNREAD" as const,exercisesAnswered:0,exercisesTotal:2};
 const steps=render(<ReadingCourseView courseName="Stap voor stap" today={{id:"exact-step"}} chapters={[{...chapter,locked:false,lessonCount:2,completedLessons:0,steps:[{id:"exact-step",number:1,startVerse:11,endVerse:20,done:false,available:true},{id:"locked",number:2,startVerse:21,endVerse:30,done:false,available:false}]}]}/>);
 assert.match(steps,/exact-step/);assert.doesNotMatch(steps,/href="[^"]*locked/);assert.match(steps,/11/);
 for(const sequential of [true,false]) assert.match(render(<ChapterListCourseView courseId="course" courseName="Lezen" chapters={[{...chapter,verseCount:30,exerciseScore:null,completed:false}]} sequential={sequential} todayId={sequential?"alma32":null} todayMinutes={2} todayXp={5} defaultOpenBook="bofm\/alma" unitPlural="hoofdstukken"/>),/Alma/);
 for(const file of ["src/components/CoursesClient.tsx","src/components/native/NativeLearningView.tsx"])assert.match(readFileSync(file,"utf8"),/CoursesView/);
});
test("exact read-only Access routes and capability gated destinations; no Foundation completion rewrite",()=>{
 for(const path of ["courses","courses/real-course/path"]){assert.ok(accessRouteAllowed(path,"GET"));for(const method of ["POST","PUT","DELETE"])assert.equal(accessRouteAllowed(path,method),false);}
 for(const file of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"])assert.ok(readFileSync(file,"utf8").includes("courses/[A-Za-z0-9_-]{1,128}/path"));
 for(const path of ["courses/x/path?preview=1","courses/../path","courses/x/path/extra","courses/https%3a/path"])assert.equal(accessRouteAllowed(path,"GET"),false);
 for(const href of ["/courses","/courses/id","/courses/id/pad"]){assert.equal(nativeRoute(href),href);assert.deepEqual(nativeTodayDestination(href,true),{href,phase:null});assert.equal(nativeTodayDestination(href,false).href,null);}
 assert.equal(nativeTodayDestination("/reading-lesson/exact-step",true).href,null);assert.equal(nativePrimaryNav([]).length,1);assert.deepEqual(nativePrimaryNav(["courses-overview-v1"]).map(x=>x.id),["today","learn"]);
});
test("typed contract rejects unknown versions, wrong paths and malformed progress",()=>{
 assert.ok(nativeCoursesSchema.safeParse(response).success);
 for(const patch of [{version:2},{selectionVersion:-1},{courses:[{...card,completedCount:-1}]}])assert.equal(nativeCoursesSchema.safeParse({...response,...patch}).success,false);
 assert.equal(nativeCoursePathSchema.safeParse({...context,kind:"steps",courseId:"a/../b",courseName:"x",unitPlural:"hoofdstukken",chapters:[],todayId:null}).success,false);
});
test("late course responses cannot cross account epoch or newer source identity",async()=>{
 let release!:(value:unknown)=>void;const env:LiveEnvironment={now:()=>0,isOnline:()=>true,isVisible:()=>true,random:()=>0,schedule:()=>()=>{}};
 const runtime=new NativeDataRuntime({api:()=>new Promise(r=>{release=r;})} as unknown as NativeSessionClient,env);
 const old=runtime.learning("A",context);runtime.reset();release(response);await assert.rejects(old,/session_changed/);
 const observer=runtime.store.observe(["native",runtime.getSnapshot(),...nativeContentQueryKey("A")],{scopes:["content"],initialData:{userId:"A",picker:context},fetcher:async()=>({userId:"A",picker:context})});
 const pending=runtime.learning("A",context);
 runtime.store.setData(["native",runtime.getSnapshot(),...nativeContentQueryKey("A")],{userId:"A",picker:{activeCollectionId:"source-en",selectionVersion:2}});
 release(response);await assert.rejects(pending,/content_context_changed/);observer.release();runtime.reset();
});
