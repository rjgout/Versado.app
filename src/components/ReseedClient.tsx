"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";
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
  progress: { current: number; total: number; label: string; language: string; work: string } | null;
}

const POLL_MS = 1500;

export default function ReseedClient() {
  const t = useT();
  const confirm = useConfirm();
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
    // Dit raakt de live database; een tik of klik mag het nooit zomaar starten.
    if (!(await confirm(t("adminHub.reseedConfirm"), { destructive: true, confirmLabel: t("adminReseed.title") }))) return;
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
    <AdminSection title={t("adminReseed.title")} tone="danger" badge={t("adminHub.dangerBadge")}>

      <p className="text-sm text-vs-fg-2">
        {rich(t("adminReseed.text"), { cmd: <code>npm run db:seed</code> })}
      </p>

      <button className={`${dangerButton} self-start`} disabled={running} onClick={run}>
        {running ? t("adminCommon.busy") : t("adminReseed.title")}
      </button>

      {running && (
        <div className="flex flex-col gap-2">
          {job.progress && <p className="text-sm text-vs-fg-2">{job.progress.work === "old-testament" ? "Oude Testament" : "Nieuwe Testament"} — {job.progress.language} · {job.progress.current}/{job.progress.total} hoofdstukken · {job.progress.label}</p>}
          <div className="h-2 w-full overflow-hidden rounded-full bg-vs-subtle" aria-label="Importvoortgang" role="progressbar" aria-valuemin={0} aria-valuemax={job.progress?.total ?? 0} aria-valuenow={job.progress?.current ?? 0}>
            <div className="h-full rounded-full bg-vs-accent transition-all" style={{ width: `${job.progress ? Math.round((job.progress.current / job.progress.total) * 100) : 5}%` }} />
          </div>
        </div>
      )}

      {loadError && <p className="text-sm font-semibold text-vs-danger">{loadError}</p>}
      {job?.status === "error" && (
        <p className="text-sm font-semibold text-vs-danger">
          {job.error ?? t("adminReseed.failed")}
        </p>
      )}
      {job?.status === "done" && (
        <p className="text-sm font-semibold text-vs-accent">{t("adminReseed.done")}</p>
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
