"use client";

import { useEffect, useSyncExternalStore } from "react";

// De terugbalk (SubpageBackBar) kijkt alleen naar het adres. Een les weet
// zelf uit welke cursus hij komt; die geeft de pagina hier door. De balk
// toont de cursusnaam dan als ondertitel, en een rechtstreeks geopende les
// gaat terug naar die cursus in plaats van naar de cursussenlijst.

export interface BackTargetOverride {
  pathname: string;
  href: string;
  parent: string;
  /** Een lokale activiteitstap kan teruggaan zonder de route te verlaten. */
  onBack?: () => void;
}

let current: BackTargetOverride | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSetBackTarget(pathname: string, href: string, parent: string, onBack?: () => void): void {
  useEffect(() => {
    const target = { pathname, href, parent, onBack };
    current = target;
    emit();
    return () => {
      if (current === target) {
        current = null;
        emit();
      }
    };
  }, [pathname, href, parent, onBack]);
}

/** Alleen de doorgegeven cursus van déze pagina: bij het wisselen van pagina geldt die niet meer. */
export function useBackTargetOverride(pathname: string): BackTargetOverride | null {
  const target = useSyncExternalStore(subscribe, () => current, () => null);
  return target && target.pathname === pathname ? target : null;
}
