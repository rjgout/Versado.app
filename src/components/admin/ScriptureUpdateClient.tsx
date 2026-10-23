"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import AdminSection from "@/components/admin/AdminSection";
import { useConfirm } from "@/components/ConfirmProvider";
import { dangerButton, primaryButton, secondaryButton } from "@/components/versado/styles";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import type { ScriptureJobState } from "@/lib/scriptureUpdateJob";

interface Overview {
  job: ScriptureJobState;
  needsReview: number;
  runs: { id: string; kind: string; status: string; startedAt: string; durationMs: number | null; planHash: string | null }[];
}

interface AudioItem {
  chapterId: string;
  book: string;
  chapter: number;
  detail: { changedVerses?: number[] } | null;
}

export default function ScriptureUpdateClient() {
  const t = useT();
  const confirm = useConfirm();
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mutex = useRef(false);
  const outcome = useRef<HTMLDivElement>(null);

  const query = useLiveQuery<Overview>(["admin", "scripture-update"], () => fetchJson("/api/admin/scripture-update"), {
    scopes: ["content"],
    staleTime: 0,
    pollMs: polling ? 2000 : undefined,
  });
  const audio = useLiveQuery<{ items: AudioItem[] }>(["admin", "audio-checks"], () => fetchJson("/api/admin/audio-checks"), {
    scopes: ["content"],
    staleTime: 0,
  });
  const job = query.data?.job ?? null;
  const running = job?.status === "running";

  // Poll alleen zolang er een taak loopt; de status leeft op de server en overleeft dus navigeren.
  if (query.data && polling !== running) setPolling(running);
  // Het voorbereide plan is de nieuwste geslaagde voorbereiding die nog niet gepubliceerd is; zo overleeft het ook een herlaad.
  const latestPublish = query.data?.runs.find((run) => run.kind === "SCRIPTURE_PUBLISH");
  const latestPrepare = query.data?.runs.find((run) => run.kind === "SCRIPTURE_PREPARE" && run.status === "OK" && run.planHash);
  const preparedHash = latestPrepare && (!latestPublish || latestPublish.startedAt < latestPrepare.startedAt) ? latestPrepare.planHash : null;
  useEffect(() => { if (error || job?.status === "done" || job?.status === "error") outcome.current?.focus({ preventScroll: true }); }, [error, job?.status]);

  async function start(action: "check" | "prepare" | "publish" | "mirror") {
    if (mutex.current) return;
    mutex.current = true;
    setError("");
    try {
      if (action === "publish" && !(await confirm(t("adminContentUpdate.publishConfirm"), { destructive: true, native: true, confirmLabel: t("adminContentUpdate.publish") }))) return;
      setBusy(true);
      await jsonMutation("/api/admin/scripture-update", { json: action === "publish" ? { action, planHash: preparedHash } : { action } }, { invalidates: action === "publish" ? "contentChanged" : ["content"] });
      setPolling(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("adminCommon.error"));
      await query.refetch();
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }

  async function confirmAudio(chapterId: string) {
    try {
      await jsonMutation("/api/admin/audio-checks", { json: { chapterId, action: "confirm" } }, { invalidates: ["content"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("adminCommon.error"));
    }
  }

  const resultsBusy = busy || running;
  const message =
    job?.status === "error" ? t(`adminContentUpdate.err${job.errorCode ?? "FAILED"}` as "adminContentUpdate.errFAILED")
    : job?.status === "done" && job.action === "publish"
      ? job.results.some((r) => r.status === "error") ? t("adminContentUpdate.publishPartial") : t("adminContentUpdate.publishDone")
    : job?.status === "done" && job.action !== "publish" && job.action !== "mirror" && job.results.some((r) => r.status === "error") ? t("adminContentUpdate.checkFailed")
    : job?.status === "done" && job.action === "mirror" ? t("adminContentUpdate.mirrorDone")
    : job?.status === "done" && job.action === "prepare" ? (job.upToDate ? t("adminContentUpdate.upToDate") : t("adminContentUpdate.planReady"))
    : job?.status === "done" ? (job.upToDate ? t("adminContentUpdate.upToDate") : t("adminContentUpdate.checkDone"))
    : "";
  const failed = job?.status === "error" || (job?.status === "done" && job.results.some((r) => r.status === "error"));
  const canPublish = Boolean(preparedHash) && job?.upToDate !== true && !resultsBusy;

  return (
    <AdminSection
      title={t("adminContentUpdate.title")}
      tone="danger"
      badge={query.data && query.data.needsReview > 0 ? t("adminContentUpdate.needsReview", { n: query.data.needsReview }) : undefined}
    >
      <p className="text-sm text-vs-fg-2">{t("adminContentUpdate.text")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={secondaryButton} disabled={resultsBusy} onClick={() => start("check")}>{t("adminContentUpdate.check")}</button>
        <button className={primaryButton} disabled={resultsBusy} onClick={() => start("prepare")}>{t("adminContentUpdate.prepare")}</button>
        <button className={dangerButton} disabled={!canPublish} onClick={() => start("publish")}>{t("adminContentUpdate.publish")}</button>
      </div>

      {running && (
        <p role="status" className="text-sm text-vs-fg-2">
          {t(job?.action === "mirror" ? "adminContentUpdate.mirroring" : job?.action === "publish" ? "adminContentUpdate.publishing" : job?.action === "prepare" ? "adminContentUpdate.preparing" : "adminContentUpdate.checking")}
        </p>
      )}

      <div ref={outcome} tabIndex={-1} className="outline-none">
        {error && <p role="alert" className="text-sm font-semibold text-vs-danger">{error}</p>}
        {message && (
          <p role={failed ? "alert" : "status"} className={`text-sm font-semibold ${failed ? "text-vs-danger" : "text-vs-accent"}`}>{message}</p>
        )}
      </div>

      {job && job.results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {job.results.map((result) => (
            <li key={result.key} className="rounded-xl bg-vs-subtle p-3 text-sm">
              <p className="font-bold text-vs-fg">{result.label}</p>
              <p className={result.status === "error" ? "text-vs-danger" : "text-vs-fg-2"}>
                {result.status === "ok" ? t("adminContentUpdate.sourceOk") : result.status === "skipped" ? t(result.message === "otbNotPrepared" ? "adminContentUpdate.sourceSkippedOtb" : "adminContentUpdate.sourceSkipped") : t("adminContentUpdate.sourceError")}
              </p>
              {result.counts && (
                <ul className="mt-1 text-xs text-vs-fg-2">
                  <li>{t("adminContentUpdate.chapters", { changed: result.counts.changedChapters, created: result.counts.chaptersCreated })}</li>
                  <li>{t("adminContentUpdate.verses", { created: result.counts.versesCreated, updated: result.counts.versesUpdated, deleted: result.counts.versesDeleted })}</li>
                  <li>{t("adminContentUpdate.exercises", { kept: result.counts.exercisesKept, created: result.counts.exercisesCreated, retired: result.counts.exercisesRetired, deleted: result.counts.exercisesDeleted })}</li>
                  {result.counts.audioChapters > 0 && <li>{t("adminContentUpdate.audio", { n: result.counts.audioChapters })}</li>}
                </ul>
              )}
              {result.status === "error" && result.message && <p className="mt-1 break-words text-xs text-vs-danger">{result.message}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-vs-line pt-3">
        <h3 className="text-sm font-extrabold text-vs-fg">{t("adminContentUpdate.audioTitle")}</h3>
        <p className="text-xs text-vs-fg-2">{t("adminContentUpdate.audioText")}</p>
        <p className="text-xs text-vs-fg-2">{t("adminContentUpdate.mirrorText")}</p>
        <button className={`${secondaryButton} self-start`} disabled={resultsBusy} onClick={() => start("mirror")}>{t("adminContentUpdate.mirror")}</button>
        {audio.data && audio.data.items.length === 0 && <p role="status" className="text-sm text-vs-fg-2">{t("adminContentUpdate.audioNone")}</p>}
        <ul className="flex flex-col gap-2">
          {audio.data?.items.map((item) => (
            <li key={item.chapterId} className="flex flex-wrap items-center gap-2 rounded-xl bg-vs-subtle p-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-vs-fg">{item.book} {item.chapter}</span>
                {item.detail?.changedVerses && item.detail.changedVerses.length > 0 && (
                  <span className="block text-xs text-vs-fg-2">{t("adminContentUpdate.audioChanged", { verses: item.detail.changedVerses.slice(0, 20).join(", ") })}</span>
                )}
              </span>
              <button className={secondaryButton} onClick={() => confirmAudio(item.chapterId)}>{t("adminContentUpdate.audioConfirm")}</button>
            </li>
          ))}
        </ul>
      </div>
    </AdminSection>
  );
}
