"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppNavigationProvider, useAppNavigation, type AppLinkProps } from "@/components/navigation/AppNavigation";
import { currentEntryKey } from "@/lib/navigationEntry";
import { beginScrollEntry, noteScrollInteraction, registerScrollRestorer } from "@/lib/scrollRestore";
import { NativeNavigator, nativeRoute } from "@/lib/native/navigation";
import { openExternalUrl } from "@/lib/platform";

function NativeLink({ href, replace, onClick, onNavigate, prefetch, ...props }: AppLinkProps) {
  void prefetch;
  const navigation = useAppNavigation(), internal = nativeRoute(href);
  let external = false;
  try { external = new URL(href).protocol === "https:"; } catch {}
  return <a {...props} href={internal ? `#${internal}` : external ? href : undefined} aria-disabled={!internal && !external ? true : props["aria-disabled"]} onClick={event => {
    onClick?.(event); if (event.defaultPrevented) return;
    if (external) { event.preventDefault(); void openExternalUrl(href); return; }
    if (!internal || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === "_blank" || props.download) return;
    event.preventDefault(); let cancelled = false; onNavigate?.({ preventDefault: () => { cancelled = true; } }); if (cancelled) return; if (replace) navigation.replace(internal); else navigation.push(internal);
  }} />;
}

/** Alleen lokaal gebruikt; bevat geen Next-import of browseropslag. */
export default function NativeNavigationProvider({ children }: { children: ReactNode }) {
  const [router] = useState(() => new NativeNavigator(window));
  const positions = useRef(new Map<number, number>());
  const subscribe = useCallback((notify: () => void) => {
    let previous = router.getSnapshot();
    return router.subscribe(() => {
      // Vóór React de oude DOM vervangt: een kortere pagina/shell kan scrollY al
      // begrenzen voordat de layout-effectcleanup van die oude route draait.
      positions.current.set(previous.index, window.scrollY);
      previous = router.getSnapshot();
      notify();
    });
  }, [router]);
  const snapshot = useSyncExternalStore(subscribe, router.getSnapshot);
  useEffect(() => router.listen(), [router]);
  useLayoutEffect(() => {
    beginScrollEntry(currentEntryKey(), snapshot.traversal);
    let frame = 0;
    const unregister = registerScrollRestorer(target => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const top = target(); if (top !== null) window.scrollTo({top,behavior:"instant"}); }); });
    const interact = () => { cancelAnimationFrame(frame); noteScrollInteraction(); };
    for (const name of ["pointerdown","keydown","wheel","touchstart"]) window.addEventListener(name,interact,{passive:true});
    return () => { unregister(); cancelAnimationFrame(frame); for (const name of ["pointerdown","keydown","wheel","touchstart"]) window.removeEventListener(name,interact); };
  }, [snapshot]);
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  useLayoutEffect(() => {
    const previous = history.scrollRestoration; history.scrollRestoration = "manual";
    return () => { history.scrollRestoration = previous; };
  }, []);
  useLayoutEffect(() => {
    // Nieuwe routes beginnen eenmaal bovenaan. Een lees-/ankerscroll van de pagina
    // daarna heeft voorrang; alleen terug/vooruit vereist gevolgd positieherstel.
    if (!snapshot.traversal) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
    const target = snapshot.traversal ? positions.current.get(snapshot.index) ?? 0 : 0;
    const root = document.documentElement, previousAnchor = root.style.overflowAnchor;
    const started = performance.now(); let frame = 0, stopped = false, lastHeight = -1, stableSince = started;
    const stop = () => { stopped = true; cancelAnimationFrame(frame); root.style.overflowAnchor = previousAnchor; };
    const restore = () => {
      if (stopped) return;
      const now = performance.now(), height = root.scrollHeight;
      if (height !== lastHeight) { lastHeight = height; stableSince = now; }
      const top = Math.min(target, Math.max(0, height - innerHeight));
      if (Math.abs(scrollY - top) > 1) window.scrollTo({ top, behavior: "instant" });
      // Net als de webshell: ook na het eerste bereiken even blijven volgen.
      // Late header-/inhoudmetingen en browseranchoring mogen leesherstel niet verschuiven.
      if ((top >= target && now - stableSince > 500) || now - started >= 1500) { stop(); return; }
      frame = requestAnimationFrame(restore);
    };
    root.style.overflowAnchor = "none";
    restore();
    window.addEventListener("touchstart", stop, { passive: true }); window.addEventListener("wheel", stop, { passive: true }); window.addEventListener("keydown", stop); window.addEventListener("pointerdown", stop, { passive: true });
    return () => {
      stop();
      window.removeEventListener("touchstart", stop); window.removeEventListener("wheel", stop); window.removeEventListener("keydown", stop); window.removeEventListener("pointerdown", stop);
    };
  }, [snapshot]);
  const adapter = useMemo(() => ({ pathname: snapshot.href, contentDeparture: router.contentDeparture, push: router.push, replace: router.replace, back: router.back, canGoBack: router.canGoBack, refresh: router.refresh, Link: NativeLink }), [router, snapshot]);
  return <AppNavigationProvider adapter={adapter}>{children}</AppNavigationProvider>;
}
