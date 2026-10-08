"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import PersonalMascot, { useCompanion } from "@/components/versado/PersonalMascot";
import { KompasIcon } from "@/components/kompas/KompasIcon";
import { focusRing, primaryButton, secondaryButton } from "@/components/versado/styles";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { shellModeForRoute, isActivityRoute } from "@/lib/focusMode";
import { recordKompasState } from "@/lib/kompas/client";
import { guideMascotState } from "@/lib/kompas/mascot";
import { kompasHref, topicForPath, topicTitle } from "@/lib/kompas/registry";
import { resolveExplanation } from "@/lib/kompas/resolve";
import { shouldOffer, type KompasRow } from "@/lib/kompas/state";
import { personalMascotName } from "@/lib/mascots";

// Subtiele uitnodiging bij een onderdeel dat je voor het eerst opent: "Wil je
// zien hoe dit werkt?". Regels (docs/KOMPAS.md):
// - hoogstens één automatische uitnodiging per sessie;
// - alleen op overzichtspagina's in de gewone shell, nooit in een activiteit,
//   een spel of boven een open dialoog (dus ook nooit over een resultaatkaart
//   of viering heen, zie celebrationGate);
// - afwijzen wordt onthouden, per onderdeel en per schriftbron met eigen uitleg;
// - te stoppen met "Niet meer vragen", en uit te zetten in het profiel.
// De uitleg zelf staat altijd open via Ontdek Versado.

const SESSION_KEY = "kompas:offered";
const SHOW_DELAY_MS = 1200;

// Zonder sessionStorage (privévenster) onthoudt de pagina het in het geheugen.
let offeredInMemory = false;

function wasOfferedThisSession(): boolean {
  if (offeredInMemory) return true;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markOffered(): void {
  offeredInMemory = true;
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // alleen geheugen
  }
}

interface StateResponse {
  rows: KompasRow[];
  offersEnabled: boolean;
}

export default function ContextOffer({ work }: { work: string | null }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { character } = useCompanion();
  const [shown, setShown] = useState<{ topicId: string; scope: string } | null>(null);

  const topic = topicForPath(pathname);
  const eligible = topic !== null && shellModeForRoute(pathname) === "normal" && !isActivityRoute(pathname);

  const state = useLiveQuery<StateResponse>(["kompas", "state"], () => fetchJson<StateResponse>("/api/kompas/state"), { scopes: ["kompas"], enabled: eligible, staleTime: 60_000 });
  const rows = state.data?.rows;
  const enabled = state.data?.offersEnabled ?? false;

  const topicId = topic?.id ?? null;
  const explanation = topicId ? resolveExplanation(t, topicId, { work, character }) : null;
  const scope = explanation?.scope ?? "";
  const version = topic?.version ?? 1;
  const decision = eligible && topicId && rows
    ? shouldOffer({ rows, topicId, scope, version, enabled, offeredThisSession: false })
    : false;

  useEffect(() => {
    if (!decision || !topicId || shown || wasOfferedThisSession()) return;
    const timer = window.setTimeout(() => {
      // Pas tonen als er niets anders aandacht vraagt en de sessie nog geen uitnodiging had.
      if (wasOfferedThisSession() || document.querySelector("dialog[open], [data-kompas-tour], [aria-modal='true']")) return;
      markOffered();
      setShown({ topicId, scope });
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [decision, topicId, scope, shown]);

  // Escape wijst de uitnodiging af, zoals "Nu niet".
  const open = Boolean(shown && topic && shown.topicId === topic.id);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !shown) return;
      setShown(null);
      void recordKompasState({ topicId: shown.topicId, scope: shown.scope, kind: "GUIDE", status: "SKIPPED" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, shown]);

  if (!shown || !topic || shown.topicId !== topic.id || !explanation) return null;

  const title = topicTitle(topic, t, character);
  const guideName = personalMascotName(character);

  function dismiss(stop: boolean) {
    const current = shown;
    setShown(null);
    if (!current) return;
    void recordKompasState({ topicId: current.topicId, scope: current.scope, kind: "GUIDE", status: "SKIPPED" });
    if (stop) {
      void jsonMutation("/api/account", { method: "PATCH", json: { kompasOffersEnabled: false } }, { invalidates: "settingsChanged" }).catch(() => {});
    }
  }

  return (
    <div
      role="region"
      aria-label={t("kompas.offer.region")}
      aria-live="polite"
      className="vs-motion pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-height,4.5rem)+0.75rem)] z-30 px-4 lg:bottom-6"
    >
      <div className="vs-rise pointer-events-auto mx-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-vs-line bg-vs-elevated p-4 shadow-[0_12px_40px_-12px_rgb(var(--vs-shadow)/0.45)]">
        <div className="flex items-start gap-3">
          <div className="aspect-square w-[56px] shrink-0 vs-decor">
            <PersonalMascot state={guideMascotState(character)} size={56} fill />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-vs-fg-2">
              <KompasIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">{t("kompas.offer.about", { topic: title })}</span>
            </p>
            <p className="mt-1 text-base font-extrabold text-vs-fg">{t("kompas.offer.question")}</p>
            <p className="text-sm text-vs-fg-2">{t("kompas.offer.from", { name: guideName })}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${primaryButton} !min-h-11`}
            onClick={() => {
              const current = shown;
              setShown(null);
              if (current) router.push(kompasHref(current.topicId));
            }}
          >
            {t("kompas.offer.show")}
          </button>
          <button type="button" className={`${secondaryButton} !min-h-11`} onClick={() => dismiss(false)}>
            {t("kompas.offer.dismiss")}
          </button>
          <button type="button" className={`min-h-11 rounded-full px-3 text-sm font-bold text-vs-fg-2 underline-offset-2 hover:underline ${focusRing}`} onClick={() => dismiss(true)}>
            {t("kompas.offer.stop")}
          </button>
        </div>
      </div>
    </div>
  );
}
