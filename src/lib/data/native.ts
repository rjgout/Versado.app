// Native adapter van dezelfde LiveDataStore als web. Geen cookiesocket,
// web-API-fallback, opslag of tweede voortgangs-/beloningssysteem.
import { nativeTodayActionResultSchema } from "@/lib/native/todayActionsContract";
import type { NativeTodayOverview } from "@/lib/native/todayContract";
import { nativeStudyMediaId, nativeStudyDataUrl } from "@/lib/native/studyMediaContract";
import { nativeTodayOverviewSchema } from "@/lib/native/todayContract";
import type { Socket } from "socket.io-client";
import { LiveDataStore, serializeKey, type LiveEnvironment, type QueryKey } from "./store";
import { DATA_EVENT_SOCKET_NAME, SOCKET_EVENT_TO_DATA_EVENT, dataEventsForSocketEvent, isDataEvent, type DataEvent, type DataScope } from "./scopes";
import { nativeAccountSchema, nativeTodaySchema, nativeChapterSchema, nativeContentStateSchema, nativeContentResultSchema, nativeContentSelectionSchema, type NativeContentState, type NativeContentSelection } from "@/lib/native/contract";
import { NativeClientError, type NativeSessionClient } from "@/lib/native/client";

import { nativeCoursesSchema, nativeCoursePathSchema, nativeCourseId } from "@/lib/native/coursesContract";

export const nativeContentQueryKey = (userId: string | null) => ["content-context", userId] as const;

export const nativeTodayQueryKey = (state: Pick<NativeTodayOverview, "userId" | "activeCollectionId" | "selectionVersion" | "language">) =>
  ["today-overview", state.userId, `${state.activeCollectionId}:${state.selectionVersion}`, state.language] as const;

export class NativeDataRuntime {
  readonly store: LiveDataStore;
  private epoch = 0;
  private pendingTodayActions = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(readonly client: NativeSessionClient, private readonly environment: LiveEnvironment) { this.store = new LiveDataStore(environment); }
  getSnapshot = () => this.epoch;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  reset = () => { this.epoch++; this.store.reset(); for (const listener of this.listeners) listener(); };
  async account() { return nativeAccountSchema.parse(await this.client.api("me")); }
  async learning(userId: string, expected: { activeCollectionId: string | null; selectionVersion: number }, courseId?: string) {
    const epoch = this.epoch;
    const path = courseId ? `courses/${nativeCourseId.parse(courseId)}/path` : "courses";
    const response = await this.client.api(path);
    const result = courseId ? nativeCoursePathSchema.parse(response) : nativeCoursesSchema.parse(response);
    if (epoch !== this.epoch || result.userId !== userId) throw new NativeClientError("session_changed",409);
    const latest = this.store.getSnapshot<NativeContentState>(serializeKey(["native",epoch,...nativeContentQueryKey(userId)])).data?.picker ?? expected;
    if (result.activeCollectionId !== latest.activeCollectionId || result.selectionVersion !== latest.selectionVersion || (courseId && (!("courseId" in result) || result.courseId !== courseId))) throw new NativeClientError("content_context_changed",409);
    return result;
  }
  async today() { return nativeTodaySchema.parse(await this.client.api("today")); }
  async todayOverview(userId: string, context: { activeCollectionId: string | null; selectionVersion: number }) {
    const epoch = this.epoch;
    const result = nativeTodayOverviewSchema.parse(await this.client.api("today-overview"));
    if (epoch !== this.epoch || result.userId !== userId) throw new NativeClientError("session_changed", 409);
    const current = this.store.getSnapshot<NativeContentState>(serializeKey(["native", epoch, ...nativeContentQueryKey(userId)])).data;
    const expected = current?.picker ?? context;
    if (result.activeCollectionId !== expected.activeCollectionId || result.selectionVersion !== expected.selectionVersion) throw new NativeClientError("content_context_changed", 409);
    return result;
  }
  /** Alleen in-flight uitsluiting, geen offline wachtrij of voortgangscache.
   * De port legt de epoch bij render vast; een oude klik kan nooit als B schrijven.
   */
  todayActions(state: NativeTodayOverview, queryKey: QueryKey = nativeTodayQueryKey(state)) {
    const epoch = this.epoch;
    const run = async (path: "hide" | "friend-response", input: { itemKey: string } | { friendshipId: string; action: "accept" | "decline" }) => {
      if (epoch !== this.epoch) throw new NativeClientError("session_changed", 409);
      if (!this.environment.isOnline()) throw new NativeClientError("network_unavailable");
      const identity = `${epoch}:${"itemKey" in input ? input.itemKey : input.friendshipId}`;
      if (this.pendingTodayActions.has(identity)) throw new NativeClientError("action_in_progress", 409);
      this.pendingTodayActions.add(identity);
      try {
        const result = nativeTodayActionResultSchema.parse(await this.client.actionOnce(`today-actions/${path}`, input));
        if (epoch !== this.epoch || result.userId !== state.userId) throw new NativeClientError("session_changed", 409);
        const outcome = result.outcome;
        if ("itemKey" in input ? outcome.kind !== "hidden" || outcome.itemKey !== input.itemKey
          : outcome.kind !== "friend-response" || outcome.friendshipId !== input.friendshipId || outcome.status !== (input.action === "accept" ? "accepted" : "declined")) throw new NativeClientError("invalid_response");
        // Alleen bevestigde resultaten projecteren in dezelfde store. writeVersion
        // blokkeert oudere GETs, ook als de volgende herlaadactie mislukt.
        this.store.setData<NativeTodayOverview>(["native", epoch, ...queryKey], previous => {
          if (!previous || previous.userId !== result.userId) return previous;
          if (outcome.kind === "hidden") return { ...previous, data: { ...previous.data, continueItems: previous.data.continueItems.filter(item => item.visibilityKey !== outcome.itemKey) } };
          const actions = previous.data.actions.filter(action => action.kind !== "friend-request" || action.actionId !== outcome.friendshipId);
          return { ...previous, data: { ...previous.data, actions, actionTotal: Math.max(0, previous.data.actionTotal - (previous.data.actions.length - actions.length)) } };
        });
        this.store.invalidate(outcome.kind === "hidden" ? ["today"] : "friendsChanged");
      } catch (error) {
        // Een elders verwerkt/verwijderd verzoek is geen nieuwe succesvolle actie.
        // Alleen lezen verversen, nooit een write herhalen of een uitslag verzinnen.
        if (epoch === this.epoch && error instanceof NativeClientError && [404, 409].includes(error.status)) this.store.invalidate(["today", "friends"]);
        throw error;
      } finally { this.pendingTodayActions.delete(identity); }
    };
    return {
      hideContinue: (item: { visibilityKey: string }) => run("hide", { itemKey: item.visibilityKey }),
      respondFriend: (friendshipId: string, action: "accept" | "decline") => run("friend-response", { friendshipId, action }),
    };
  }
  async studyImage(mediaId: string, expected: { userId: string; activeCollectionId: string | null; selectionVersion: number }) {
    const id = nativeStudyMediaId.parse(mediaId), epoch = this.epoch, requestedAt = this.environment.now();
    const checkContext = () => {
      if (epoch !== this.epoch) throw new NativeClientError("session_changed", 409);
      const current = this.store.getSnapshot<NativeContentState>(serializeKey(["native", epoch, ...nativeContentQueryKey(expected.userId)])).data;
      if (!current || current.userId !== expected.userId || current.picker.activeCollectionId !== expected.activeCollectionId || current.picker.selectionVersion !== expected.selectionVersion) throw new NativeClientError("content_context_changed", 409);
    };
    checkContext();
    const value = await nativeStudyDataUrl(await this.client.api(`study-media/${id}`));
    checkContext();
    if (value.userId !== expected.userId || value.mediaId !== id || value.selectionVersion !== expected.selectionVersion) throw new NativeClientError("content_context_changed", 409);
    const validUntil = requestedAt + Date.parse(value.expiresAt) - value.serverNow;
    if (this.environment.now() >= validUntil) throw new NativeClientError("media_expired", 409);
    return { ...value, validUntil };
  }
  async contentContext(userId: string) {
    const epoch = this.epoch;
    const state = nativeContentStateSchema.parse(await this.client.api("content-context"));
    if (state.userId !== userId || epoch !== this.epoch) throw new NativeClientError("session_changed", 409);
    // Een GET van vóór een bevestigde keuze mag de bestaande gedeelde cache
    // nooit terugzetten. Geen tweede cache: lees uitsluitend de actieve store-entry.
    const current = this.store.getSnapshot<NativeContentState>(serializeKey(["native", epoch, ...nativeContentQueryKey(userId)])).data;
    if (current && state.picker.selectionVersion >= current.picker.selectionVersion && (current.picker.selectionVersion !== state.picker.selectionVersion || current.picker.activeCollectionId !== state.picker.activeCollectionId)) this.store.invalidate(["studyContent"]);
    return current?.userId === userId && current.picker.selectionVersion > state.picker.selectionVersion ? current : state;
  }
  async selectContent(userId: string, input: NativeContentSelection) {
    return this.mutation(async () => {
      const result = nativeContentResultSchema.parse(await this.client.api("content-context", nativeContentSelectionSchema.parse(input)));
      if (result.state.userId !== userId) throw new NativeClientError("session_changed", 409);
      return result;
    }, "contentChanged");
  }
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
    listen(target, "offline", () => this.store.invalidate(["studyContent"]));
    listen(target, "focus", () => this.store.revalidate());
    let stopped = false, cancelTick: (() => void) | undefined;
    const scheduleTick = () => {
      cancelTick?.(); cancelTick = undefined;
      if (!stopped && page.visibilityState !== "hidden") cancelTick = this.environment.schedule(() => { this.store.tick(); scheduleTick(); }, 1000);
    };
    listen(page, "visibilitychange", () => { scheduleTick(); if (page.visibilityState === "visible") this.store.revalidate(); });
    scheduleTick();
    listen(target, "versado:app-resumed", this.resume);
    return () => { stopped = true; cancelTick?.(); for (const stop of cleanups) stop(); this.reset(); };
  }
}
