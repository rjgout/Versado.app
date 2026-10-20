import { nativeTokensSchema } from "./contract";
export interface SecureSessionStore { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export type SavedSession = { refreshToken: string; actionId?: string; logoutPending?: boolean };
export class NativeClientError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
export class NativeSessionClient {
  private access: string | null = null;
  private refreshQueue: Promise<void> | null = null;
  private generation = 0;
  private store: SecureSessionStore;
  constructor(readonly baseUrl: string, store: SecureSessionStore, private transport: typeof fetch = (input, init) => fetch(input, init)) {
    let tail: Promise<unknown> = Promise.resolve();
    const run = <T>(operation: () => Promise<T>) => { const next = tail.then(operation); tail = next.catch(() => {}); return next; };
    this.store = { read: () => run(() => store.read()), write: value => run(() => store.write(value)), clear: () => run(() => store.clear()) };
  }
  private async saved(): Promise<SavedSession | null> {
    const raw = await this.store.read(); if (!raw) return null;
    try { const value = JSON.parse(raw); if (typeof value.refreshToken === "string" && value.refreshToken.length <= 128) return value; } catch {}
    await this.store.clear(); return null;
  }
  private async request<T>(path: string, body?: unknown, token?: string, method = body === undefined ? "GET" : "POST"): Promise<T> {
    let response;
    try {
      response = await this.transport(`${this.baseUrl}/api/v1/native/${path}`, { method, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "X-Versado-Client": "native-v1", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new NativeClientError("network_unavailable"); }
    let data; try { data = await response.json(); } catch { throw new NativeClientError("invalid_response", response.status); }
    if (!response.ok) throw new NativeClientError(typeof data.error === "string" ? data.error : "request_failed", response.status);
    return data as T;
  }
  async publicRequest<T>(path: string, body?: unknown) { return this.request<T>(path, body); }
  async accept(pair: { accessToken: string; refreshToken: string }, generation = this.generation) {
    pair = nativeTokensSchema.pick({ accessToken: true, refreshToken: true }).parse(pair);
    // Eerst veilig opslaan; zonder Keychain/Keystore geen ingelogde status.
    if (generation !== this.generation) {
      await this.request("logout", { refreshToken: pair.refreshToken, actionId: crypto.randomUUID() }).catch(() => {}); return;
    }
    try { await this.store.write(JSON.stringify({ refreshToken: pair.refreshToken })); }
    catch (error) { await this.request("logout", { refreshToken: pair.refreshToken, actionId: crypto.randomUUID() }).catch(() => {}); throw error; }
    if (generation === this.generation) this.access = pair.accessToken;
  }
  async login(identifier: string, password: string, code?: string) {
    const generation = ++this.generation;
    const pair = await this.request<{ accessToken: string; refreshToken: string }>("login", { identifier, password, ...(code ? { code } : {}) });
    await this.accept(pair, generation);
  }
  async restore(): Promise<boolean> {
    const saved = await this.saved();
    if (!saved) return false;
    if (saved.logoutPending) { await this.logout(); return false; }
    await this.refresh(); return !!this.access;
  }
  private async refresh() {
    if (this.refreshQueue) return this.refreshQueue;
    const generation = this.generation;
    this.refreshQueue = (async () => {
      const saved = await this.saved(); if (!saved || saved.logoutPending) throw new NativeClientError("session_expired", 401);
      const actionId = saved.actionId ?? crypto.randomUUID();
      // Ook na procesbeëindiging krijgt een onzekere refresh dezelfde actie-ID.
      await this.store.write(JSON.stringify({ ...saved, actionId }));
      try {
        const pair = await this.request<{ accessToken: string; refreshToken: string }>("refresh", { refreshToken: saved.refreshToken, actionId });
        await this.accept(pair, generation);
      } catch (error) {
        if (error instanceof NativeClientError && (error.status === 401 || error.status === 400) && generation === this.generation) { this.access = null; await this.store.clear(); }
        throw error;
      }
    })().finally(() => { this.refreshQueue = null; });
    return this.refreshQueue;
  }
  async api<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const generation = this.generation;
    if (!this.access) await this.refresh();
    try { return await this.request<T>(path, body, this.access ?? undefined, method); }
    catch (error) {
      if (!(error instanceof NativeClientError) || error.status !== 401 || error.code !== "session_expired" || generation !== this.generation) throw error;
      await this.refresh(); return this.request<T>(path, body, this.access ?? undefined, method);
    }
  }
  async logout(onCommitted?: () => void) {
    this.generation++; this.access = null;
    const saved = await this.saved(); if (!saved) { onCommitted?.(); return; }
    const pending = { ...saved, logoutPending: true, actionId: saved.actionId ?? crypto.randomUUID() };
    // De UI mag pas uitgelogd tonen nadat deze duurzame intentie bestaat.
    await this.store.write(JSON.stringify(pending));
    onCommitted?.();
    try { await this.request("logout", { refreshToken: pending.refreshToken, actionId: pending.actionId }); await this.store.clear(); }
    catch (error) { if (error instanceof NativeClientError && error.status === 401) await this.store.clear(); else throw error; }
  }
}
