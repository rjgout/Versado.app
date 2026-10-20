"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HANDLE_MAX_LENGTH } from "@/lib/handle";
import { ArrowLeft, LogOut, WifiOff } from "lucide-react";
import MascotSlot from "@/components/versado/MascotSlot";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { primaryButton, secondaryButton } from "@/components/versado/styles";
import { dismissNativeKeyboard, isIOSApp, lightHaptic, nativeAppleAuthorization, openExternalUrl, startNativeFoundationRuntime } from "@/lib/platform";
import { nativeAccountSchema, nativeTodaySchema, nativeChapterSchema, type NativeAccount, type NativeChapter } from "@/lib/native/contract";
import { NativeClientError, type NativeSessionClient } from "@/lib/native/client";

type Account = NativeAccount;
type Chapter = NativeChapter;
export default function NativeFoundation({ client, termsUrl = null, onLanguage }: { client: NativeSessionClient; termsUrl?: string | null; onLanguage?: (language: string) => void }) {
  const t = useT(), uiLanguage = useUiLanguage();
  const [user, setUser] = useState<Account | null>(null), [activity, setActivity] = useState<{ id: string; title: string } | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null), [profile, setProfile] = useState(false), [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [identifier, setIdentifier] = useState(""), [password, setPassword] = useState(""), [code, setCode] = useState(""), [handle, setHandle] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(false), [busy, setBusy] = useState(false), [offline, setOffline] = useState(false), [apple, setApple] = useState(false), [saved, setSaved] = useState(false);
  const sequence = useRef(0), current = useRef({ chapter, profile, busy });
  useEffect(() => { current.current = { chapter, profile, busy }; }, [chapter, profile, busy]);
  useEffect(() => { if (user?.uiLanguage) onLanguage?.(user.uiLanguage); }, [user?.uiLanguage, onLanguage]);
  useEffect(() => { document.querySelector<HTMLElement>("h1")?.focus(); }, [chapter?.id, profile, user?.id]);
  const report = useCallback((err: unknown) => {
    const key = err instanceof NativeClientError ? err.code : "request_failed";
    const mapping = { wrong_credentials: "wrongCredentials", two_factor_required: "twoFactorRequired", sign_in_then_link_apple: "appleConflict", alternative_login_required: "alternativeRequired", network_unavailable: "offline", session_expired: "sessionExpired", secure_storage_unavailable: "storageUnavailable" } as const;
    setError(t(`nativeFoundation.${mapping[key as keyof typeof mapping] ?? "error"}`));
    if (key === "network_unavailable") setOffline(true);
    if (err instanceof NativeClientError && err.status === 401 && key !== "two_factor_required" && key !== "wrong_credentials") { setUser(null); setChapter(null); setProfile(false); }
  }, [t]);
  const load = useCallback(async () => {
    const [me, today] = await Promise.all([client.api<Account>("me"), client.api<{ activity: typeof activity }>("today")]);
    return { me: nativeAccountSchema.parse(me), today: nativeTodaySchema.parse(today) };
  }, [client]);
  const bootstrap = useCallback(async () => {
    const id = ++sequence.current; setBusy(true); setError("");
    try {
      const capabilities = await client.publicRequest<{ apple: boolean }>("capabilities");
      if (id !== sequence.current) return;
      setApple(capabilities.apple && isIOSApp());
      if (await client.restore()) {
        const data = await load(); if (id !== sequence.current) return; setUser(data.me); setActivity(data.today.activity);
      } else { setUser(null); setChapter(null); }
      setOffline(false);
    } catch (err) { if (id === sequence.current) report(err); }
    finally { if (id === sequence.current) setBusy(false); }
  }, [client, load, report]);
  useEffect(() => {
    void Promise.resolve().then(bootstrap);
    const online = () => { if (!current.current.busy) void bootstrap(); }, offline = () => setOffline(true);
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    const invalidate = () => { sequence.current++; };
    let disposed = false, cleanup: (() => void) | undefined;
    void startNativeFoundationRuntime({ onResume: online, onBack: () => { if (current.current.busy) return true; if (current.current.chapter || current.current.profile) { sequence.current++; setChapter(null); setProfile(false); return true; } return false; }, onUrl: raw => {
      try {
        const url = new URL(raw); if (url.origin !== new URL(client.baseUrl).origin) return;
        if (url.pathname === "/dashboard") { sequence.current++; setChapter(null); setProfile(false); }
        // Andere deeplinks pas na migratie van het betreffende contract.
      } catch {}
    } }).then(stop => { if (disposed) stop(); else cleanup = stop; }).catch(() => {});
    return () => { disposed = true; invalidate(); cleanup?.(); window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [bootstrap, client]);
  async function action(run: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return;
    const id = ++sequence.current; setBusy(true); setError(""); setNotice(false);
    try { await run(() => id === sequence.current); if (id === sequence.current) setOffline(false); }
    catch (err) { if (id === sequence.current) report(err); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  async function signInApple(link = false, isCurrent: () => boolean = () => true) {
    const challenge = link ? await client.api<{ id: string; nonce: string; state: string }>("apple/challenge", { intent: "link", password, ...(code ? { code } : {}) })
      : await client.publicRequest<{ id: string; nonce: string; state: string }>("apple/challenge", { intent: "signin" });
    const result = await nativeAppleAuthorization(challenge.nonce, challenge.state);
    const input = { uiLanguage, challengeId: challenge.id, identityToken: result.identityToken, state: result.state, ...(result.displayName ? { displayName: result.displayName } : {}), ...(code ? { code } : {}) };
    if (link) await client.api("apple/complete", input);
    else await client.accept(await client.publicRequest("apple/complete", input));
    const data = await load(); if (!isCurrent()) return; setUser(data.me); setActivity(data.today.activity); setPassword("");
  }
  const button = `${secondaryButton} min-h-12 whitespace-normal`;
  return <main className="native-foundation mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 bg-vs-bg p-5 text-vs-fg">
    <header className="flex flex-wrap items-center gap-3">
      {/* Bestaand appicoon, geen nieuwe merkasset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-512.png" width="44" height="44" alt="" />
      <span className="text-xl font-extrabold">Versado</span>
      {user && <button type="button" disabled={busy} className={`${button} ml-auto`} onClick={() => { sequence.current++; setUser(null); setChapter(null); setProfile(false); void action(() => client.logout()); }}><LogOut className="h-4 w-4" />{t("nativeFoundation.logout")}</button>}
    </header>
    {offline && <p role="status" className="flex gap-2 rounded-xl bg-vs-surface p-3"><WifiOff className="h-5 w-5 shrink-0" />{t("nativeFoundation.offline")}</p>}
    {error && <p role="alert" className="rounded-xl border border-vs-line bg-vs-surface p-3">{error}</p>}
    {busy && <p role="status">{t("nativeFoundation.loading")}</p>}
    {!user ? <>
      <MascotSlot character="novi" state="greeting" size={100} />
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("nativeFoundation.welcome")}</h1>
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void action(async isCurrent => {
        if (mode === "login") { await client.login(identifier, password, code || undefined); const data = await load(); if (!isCurrent()) return; setUser(data.me); setActivity(data.today.activity); setPassword(""); setCode(""); }
        else { await client.publicRequest(mode === "register" ? "register" : "forgot-password", mode === "register" ? { email: identifier, password, handle } : { identifier }); if (isCurrent()) setNotice(true); }
      }); }}>
        <label>{t("nativeFoundation.email")}<input className="input mt-1 w-full" value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" inputMode="email" required maxLength={320} /></label>
        {mode === "register" && <label>{t("nativeFoundation.handle")}<input className="input mt-1 w-full" value={handle} onChange={e => setHandle(e.target.value)} required maxLength={HANDLE_MAX_LENGTH} /></label>}
        {mode !== "forgot" && <label>{t("nativeFoundation.password")}<input className="input mt-1 w-full" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : 1} required maxLength={256} /></label>}
        {mode === "login" && <label>{t("nativeFoundation.code")}<input className="input mt-1 w-full" value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" maxLength={100} /></label>}
        <button disabled={busy} className={`${primaryButton} min-h-12 whitespace-normal`} type="submit">{t(mode === "login" ? "nativeFoundation.login" : mode === "register" ? "nativeFoundation.register" : "nativeFoundation.forgot")}</button>
      </form>
      {notice && <p role="status">{t("nativeFoundation.registrationSent")}</p>}
      {isIOSApp() && <button type="button" disabled={busy || !apple} className={`${button} !bg-black !text-white`} onClick={() => void action(isCurrent => signInApple(false, isCurrent))}>{t("nativeFoundation.apple")}</button>}
      {isIOSApp() && !apple && <p>{t("nativeFoundation.appleUnavailable")}</p>}
      <div className="flex flex-wrap gap-3">{(["login", "register", "forgot"] as const).filter(v => v !== mode).map(value => <button className={button} disabled={busy} key={value} onClick={() => { setMode(value); setError(""); setNotice(false); }}>{t(`nativeFoundation.${value}`)}</button>)}</div>
      <p className="text-sm">{t("nativeFoundation.appleResetHelp")}</p>
      {!termsUrl && <p className="text-sm">{t("nativeFoundation.termsUnavailable")}</p>}
    </> : <>
      {(chapter || profile) && <button className={button} disabled={busy} onClick={() => { sequence.current++; setChapter(null); setProfile(false); }}><ArrowLeft className="h-4 w-4" />{t("nativeFoundation.back")}</button>}
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{profile ? t("nativeFoundation.account") : chapter?.title ?? `${t("nativeFoundation.today")}, ${user.handle}`}</h1>
      {profile ? <>
        <p>{user.appleLinked ? t("nativeFoundation.appleLinked") : t("nativeFoundation.appleUnavailable")}</p>
        <label>{t("nativeFoundation.password")}<input type="password" autoComplete="current-password" className="input w-full" value={password} onChange={e => setPassword(e.target.value)} maxLength={256} /></label>
        <label>{t("nativeFoundation.code")}<input className="input w-full" value={code} onChange={e => setCode(e.target.value)} maxLength={100} /></label>
        {(apple || user.appleLinked) && <button className={button} disabled={busy || !password || !user.passwordLoginEnabled} onClick={() => void action(async isCurrent => { if (user.appleLinked) { await client.api("apple", { password, ...(code ? { code } : {}) }, "DELETE"); setUser(null); setProfile(false); await client.logout(); } else await signInApple(true, isCurrent); })}>{t(user.appleLinked ? "nativeFoundation.appleUnlink" : "nativeFoundation.appleLink")}</button>}
        {!user.passwordLoginEnabled && <p>{t("nativeFoundation.alternativeRequired")}</p>}
      </> : chapter ? <>
        {chapter.verses.map(verse => <p key={verse.number} className="leading-relaxed"><sup className="mr-2">{verse.number}</sup>{verse.text}</p>)}
        <button className={`${primaryButton} min-h-12 whitespace-normal`} disabled={busy || saved} onClick={() => void action(async isCurrent => { await client.api(`chapters/${encodeURIComponent(chapter.id)}/complete`, {}); if (!isCurrent()) return; setSaved(true); await lightHaptic(); })}>{t(saved ? "nativeFoundation.completeSaved" : "nativeFoundation.complete")}</button>
      </> : <>
        {user.onboardingRequired && <p>{t("nativeFoundation.onboardingNote")}</p>}
        {activity ? <button className={`${primaryButton} min-h-12 whitespace-normal`} disabled={busy} onClick={() => void action(async isCurrent => { const value = await client.api<Chapter>(`chapters/${encodeURIComponent(activity.id)}`); if (!isCurrent()) return; setChapter(nativeChapterSchema.parse(value)); setSaved(value.state.read === "READ"); })}>{activity.title} — {t("nativeFoundation.continue")}</button> : <p>{t("nativeFoundation.empty")}</p>}
        <button className={button} onClick={() => setProfile(true)}>{t("nativeFoundation.account")}</button>
      </>}
    </>}
    <footer className="mt-auto flex flex-wrap gap-3 pt-6">
      <button className={button} onClick={() => void bootstrap()} disabled={busy}>{t("nativeFoundation.retry")}</button>
      <button className={button} onClick={() => void dismissNativeKeyboard()}>{t("nativeFoundation.keyboardDone")}</button>
      <button className={button} onClick={() => void openExternalUrl(`${client.baseUrl}/privacy`)}>{t("nativeFoundation.privacy")}</button>
      <button className={button} disabled={!termsUrl} title={!termsUrl ? t("nativeFoundation.termsUnavailable") : undefined} onClick={() => { if (termsUrl) void openExternalUrl(termsUrl); }}>{t("nativeFoundation.terms")}</button>
    </footer>
  </main>;
}
