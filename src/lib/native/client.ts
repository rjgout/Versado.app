import { z } from "zod";
import { nativeTokensSchema, nativeSetupSchema, type NativeSecuritySetup } from "./contract";
export interface SecureSessionStore { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
const retirementSchema = z.object({ refreshToken: z.string().min(1).max(128), actionId: z.uuid(), kind: z.literal("setup").optional() }).strict();
const savedSchema = z.object({
  refreshToken: z.string().min(1).max(128), actionId: z.uuid().optional(), logoutPending: z.boolean().optional(),
  pendingRevocations: z.array(retirementSchema).max(16).optional(),
  kind: z.literal("setup").optional(),
}).strict().refine(value => !value.kind || value.logoutPending === true);
export type SavedSession = z.infer<typeof savedSchema>;
type Retirement = z.infer<typeof retirementSchema>;
export interface NativeSignInOutcome { securitySetup?: NativeSecuritySetup; recoveryCodes?: string[] }
export class NativeClientError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
function retirements(saved: SavedSession | null): Retirement[] {
  if (!saved) return [];
  return [...(saved.pendingRevocations ?? []), ...(saved.logoutPending ? [{ refreshToken: saved.refreshToken, actionId: saved.actionId ?? crypto.randomUUID(), ...(saved.kind ? { kind: saved.kind } : {}) }] : [])];
}
function pack(active: SavedSession | null, pending: Retirement[]): SavedSession | null {
  const unique = [...new Map(pending.filter(item => item.refreshToken !== active?.refreshToken).map(item => [item.refreshToken, item])).values()];
  if (active) return { refreshToken: active.refreshToken, ...(active.actionId ? { actionId: active.actionId } : {}), ...(unique.length ? { pendingRevocations: unique } : {}) };
  const [first, ...rest] = unique;
  return first ? { ...first, logoutPending: true, ...(rest.length ? { pendingRevocations: rest } : {}) } : null;
}
export class NativeSessionClient {
  private access: string | null = null;
  private refreshQueue: { generation: number; promise: Promise<void> } | null = null;
  private revocationQueue: Promise<void> | null = null;
  private storageQueue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private sessionListeners = new Set<() => void>();
  onSessionChange(listener: () => void) { this.sessionListeners.add(listener); return () => { this.sessionListeners.delete(listener); }; }
  private advanceSession(authenticating: boolean) {
    const generation = ++this.generation;
    this.access = null; this.securitySetup = null; this.authenticating = authenticating ? generation : null;
    for (const listener of this.sessionListeners) { try { listener(); } catch {} }
    return generation;
  }
  private authenticating: number | null = null;
  private securitySetup: { value: NativeSecuritySetup; generation: number } | null = null;
  constructor(readonly baseUrl: string, private store: SecureSessionStore, private transport: typeof fetch = (input, init) => fetch(input, init), readonly realtimeSupported = true) {}

  // Lees + voorwaardelijke wijziging vormen samen één transactie in deze client.
  // Een losse queue per read/write beschermt niet tegen laat bevestigde logout.
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.storageQueue.then(operation);
    this.storageQueue = next.catch(() => {});
    return next;
  }
  private async readSaved(): Promise<SavedSession | null> {
    const raw = await this.store.read(); if (!raw) return null;
    try {
      if (new TextEncoder().encode(raw).byteLength > 4096) throw new Error();
      return savedSchema.parse(JSON.parse(raw));
    } catch { await this.store.clear(); return null; }
  }
  private saved() { return this.serialized(() => this.readSaved()); }
  private edit(change: (current: SavedSession | null) => SavedSession | null): Promise<SavedSession | null> {
    return this.serialized(async () => {
      const current = await this.readSaved(), next = change(current);
      if (next === current) return current;
      if (!next) { await this.store.clear(); return null; }
      const parsed = savedSchema.safeParse(next), raw = JSON.stringify(next);
      // Dezelfde limiet als de echte Keychain/Keystore-bridge; nooit oude
      // intrekkingsintenties weggooien om een nieuwe login passend te maken.
      if (!parsed.success || new TextEncoder().encode(raw).byteLength > 4096) throw new NativeClientError("secure_storage_unavailable");
      await this.store.write(raw);
      return next;
    });
  }
  private assertGeneration(generation: number) {
    if (generation !== this.generation) throw new NativeClientError("session_changed", 409);
  }
  private async request<T>(path: string, body?: unknown, token?: string, method = body === undefined ? "GET" : "POST"): Promise<T> {
    let response;
    try {
      response = await this.transport(`${this.baseUrl}/api/v1/native/${path}`, { method, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "X-Versado-Client": "native-v1", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      if (error instanceof NativeClientError && error.code.startsWith("access_")) throw error;
      throw new NativeClientError("network_unavailable");
    }
    let data; try { data = await response.json(); } catch { throw new NativeClientError("invalid_response", response.status); }
    if (!response.ok) throw new NativeClientError(typeof data.error === "string" ? data.error : "request_failed", response.status);
    return data as T;
  }
  async publicRequest<T>(path: string, body?: unknown) { return this.request<T>(path, body); }

  // Alle providers starten hun authenticatie vóór challenge/netwerk/OS-prompts.
  // Daardoor kan ook een laat Apple-antwoord na logout geen sessie herstellen.
  async authenticate(authorize: (isCurrent: () => boolean) => Promise<unknown>): Promise<NativeSignInOutcome> {
    const generation = this.advanceSession(true);
    try { this.assertGeneration(generation); return await this.signInResult(await authorize(() => generation === this.generation && this.authenticating === generation), generation); }
    finally { if (this.authenticating === generation) this.authenticating = null; void this.flushRevocations().catch(() => {}); }
  }
  private async signInResult(value: unknown, generation: number): Promise<NativeSignInOutcome> {
    const setup = nativeSetupSchema.safeParse(value);
    if (setup.success) {
      const challenge = setup.data.securitySetup;
      // Setup mag nooit als hervatbare sessie worden opgeslagen. Duurzaam
      // bewaren we uitsluitend de intrekking bij logout/herstart. Zolang
      // deze ene geheugenflow actief is, slaat de flusher haar intentie over.
      if (generation === this.generation) this.securitySetup = { value: challenge, generation };
      try {
        await this.edit(current => {
          const active = current && !current.logoutPending ? current : null;
          const accepted = generation === this.generation;
          return pack(accepted ? null : active, [...retirements(current),
            ...(accepted && active ? [{ refreshToken: active.refreshToken, actionId: active.actionId ?? crypto.randomUUID() }] : []),
            { refreshToken: challenge.token, actionId: crypto.randomUUID(), kind: "setup" },
          ]);
        });
      } catch (error) {
        if (this.securitySetup?.value.token === challenge.token) this.securitySetup = null;
        await this.request("security-setup/cancel", { challengeToken: challenge.token }).catch(() => {});
        throw error;
      }
      this.assertGeneration(generation);
      return { securitySetup: challenge };
    }
    const extra = z.object({ recoveryCodes: z.array(z.string().min(1).max(100)).min(1).max(16).optional() }).safeParse(value);
    if (!extra.success) throw new NativeClientError("invalid_response");
    if (generation === this.generation) this.securitySetup = null;
    await this.install(value, generation);
    return extra.data;
  }
  async completeSecuritySetup(input: { newPassword?: string; code?: string }): Promise<NativeSignInOutcome> {
    const setup = this.securitySetup;
    if (!setup || setup.generation !== this.generation) throw new NativeClientError("setup_expired", 401);
    if (this.authenticating !== null) throw new NativeClientError("authentication_in_progress", 409);
    this.authenticating = setup.generation;
    try { return await this.signInResult(await this.request("security-setup/complete", { challengeToken: setup.value.token, ...input }), setup.generation); }
    finally { if (this.authenticating === setup.generation) this.authenticating = null; void this.flushRevocations().catch(() => {}); }
  }
  private async install(value: unknown, generation: number, rotation?: { refreshToken: string; actionId: string }) {
    const parsed = nativeTokensSchema.pick({ accessToken: true, refreshToken: true }).safeParse(value);
    if (!parsed.success) throw new NativeClientError("invalid_response");
    const pair = parsed.data;
    let accepted = false;
    try {
      await this.edit(current => {
        const active = current && !current.logoutPending ? current : null;
        const pending = retirements(current);
        const matchingRotation = !rotation || (active?.refreshToken === rotation.refreshToken && active.actionId === rotation.actionId);
        accepted = generation === this.generation && matchingRotation && (rotation ? this.authenticating === null : this.authenticating === generation);
        if (!accepted) return pack(active, [...pending, { refreshToken: pair.refreshToken, actionId: crypto.randomUUID() }]);
        if (!rotation && active && active.refreshToken !== pair.refreshToken) pending.push({ refreshToken: active.refreshToken, actionId: active.actionId ?? crypto.randomUUID() });
        return pack({ refreshToken: pair.refreshToken }, pending);
      });
    } catch (error) {
      // Zonder bevestigde veilige opslag mag het nieuwe paar niet bruikbaar
      // blijven. Bestaande veilige staat wordt hierbij niet blind gewist.
      await this.request("logout", { refreshToken: pair.refreshToken, actionId: crypto.randomUUID() }).catch(() => {});
      throw error;
    }
    if (generation !== this.generation && accepted) {
      // De generatie kan tijdens de native write zijn gewijzigd. Trek alleen
      // dit oude paar in; raak een inmiddels opgeslagen nieuw account niet aan.
      await this.edit(current => current?.refreshToken === pair.refreshToken && !current.logoutPending
        ? pack(null, [...retirements(current), { refreshToken: pair.refreshToken, actionId: crypto.randomUUID() }])
        : current);
      accepted = false;
    }
    if (!accepted) {
      await this.flushRevocations().catch(() => {});
      throw new NativeClientError("session_changed", 409);
    }
    this.assertGeneration(generation);
    this.access = pair.accessToken;
    // Eerdere offline intenties staan al duurzaam in dezelfde beveiligde
    // staat. Hun transport blokkeert de nieuwe accountweergave niet.
    void this.flushRevocations().catch(() => {});
  }
  async login(identifier: string, password: string, code?: string, supportsSecuritySetup = false) {
    return this.authenticate(() => this.request("login", { identifier, password, ...(code ? { code } : {}), ...(supportsSecuritySetup ? { supportsSecuritySetup: true } : {}) }));
  }
  async restore(): Promise<boolean> {
    const generation = this.generation;
    if (this.authenticating !== null) throw new NativeClientError("authentication_in_progress", 409);
    const saved = await this.saved(); this.assertGeneration(generation);
    if (!saved) return false;
    if (saved.logoutPending) { await this.flushRevocations(); this.assertGeneration(generation); return false; }
    void this.flushRevocations().catch(() => {});
    await this.refresh(); this.assertGeneration(generation); return !!this.access;
  }
  private async refresh() {
    const generation = this.generation;
    if (this.authenticating !== null) throw new NativeClientError("authentication_in_progress", 409);
    if (this.refreshQueue?.generation === generation) return this.refreshQueue.promise;
    const slot = { generation, promise: Promise.resolve() };
    slot.promise = (async () => {
      let claimed: SavedSession | null = null;
      await this.edit(current => {
        this.assertGeneration(generation);
        if (!current || current.logoutPending) throw new NativeClientError("session_expired", 401);
        claimed = { ...current, actionId: current.actionId ?? crypto.randomUUID() };
        return claimed;
      });
      const saved = claimed as SavedSession | null;
      if (!saved?.actionId) throw new NativeClientError("session_expired", 401);
      try {
        const pair = await this.request("refresh", { refreshToken: saved.refreshToken, actionId: saved.actionId });
        await this.install(pair, generation, { refreshToken: saved.refreshToken, actionId: saved.actionId });
      } catch (error) {
        if (error instanceof NativeClientError && (error.status === 401 || error.status === 400)) {
          await this.edit(current => {
            if (generation !== this.generation || current?.refreshToken !== saved.refreshToken) return current;
            this.access = null;
            return pack(null, retirements(current));
          });
        }
        throw error;
      }
    })().finally(() => { if (this.refreshQueue === slot) this.refreshQueue = null; });
    this.refreshQueue = slot;
    return slot.promise;
  }
  /** B2b writes are sent once. A 401 never refreshes/resends this write:
   * the user must explicitly restore the session and inspect server state. */
  async actionOnce<T>(path: string, body: unknown): Promise<T> {
    return this.api<T>(path, body, "POST", false);
  }
  async api<T>(path: string, body?: unknown, method?: string, retryExpired = true): Promise<T> {
    const generation = this.generation;
    if (this.authenticating !== null) throw new NativeClientError("authentication_in_progress", 409);
    if (!this.access) await this.refresh();
    this.assertGeneration(generation);
    const token = this.access;
    try {
      const data = await this.request<T>(path, body, token ?? undefined, method);
      this.assertGeneration(generation); return data;
    } catch (error) {
      this.assertGeneration(generation);
      if (!(error instanceof NativeClientError) || error.status !== 401 || error.code !== "session_expired") throw error;
      if (!retryExpired) throw error;
      await this.refresh(); this.assertGeneration(generation);
      const data = await this.request<T>(path, body, this.access ?? undefined, method);
      this.assertGeneration(generation); return data;
    }
  }
  private flushRevocations(): Promise<void> {
    if (this.revocationQueue) return this.revocationQueue;
    this.revocationQueue = (async () => {
      for (;;) {
        const pending = retirements(await this.saved()).find(item => item.kind !== "setup" || item.refreshToken !== this.securitySetup?.value.token); if (!pending) return;
        try { await this.request(pending.kind === "setup" ? "security-setup/cancel" : "logout", pending.kind === "setup" ? { challengeToken: pending.refreshToken } : pending); }
        catch (error) { if (!(error instanceof NativeClientError) || error.status !== 401) throw error; }
        await this.edit(current => pack(current && !current.logoutPending ? current : null, retirements(current).filter(item => item.refreshToken !== pending.refreshToken || item.kind !== pending.kind)));
      }
    })().finally(() => { this.revocationQueue = null; });
    return this.revocationQueue;
  }
  async logout(onCommitted?: () => void) {
    const generation = this.advanceSession(false);
    await this.edit(current => {
      if (!current) return null;
      return pack(null, [...retirements(current), ...(!current.logoutPending ? [{ refreshToken: current.refreshToken, actionId: current.actionId ?? crypto.randomUUID() }] : [])]);
    });
    if (generation === this.generation) onCommitted?.();
    await this.flushRevocations();
  }
}
