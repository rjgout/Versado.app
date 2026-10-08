"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";

type ReseedJobStatus = "idle" | "running" | "done" | "error";

interface ReseedJobState {
  status: ReseedJobStatus;
  logs: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: { current: number; total: number; label: string; language: string; work: string } | null;
}

const POLL_MS = 1500;

export default function ReseedClient() {
  const t = useT();
  const [job, setJob] = useState<ReseedJobState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoadError(null);
      if (data.job.status !== "running") stopPolling();
      return data.job as ReseedJobState;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("adminCommon.statusFailed"));
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
    setLoadError(null);
    const res = await fetch("/api/admin/reseed", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      setLoadError(data?.error ?? t("adminCommon.error"));
      return;
    }
    setJob(data.job as ReseedJobState);
    if (data.job.status === "running") startPolling();
  }

  const running = job?.status === "running";

  // Automatisch meescrollen naar de nieuwste regel, zodat je de voortgang
  // kan volgen zonder zelf te hoeven scrollen — net als bij een lopend
  // buildlog. Zonder dit bleef het venster (bewust vast van hoogte, zie
  // hieronder) bij de bovenkant staan terwijl nieuwe regels onderaan
  // bijkwamen.
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [job?.logs.length]);

  return (
    <details className="group card flex flex-col gap-4">
      <summary className="font-extrabold cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center justify-between">
        {t("adminReseed.title")}
        <span className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        {rich(t("adminReseed.text"), { cmd: <code>npm run db:seed</code> })}
      </p>

      <button className="btn-primary self-start" disabled={running} onClick={run}>
        {running ? t("adminCommon.busy") : t("adminReseed.title")}
      </button>

      {running && (
        <div className="flex flex-col gap-2">
          {job.progress && <p className="text-sm text-slate-600 dark:text-slate-300">{job.progress.work === "old-testament" ? "Oude Testament" : "Nieuwe Testament"} — {job.progress.language} · {job.progress.current}/{job.progress.total} hoofdstukken · {job.progress.label}</p>}
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-label="Importvoortgang" role="progressbar" aria-valuemin={0} aria-valuemax={job.progress?.total ?? 0} aria-valuenow={job.progress?.current ?? 0}>
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${job.progress ? Math.round((job.progress.current / job.progress.total) * 100) : 5}%` }} />
          </div>
        </div>
      )}

      {loadError && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{loadError}</p>}
      {job?.status === "error" && (
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">
          {job.error ?? t("adminReseed.failed")}
        </p>
      )}
      {job?.status === "done" && (
        <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">{t("adminReseed.done")}</p>
      )}

      {job && job.logs.length > 0 && (
        <pre
          ref={logBoxRef}
          className="text-xs bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-xl p-3 max-h-48 overflow-y-auto whitespace-pre-wrap"
        >
          {job.logs.join("\n")}
        </pre>
      )}
    </details>
  );
}
