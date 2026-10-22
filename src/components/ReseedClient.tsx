"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import AdminSection from "@/components/admin/AdminSection";
import { useConfirm } from "@/components/ConfirmProvider";
import { dangerButton } from "@/components/versado/styles";

type ReseedJobStatus = "idle" | "running" | "done" | "error";

interface ReseedJobState {
  status: ReseedJobStatus;
  logs: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: {
    current: number;
    total: number;
    label: string;
    language: string;
    work: string;
  } | null;
}

const POLL_MS = 1500;

export default function ReseedClient() {
  const t = useT();
  const confirm = useConfirm();
  const [job, setJob] = useState<ReseedJobState | null>(null);
  const [studySource, setStudySource] = useState<{
    snapshot: string;
    lessons: number;
    storageReady: boolean;
  } | null>(null);
  const [includeCfm, setIncludeCfm] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logBoxRef = useRef<HTMLPreElement | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch("/api/admin/reseed");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("adminCommon.statusFailed"));
      setJob(data.job as ReseedJobState);
      setStudySource(data.studySource ?? null);
      setLoadError(null);
      if (data.job.status !== "running") stopPolling();
      return data.job as ReseedJobState;
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : t("adminCommon.statusFailed"),
      );
      return null;
    }
  }

  function startPolling() {
    if (pollRef.current) return; // al aan het pollen
    pollRef.current = setInterval(fetchStatus, POLL_MS);
  }

  // Bij het openen (of heropenen na navigeren) meteen de actuele status
  // ophalen — die leeft op de server, dus dit werkt ook als een vorige run
  // gestart is vanaf een andere pagina/tab of vóór een page-refresh.
  useEffect(() => {
    fetchStatus().then((initial) => {
      if (initial?.status === "running") startPolling();
    });
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      // Dit raakt de live database; een tik of klik mag het nooit zomaar starten.
      if (
        !(await confirm(t("adminHub.reseedConfirm"), {
          destructive: true,
          native: true,
          confirmLabel: t("adminReseed.title"),
        }))
      )
        return;
      setLoadError(null);
      if (
        includeCfm &&
        studySource &&
        !(await confirm(
          t("managedContent.approveImport", { snapshot: studySource.snapshot, lessons: studySource.lessons }),
          { native: true },
        ))
      )
        return;
      const res = await fetch("/api/admin/reseed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          includeCfm && studySource
            ? {
                approvedSnapshot: studySource.snapshot,
                confirmDraftsOnly: true,
              }
            : {},
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        if (res.status === 409) await fetchStatus();
        setLoadError(data?.error ?? t("adminCommon.error"));
        return;
      }
      setJob(data.job as ReseedJobState);
      if (data.job.status === "running") startPolling();
    } catch {
      const status = await fetchStatus();
      if (status?.status === "running") startPolling();
      else setLoadError(t("adminCommon.error"));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  const running = job?.status === "running";

  // Automatisch meescrollen naar de nieuwste regel, zodat je de voortgang
  // kan volgen zonder zelf te hoeven scrollen — net als bij een lopend
  // buildlog. Zonder dit bleef het venster (bewust vast van hoogte, zie
  // hieronder) bij de bovenkant staan terwijl nieuwe regels onderaan
  // bijkwamen.
  useEffect(() => {
    if (logBoxRef.current)
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [job?.logs.length]);

  return (
    <AdminSection
      title={t("adminReseed.title")}
      tone="danger"
      badge={t("adminHub.dangerBadge")}
    >
      <p className="text-sm text-vs-fg-2">
        {t("adminReseed.text")}
      </p>

      {studySource ? (
        <label className="flex min-h-12 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={includeCfm}
            onChange={(e) => setIncludeCfm(e.target.checked)}
            disabled={running}
          />
          <span className="min-w-0">{t("managedContent.includeCfm")}</span>
        </label>
      ) : (
        <p role="status" className="text-sm text-vs-fg-2">
          {t("managedContent.sourceMissing")}
        </p>
      )}
      {includeCfm && studySource && !studySource.storageReady && (
        <p role="alert" className="text-sm text-vs-danger">
          {t("managedContent.spaceMissing")}
        </p>
      )}
      <button
        className={`${dangerButton} self-start`}
        disabled={
          running ||
          starting ||
          Boolean(includeCfm && studySource && !studySource.storageReady)
        }
        onClick={run}
      >
        {running ? t("adminCommon.busy") : t("adminReseed.title")}
      </button>

      {running && (
        <div className="flex flex-col gap-2">
          {job.progress && (
            <p className="text-sm text-vs-fg-2">
              {job.progress.work.startsWith("cfm-")
                ? `CFM ${/(\d{4})$/.exec(job.progress.work)?.[1] ?? ""}`.trim()
                : job.progress.work === "old-testament"
                  ? "Oude Testament"
                  : "Nieuwe Testament"}{" "}
              — {job.progress.language} · {job.progress.current}/
              {job.progress.total} · {job.progress.label}
            </p>
          )}
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-vs-subtle"
            aria-label={t("studyPublishing.progress")}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={job.progress?.total ?? 0}
            aria-valuenow={job.progress?.current ?? 0}
          >
            <div
              className="h-full rounded-full bg-vs-accent transition-all"
              style={{
                width: `${job.progress ? Math.round((job.progress.current / job.progress.total) * 100) : 5}%`,
              }}
            />
          </div>
        </div>
      )}

      {loadError && (
        <p role="alert" className="text-sm font-semibold text-vs-danger">{loadError}</p>
      )}
      {job?.status === "error" && (
        <p role="alert" className="text-sm font-semibold text-vs-danger">
          {job.error ?? t("adminReseed.failed")}
        </p>
      )}
      {job?.status === "done" && (
        <p role="status" className="text-sm font-semibold text-vs-accent">
          {t("adminReseed.done")}
        </p>
      )}

      {job && job.logs.length > 0 && (
        <pre
          ref={logBoxRef}
          className="text-xs bg-vs-subtle text-vs-fg-2 rounded-xl p-3 max-h-48 overflow-y-auto whitespace-pre-wrap"
        >
          {job.logs.join("\n")}
        </pre>
      )}
    </AdminSection>
  );
}
