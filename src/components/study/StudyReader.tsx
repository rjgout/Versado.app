"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, RefreshCw } from "lucide-react";
import { studyExerciseDraftKey } from "@/lib/learning/exerciseCheckpoint";
import { useT } from "@/components/I18nProvider";
import FocusLayout from "@/components/versado/FocusLayout";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import type { StudyReaderDTO } from "@/lib/studyContent/reader";
import type { ReaderDocument, ReadingPositionState } from "@/lib/studyContent/readingPositionContract";
import { stepOfBlock, PERSONAL_STUDY_STEPS, type PersonalStudyView } from "@/lib/studyContent/personalStudy";
import type { StepProgressState } from "@/lib/studyContent/stepProgress";
import type { WeekContext } from "@/lib/studyContent/weekContext";
import { HeaderMenu, StepDots, WeekNav, lessonBase, menuItem } from "./PersonalStudyParts";
import { primaryButton, secondaryButton } from "@/components/versado/styles";
import StudyAnnotations from "@/components/annotations/StudyAnnotations";
import ScriptureVerses from "./ScriptureVerses";
import RichContentBlocks, { InlineContent } from "./RichContentBlocks";
import { useAnnotationFocus } from "./useAnnotationFocus";
import { useStudyMarkRead } from "./useStudyMarkRead";
import type { AnnotationFocus } from "@/lib/annotations/studyFocus";
import { useReadingPositionController } from "./ReadingPositionController";
import ReferencePreview from "./ReferencePreview";
import ReferenceReturn from "./ReferenceReturn";
import { ReferenceActionsContext, BlockedReferencesContext } from "./ReferenceLink";
import { currentEntryKey } from "@/lib/navigationHistory";
import { useStudyReturnToPath } from "@/lib/studyOrigin";
import { jsonMutation } from "@/lib/data/mutation";
import { rememberReferenceTrip } from "@/lib/references/returnContext";
import type { ReferenceTrip } from "@/lib/references/tripContract";
import type { ReferenceRequest } from "@/lib/references/contract";
import { contentSelectionSchema, type ContentPickerContext, type ContentSelection } from "@/lib/contentPickerContract";

/** Persoonlijke studie 2.0: wat de server over de indeling, voortgang en week weet. `view` null = geen persoonlijke route (bv. FSY). */
export interface ReaderPersonal {
  view: PersonalStudyView | null;
  progress: StepProgressState | null;
  week: WeekContext;
  program?: { name: string; year: number | null };
  mode: "free" | "step" | "full";
  stepIndex: number | null;
  /** De lezer toont de volledige les omdat de gevraagde annotatie buiten de persoonlijke studie valt. */
  forcedFull: boolean;
  /** Het CFM-leerpad in Leren waar deze les bij hoort (expliciete bestemming, geen browsergeschiedenis). */
  coursePath?: string | null;
}

/** Programma's zonder persoonlijke studieroute (bv. FSY) behouden de bestaande lezer. */
const NO_PERSONAL: ReaderPersonal = {
  view: null,
  progress: null,
  week: { startsOn: null, endsOnExclusive: null, prev: null, next: null, index: 0, total: 0 },
  mode: "full",
  stepIndex: null,
  forcedFull: false,
};

export default function StudyReader({
  initial,
  sessionKey,
  annotationFocus = null,
  personal = NO_PERSONAL,
}: {
  initial: StudyReaderDTO;
  sessionKey: string;
  /** Door de server bepaald (eigen annotatie, exacte revisie); nooit uit vrije URL-gegevens. */
  annotationFocus?: AnnotationFocus | null;
  personal?: ReaderPersonal;
}) {
  const [pinned, setPinned] = useState(initial);
  const allowUpdate = useRef(false);
  useEffect(() => {
    if (allowUpdate.current) {
      allowUpdate.current = false;
      setPinned(initial);
    }
  }, [initial]);
  return (
    <ReaderVisit
      key={`${pinned.lesson.editionId}:${pinned.lesson.revisionId}`}
      data={pinned}
      sessionKey={sessionKey}
      annotationFocus={annotationFocus}
      personal={personal}
      onUpdate={() => {
        allowUpdate.current = true;
      }}
    />
  );
}
function ReaderVisit({
  data,
  sessionKey,
  annotationFocus,
  personal,
  onUpdate,
}: {
  data: StudyReaderDTO;
  sessionKey: string;
  annotationFocus: AnnotationFocus | null;
  personal: ReaderPersonal;
  onUpdate: () => void;
}) {
  const t = useT(),
    router = useRouter(),
    root = useRef<HTMLElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  const [updating, setUpdating] = useState(false);
  const [reference,setReference]=useState<{request:ReferenceRequest;label:string;element:HTMLElement}|null>(null);
  const moreAlive=useRef(true),moreSession=useRef(sessionKey),moreController=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{
    moreAlive.current=true;moreSession.current=sessionKey;
    return ()=>{moreAlive.current=false;moreController.current?.abort();};
  },[sessionKey]);
  const morePending=useRef<{occurrenceKey:string;expectedSelection:ContentSelection;expectedSelectionVersion:number}|null>(null);
  const { view, week } = personal;
  const pathname = usePathname();
  const returnToPath = useStudyReturnToPath(pathname, personal.coursePath ?? "/courses");
  const legacy = !view;
  const pageMode = legacy ? "full" : personal.mode;
  const currentStep = view && pageMode === "step" && personal.stepIndex ? view.steps[personal.stepIndex - 1] ?? null : null;
  const exerciseVisitProof=currentStep?data.exerciseVisitProofs?.steps[currentStep.index-1]:data.exerciseVisitProofs?.week;
  // Alleen de weergave filtert: dezelfde bronblokken, ids en volgorde. Annotaties en selectors rekenen met het volledige document.
  const displayDoc = useMemo<ReaderDocument>(() => {
    const body = data.lesson.body;
    if (!view || pageMode === "full") return body;
    const allowed = new Set(pageMode === "step" ? currentStep?.blockIds ?? [] : view.personalBlockIds);
    return { ...body, sections: body.sections.map((section) => ({ ...section, blocks: section.blocks.filter((block) => allowed.has(block.id)) })) } as ReaderDocument;
  }, [data.lesson.body, view, pageMode, currentStep]);
  const base = lessonBase(data.lesson.lessonId, data.lesson.collectionId);
  const stepQuery = useLiveQuery<{ revisionId: string; state: StepProgressState }>(
    ["studySteps", sessionKey, data.lesson.editionId, data.lesson.revisionId],
    () => fetchJson(`/api/study-steps?lessonEditionId=${encodeURIComponent(data.lesson.editionId)}`),
    {
      scopes: ["studySteps"],
      initialData: personal.progress ? { revisionId: data.lesson.revisionId, state: personal.progress } : undefined,
      staleTime: 30000,
      enabled: !!view,
    },
  );
  const stepState = stepQuery.data?.state ?? personal.progress;
  const stepStatus = currentStep ? stepState?.steps.find((step) => step.fingerprint === currentStep.fingerprint)?.status ?? "NOT_STARTED" : null;
  const [completing, setCompleting] = useState(false);
  const continuing = useRef(false);
  const [stepError, setStepError] = useState<string | null>(null);
  async function postStep(action: "OPEN" | "COMPLETE") {
    if (!currentStep) return;
    const result = await jsonMutation<{ state: StepProgressState; changed: boolean }>(
      "/api/study-steps",
      {
        json: {
          lessonEditionId: data.lesson.editionId,
          revisionId: data.lesson.revisionId,
          stepIndex: currentStep.index,
          stepFingerprint: currentStep.fingerprint,
          action,
        },
        headers: { "X-Reading-Session": sessionKey },
      },
      { invalidates: "studyStepsChanged" },
    );
    stepQuery.setData({ revisionId: data.lesson.revisionId, state: result.state });
    return result;
  }
  async function continueStep() {
    if (!currentStep || continuing.current) return;
    continuing.current = true;
    setCompleting(true);
    setStepError(null);
    const entry = currentEntryKey();
    try {
      await control.flush();
      if (!control.canLeave()) throw new Error("READING_POSITION_NOT_SAVED");
      const key = studyExerciseDraftKey(sessionKey, data.lesson.editionId, data.lesson.revisionId, currentStep.index);
      let exerciseSessionId: string | undefined;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
        if (typeof saved?.sessionId === "string") exerciseSessionId = saved.sessionId;
      } catch {}
      const result = await jsonMutation<{ state: StepProgressState; questions: "available" | "completed" | "unavailable" }>(
        "/api/study-steps", {
          json: { lessonEditionId: data.lesson.editionId, revisionId: data.lesson.revisionId, stepIndex: currentStep.index, stepFingerprint: currentStep.fingerprint, action: "CONTINUE", exerciseSessionId },
          headers: { "X-Reading-Session": sessionKey },
        }, { invalidates: "studyStepsChanged" },
      );
      if (!moreAlive.current || moreSession.current !== sessionKey || currentEntryKey() !== entry) return;
      stepQuery.setData({ revisionId: data.lesson.revisionId, state: result.state });
      if (result.questions === "available") {
        if (exerciseVisitProof) try { sessionStorage.setItem(key + ":visit", exerciseVisitProof); } catch {}
        router.replace(`${base}/vragen?stap=${currentStep.index}${exerciseVisitProof ? `#leesbewijs=${encodeURIComponent(exerciseVisitProof)}` : ""}`);
      } else if (currentStep.index < PERSONAL_STUDY_STEPS) router.replace(`${base}/stappen/${currentStep.index + 1}`);
      else returnToPath();
    } catch (error) {
      if (moreAlive.current && currentEntryKey() === entry)
        setStepError(error instanceof ApiRequestError && error.status === 409 ? t("cfmStudy.stepRevisionChanged") : t("cfmStudy.completeFailed"));
    } finally {
      continuing.current = false;
      setCompleting(false);
    }
  }
  const openedStep = useRef<string | null>(null);
  useEffect(() => {
    // Een stap openen markeert hem hooguit als "bezig"; afronden blijft een bewuste actie.
    if (!currentStep || openedStep.current === currentStep.fingerprint) return;
    openedStep.current = currentStep.fingerprint;
    void postStep("OPEN").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.fingerprint]);
  const query = useLiveQuery<ReadingPositionState>(
    [
      "readingPosition",
      sessionKey,
      data.lesson.editionId,
      data.lesson.revisionId,
    ],
    () =>
      fetchJson(
        `/api/reading-position?lessonEditionId=${encodeURIComponent(data.lesson.editionId)}`,
      ),
    {
      scopes: ["readingPosition", "studyContent"],
      initialData: data.positionState,
      staleTime: 30000,
    },
  );
  const control = useReadingPositionController(
    root,
    displayDoc,
    data.lesson.revisionId,
    data.positionState,
    query.data,
    sessionKey,
    data.visitProof,
  );
  useAnnotationFocus(root, annotationFocus);
  const status = control.snapshot.status;
  const busy = status === "saving" || updating;
  const { readState, markingRead, readError, justMarkedRead, markRead } = useStudyMarkRead(data, sessionKey, () => busy);
  const update =
    (query.data?.currentRevisionId ?? data.positionState.currentRevisionId) !==
    data.lesson.revisionId;
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);
  async function openUpdate() {
    setUpdating(true);
    await control.flush();
    if (control.canLeave()) {
      onUpdate();
      router.refresh();
    }
    setUpdating(false);
  }
  async function moreReference(passageIndex = 0){
    if(!reference)throw new Error("REFERENCE_UNAVAILABLE");
    const entry=currentEntryKey();
    const stillCurrent=()=>moreAlive.current && moreSession.current===sessionKey && currentEntryKey()===entry;
    const state=await control.flush();
    if(!stillCurrent())throw new Error("REFERENCE_NAVIGATION_CANCELLED");
    if(!state || !control.canLeave())throw new Error("READING_POSITION_NOT_SAVED");
    // Geen bronmutatie als de vereiste tabgebonden context niet kan worden bewaard.
    const reserve=`vs-reference-trip:reserve`;
    sessionStorage.setItem(reserve," ".repeat(16000));
    const pendingKey=`vs-reference-pending:${sessionKey}:${data.lesson.editionId}:${data.lesson.revisionId}`;
    if(!morePending.current){
      try{
        const stored=JSON.parse(sessionStorage.getItem(pendingKey)??"null");
        const selection=contentSelectionSchema.safeParse(stored?.expectedSelection);
        if(selection.success && typeof stored.occurrenceKey==="string" && stored.occurrenceKey.length<=128 && Number.isSafeInteger(stored.expectedSelectionVersion) && stored.expectedSelectionVersion>=0 && stored.expectedSelectionVersion<=2147483647)
          morePending.current={occurrenceKey:stored.occurrenceKey,expectedSelection:selection.data,expectedSelectionVersion:stored.expectedSelectionVersion};
      }catch{}
    }
    if(morePending.current?.occurrenceKey!==reference.request.occurrenceKey){
      const picker=await fetchJson<ContentPickerContext>("/api/content-context?view=picker");
      if(!stillCurrent())throw new Error("REFERENCE_NAVIGATION_CANCELLED");
      if(picker.selectionVersion===undefined)throw new Error("REFERENCE_SOURCE_STATUS_UNKNOWN");
      morePending.current={occurrenceKey:reference.request.occurrenceKey,expectedSelection:picker.selection,expectedSelectionVersion:picker.selectionVersion};
      sessionStorage.setItem(pendingKey,JSON.stringify(morePending.current));
    }
    const controller=new AbortController();moreController.current=controller;
    const deadline=setTimeout(()=>controller.abort(),15000);
    let result:{href:string;token:string;trip:ReferenceTrip};
    try{result=await jsonMutation<{href:string;token:string;trip:ReferenceTrip}>("/api/study-references",{
      json:{action:"more",...reference.request,passageIndex,expectedSelection:morePending.current.expectedSelection,expectedSelectionVersion:morePending.current.expectedSelectionVersion,expectedPositionVersion:state.position?.version ?? 0,...(legacy ? {} : {origin:pageMode==="step" && currentStep ? {mode:"steps" as const,step:currentStep.index} : {mode:pageMode==="full" ? "full" as const : "free" as const}})},
      headers:{"X-Reading-Session":sessionKey},signal:controller.signal,
    },{invalidates:"contentChanged"});}
    catch(error){
      if(error instanceof ApiRequestError && error.status===409){sessionStorage.removeItem(pendingKey);morePending.current=null;}
      throw error;
    }
    finally{clearTimeout(deadline);if(moreController.current===controller)moreController.current=null;}
    if(controller.signal.aborted || !stillCurrent())throw new Error("REFERENCE_NAVIGATION_CANCELLED");
    if(!rememberReferenceTrip(result))throw new Error("REFERENCE_RETURN_STORAGE");
    sessionStorage.removeItem(pendingKey);morePending.current=null;
    setReference(null);router.push(result.href);router.refresh();
  }
  const anchor = control.snapshot.pending?.blockAnchor ?? control.snapshot.state.position?.blockAnchor ?? null;
  const positionStep = view && anchor ? stepOfBlock(view, anchor) : null;
  const headline = view?.weekTitle ?? data.lesson.title;
  // De schriftgedeelten in de kop zijn de oorspronkelijke verwijzingen van de bronkop, dus ze blijven openbaar als verwijzing.
  const scriptureBlock = view?.scriptureTitleId ? data.lesson.body.sections.flatMap((x) => x.blocks).find((b) => b.id === view.scriptureTitleId) : undefined;
  const scriptureHeading = scriptureBlock?.type === "heading" ? scriptureBlock : null;
  const saveVisible = status === "error" || status === "conflict" || status === "unavailable";
  const startOverDisabled = busy || status === "conflict" || status === "unavailable" || query.updatedAt === null;
  const markLabel = (invite: boolean) => (markingRead ? t("studyReader.markingRead") : invite ? t("cfmStudy.markWholeRead") : t("studyReader.markRead"));
  const markReadFor = (invite: boolean) => readState.read ? (
    <section data-study-read-status="read" role="status" className="flex items-start gap-3 rounded-xl border border-vs-success/35 bg-vs-success-soft p-3 text-vs-fg">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-vs-success" aria-hidden />
      <div className="min-w-0">
        <h2 className="font-bold">{t("studyReader.readComplete")}</h2>
        <p className="mt-0.5 text-sm text-vs-fg-2">{t("studyReader.readCompleteNotice")}</p>
      </div>
    </section>
  ) : (
    <div className="space-y-2">
      <button type="button" data-mark-study-read className={`${primaryButton} min-h-12`} onClick={() => void markRead()} disabled={markingRead || busy}>
        <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
        {markLabel(invite)}
      </button>
      <p className="text-sm text-vs-fg-2">{t("studyReader.markReadNotice")}</p>
      {readError && <p role="status" className="text-sm text-vs-danger">{readError}</p>}
    </div>
  );
  const markReadSection = markReadFor(false);
  const readMarked = justMarkedRead && (
    <p role="status" className="text-sm font-semibold text-vs-success">{t("studyReader.readMarked")}</p>
  );
  const stepNumber = currentStep?.index ?? 0;
  const stepFooter = currentStep && (
    <div className="space-y-4 border-t border-vs-line pt-4">
      {stepStatus === "COMPLETED" ? (
        <p role="status" className="flex items-center gap-2 font-semibold text-vs-success">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          {t("cfmStudy.statusCompleted")}
        </p>
      ) : null}
      {stepError && <p role="status" className="text-sm text-vs-danger">{stepError}</p>}
      {stepStatus === "COMPLETED" && <p className="text-sm text-vs-fg-2">{t("cfmStudy.stepDone")}</p>}
      <nav className="flex flex-wrap gap-2" aria-label={t("cfmStudy.stepNavigation")}>
        {stepNumber > 1 && (
          <Link href={`${base}/stappen/${stepNumber - 1}`} prefetch={false} replace data-step-prev onClick={event => { if (completing) event.preventDefault(); }} aria-disabled={completing} className={`${secondaryButton} min-h-12 flex-1`}>
            <ChevronLeft aria-hidden className="h-5 w-5 shrink-0" />
            {t("cfmStudy.previousStep")}
          </Link>
        )}
        {stepNumber < PERSONAL_STUDY_STEPS ? (
          <Link href={`${base}/stappen/${stepNumber + 1}`} prefetch={false} replace data-step-next aria-disabled={completing || busy} onClick={event => { event.preventDefault(); if (!busy) void continueStep(); }} className={`${primaryButton} min-h-12 flex-1`}>
            {completing ? t("courses.busy") : t("cfmStudy.nextStep")}
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
          </Link>
        ) : (
          // De laatste stap heeft geen volgende stap: naar het weekpad (een eigen knop, los van de hoofdterugknop). Stappen onderling vervangen elkaar in de geschiedenis, zodat de hoofdterugknop altijd naar de herkomst gaat.
          <Link
            href={personal.coursePath ?? "/courses"}
            prefetch={false}
            data-step-to-path
            onClick={(event) => {
              // Komt de gebruiker van het weekpad, dan terug in plaats van een tweede weekpad op de geschiedenis te zetten.
              event.preventDefault();
              if (!busy) void continueStep();
            }}
            aria-disabled={completing || busy}
            className={`${stepStatus === "COMPLETED" ? primaryButton : secondaryButton} min-h-12 flex-1`}
          >
            {completing ? t("courses.busy") : t("cfmStudy.nextStep")}
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
          </Link>
        )}
      </nav>
      {stepState?.allCompleted && (
        <div className="space-y-3 rounded-xl bg-vs-subtle/60 p-3">
          <p className="font-semibold">{t("cfmStudy.allDone")}</p>
          <p className="text-sm text-vs-fg-2">{t("cfmStudy.sundayRest")}</p>
          <p className="text-sm text-vs-fg-2">{t("cfmStudy.markInvite")}</p>
          {markReadFor(true)}
          {readMarked}
        </div>
      )}
    </div>
  );
  const newHeader = (
    <header className="space-y-3">
      <ReferenceReturn sessionKey={sessionKey} />
      {/* Het menu bestaat alleen in Vrije studie en de volledige les; in Stap voor stap staan terugnavigatie en stapnavigatie in de lezer zelf. */}
      {pageMode !== "step" && (
        <div className="flex items-center justify-end gap-2">
          <HeaderMenu>
            <button type="button" data-menu-item className={menuItem} onClick={() => void control.startOver()} disabled={startOverDisabled}>
              <RotateCcw className="h-5 w-5 shrink-0" aria-hidden />
              {t("studyReader.startOver")}
            </button>
            {pageMode === "full" ? (
              <Link href={base} prefetch={false} className={menuItem}>{t("cfmStudy.backToPersonal")}</Link>
            ) : (
              <Link href={`${base}?weergave=volledig`} prefetch={false} className={menuItem}>{t("cfmStudy.viewFull")}</Link>
            )}
            <Link href={personal.coursePath ?? "/courses"} prefetch={false} className={menuItem}>{t("cfmStudy.pickWeek")}</Link>
          </HeaderMenu>
        </div>
      )}
      <div className="space-y-1">
        <h1 ref={title} tabIndex={-1} className="text-xl font-extrabold leading-tight text-vs-fg focus:outline-none sm:text-2xl" lang={data.lesson.language}>
          {headline}
        </h1>
        {view?.scriptureTitle && (
          <p className="text-sm text-vs-fg-2">
            {/* In de volledige les staat de bronkop zelf met zijn verwijzingen in de tekst; een tweede klikbare kopie zou dezelfde verwijzing dubbel aanbieden. */}
            {scriptureHeading && pageMode !== "full" ? <InlineContent parts={scriptureHeading.content} /> : view.scriptureTitle}
          </p>
        )}
      </div>
      {currentStep && (
        <p className="font-bold text-vs-fg">
          {t("cfmStudy.stepOf", { n: currentStep.index, total: PERSONAL_STUDY_STEPS })}
          {currentStep.title ? ` · ${currentStep.title}` : ""}
          {currentStep.continued ? ` · ${t("cfmStudy.continued")}` : ""}
        </p>
      )}
      {currentStep && stepState && <StepDots statuses={stepState.steps.map((x) => x.status)} current={currentStep.index} />}
      <div role="progressbar" aria-label={t("studyReader.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={control.progress} className="h-1 overflow-hidden rounded-full bg-vs-subtle">
        <div className="h-full bg-vs-accent" style={{ width: `${control.progress}%` }} />
      </div>
      {pageMode === "full" && (
        <p role="status" className="text-sm text-vs-fg-2">
          {personal.forcedFull ? t("cfmStudy.outsideNotice") : t("cfmStudy.fullNotice")}{" "}
          <Link href={base} prefetch={false} className="font-semibold text-vs-accent underline underline-offset-2">{t("cfmStudy.backToPersonal")}</Link>
        </p>
      )}
      {annotationFocus?.status === "exact" && <p role="status" className="sr-only">{t("studyFolder.readerFocused")}</p>}
      {annotationFocus?.status === "missing" && (
        <section data-annotation-focus-note={annotationFocus.status} role="status" className="rounded-2xl border border-vs-line bg-vs-elevated p-4 text-sm text-vs-fg">
          <p>{t("studyFolder.readerMissing")}</p>
          {annotationFocus.quote && (
            <blockquote className="mt-2 whitespace-pre-line border-l-2 border-vs-line pl-3 text-vs-fg-2 [overflow-wrap:anywhere]">
              <span className="block text-xs font-bold text-vs-fg-3">{t("studyFolder.originalPassage")}</span>
              {annotationFocus.quote}
            </blockquote>
          )}
        </section>
      )}
      <div data-reading-save-status role="status" aria-live="polite" className={saveVisible ? "text-sm text-vs-fg-2" : "sr-only"}>
        {status === "saving" ? t("studyReader.saving") : status === "saved" ? t("studyReader.saved") : status === "error" ? t("studyReader.saveFailed") : status === "conflict" ? t("studyReader.conflict") : status === "unavailable" ? t("studyReader.availableFailed") : ""}
      </div>
      {status === "error" && <button className={`${secondaryButton} min-h-12`} onClick={() => void control.retry()}>{t("studyReader.retry")}</button>}
      {status === "conflict" && <button className={`${secondaryButton} min-h-12`} onClick={control.useServer}>{t("studyReader.useServer")}</button>}
      {(control.recovery === "LOST" || control.recovery === "QUOTE" || (control.recovery === "SECTION" && pageMode === "full")) && (
        <p role="status" className="text-sm text-vs-fg-2">{t(control.recovery === "LOST" ? "studyReader.positionLost" : "studyReader.positionRemapped")}</p>
      )}
      {Boolean(query.error) && <p role="status" className="text-sm text-vs-fg-2">{t("studyReader.availableFailed")}</p>}
      {update && (
        <div className="rounded-xl border border-vs-line bg-vs-elevated p-3">
          <p className="text-sm text-vs-fg-2">{t("studyReader.updateAvailable")}</p>
          <button className={`${secondaryButton} mt-2 min-h-12`} disabled={busy || status === "conflict" || status === "unavailable"} onClick={() => void openUpdate()}>
            <RefreshCw className="h-5 w-5 shrink-0" aria-hidden />
            {t("studyReader.openUpdate")}
          </button>
        </div>
      )}
    </header>
  );
  return (
    <FocusLayout className="max-w-3xl">
      <div
        data-study-reader
        data-edition-id={data.lesson.editionId}
        data-revision-id={data.lesson.revisionId}
        data-reader-mode={pageMode}
        className="vs-motion min-w-0 space-y-5 py-2"
      >
        <ReferenceActionsContext.Provider value={(id,label,element)=>setReference({request:{lessonEditionId:data.lesson.editionId,revisionId:data.lesson.revisionId,occurrenceKey:id,...(data.visitProof ? {visitProof:data.visitProof} : {})},label,element})}>
        <BlockedReferencesContext.Provider value={data.blockedReferences ?? []}>
        {legacy ? (
        <header className="space-y-4">
            <ReferenceReturn sessionKey={sessionKey}/>
            <h1
              ref={title}
              tabIndex={-1}
              className="text-2xl font-extrabold leading-tight text-vs-fg focus:outline-none"
              lang={data.lesson.language}
            >
              {data.lesson.title}
            </h1>
            <div
              role="progressbar"
              aria-label={t("studyReader.progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={control.progress}
              className="h-1.5 overflow-hidden rounded-full bg-vs-subtle"
            >
              <div
                className="h-full bg-vs-accent"
                style={{ width: `${control.progress}%` }}
              />
            </div>
            {annotationFocus?.status === "exact" && <p role="status" className="sr-only">{t("studyFolder.readerFocused")}</p>}
            {annotationFocus?.status === "missing" && (
              <section data-annotation-focus-note={annotationFocus.status} role="status" className="rounded-2xl border border-vs-line bg-vs-elevated p-4 text-sm text-vs-fg">
                <p>{t("studyFolder.readerMissing")}</p>
                {annotationFocus.quote && (
                  <blockquote className="mt-2 whitespace-pre-line border-l-2 border-vs-line pl-3 text-vs-fg-2 [overflow-wrap:anywhere]">
                    <span className="block text-xs font-bold text-vs-fg-3">{t("studyFolder.originalPassage")}</span>
                    {annotationFocus.quote}
                  </blockquote>
                )}
              </section>
            )}
            <p className="text-sm text-vs-fg-2">{t("studyReader.readNotice")}</p>
            {readState.read ? (
              <section
                data-study-read-status="read"
                role="status"
                className="rounded-2xl border border-vs-success/35 bg-vs-success-soft p-4 text-vs-fg"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-vs-success" aria-hidden />
                  <div className="min-w-0">
                    <h2 className="font-bold">{t("studyReader.readComplete")}</h2>
                    <p className="mt-1 text-sm text-vs-fg-2">{t("studyReader.readCompleteNotice")}</p>
                  </div>
                </div>
              </section>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  data-mark-study-read
                  className="btn-primary min-h-12 max-w-full gap-2"
                  onClick={() => void markRead()}
                  disabled={markingRead || busy}
                >
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
                  {markingRead ? t("studyReader.markingRead") : t("studyReader.markRead")}
                </button>
                <p className="text-sm text-vs-fg-2">{t("studyReader.markReadNotice")}</p>
                {readError && <p role="status" className="text-sm text-vs-danger">{readError}</p>}
              </div>
            )}
            {justMarkedRead && (
              <p role="status" className="text-sm font-semibold text-vs-success">
                {t("studyReader.readMarked")}
              </p>
            )}
            <button
              type="button"
              className="btn-secondary min-h-12 max-w-full gap-2"
              onClick={() => void control.startOver()}
              disabled={
                busy ||
                status === "conflict" ||
                status === "unavailable" ||
                query.updatedAt === null
              }
            >
              <RotateCcw className="h-5 w-5 shrink-0" aria-hidden />
              {t("studyReader.startOver")}
            </button>
            <div
              data-reading-save-status
              role="status"
              aria-live="polite"
              className="text-sm text-vs-fg-2"
            >
              {status === "saving"
                ? t("studyReader.saving")
                : status === "saved"
                  ? t("studyReader.saved")
                  : status === "error"
                    ? t("studyReader.saveFailed")
                    : status === "conflict"
                      ? t("studyReader.conflict")
                      : status === "unavailable"
                        ? t("studyReader.availableFailed")
                        : ""}
            </div>
            {status === "error" && (
              <button
                className="btn-secondary min-h-12"
                onClick={() => void control.retry()}
              >
                {t("studyReader.retry")}
              </button>
            )}
            {status === "conflict" && (
              <button
                className="btn-secondary min-h-12"
                onClick={control.useServer}
              >
                {t("studyReader.useServer")}
              </button>
            )}
            {(control.recovery === "LOST" ||
              control.recovery === "SECTION" ||
              control.recovery === "QUOTE") && (
              <p role="status" className="text-sm text-vs-fg-2">
                {t(
                  control.recovery === "LOST"
                    ? "studyReader.positionLost"
                    : "studyReader.positionRemapped",
                )}
              </p>
            )}
            {Boolean(query.error) && (
              <p role="status" className="text-sm text-vs-fg-2">
                {t("studyReader.availableFailed")}
              </p>
            )}
            {update && (
              <div className="rounded-xl border border-vs-line bg-vs-elevated p-4">
                <p className="text-sm text-vs-fg-2">
                  {t("studyReader.updateAvailable")}
                </p>
                <button
                  className="btn-secondary mt-3 min-h-12 gap-2"
                  disabled={
                    busy || status === "conflict" || status === "unavailable"
                  }
                  onClick={() => void openUpdate()}
                >
                  <RefreshCw className="h-5 w-5 shrink-0" aria-hidden />
                  {t("studyReader.openUpdate")}
                </button>
              </div>
            )}
          </header>
        ) : newHeader}
        <article
          ref={root}
          data-study-reader-body
          lang={data.lesson.language}
          className={legacy ? "min-w-0 rounded-2xl border border-vs-line bg-vs-elevated p-4 sm:p-6" : "min-w-0"}
        >
          <StudyAnnotations document={data.lesson.body} editionId={data.lesson.editionId} revisionId={data.lesson.revisionId} sessionKey={sessionKey} disabled={!!reference || updating} recovery={annotationFocus} compact={!legacy}><RichContentBlocks document={displayDoc} media={data.media} compact={!legacy}/ ></StudyAnnotations>
        </article>
        </BlockedReferencesContext.Provider>
        </ReferenceActionsContext.Provider>
        {!legacy && Boolean(data.scriptureReadingSteps?.some(index=>!currentStep || index===currentStep.index)) && (
          <section data-study-scripture-readings className="min-w-0 space-y-6 border-t border-vs-line pt-4 text-base text-vs-fg">
            <h2 className="text-xl font-extrabold">{t("cfmExercises.scriptureReading")}</h2>
            {(data.scriptureReadings??[]).filter(reading=>!currentStep || reading.stepIndex===currentStep.index).map((reading,index,readings)=>(
              <section key={`${reading.stepIndex}:${reading.bookKey}:${reading.chapter}`} data-study-scripture-reading={reading.stepIndex} className="min-w-0 space-y-3">
                {!currentStep && readings[index-1]?.stepIndex!==reading.stepIndex && <p className="font-bold">{t("cfmStudy.stepOf",{n:reading.stepIndex,total:6})}</p>}
                <h3 className="font-bold">{reading.bookName} {reading.chapter}:{reading.verses.map(verse=>verse.number).join(", ")}</h3>
                <ScriptureVerses verses={reading.verses} language={reading.language} />
              </section>
            ))}
            {data.scriptureReadingSteps?.some(index=>(!currentStep || index===currentStep.index) && (data.scriptureReadings??[]).filter(reading=>reading.stepIndex===index).reduce((count,reading)=>count+reading.verses.length,0)<3) && <p role="status" className="text-sm text-vs-fg-2">{t("cfmExercises.scriptureUnavailable")}</p>}
          </section>
        )}
        {!legacy && !currentStep && data.exerciseCounts && <div className="border-t border-vs-line pt-4">
          {data.exerciseCounts.every(n=>n===3) ? <Link data-study-exercises replace onClick={()=>{const proof=exerciseVisitProof;if(proof)try{sessionStorage.setItem(studyExerciseDraftKey(sessionKey,data.lesson.editionId,data.lesson.revisionId,null)+":visit",proof);}catch{}}} href={`${base}/vragen${pageMode==='full'?'?volledig=1':''}${exerciseVisitProof?`#leesbewijs=${encodeURIComponent(exerciseVisitProof)}`:""}`} prefetch={false} className="btn-primary">{t('progress.practice',{n:18})}</Link>:<p role="status" className="text-sm text-vs-fg-2">{t('cfmExercises.unavailable')}</p>}
        </div>}
        {!legacy && pageMode !== "step" && (
          <footer className="space-y-4 border-t border-vs-line pt-4">
            {markReadSection}
            {readMarked}
            <WeekNav week={week} suffix={pageMode === "free" ? "" : "?weergave=volledig"} />
          </footer>
        )}
        {!legacy && pageMode === "step" && stepFooter}
        {reference && <ReferencePreview key={`${sessionKey}:${reference.request.occurrenceKey}`} request={reference.request} label={reference.label} sessionKey={sessionKey} onClose={()=>setReference(null)} onMore={moreReference} returnFocus={reference.element}/ >}
      </div>
    </FocusLayout>
  );
}
