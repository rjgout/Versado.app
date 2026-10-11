"use client";

import { useEffect, useState } from "react";

/** Verstreken monotone tijd: een gewijzigde toestelklok verkort de wachttijd niet. */
export function serverCountdownSeconds(until: string | null, serverNow: number, receivedAt: number, monotonicNow: number): number {
  if (!until) return 0;
  return Math.max(0, Math.ceil((Date.parse(until) - serverNow - Math.max(0, monotonicNow - receivedAt)) / 1000));
}

// Alleen een visuele klok; alle dataverversing blijft bij useLiveQuery.
export function useServerCountdown(until: string | null, serverNow: number, receivedAt: number): number {
  const [monotonicNow, setMonotonicNow] = useState(receivedAt);
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => {
      const current = performance.now();
      setMonotonicNow(current);
      if (serverCountdownSeconds(until, serverNow, receivedAt, current) === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [until, serverNow, receivedAt]);
  return serverCountdownSeconds(until, serverNow, receivedAt, monotonicNow);
}
