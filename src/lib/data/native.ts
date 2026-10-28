// Native adapter van dezelfde LiveDataStore als web. Geen cookiesocket,
// web-API-fallback, opslag of tweede voortgangs-/beloningssysteem.
import type { Socket } from "socket.io-client";
import { LiveDataStore, type LiveEnvironment } from "./store";
import { DATA_EVENT_SOCKET_NAME, SOCKET_EVENT_TO_DATA_EVENT, dataEventsForSocketEvent, isDataEvent, type DataEvent, type DataScope } from "./scopes";
import { nativeAccountSchema, nativeTodaySchema, nativeChapterSchema } from "@/lib/native/contract";
import { NativeClientError, type NativeSessionClient } from "@/lib/native/client";

export class NativeDataRuntime {
  readonly store: LiveDataStore;
  private epoch = 0;
  private listeners = new Set<() => void>();
  constructor(readonly client: NativeSessionClient, environment: LiveEnvironment) { this.store = new LiveDataStore(environment); }
  getSnapshot = () => this.epoch;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  reset = () => { this.epoch++; this.store.reset(); for (const listener of this.listeners) listener(); };
  async account() { return nativeAccountSchema.parse(await this.client.api("me")); }
  async today() { return nativeTodaySchema.parse(await this.client.api("today")); }
  async chapter(id: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new NativeClientError("invalid_input", 400);
    const chapter = nativeChapterSchema.parse(await this.client.api(`chapters/${encodeURIComponent(id)}`));
    if (chapter.id !== id) throw new NativeClientError("invalid_response");
    return chapter;
  }
  async mutation<T>(run: () => Promise<T>, invalidates: DataEvent | readonly DataScope[]): Promise<T> {
    const epoch = this.epoch;
    const result = await run();
    if (epoch !== this.epoch) throw new NativeClientError("session_changed", 409);
    this.store.invalidate(invalidates);
    return result;
  }
  resume = () => this.store.revalidate({ force: true });
  /** Alleen de reeds met eenmalig bewijs geauthenticeerde native socket. */
  attachSocket(socket: Pick<Socket, "on" | "off">) {
    const cleanups: (() => void)[] = [];
    const listen = (name: string, handler: (...args: unknown[]) => void) => { socket.on(name, handler); cleanups.push(() => { socket.off(name, handler); }); };
    listen("connect", this.resume);
    listen(DATA_EVENT_SOCKET_NAME, (payload: unknown) => {
      const event = (payload as { event?: unknown } | null)?.event;
      if (isDataEvent(event)) this.store.invalidate(event, { jitterMs: 1500 });
    });
    for (const name of Object.keys(SOCKET_EVENT_TO_DATA_EVENT) as (keyof typeof SOCKET_EVENT_TO_DATA_EVENT)[]) listen(name, () => {
      for (const event of dataEventsForSocketEvent(name)) this.store.invalidate(event, { jitterMs: 1500 });
    });
    return () => { for (const stop of cleanups) stop(); };
  }
  start(target: Window, page: Document) {
    const cleanups = [this.client.onSessionChange(this.reset)];
    const listen = (source: Window | Document, name: string, handler: () => void) => { source.addEventListener(name, handler); cleanups.push(() => source.removeEventListener(name, handler)); };
    listen(target, "online", this.resume);
    listen(target, "focus", () => this.store.revalidate());
    listen(page, "visibilitychange", () => { if (page.visibilityState === "visible") this.store.revalidate(); });
    listen(target, "versado:app-resumed", this.resume);
    return () => { for (const stop of cleanups) stop(); this.reset(); };
  }
}
