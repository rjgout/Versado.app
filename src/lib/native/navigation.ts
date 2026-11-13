import { parseProfileView } from "@/lib/profileViews";
/** Alleen daadwerkelijk lokaal geïmplementeerde routes worden geaccepteerd.
 * Breid deze grens samen met scherm, contract en tests uit, nooit als placeholder.
 */
const ROUTES = [/^\/courses\/[A-Za-z0-9_-]{1,128}\/read\/(?:steps|chapters)\/[A-Za-z0-9_-]{1,128}$/, /^\/courses$/, /^\/courses\/[A-Za-z0-9_-]{1,128}(?:\/(?:pad|archief))?$/, /^\/content$/, /^\/diagnostics$/, /^\/dashboard$/, /^\/profile(?:\/avatar)?$/, /^\/account-verwijderen$/, /^\/change-password$/, /^\/reset-password$/, /^\/verify-email$/, /^\/lesson\/[A-Za-z0-9_-]{1,128}$/, /^\/privacy$/, /^\/cookies$/, /^\/disclaimer$/, /^\/contact$/, /^\/login$/, /^\/register$/, /^\/forgot-password$/];
export function nativeRoute(raw: string): string | null {
  const profile = /^\/profile\?view=([A-Za-z]+)$/.exec(raw);
  if (profile) return parseProfileView(profile[1]) ? raw : null;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s%?#]/.test(raw)) return null;
  return ROUTES.some(pattern => pattern.test(raw)) ? raw : null;
}
export function nativeDeepLink(raw: string, backendOrigin: string): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(backendOrigin).origin || url.username || url.password || url.hash) return null;
    return url.pathname === "/diagnostics" ? null : nativeRoute(url.pathname + url.search);
  } catch { return null; }
}
export interface NativeRouteSnapshot { href: string; index: number; revision: number; traversal: boolean }
interface RouteWindow {
  location: { hash: string };
  history: Pick<History, "state" | "replaceState" | "pushState" | "back"> & Partial<Pick<History,"go">>;
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}
/** Hashgeschiedenis voorkomt een remote paginalaad bij heropening van de lokale bundle.
 * Alleen route + positie, nooit accountgegevens of tokens in history/state.
 */
export class NativeNavigator {
  private listeners = new Set<() => void>();
  private guards=new Set<(proceed:()=>void)=>boolean>();
  private skipPop=false;
  private restoringIndex:number|null=null;
  registerNavigationGuard=(guard:(proceed:()=>void)=>boolean)=>{this.guards.add(guard);return()=>{this.guards.delete(guard);};};
  private allowed(proceed:()=>void,href?:string) { return href==="/login" || [...this.guards].every(guard=>guard(proceed)); }
  private departure = "/dashboard";
  contentDeparture = () => this.departure;
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
    if (href && state?.versadoNative === 1 && state.href === href && Number.isSafeInteger(state.index) && state.index >= 0) {
      if(this.restoringIndex===state.index){this.restoringIndex=null;return;}
      if(this.skipPop){this.skipPop=false;this.publish(href,state.index,true);return;}
      const delta=state.index-this.snapshot.index;
      if(delta && this.window.history.go && !this.allowed(()=>{this.skipPop=true;this.window.history.go!(delta);})){this.restoringIndex=this.snapshot.index;this.window.history.go(-delta);return;}
      this.publish(href,state.index,true);
    } else {this.skipPop=false;this.navigate("/dashboard",true,true);}
  };
  listen() { this.window.addEventListener("popstate", this.onPop); return () => this.window.removeEventListener("popstate", this.onPop); }
  private navigate(raw:string,replace:boolean,unguarded=false) {
    const href=nativeRoute(raw);if(!href)throw new Error("native_route_unavailable");
    if(!replace&&href===this.snapshot.href)return;
    const proceed=()=>{
      if(href==="/content"&&this.snapshot.href!=="/content")this.departure=this.snapshot.href;
      if(["/login","/register","/forgot-password"].includes(href))this.departure="/dashboard";
      const index=this.snapshot.index+(replace?0:1),state={versadoNative:1,href,index};
      if(replace)this.window.history.replaceState(state,"",`#${href}`);else this.window.history.pushState(state,"",`#${href}`);
      this.publish(href,index,false);
    };
    if(unguarded||this.allowed(proceed,href))proceed();
  }
  push=(raw:string)=>this.navigate(raw,false);
  replace=(raw:string)=>this.navigate(raw,true);
  back=(fallback="/dashboard")=>{
    const proceed=()=>{if(this.snapshot.index>0){this.skipPop=true;this.window.history.back();}else this.navigate(fallback,true,true);};
    if(this.allowed(proceed))proceed();
  };
  refresh = () => this.publish(this.snapshot.href, this.snapshot.index, true);
  canGoBack = () => this.snapshot.index > 0;
}

/** Alleen de bestaande herstelmail van de geconfigureerde backend. Het bewijs
 * gaat uitsluitend naar werkgeheugen, nooit naar hash/history of sessieopslag. */
function nativeMailToken(raw: string, backendOrigin: string, pathname: string): string | null {
  if (raw.length > 2048 || /[\\\s]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== new URL(backendOrigin).origin || url.username || url.password || url.hash || url.pathname !== pathname) return null;
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0][0] !== "token" || !/^[A-Za-z0-9_-]{43}$/.test(entries[0][1])) return null;
    return entries[0][1];
  } catch { return null; }
}

export function nativePasswordResetLink(raw: string, backendOrigin: string) { return nativeMailToken(raw, backendOrigin, "/reset-password"); }
export function nativeEmailConfirmationLink(raw: string, backendOrigin: string) { return nativeMailToken(raw, backendOrigin, "/verify-email"); }
