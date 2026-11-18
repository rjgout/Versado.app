"use client";
import NativeLearningPanel,{useNativeLearningFlow} from "./NativeLearningPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import NativeReadAloudPlayer from "./NativeReadAloudPlayer";
import {useReadAloudPlayer} from "@/lib/readAloudPlayerContext";
import type {ReadAloudControl,ReadAloudStatus} from "@/components/ReadAloudPlayer";
import { useNativeReaderPosition } from "./useNativeReaderPosition";
import { useVerseAnnotationMenu } from "@/components/annotations/useVerseAnnotationMenu";
import AnnotationActionsView, { type AnnotationActionsAdapter } from "@/components/annotations/AnnotationActionsView";
import { nativeAnnotationQueryKey } from "@/lib/data/native";
import ScriptureReaderView from "@/components/reading/ScriptureReaderView";
import FocusLayout from "@/components/versado/FocusLayout";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import { useNativeData, useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { nativeLearningTransientError } from "@/lib/data/native";
import { NativeClientError } from "@/lib/native/client";
import { focusNativeRouteHeading } from "@/lib/native/routeFocus";
import { requestScrollRestore } from "@/lib/scrollRestore";
import { currentEntryKey } from "@/lib/navigationEntry";
import type { NativeContentState } from "@/lib/native/contract";
import type { nativeReaderRoute } from "@/lib/native/readerNavigation";

export default function NativeReaderView({
  userId,
  language,
  content,
  enabled,
  positionEnabled = false,
  annotationsEnabled = false,
  audioEnabled = false,
  learningEnabled = false,
  learningMode,
  route,
  onError,
  parentError,
  retryParent,
}: {
  userId: string;
  language: string;
  content?: NativeContentState;
  enabled: boolean;
  positionEnabled?: boolean;
  annotationsEnabled?: boolean;
  audioEnabled?: boolean;
  learningEnabled?: boolean;
  learningMode?: "steps"|"FREE_CHOICE"|"FRONT_TO_BACK";
  route: NonNullable<ReturnType<typeof nativeReaderRoute>>;
  onError: (e: unknown) => void;
  parentError?: unknown;
  retryParent?: () => void;
}) {
  const runtime = useNativeData(),
    navigation = useAppNavigation(),
    t = useT();
  const audioPlayer=useReadAloudPlayer();
  const audioControl=useRef<ReadAloudControl|null>(null);
  const [audioStatus,setAudioStatus]=useState<ReadAloudStatus>("loading");
  const identity = `${userId}:${language}:${content?.picker.activeCollectionId}:${content?.picker.selectionVersion}:${route.courseId}:${route.kind}:${route.targetId}`;
  const queryKey = ["reader", identity, positionEnabled] as const;
  const query = useNativeLiveQuery(
    queryKey,
    () =>
      runtime.readerResume(
        userId,
        language,
        content!.picker,
        route.courseId,
        route.kind,
        route.targetId,
        positionEnabled,
      ),
    {
      enabled: enabled && !!content,
      scopes: ["content", "courses", "progress"],
      staleTime: 60_000,
    },
  );
  // Bevestigde tekst blijft bij transportfouten gemount. Een echte blokkade
  // van reader óf leerpad heeft altijd voorrang, ook als de andere GET slaagt.
  const [audioDenied,setAudioDenied]=useState<unknown>(null);
  const blockingError = [audioDenied,parentError,query.error].find(error=>error && !nativeLearningTransientError(error));
  const candidate = enabled && content && !blockingError ? query.data?.reader : undefined;
  const annotations=useNativeLiveQuery(candidate?nativeAnnotationQueryKey(candidate):["reader-annotations",identity],()=>runtime.readerAnnotations(candidate!),{enabled:annotationsEnabled&&!!candidate,scopes:["annotations","content","courses"],staleTime:60000});
  const [annotationDenied,setAnnotationDenied]=useState<unknown>(null);
  const annotationError=annotationsEnabled ? annotationDenied??annotations.error : null;
  const annotationBlocked=annotationError&&!nativeLearningTransientError(annotationError);
  const data=candidate&&!annotationBlocked?candidate:undefined;
  const learning=useNativeLearningFlow(data,learningEnabled&&!!learningMode);
  const reading=!learning.state||learning.state.phase==="read";
  const annotationRows=annotations.data?.annotations.filter(row=>!row.deleted)??[];
  const colorForVerse=(id:string)=>annotationRows.find(row=>row.kind==="highlight"&&row.target.verseId===id)?.color;
  const menu=useVerseAnnotationMenu(annotationsEnabled&&!!data,colorForVerse);
  const annotationFailure=(error:unknown)=>{
    if(error instanceof NativeClientError && error.code!=="annotation_conflict" && !nativeLearningTransientError(error) && ([401,403,404,409].includes(error.status)||error.code.startsWith("access_"))) {
      setAnnotationDenied(error);
      if(error.status===401||error.code==="content_context_changed"||error.code.startsWith("access_"))onError(error);
    }
  };
  const annotationAdapter:AnnotationActionsAdapter={
    async load(target,signal){
      if(!data||target.type!=="verse")throw new NativeClientError("content_unavailable",404);
      try {const result=await runtime.readerAnnotations(data,target.verseId);if(signal?.aborted)throw new NativeClientError("session_changed",409);return result;}
      catch(error){if(!signal?.aborted)annotationFailure(error);throw error;}
    },
    async mutate(action,method){
      if(!data)throw new NativeClientError("content_unavailable",404);
      try{return await runtime.mutateReaderAnnotation(data,action,method);}catch(error){annotationFailure(error);throw error;}
    },
    status(error){return error instanceof NativeClientError?error.status:undefined;},
    registerNavigationGuard:navigation.registerNavigationGuard,
  };
  const retryAnnotations=async()=>{
    if(!candidate||!annotationsEnabled)return;
    try {const fresh=await runtime.readerAnnotations(candidate);annotations.setData(fresh);setAnnotationDenied(null);}
    catch(error){annotationFailure(error);}
  };
  const verseState=data?.verses.map(verse=>({...verse,
    bookmarked:annotationRows.some(row=>row.kind==="bookmark"&&row.target.verseId===verse.id),
    note:annotationRows.find(row=>row.kind==="note"&&row.target.verseId===verse.id)?.text??"",
  }));
  useEffect(() => {
    const error=blockingError??(annotationBlocked?annotationError:null);
    if (error instanceof NativeClientError &&
      (error.status === 401 || error.code.startsWith("access_") || error.code === "content_context_changed"))onError(error);
  },[blockingError,annotationError,annotationBlocked,onError]);
  const [conflict,setConflict] = useState(false);
  const writePosition=query.data ? runtime.readerPositionWriter(query.data,queryKey) : null;
  const position = useNativeReaderPosition(reading?data:undefined,query.data?.positionVersion ?? 0,positionEnabled,
    async input => {if(!writePosition)throw new NativeClientError("content_context_changed",409);return writePosition(input);},
    error => {
      if(error instanceof NativeClientError && error.status === 409)setConflict(true);
      if(!nativeLearningTransientError(error) && error instanceof NativeClientError && (error.status===401||error.code.startsWith("access_")||error.code==="content_context_changed"))onError(error);
    });
  const hasData = !!data;
  const focused = useRef("");
  useEffect(() => {
    if (hasData && focused.current !== identity) {
      focused.current = identity;
      return focusNativeRouteHeading();
    }
  }, [hasData, identity]);
  const restored = useRef(false);
  const startVerse = data?.startVerse;
  const restoreVerse = useCallback((number: number) => {
    if (restored.current) return;
    restored.current = true;
    requestScrollRestore(currentEntryKey(), "position", () => {
      if (number === startVerse) return 0;
      const element = document.getElementById(`vers-${number}`);
      return element
        ? Math.max(
            0,
            element.getBoundingClientRect().top + scrollY - innerHeight / 2,
          )
        : null;
    });
  }, [startVerse]);
  const retryReader=async()=>{
    if(!audioDenied){void query.refetch();return;}
    try {const fresh=await runtime.readerResume(userId,language,content!.picker,route.courseId,route.kind,route.targetId,positionEnabled);query.setData(fresh);setAudioDenied(null);}catch(error){onError(error);}
  };
  const back = () => navigation.back(`/courses/${route.courseId}/pad`);
  if (!data)
    return (
      <section data-native-reader-unavailable aria-busy={query.isFetching}>
        <h1 tabIndex={-1} className="text-2xl font-extrabold">
          {t("pages.lesson")}
        </h1>
        <p role="status">
          {t(
            !enabled
              ? "nativeReader.unsupported"
              : blockingError || annotationError || query.error
                ? "nativeLearning.pathUnavailable"
                : "nativeFoundation.loading",
          )}
        </p>
        {enabled && (
          <button
            className="btn-secondary"
            disabled={query.isFetching}
            onClick={() => { void retryReader(); void retryAnnotations(); retryParent?.(); }}
          >
            {t("nativeFoundation.retry")}
          </button>
        )}
        <button className="btn-secondary" onClick={back}>
          {t("common.back")}
        </button>
      </section>
    );
  if(learning.flow&&learning.state&&!reading&&learningMode)return <NativeLearningPanel flow={learning.flow} state={learning.state} reader={data} mode={learningMode} onError={onError}/>;
  return (
    <FocusLayout>
      <div className="flex min-w-0 flex-col gap-5" data-native-reader>
        <p className="text-sm text-vs-fg-2" data-reader-source>
          {data.collectionName} · {data.sourceLanguage}
        </p>
        <ScriptureReaderView
          bookName={data.bookName}
          chapterNumber={data.chapterNumber}
          verses={verseState!}
          {...menu.props}
          focus
          beforeVerses={audioEnabled?<NativeReadAloudPlayer reader={data} controlRef={audioControl} onStatusChange={setAudioStatus} onReadDenied={error=>{if(error instanceof NativeClientError&&error.code==="content_context_changed"){onError(error);}else{setAudioDenied(error);onError(error);}}}/>:undefined}
          readingVerse={audioPlayer.source?.native&&audioPlayer.source.id===data.chapterId?audioPlayer.source.verses[audioPlayer.currentIndex]?.number:null}
          followReadingVerse={false}
          focusVerse={data.focusVerse}
          language={data.sourceLanguage}
          restoreVerse={restoreVerse}
        />
        {annotationsEnabled&&annotations.data&&!annotations.data.complete&&<p role="status">{t("annotations.incomplete")}</p>}
        {annotationsEnabled&&!!annotations.error&&<p role="alert">{t("annotations.failed")}</p>}
        {annotationsEnabled&&menu.target&&data.verses.some(verse=>verse.id===menu.target!.verseId)&&
          <AnnotationActionsView audio={audioEnabled?{label:t("player.readAloud"),status:audioStatus,onStart:()=>audioControl.current?.startAtVerse(data.verses.find(verse=>verse.id===menu.target!.verseId)!.number)??false,onRetry:()=>audioControl.current?.retry()}:undefined} key={menu.target.verseId} adapter={annotationAdapter} target={{type:"verse",verseId:menu.target.verseId}} returnFocus={menu.target.element} onClose={menu.close} onChanged={()=>{}}/>}
        {data.kind === "steps" && (
          <p role="note" className="text-sm text-vs-fg-2">
            {t("nativeReader.range", {
              start: data.startVerse,
              end: data.endVerse,
            })}
          </p>
        )}
        <p role="note" className="text-sm text-vs-fg-2">
          {t(learning.flow ? "nativeLearningFlow.ready" : annotationsEnabled ? positionEnabled ? "nativeReader.annotationsPositionEnabled" : "nativeReader.annotationsEnabled" : positionEnabled ? "nativeReader.positionEnabled" : "nativeReader.readOnly")}
        </p>
        {positionEnabled && <div aria-live="polite" className="text-sm text-vs-fg-2" data-reader-save-status>
          {position.status === "saving" && t("nativeReader.saving")}
          {position.status === "saved" && t("nativeReader.saved")}
          {position.status === "error" && <><p role="status">{t(conflict ? "nativeReader.conflict" : "nativeReader.saveFailed")}</p>
            <button className="btn-secondary" onClick={()=>{if(conflict){position.reset();setConflict(false);void query.refetch();}else position.retry();}}>{t("nativeFoundation.retry")}</button></>}
        </div>}
        {data.kind === "chapters" && positionEnabled && <nav aria-label={t("pages.lesson")} className="flex flex-wrap gap-3" data-reader-chapter-navigation>
          {query.data?.previous && <button className="btn-secondary" onClick={()=>navigation.push(`/courses/${route.courseId}/read/chapters/${query.data!.previous}`)}>{t("nativeReader.previous")}</button>}
          {query.data?.next && <button className="btn-secondary" onClick={()=>navigation.push(`/courses/${route.courseId}/read/chapters/${query.data!.next}`)}>{t("nativeReader.next")}</button>}
        </nav>}
        {!!query.error && position.status !== "error" && (
          <p role="status">{t("nativeLearning.refreshFailed")}</p>
        )}
        {learning.flow&&learning.state&&learningMode&&<NativeLearningPanel flow={learning.flow} state={learning.state} reader={data} mode={learningMode} onError={onError}/>}
        <button className="btn-secondary self-start" onClick={back}>
          {t("common.back")}
        </button>
      </div>
    </FocusLayout>
  );
}
