import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/** Vergelijkbaar met `useLiveQuery` van de webapp: laden bij openen, opnieuw bij terugkeer naar de app en bij een signaal.
 * Een nieuwere aanvraag annuleert de vorige, zodat een traag antwoord nooit een nieuwer antwoord overschrijft. */
export function useLive<T>(load: (signal: AbortSignal) => Promise<T>, subscribe?: (refresh: () => void) => () => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const loadRef = useRef(load); loadRef.current = load;
  const refresh = useCallback(async () => {
    const mine = ++seq.current; ctrl.current?.abort(); const c = ctrl.current = new AbortController();
    try { const v = await loadRef.current(c.signal); if (mine === seq.current) { setData(v); setError(null); } }
    catch (e) { if (mine === seq.current && !c.signal.aborted) setError(e instanceof Error ? e.message : "fout"); }
    finally { if (mine === seq.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", s => { if (s === "active") void refresh(); });
    const off = subscribe?.(() => void refresh());
    return () => { sub.remove(); off?.(); seq.current++; ctrl.current?.abort(); };
  }, [refresh, subscribe]);
  return { data, error, loading, refresh };
}
