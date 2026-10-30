"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppNavigationProvider, useAppNavigation, type AppLinkProps } from "@/components/navigation/AppNavigation";
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
  const snapshot = useSyncExternalStore(router.subscribe, router.getSnapshot);
  const positions = useRef(new Map<number, number>());
  useEffect(() => router.listen(), [router]);
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
    const target = snapshot.traversal ? positions.current.get(snapshot.index) ?? 0 : 0;
    const started = performance.now(); let frame = 0, stopped = false;
    const restore = () => {
      if (stopped) return;
      window.scrollTo({ top: Math.min(target, Math.max(0, document.documentElement.scrollHeight - innerHeight)), behavior: "instant" });
      if (performance.now() - started < 1500 && scrollY < target) frame = requestAnimationFrame(restore);
    };
    const stop = () => { stopped = true; cancelAnimationFrame(frame); };
    restore();
    window.addEventListener("touchstart", stop, { passive: true }); window.addEventListener("wheel", stop, { passive: true }); window.addEventListener("keydown", stop);
    return () => {
      positions.current.set(snapshot.index, scrollY); stop();
      window.removeEventListener("touchstart", stop); window.removeEventListener("wheel", stop); window.removeEventListener("keydown", stop);
    };
  }, [snapshot]);
  const adapter = useMemo(() => ({ pathname: snapshot.href, contentDeparture: router.contentDeparture, push: router.push, replace: router.replace, back: router.back, canGoBack: router.canGoBack, refresh: router.refresh, Link: NativeLink }), [router, snapshot]);
  return <AppNavigationProvider adapter={adapter}>{children}</AppNavigationProvider>;
}
