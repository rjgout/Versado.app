"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { resolveShellMode, type ShellMode } from "@/lib/focusMode";

// Een Focus-route met meerdere interne stappen (Legpuzzel: catalogus, speelbord, resultaat) kiest per stap of de
// shell Immersive is. De route blijft de bron voor de modus (focusMode.ts); een scherm kan hier alleen, zolang het
// gemonteerd is, om Immersive vragen. Hetzelfde patroon als backTarget.ts: één kleine store met opruiming bij
// unmount, zodat navigeren, vervangen of sluiten van het scherm de shell altijd terugzet. Meerdere aanvragen
// tellen mee (een stapel), dus de volgorde van mounten en unmounten maakt niet uit.

const requests = new Set<symbol>();
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
export const subscribeShellModeOverride = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Vraagt Immersive aan; geeft de functie terug die de aanvraag weer intrekt. Los van React, voor tests. */
export function requestImmersiveShell(): () => void {
  const token = Symbol("immersive");
  requests.add(token); emit();
  return () => { if (requests.delete(token)) emit(); };
}

export const immersiveShellRequested = () => requests.size > 0;

/** Zolang `active` waar is en het scherm gemonteerd blijft, wil dit scherm de shell Immersive. */
export function useImmersiveShell(active = true): void {
  // Layout-effect: de shell wisselt vóór de eerste teken-pass van het bord (geen flits van de terugbalk).
  useLayoutEffect(() => (active ? requestImmersiveShell() : undefined), [active]);
}

/** De werkelijke shellmodus: de routemodus, eventueel verheven naar Immersive door het actieve scherm. */
export function useEffectiveShellMode(routeMode: ShellMode): ShellMode {
  const requested = useSyncExternalStore(subscribeShellModeOverride, immersiveShellRequested, () => false);
  return resolveShellMode(routeMode, requested);
}
