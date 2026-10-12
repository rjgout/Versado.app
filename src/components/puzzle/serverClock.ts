"use client";

import { useEffect, useState } from "react";

/**
 * Serverkloktijd voor weergave van een aftelling of lopende wedstrijdtijd. De server
 * beslist over alle tijden; dit toont alleen een tikkende klok, gebaseerd op het verschil
 * tussen de serverklok (op het moment dat een stand binnenkwam) en de toestelklok.
 * Bewust een eigen bestand zonder data-ophalen: geen verversingslogica (docs/DATA-REFRESH.md).
 */
export function useServerNow(serverNow: number, tickMs = 250): { now: number; offset: number } {
  const [state, setState] = useState({ now: serverNow, offset: 0 });
  useEffect(() => {
    const offset = serverNow - Date.now();
    const handle = window.setInterval(() => setState({ now: Date.now() + offset, offset }), tickMs);
    queueMicrotask(() => setState({ now: Date.now() + offset, offset }));
    return () => window.clearInterval(handle);
  }, [serverNow, tickMs]);
  return state;
}

/** Tikkende toestelklok (alleen weergave); gebruik met een vaste offset naar de serverklok. */
export function useTick(enabled: boolean, tickMs = 500): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const handle = window.setInterval(() => setNow(Date.now()), tickMs);
    queueMicrotask(() => setNow(Date.now()));
    return () => window.clearInterval(handle);
  }, [enabled, tickMs]);
  return now;
}
