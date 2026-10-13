"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, RefreshCw } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import FocusLayout from "@/components/versado/FocusLayout";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import type { StudyReaderDTO } from "@/lib/studyContent/reader";
import type { ReadingPositionState } from "@/lib/studyContent/readingPositionContract";
import RichContentBlocks from "./RichContentBlocks";
import { useReadingPositionController } from "./ReadingPositionController";

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
  return (
    <FocusLayout className="max-w-3xl">
      <div
        data-study-reader
        data-edition-id={data.lesson.editionId}
        data-revision-id={data.lesson.revisionId}
        className="vs-motion min-w-0 space-y-5 py-2"
      >
        <header className="space-y-4">
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
        <article
          ref={root}
          data-study-reader-body
          lang={data.lesson.language}
          className="min-w-0 rounded-2xl border border-vs-line bg-vs-elevated p-4 sm:p-6"
        >
          <RichContentBlocks document={data.lesson.body} media={data.media} />
        </article>
      </div>
    </FocusLayout>
  );
}
