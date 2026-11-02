"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNativeReaderPosition } from "./useNativeReaderPosition";
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
  route,
  onError,
}: {
  userId: string;
  language: string;
  content?: NativeContentState;
  enabled: boolean;
  positionEnabled?: boolean;
  route: NonNullable<ReturnType<typeof nativeReaderRoute>>;
  onError: (e: unknown) => void;
}) {
  const runtime = useNativeData(),
    navigation = useAppNavigation(),
    t = useT();
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
  const transient = nativeLearningTransientError(query.error),
    data =
      enabled && content && (!query.error || transient)
        ? query.data?.reader
        : undefined;
  useEffect(() => {
    if (
      query.error instanceof NativeClientError &&
      (query.error.status === 401 ||
        query.error.code.startsWith("access_") ||
        query.error.code === "content_context_changed")
    )
      onError(query.error);
  }, [query.error, onError]);
  const [conflict,setConflict] = useState(false);
  const writePosition=query.data ? runtime.readerPositionWriter(query.data,queryKey) : null;
  const position = useNativeReaderPosition(data,query.data?.positionVersion ?? 0,positionEnabled,
    async input => {if(!writePosition)throw new NativeClientError("content_context_changed",409);return writePosition(input);},
    error => {
      if(error instanceof NativeClientError && error.status === 409)setConflict(true);
      if(error instanceof NativeClientError && (error.status===401||error.code.startsWith("access_")||error.code==="content_context_changed"))onError(error);
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
  const back = () => navigation.back(`/courses/${route.courseId}/pad`);
  if (!data)
    return (
      <section aria-busy={query.isFetching}>
        <h1 tabIndex={-1} className="text-2xl font-extrabold">
          {t("pages.lesson")}
        </h1>
        <p role="status">
          {t(
            !enabled
              ? "nativeReader.unsupported"
              : query.error
                ? "nativeLearning.pathUnavailable"
                : "nativeFoundation.loading",
          )}
        </p>
        {enabled && (
          <button
            className="btn-secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("nativeFoundation.retry")}
          </button>
        )}
        <button className="btn-secondary" onClick={back}>
          {t("common.back")}
        </button>
      </section>
    );
  return (
    <FocusLayout>
      <div className="flex min-w-0 flex-col gap-5" data-native-reader>
        <p className="text-sm text-vs-fg-2" data-reader-source>
          {data.collectionName} · {data.sourceLanguage}
        </p>
        <ScriptureReaderView
          bookName={data.bookName}
          chapterNumber={data.chapterNumber}
          verses={data.verses}
          focus
          focusVerse={data.focusVerse}
          language={data.sourceLanguage}
          restoreVerse={restoreVerse}
        />
        {data.kind === "steps" && (
          <p role="note" className="text-sm text-vs-fg-2">
            {t("nativeReader.range", {
              start: data.startVerse,
              end: data.endVerse,
            })}
          </p>
        )}
        <p role="note" className="text-sm text-vs-fg-2">
          {t(positionEnabled ? "nativeReader.positionEnabled" : "nativeReader.readOnly")}
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
        {!!query.error && (
          <p role="status">{t("nativeLearning.refreshFailed")}</p>
        )}
        <button className="btn-secondary self-start" onClick={back}>
          {t("common.back")}
        </button>
      </div>
    </FocusLayout>
  );
}
