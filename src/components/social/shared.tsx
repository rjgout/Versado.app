"use client";
import {applicationFetch} from "@/lib/data/applicationRuntime";


import { useEffect, useState } from "react";
import { Hand } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import SystemIcon from "@/components/versado/SystemIcon";
import { focusRing } from "@/components/versado/styles";

// Gedeelde onderdelen voor Samen (vriendenreeksen, groepen, seintjes), met
// de Versado-tokens: licht en donker vanzelf goed.

export interface Person {
  id: string;
  handle: string;
  discriminator: string;
  avatarEmoji: string | null;
}

/** POST/PATCH/DELETE naar een Samen-route; de foutmelding komt al vertaald van de server. */
export async function socialRequest(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; error: string | null; data: Record<string, unknown> }> {
  try {
    const res = await applicationFetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, error: res.ok ? null : typeof data.error === "string" ? data.error : null, data };
  } catch {
    return { ok: false, error: null, data: {} };
  }
}

export const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold";

/** Reeksgetal met de reeksvlam. */
export function StreakBadge({ days, className = "" }: { days: number; className?: string }) {
  const t = useT();
  return (
    <span className={`${chip} bg-vs-streak-soft text-vs-streak ${className}`}>
      <SystemIcon kind="streak" className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular-nums">{days === 1 ? t("together.common.daysOne") : t("together.common.daysMany", { n: days })}</span>
    </span>
  );
}

/** Voortgang van een groepsdag. Puur visueel: de tekst ernaast zegt hetzelfde in aantallen. */
export function ProgressBar({ value, max, done }: { value: number; max: number; done: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-vs-subtle" aria-hidden>
      <div className={`vs-motion h-full rounded-full transition-[width] duration-500 ${done ? "bg-vs-success" : "bg-vs-accent"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export type NudgeContext = { kind: "general" } | { kind: "friend-streak" } | { kind: "group"; groupId: string };

/**
 * "Geef een seintje": één per 6 uur per vriend (de server bewaakt dat ook).
 * Na verzenden blijft hij tot het volgende moment op "Seintje gegeven".
 */
export function NudgeButton({ recipient, context, availableAt, compact = false }: { recipient: Person; context: NudgeContext; availableAt: string | null; compact?: boolean }) {
  const t = useT();
  const [sentUntil, setSentUntil] = useState<number>(availableAt ? Date.parse(availableAt) : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => setSentUntil(availableAt ? Date.parse(availableAt) : 0), [availableAt]);
  useEffect(() => {
    if (sentUntil <= Date.now()) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(sentUntil - Date.now() + 500, 60 * 60_000));
    return () => clearTimeout(timer);
  }, [sentUntil]);
  const sent = sentUntil > Date.now();

  async function send() {
    setBusy(true);
    setError(null);
    const result = await socialRequest("/api/nudges", { recipientId: recipient.id, context });
    setBusy(false);
    if (result.ok && typeof result.data.availableAt === "string") setSentUntil(Date.parse(result.data.availableAt));
    else setError(result.error ?? t("together.common.error"));
  }

  const label = sent ? t("together.nudge.given") : t("together.nudge.give");
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={send}
        disabled={busy || sent}
        aria-label={sent ? label : t("together.nudge.giveTo", { name: recipient.handle })}
        className={`vs-motion inline-flex shrink-0 items-center gap-1.5 rounded-full border border-vs-line-strong bg-vs-surface font-bold text-vs-fg transition hover:bg-vs-subtle active:scale-[0.97] disabled:opacity-60 ${compact ? "h-9 px-3 text-xs" : "h-10 px-4 text-sm"} ${focusRing}`}
      >
        <Hand className="h-4 w-4" aria-hidden />
        <span className={compact ? "hidden sm:inline" : ""}>{label}</span>
      </button>
      {error && (
        <span role="status" className="max-w-[14rem] text-right text-xs text-vs-danger">
          {error}
        </span>
      )}
    </span>
  );
}

/** Een kop met optioneel getal, in de stijl van Vandaag. */
export function SocialHeading({ id, title, count }: { id?: string; title: string; count?: string }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 text-lg font-extrabold tracking-tight text-vs-fg">
      {title}
      {count && <span className="text-sm font-bold tabular-nums text-vs-fg-3">{count}</span>}
    </h2>
  );
}
