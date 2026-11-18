import type { Socket } from "socket.io-client";
import type { LiveDataStore } from "./store";

/** Platformpoort voor gedeelde componenten. Web houdt fetch/cookies; de lokale
 * app installeert haar bestaande sessieclient, store en ticketverbinding. */
export interface ApplicationRuntime {
  request: typeof fetch;
  store: LiveDataStore;
  socket(): Socket;
  capture(): () => void;
  selectGameContent?(id:string,href:string):Promise<void>;
}
let runtime: ApplicationRuntime | null = null;
let native = false;
export function applicationRuntime() { return runtime; }
export function installNativeApplicationRuntime(value: ApplicationRuntime): () => void {
  native = true; runtime = value;
  return () => { if (runtime === value) runtime = null; };
}
export const applicationFetch: typeof fetch = (input, init) => {
  if(runtime){
    return runtime.request(input,init?.credentials === "same-origin" ? {...init,credentials:"omit"} : init);
  }
  if (native) return Promise.reject(new Error("native_runtime_unavailable"));
  return globalThis.fetch(input,init);
};
export function nativeApplicationInstalled() { return native; }
