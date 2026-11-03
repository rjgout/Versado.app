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

import { nativeAnnotationList, nativeAnnotationResult, nativeAnnotationMutation, nativeAnnotationContext, type NativeAnnotationList } from "@/lib/native/annotationsContract";
import type { AnnotationAction } from "@/lib/annotations/contract";
import type { NativeReader } from "@/lib/native/readerContract";
import { readerResumeSchema, readerPositionInput, readerPositionResult, type ReaderResume, type ReaderPositionInput } from "@/lib/native/readerPositionContract";
import { nativeReaderSchema, nativeReaderKind, type NativeReaderKind } from "@/lib/native/readerContract";
import { nativeStudyCourseSchema, nativeStudyStepsSchema } from "@/lib/native/studyCoursesContract";
import { nativeCoursesSchema, nativeCoursePathSchema, nativeCourseId } from "@/lib/native/coursesContract";

/** Gescheiden resources, ook wanneer een geldige cursus-ID "list" of "overview" is. */
export const nativeLearningQueryKey = (userId: string, language: string, context: { activeCollectionId: string | null; selectionVersion: number } | undefined, courseId?: string) =>
  ["courses", userId, language, context?.activeCollectionId ?? null, context?.selectionVersion ?? null, courseId ? "path" : "overview", courseId ?? null] as const;

/** Alleen transportstoringen / bekende serverfouten mogen bevestigde read-only
 * data laten staan. Autorisatie, Access-weigering en gewijzigde context nooit. */
export function nativeLearningTransientError(error: unknown): boolean {
  return error instanceof NativeClientError && (["network_unavailable", "access_network_unavailable"].includes(error.code) ||
    (["native_request_failed", "request_failed", "invalid_response"].includes(error.code) && error.status >= 500 && error.status < 600));
}

export const nativeAnnotationQueryKey = (reader: NativeReader) =>
  ["reader-annotations",reader.userId,reader.activeCollectionId,reader.selectionVersion,reader.language,reader.courseId,reader.kind,reader.targetId,reader.chapterId,reader.startVerse,reader.endVerse] as const;
function annotationPath(reader: NativeReader) {
  return `courses/${nativeCourseId.parse(reader.courseId)}/read/${nativeReaderKind.parse(reader.kind)}/${nativeCourseId.parse(reader.targetId)}/annotations`;
}

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
  private studyResponse<T extends {userId:string;activeCollectionId:string|null;selectionVersion:number;language:string}>(value:T,epoch:number,userId:string,language:string,expected:{activeCollectionId:string|null;selectionVersion:number}) {
    if(epoch!==this.epoch || value.userId!==userId)throw new NativeClientError("session_changed",409);
    const latest=this.store.getSnapshot<NativeContentState>(serializeKey(["native",epoch,...nativeContentQueryKey(userId)])).data?.picker??expected;
    if(value.activeCollectionId!==latest.activeCollectionId || value.selectionVersion!==latest.selectionVersion || value.language!==language)throw new NativeClientError("content_context_changed",409);
    return value;
  }
  async reader(userId:string,language:string,expected:{activeCollectionId:string|null;selectionVersion:number},courseId:string,kind:NativeReaderKind,targetId:string) {
    const epoch=this.epoch;
    const value=nativeReaderSchema.parse(await this.client.api(`courses/${nativeCourseId.parse(courseId)}/read/${nativeReaderKind.parse(kind)}/${nativeCourseId.parse(targetId)}`));
    if(value.courseId!==courseId||value.kind!==kind||value.targetId!==targetId)throw new NativeClientError("content_context_changed",409);
    return this.studyResponse(value,epoch,userId,language,expected);
  }
  async readerResume(userId:string,language:string,expected:{activeCollectionId:string|null;selectionVersion:number},courseId:string,kind:NativeReaderKind,targetId:string,positionEnabled:boolean):Promise<ReaderResume> {
    if(!positionEnabled)return {reader:await this.reader(userId,language,expected,courseId,kind,targetId),positionVersion:0,previous:null,next:null};
    const epoch=this.epoch;
    const value=readerResumeSchema.parse(await this.client.api(`courses/${nativeCourseId.parse(courseId)}/read/${nativeReaderKind.parse(kind)}/${nativeCourseId.parse(targetId)}/resume`));
    if(value.reader.courseId!==courseId||value.reader.kind!==kind||value.reader.targetId!==targetId)throw new NativeClientError("content_context_changed",409);
    this.studyResponse(value.reader,epoch,userId,language,expected);
    return value;
  }
  readerPositionWriter(state:ReaderResume,queryKey:QueryKey) {
    const epoch=this.epoch, reader=state.reader;
    return async (raw:ReaderPositionInput)=>{
      const input=readerPositionInput.parse(raw);
      this.studyResponse(reader,epoch,reader.userId,reader.language,reader);
      if(!this.environment.isOnline())throw new NativeClientError("network_unavailable");
      // Eerst uitsluitend lezen: een verlopen kort access-token mag via de
      // bestaande sessierotatie herstellen vóór de eenmalige schrijfaanvraag.
      // Nooit een ontvangen 401 van de POST automatisch opnieuw versturen.
      const account=await this.account();
      this.studyResponse(reader,epoch,reader.userId,reader.language,reader);
      if(account.id!==reader.userId)throw new NativeClientError("session_changed",409);
      const result=readerPositionResult.parse(await this.client.actionOnce(`courses/${reader.courseId}/read/${reader.kind}/${reader.targetId}/position`,input));
      this.studyResponse(result,epoch,reader.userId,reader.language,reader);
      if(result.courseId!==reader.courseId||result.kind!==reader.kind||result.targetId!==reader.targetId||result.actionId!==input.actionId||result.verse!==input.verse||result.version!==input.expectedVersion+1)throw new NativeClientError("invalid_response");
      // Bevestigde hervatdata beschermen tegen een oudere in-flight GET.
      this.store.setData<ReaderResume>(["native",epoch,...queryKey],previous=>previous && previous.positionVersion<=result.version ? {...previous,positionVersion:result.version,reader:{...previous.reader,focusVerse:result.verse}}:previous);
      return result;
    };
  }
  private annotationResponse(value:NativeAnnotationList,reader:NativeReader,epoch:number) {
    this.studyResponse(value,epoch,reader.userId,reader.language,reader);
    if(value.courseId!==reader.courseId||value.kind!==reader.kind||value.targetId!==reader.targetId||value.chapterId!==reader.chapterId||value.startVerse!==reader.startVerse||value.endVerse!==reader.endVerse||value.annotations.some(row=>!reader.verses.some(verse=>verse.id===row.target.verseId)))throw new NativeClientError("content_context_changed",409);
    return value;
  }
  async readerAnnotations(reader:NativeReader,verseId?:string) {
    const epoch=this.epoch;
    this.studyResponse(reader,epoch,reader.userId,reader.language,reader);
    if(verseId&&!reader.verses.some(verse=>verse.id===verseId))throw new NativeClientError("content_unavailable",404);
    const result=nativeAnnotationList.parse(await this.client.api(annotationPath(reader)+(verseId?`/${nativeCourseId.parse(verseId)}`:"")));
    this.annotationResponse(result,reader,epoch);
    if(verseId&&result.annotations.some(row=>row.target.verseId!==verseId))throw new NativeClientError("invalid_response");
    return result;
  }
  async mutateReaderAnnotation(reader:NativeReader,action:AnnotationAction,method:"PUT"|"DELETE") {
    const epoch=this.epoch;
    this.studyResponse(reader,epoch,reader.userId,reader.language,reader);
    const input=nativeAnnotationMutation.parse({operation:method==="DELETE"?"delete":"put",context:nativeAnnotationContext.parse(reader),action});
    if(input.action.target.type!=="verse")throw new NativeClientError("content_unavailable",404);
    const verseId=input.action.target.verseId;
    if(!reader.verses.some(verse=>verse.id===verseId))throw new NativeClientError("content_unavailable",404);
    if(!this.environment.isOnline())throw new NativeClientError("network_unavailable");
    const account=await this.account();
    this.studyResponse(reader,epoch,reader.userId,reader.language,reader);
    if(account.id!==reader.userId)throw new NativeClientError("session_changed",409);
    const result=nativeAnnotationResult.parse(await this.client.actionOnce(annotationPath(reader),input));
    this.annotationResponse({...result,annotations:[result.annotation],complete:true},reader,epoch);
    if(result.actionId!==input.action.actionId||result.annotation.kind!==input.action.kind||result.annotation.targetKey!==`verse:${input.action.target.verseId}`||result.annotation.mutationVersion!==input.action.expectedVersion+1||result.annotation.deleted!==(method==="DELETE"))throw new NativeClientError("invalid_response");
    // Alleen bevestigde serverdata; writeVersion beschermt tegen oudere GETs.
    this.store.setData<NativeAnnotationList>(["native",epoch,...nativeAnnotationQueryKey(reader)],old=>{
      if(!old)return old;
      const current=old.annotations.find(row=>row.kind===result.annotation.kind&&row.targetKey===result.annotation.targetKey);
      if(current&&current.mutationVersion>result.annotation.mutationVersion)return old;
      return {...old,annotations:[...old.annotations.filter(row=>row.kind!==result.annotation.kind||row.targetKey!==result.annotation.targetKey),result.annotation]};
    });
    this.store.invalidate("annotationsChanged");
    return result;
  }
  async studyCourse(userId:string,language:string,expected:{activeCollectionId:string|null;selectionVersion:number},courseId:string,scope:"weeks"|"archive") {
    const epoch=this.epoch;
    const value=nativeStudyCourseSchema.parse(await this.client.api(`courses/${nativeCourseId.parse(courseId)}/${scope}`));
    if(value.courseId!==courseId || value.scope!==scope)throw new NativeClientError("content_context_changed",409);
    return this.studyResponse(value,epoch,userId,language,expected);
  }
  async studySteps(userId:string,language:string,expected:{activeCollectionId:string|null;selectionVersion:number},courseId:string,editionId:string,revisionId:string) {
    const epoch=this.epoch;
    const value=nativeStudyStepsSchema.parse(await this.client.api(`courses/${nativeCourseId.parse(courseId)}/weeks/${nativeCourseId.parse(editionId)}/steps`));
    if(value.courseId!==courseId || value.editionId!==editionId || value.revisionId!==revisionId)throw new NativeClientError("content_context_changed",409);
    return this.studyResponse(value,epoch,userId,language,expected);
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
