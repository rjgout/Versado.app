"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, RefreshCw } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import FocusLayout from "@/components/versado/FocusLayout";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson, ApiRequestError } from "@/lib/data/fetchJson";
import type { StudyReaderDTO } from "@/lib/studyContent/reader";
import type { ReadingPositionState } from "@/lib/studyContent/readingPositionContract";
import RichContentBlocks from "./RichContentBlocks";
import { useReadingPositionController } from "./ReadingPositionController";
import ReferencePreview from "./ReferencePreview";
import ReferenceReturn from "./ReferenceReturn";
import { ReferenceActionsContext } from "./ReferenceLink";
import { jsonMutation } from "@/lib/data/mutation";
import { rememberReferenceTrip } from "@/lib/references/returnContext";
import type { ReferenceTrip } from "@/lib/references/tripContract";
import type { ReferenceRequest } from "@/lib/references/contract";
import { contentSelectionSchema, type ContentPickerContext, type ContentSelection } from "@/lib/contentPickerContract";

export default function StudyReader({
  initial,
  sessionKey,
}: {
  initial: StudyReaderDTO;
  sessionKey: string;
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
      onUpdate={() => {
        allowUpdate.current = true;
      }}
    />
  );
}
function ReaderVisit({
  data,
  sessionKey,
  onUpdate,
}: {
  data: StudyReaderDTO;
  sessionKey: string;
  onUpdate: () => void;
}) {
  const t = useT(),
    router = useRouter(),
    root = useRef<HTMLElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  const [updating, setUpdating] = useState(false);
  const [reference,setReference]=useState<{request:ReferenceRequest;label:string;element:HTMLElement}|null>(null);
  const morePending=useRef<{occurrenceKey:string;expectedSelection:ContentSelection;expectedSelectionVersion:number}|null>(null);
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
    data.lesson.body,
    data.lesson.revisionId,
    data.positionState,
    query.data,
    sessionKey,
    data.visitProof,
  );
  const status = control.snapshot.status;
  const busy = status === "saving" || updating;
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
  async function moreReference(){
    if(!reference)throw new Error("REFERENCE_UNAVAILABLE");
    const state=await control.flush();
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
      if(picker.selectionVersion===undefined)throw new Error("REFERENCE_SOURCE_STATUS_UNKNOWN");
      morePending.current={occurrenceKey:reference.request.occurrenceKey,expectedSelection:picker.selection,expectedSelectionVersion:picker.selectionVersion};
      sessionStorage.setItem(pendingKey,JSON.stringify(morePending.current));
    }
    let result:{href:string;token:string;trip:ReferenceTrip};
    try{result=await jsonMutation<{href:string;token:string;trip:ReferenceTrip}>("/api/study-references",{
      json:{action:"more",...reference.request,expectedSelection:morePending.current.expectedSelection,expectedSelectionVersion:morePending.current.expectedSelectionVersion,expectedPositionVersion:state.position?.version ?? 0},
      headers:{"X-Reading-Session":sessionKey},
    },{invalidates:"contentChanged"});}
    catch(error){
      if(error instanceof ApiRequestError && error.status===409){sessionStorage.removeItem(pendingKey);morePending.current=null;}
      throw error;
    }
    if(!rememberReferenceTrip(result))throw new Error("REFERENCE_RETURN_STORAGE");
    sessionStorage.removeItem(pendingKey);morePending.current=null;
    setReference(null);router.push(result.href);router.refresh();
  }
  return (
    <FocusLayout className="max-w-3xl">
      <div
        data-study-reader
        data-edition-id={data.lesson.editionId}
        data-revision-id={data.lesson.revisionId}
        className="vs-motion min-w-0 space-y-5 py-2"
      >
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
          <p className="text-sm text-vs-fg-2">{t("studyReader.readNotice")}</p>
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
        <ReferenceActionsContext.Provider value={(id,label,element)=>setReference({request:{lessonEditionId:data.lesson.editionId,revisionId:data.lesson.revisionId,occurrenceKey:id,...(data.visitProof ? {visitProof:data.visitProof} : {})},label,element})}>
        <article
          ref={root}
          data-study-reader-body
          lang={data.lesson.language}
          className="min-w-0 rounded-2xl border border-vs-line bg-vs-elevated p-4 sm:p-6"
        >
          <RichContentBlocks document={data.lesson.body} media={data.media} />
        </article>
        </ReferenceActionsContext.Provider>
        {reference && <ReferencePreview key={reference.request.occurrenceKey} request={reference.request} label={reference.label} sessionKey={sessionKey} onClose={()=>setReference(null)} onMore={moreReference} returnFocus={reference.element}/ >}
      </div>
    </FocusLayout>
  );
}
