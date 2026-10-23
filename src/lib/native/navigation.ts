/** Alleen daadwerkelijk lokaal geïmplementeerde routes worden geaccepteerd.
 * Breid deze grens samen met scherm, contract en tests uit, nooit als placeholder.
 */
const ROUTES = [/^\/dashboard$/, /^\/profile$/, /^\/change-password$/, /^\/reset-password$/, /^\/lesson\/[A-Za-z0-9_-]{1,128}$/, /^\/privacy$/, /^\/cookies$/, /^\/login$/, /^\/register$/, /^\/forgot-password$/];
export function nativeRoute(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s%?#]/.test(raw)) return null;
  return ROUTES.some(pattern => pattern.test(raw)) ? raw : null;
}
export function nativeDeepLink(raw: string, backendOrigin: string): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(backendOrigin).origin || url.username || url.password || url.search || url.hash) return null;
    return nativeRoute(url.pathname);
  } catch { return null; }
}
export interface NativeRouteSnapshot { href: string; index: number; revision: number; traversal: boolean }
interface RouteWindow {
  location: { hash: string };
  history: Pick<History, "state" | "replaceState" | "pushState" | "back">;
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}
/** Hashgeschiedenis voorkomt een remote paginalaad bij heropening van de lokale bundle.
 * Alleen route + positie, nooit accountgegevens of tokens in history/state.
 */
export class NativeNavigator {
  private listeners = new Set<() => void>();
  private snapshot: NativeRouteSnapshot;
  constructor(private window: RouteWindow) {
    const href = nativeRoute(window.location.hash.slice(1)) ?? "/dashboard";
    const old = window.history.state;
    const index = old?.versadoNative === 1 && old.href === href && Number.isSafeInteger(old.index) && old.index >= 0 ? old.index : 0;
    this.snapshot = { href, index, revision: 0, traversal: false };
    window.history.replaceState({ versadoNative: 1, href, index }, "", `#${href}`);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(href: string, index: number, traversal: boolean) {
    this.snapshot = { href, index, revision: this.snapshot.revision + 1, traversal };
    for (const listener of this.listeners) listener();
  }
  private onPop = () => {
    const href = nativeRoute(this.window.location.hash.slice(1)), state = this.window.history.state;
    if (href && state?.versadoNative === 1 && state.href === href && Number.isSafeInteger(state.index) && state.index >= 0) this.publish(href, state.index, true);
    else this.replace("/dashboard");
  };
  listen() { this.window.addEventListener("popstate", this.onPop); return () => this.window.removeEventListener("popstate", this.onPop); }
  push = (raw: string) => {
    const href = nativeRoute(raw); if (!href) throw new Error("native_route_unavailable");
    if (href === this.snapshot.href) return;
    const index = this.snapshot.index + 1;
    this.window.history.pushState({ versadoNative: 1, href, index }, "", `#${href}`);
    this.publish(href, index, false);
  };
  replace = (raw: string) => {
    const href = nativeRoute(raw); if (!href) throw new Error("native_route_unavailable");
    const index = this.snapshot.index;
    this.window.history.replaceState({ versadoNative: 1, href, index }, "", `#${href}`);
    this.publish(href, index, false);
  };
  back = (fallback = "/dashboard") => { if (this.snapshot.index > 0) this.window.history.back(); else this.replace(fallback); };
  refresh = () => this.publish(this.snapshot.href, this.snapshot.index, true);
  canGoBack = () => this.snapshot.index > 0;
}

/** Alleen de bestaande herstelmail van de geconfigureerde backend. Het bewijs
 * gaat uitsluitend naar werkgeheugen, nooit naar hash/history of sessieopslag. */
export function nativePasswordResetLink(raw: string, backendOrigin: string): string | null {
  if (raw.length > 2048 || /[\\\s]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(backendOrigin).origin || url.username || url.password || url.hash || url.pathname !== "/reset-password") return null;
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0][0] !== "token" || !/^[A-Za-z0-9_-]{43}$/.test(entries[0][1])) return null;
    return entries[0][1];
  } catch { return null; }
}
