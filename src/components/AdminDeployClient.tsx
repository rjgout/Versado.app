"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import { rich } from "@/lib/i18n/rich";
import AdminSection from "@/components/admin/AdminSection";
import { dangerButton } from "@/components/versado/styles";
import { useConfirm } from "@/components/ConfirmProvider";

interface DeployStatus {
  phase: "idle" | "pulling" | "stopping" | "starting" | "healthchecking" | "success" | "failed_rolled_back" | "failed_critical";
  message: string;
  updatedAt: string;
  logs: { ts: string; message: string }[];
  maintenanceOn: boolean;
  busy: boolean;
  hasRollbackTarget: boolean;
}

const BUSY_PHASES = ["pulling", "stopping", "starting", "healthchecking"];

export default function AdminDeployClient({ configured, onlineUserCount }: { configured: boolean; onlineUserCount: number }) {
  const t = useT();
  const confirm = useConfirm();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<DeployStatus | null>(null);
  // Tijdens een echte deploy/rollback stopt jehova-app zelf even helemaal —
  // en dat is precies de container waar deze pagina op draait. Een gewone
  // fetch() daarnaartoe faalt dan met een kale netwerkfout; een échte
  // paginaherlaad (i.p.v. die fout tonen) laat de proxy ervoor in plaats
  // daarvan de onderhoudspagina serveren, die zelf weer vanzelf ververst
  // zodra de nieuwe versie online is (zie deploy/nginx/maintenance.html).
  // Alleen aanzetten tijdens een bewust gestarte deploy/rollback, zodat een
  // toevallige netwerkhapering op een ander moment niet ook een onnodige
  // herlaad veroorzaakt.
  const deployInFlightRef = useRef(false);
  const transientStatusErrorsRef = useRef(0);
  const [reloadPending, setReloadPending] = useState(false);

  function scheduleReload() {
    if (reloadTimerRef.current) return;
    setReloadPending(true);
    reloadTimerRef.current = setTimeout(() => window.location.reload(), 2000);
  }

  function handleUnreachable() {
    if (deployInFlightRef.current) {
      scheduleReload();
      return;
    }
    setError(t("adminDeploy.unreachable"));
  }

  async function refresh() {
    try {
      const res = await fetch("/api/admin/deploy/status", { cache: "no-store" });
      if (!res.ok) {
        // Tijdens het wisselen van de app-container kan de proxy of de
        // deploy-agent heel kort een 502 geven. Dat is geen echte fout en
        // verdwijnt vanzelf bij de volgende poll. Vooral direct na een
        // succesvolle deploy willen we de gebruiker niet laten schrikken
        // van een tijdelijke netwerkhapering.
        if (res.status === 502 && (deployInFlightRef.current || statusRef.current?.phase === "success")) {
          transientStatusErrorsRef.current += 1;
          if (transientStatusErrorsRef.current <= 3) return;
        }
        setError((await res.json().catch(() => null))?.error ?? t("adminCommon.statusFailed"));
        return;
      }
      const data: DeployStatus = await res.json();
      transientStatusErrorsRef.current = 0;
      statusRef.current = data;
      setStatus(data);
      setError(null);
      if (!BUSY_PHASES.includes(data.phase)) deployInFlightRef.current = false;
    } catch {
      handleUnreachable();
    }
  }

  useEffect(() => {
    if (!configured) return;
    refresh();
    pollRef.current = setInterval(refresh, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  async function callAction(path: string, body?: unknown) {
    setActionBusy(true);
    setError(null);
    // Alleen een echte deploy vervangt de app-container zelf.
    const startsOutage = path === "/api/admin/deploy/start";
    if (startsOutage) deployInFlightRef.current = true;
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        if (startsOutage) deployInFlightRef.current = false;
        setError((await res.json().catch(() => null))?.error ?? t("adminDeploy.actionFailed"));
      } else if (startsOutage) {
        // De agent antwoordt zodra de deploy is aangenomen; daarna kan deze
        // container elk moment tijdelijk verdwijnen. De korte wachttijd geeft
        // de gebruiker eerst feedback en laat de proxy daarna de nieuwe app of
        // de onderhoudspagina tonen.
        scheduleReload();
      }
      await refresh();
    } catch {
      handleUnreachable();
    }
    setActionBusy(false);
  }

  if (!configured) {
    return (
      // Bovenste kaart van /adminbackend: standaard open, net als de variant hieronder.
      <AdminSection title={t("adminDeploy.title")} defaultOpen>
        <p className="text-sm text-vs-fg-2">
          {rich(t("adminDeploy.notConfigured"), {
            vars: (
              <>
                <code>DEPLOY_AGENT_URL</code>/<code>DEPLOY_AGENT_TOKEN</code>
              </>
            ),
            doc: <code>docs/DEPLOY-SYNOLOGY.md</code>,
          })}
        </p>
      </AdminSection>
    );
  }

  const isBusy = actionBusy || (status ? BUSY_PHASES.includes(status.phase) : false);

  return (
    <AdminSection title={t("adminDeploy.title")} defaultOpen tone="danger" badge={t("adminHub.dangerBadge")}>

      {status && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                status.maintenanceOn ? "bg-vs-warning" : "bg-vs-accent"
              }`}
              aria-hidden
            />
            <span className="font-bold text-sm text-vs-fg">{t(`adminDeploy.phases.${status.phase}`)}</span>
          </div>
          <p className="text-sm text-vs-fg-2">{status.message}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className={"inline-block w-3 h-3 rounded-full " + (onlineUserCount === 0 ? "bg-vs-accent" : onlineUserCount === 1 ? "bg-vs-warning" : "bg-vs-danger")}
            aria-hidden
          />
          <span className="font-bold text-sm text-vs-fg">
            {onlineUserCount === 0
              ? t("adminDeploy.nobodyOnline")
              : onlineUserCount === 1
                ? t("adminDeploy.oneOnline")
                : t("adminDeploy.manyOnline", { n: onlineUserCount })}
          </span>
        </div>
        <button
          className={dangerButton}
          disabled={isBusy}
          onClick={async () => {
            // Een deploy vervangt de app-container en maakt hem even onbereikbaar voor iedereen.
            if (await confirm(t("adminHub.deployConfirm", { n: onlineUserCount }), { destructive: true, confirmLabel: t("adminDeploy.deployNow") })) callAction("/api/admin/deploy/start");
          }}
        >
          {t("adminDeploy.deployNow")}
        </button>
      </div>
      {reloadPending && <p className="text-sm font-semibold text-vs-accent">{t("adminDeploy.reloadNotice")}</p>}
      {error && <p className="text-sm text-vs-danger">{error}</p>}

      {status && status.logs.length > 0 && (
        <div className="bg-vs-subtle rounded-lg p-3 max-h-48 overflow-y-auto text-xs font-mono text-vs-fg-2 flex flex-col gap-1">
          {status.logs
            .slice()
            .reverse()
            .map((l, i) => (
              <div key={i}>
                <span className="text-vs-fg-3">{new Date(l.ts).toLocaleTimeString(intlLocale)}</span> {l.message}
              </div>
            ))}
        </div>
      )}
    </AdminSection>
  );
}
