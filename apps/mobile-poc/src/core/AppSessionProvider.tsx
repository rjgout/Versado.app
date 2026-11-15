import "@poc/core/polyfills";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createAppSession, type AppSession } from "@poc/core/session";
import { secureSessionStore } from "@poc/core/secureStore";

export type Phase = "booting" | "signedOut" | "signedIn";
interface Ctx { session: AppSession; phase: Phase; userId: string | null; epoch: number; signIn(id: string, pw: string): Promise<void>; signOut(): Promise<void> }
const SessionContext = createContext<Ctx | null>(null);
const BASE_URL = process.env.EXPO_PUBLIC_VERSADO_API_URL ?? "http://127.0.0.1:3100";

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const session = useMemo(() => createAppSession(BASE_URL, secureSessionStore), []);
  const [phase, setPhase] = useState<Phase>("booting");
  const [userId, setUserId] = useState<string | null>(null);
  // `epoch` verandert bij elke sessiewissel; schermen gebruiken het als key zodat state nooit meeverhuist naar een ander account.
  const [epoch, setEpoch] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => session.client.onSessionChange(() => setEpoch(e => e + 1)), [session]);
  useEffect(() => {
    (async () => {
      try {
        if (await session.client.restore()) { const t = await session.today(); if (alive.current) { setUserId(t.userId); setPhase("signedIn"); } return; }
      } catch { /* verlopen of offline: terug naar inloggen */ }
      if (alive.current) setPhase("signedOut");
    })();
  }, [session]);
  const signIn = useCallback(async (id: string, pw: string) => { await session.signIn(id, pw); setUserId(session.actor()!.id); setPhase("signedIn"); }, [session]);
  const signOut = useCallback(async () => { setPhase("signedOut"); setUserId(null); await session.signOut(); }, [session]);
  const value = useMemo(() => ({ session, phase, userId, epoch, signIn, signOut }), [session, phase, userId, epoch, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useAppSession() { const c = useContext(SessionContext); if (!c) throw new Error("AppSessionProvider ontbreekt"); return c; }
