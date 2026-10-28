"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HANDLE_MAX_LENGTH } from "@/lib/handle";
import { ArrowLeft, LogOut, WifiOff } from "lucide-react";
import MascotSlot from "@/components/versado/MascotSlot";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { primaryButton, secondaryButton } from "@/components/versado/styles";
import { isNativeApp, dismissNativeKeyboard, isIOSApp, lightHaptic, nativeAppleAuthorization, openExternalUrl, startNativeFoundationRuntime } from "@/lib/platform";
import { nativeAccountSchema, nativeTodaySchema, nativeChapterSchema, nativeCapabilitiesSchema, type NativeAccount, type NativeChapter, type NativeSecuritySetup } from "@/lib/native/contract";
import { NativeClientError, type NativeSessionClient, type NativeSignInOutcome } from "@/lib/native/client";
import { AppLink, useAppNavigation } from "@/components/navigation/AppNavigation";
import PrivacyContent from "@/components/legal/PrivacyContent";
import DisclaimerContent from "@/components/legal/DisclaimerContent";
import ContactContent from "@/components/legal/ContactContent";
import CookiesContent from "@/components/legal/CookiesContent";
import StickyHeader from "@/components/StickyHeader";
import ShellMetrics from "@/components/shell/ShellMetrics";
import FocusModeController from "@/components/shell/FocusModeController";
import PasswordChangeForm from "@/components/account/PasswordChangeForm";
import AccountDeletionForm from "@/components/account/AccountDeletionForm";
import { AccountActionsProvider } from "@/components/account/AccountActionsProvider";
import { RecoveryCodesCard, TwoFactorSetupCard } from "@/components/account/TwoFactorCards";
import { nativeAccountActions } from "@/lib/native/account";
import { AccountActionError } from "@/lib/account/contracts";
import { NativeSocketConnection } from "@/lib/native/socketClient";
import NativeEmailConfirmation from "./NativeEmailConfirmation";
import NativePasswordReset from "./NativePasswordReset";
import { nativeDeepLink, nativePasswordResetLink, nativeEmailConfirmationLink } from "@/lib/native/navigation";

type Account = NativeAccount;
type Chapter = NativeChapter;
export default function NativeFoundation({ client, termsUrl = null, onLanguage, buildBanner = null }: { client: NativeSessionClient; termsUrl?: string | null; onLanguage?: (language: string) => void; buildBanner?: ReactNode }) {
  const t = useT(), uiLanguage = useUiLanguage(), navigation = useAppNavigation();
  const profile = navigation.pathname === "/profile";
  const resetPage = navigation.pathname === "/reset-password";
  const confirmationPage = navigation.pathname === "/verify-email";
  const [mailRequest, setMailRequest] = useState<{ token: string | null; id: number; route: string }>({ token: null, id: 0, route: "" });
  const passwordPage = navigation.pathname === "/change-password";
  const deletionPage = navigation.pathname === "/account-verwijderen";
  const legal = ["/privacy", "/cookies", "/disclaimer", "/contact"].includes(navigation.pathname);
  const chapterId = navigation.pathname.startsWith("/lesson/") ? navigation.pathname.slice(8) : null;
  const mode = navigation.pathname === "/register" ? "register" : navigation.pathname === "/forgot-password" ? "forgot" : "login";
  const [setup, setSetup] = useState<NativeSecuritySetup | null>(null), [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null), [features, setFeatures] = useState<string[]>([]);
  const [user, setUser] = useState<Account | null>(null), [activity, setActivity] = useState<{ id: string; title: string } | null>(null);
  const [loadedChapter, setChapter] = useState<Chapter | null>(null), [reloadKey, setReloadKey] = useState(0);
  const chapter = loadedChapter?.id === chapterId ? loadedChapter : null;
  const [identifier, setIdentifier] = useState(""), [password, setPassword] = useState(""), [code, setCode] = useState(""), [handle, setHandle] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(false), [busy, setBusy] = useState(false), [offline, setOffline] = useState(false), [apple, setApple] = useState(false), [saved, setSaved] = useState(false);
  const launchHandled = useRef(false);
  const sequence = useRef(0), current = useRef({ busy, navigation, setup, recoveryCodes });
  useEffect(() => { current.current = { busy, navigation, setup, recoveryCodes }; }, [busy, navigation, setup, recoveryCodes]);
  useEffect(() => { if (user?.uiLanguage) onLanguage?.(user.uiLanguage); }, [user?.uiLanguage, onLanguage]);
  useEffect(() => { document.querySelector<HTMLElement>("h1")?.focus(); }, [chapter?.id, navigation.pathname, user?.id, setup?.step, recoveryCodes]);
  const report = useCallback((err: unknown) => {
    const key = err instanceof NativeClientError ? err.code : "request_failed";
    const mapping = { wrong_credentials: "wrongCredentials", two_factor_required: "twoFactorRequired", sign_in_then_link_apple: "appleConflict", alternative_login_required: "alternativeRequired", network_unavailable: "offline", session_expired: "sessionExpired", secure_storage_unavailable: "storageUnavailable" } as const;
    setError(key === "email_confirmation_required" ? t("apiErrors.emailNotConfirmed") : key === "email_confirmation_sent" ? t("apiErrors.emailNotConfirmedSent") : key === "wrong_code" ? t("apiErrors.verificationCodeWrong") : t(`nativeFoundation.${mapping[key as keyof typeof mapping] ?? "error"}`));
    if (key === "network_unavailable") setOffline(true);
    if (err instanceof NativeClientError && err.status === 401 && key !== "two_factor_required" && key !== "wrong_credentials") { setUser(null); setChapter(null); setSetup(null); setRecoveryCodes(null); }
  }, [t]);
  const accountDeleted = useCallback(() => { setUser(null); setChapter(null); setRecoveryCodes(null); setSetup(null); navigation.replace("/login"); }, [navigation]);
  const accountActions = useMemo(() => nativeAccountActions(client, () => report(new NativeClientError("session_expired", 401)), accountDeleted), [client, report, accountDeleted]);
  const load = useCallback(async () => {
    const [me, today] = await Promise.all([client.api<Account>("me"), client.api<{ activity: typeof activity }>("today")]);
    return { me: nativeAccountSchema.parse(me), today: nativeTodaySchema.parse(today) };
  }, [client]);
  const bootstrap = useCallback(async () => {
    const id = ++sequence.current; setBusy(true); setError("");
    try {
      const capabilities = nativeCapabilitiesSchema.parse(await client.publicRequest("capabilities"));
      if (id !== sequence.current) return;
      setApple(capabilities.apple && isIOSApp()); setFeatures(capabilities.features);
      if (await client.restore()) {
        const data = await load(); if (id !== sequence.current) return; setUser(data.me); setActivity(data.today.activity);
      } else { setUser(null); setChapter(null); }
      setOffline(false); setReloadKey(value => value + 1);
    } catch (err) { if (id === sequence.current) report(err); }
    finally { if (id === sequence.current) setBusy(false); }
  }, [client, load, report]);
  useEffect(() => {
    const id = ++sequence.current;
    void Promise.resolve().then(() => { if (id === sequence.current) setMailRequest(value => value.route === navigation.pathname ? value : { token: null, id: value.id, route: navigation.pathname }); });
    void Promise.resolve().then(() => { if (id === sequence.current) { setBusy(false); setError(""); setNotice(false); setPassword(""); setCode(""); } });
  }, [navigation.pathname]);
  useEffect(() => {
    void Promise.resolve().then(bootstrap);
    const online = () => { if (!current.current.busy && !current.current.setup && !current.current.recoveryCodes) void bootstrap(); }, offline = () => setOffline(true);
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    const invalidate = () => { sequence.current++; };
    let disposed = false, cleanup: (() => void) | undefined;
    void startNativeFoundationRuntime({ onResume: online, onBack: () => {
      const nav = current.current.navigation;
      if (current.current.setup && !["/privacy", "/cookies", "/disclaimer", "/contact"].includes(nav.pathname)) {
        void client.logout(() => { setSetup(null); setCode(""); nav.replace("/login"); }).catch(report); return true;
      }
      if (nav.canGoBack() || (nav.pathname !== "/dashboard" && nav.pathname !== "/login")) { nav.back(); return true; }
      return false;
    }, onUrl: (raw, source) => {
      if (disposed) return;
      // Opnieuw binden bij taal-/contextwijziging mag het oorspronkelijke
      // mailbewijs niet opnieuw openen. Expliciete nieuwe OS-openacties wel.
      if (source === "launch") { if (launchHandled.current) return; launchHandled.current = true; }
      const reset = nativePasswordResetLink(raw, client.baseUrl), confirmation = nativeEmailConfirmationLink(raw, client.baseUrl);
      const token = reset ?? confirmation;
      if (token) {
        sequence.current++;
        const route = reset ? "/reset-password" : "/verify-email";
        setMailRequest(value => ({ token, id: value.id + 1, route }));
        current.current.navigation.push(route); return;
      }
      const route = nativeDeepLink(raw, client.baseUrl);
      if (route) current.current.navigation.push(route);
    } }).then(stop => { if (disposed) stop(); else cleanup = stop; }).catch(() => {});
    return () => { disposed = true; invalidate(); cleanup?.(); window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [bootstrap, client, report]);
  const accountId = user?.id;
  const realtime = features.includes("realtime-ticket-v1");
  useEffect(() => {
    if (!accountId || !realtime || !isNativeApp()) return;
    const connection = new NativeSocketConnection(client, error => {
      if (error instanceof NativeClientError && error.status === 401) report(error);
    });
    connection.start();
    return () => connection.dispose();
  }, [accountId, realtime, reloadKey, client, report]);
  useEffect(() => {
    if (!chapterId || !accountId) return;
    const id = ++sequence.current;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setBusy(true); setError("");
      try {
        const value = nativeChapterSchema.parse(await client.api(`chapters/${encodeURIComponent(chapterId)}`));
        if (!cancelled && id === sequence.current) { setChapter(value); setSaved(value.state.read === "READ"); }
      } catch (err) { if (!cancelled && id === sequence.current) report(err); }
      finally { if (!cancelled && id === sequence.current) setBusy(false); }
    });
    return () => { cancelled = true; };
  }, [chapterId, accountId, reloadKey, client, report]);
  async function action(run: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return;
    const id = ++sequence.current; setBusy(true); setError(""); setNotice(false);
    try { await run(() => id === sequence.current); if (id === sequence.current) setOffline(false); }
    catch (err) { if (id === sequence.current) report(err); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  async function applySignIn(outcome: NativeSignInOutcome, isCurrent: () => boolean) {
    if (!isCurrent()) return;
    if (outcome.securitySetup) { setSetup(outcome.securitySetup); setUser(null); setChapter(null); setPassword(""); setCode(""); return; }
    // De sessie is al veilig geïnstalleerd. Een storing in me/today mag de
    // verbruikte setup niet terugzetten of herstelcodes onzichtbaar maken.
    setSetup(null); setRecoveryCodes(outcome.recoveryCodes ?? null); setPassword(""); setCode(""); setBusy(true);
    try {
      const data = await load(); if (!isCurrent()) return;
      setUser(data.me); setActivity(data.today.activity);
      if (["/login", "/register", "/forgot-password"].includes(navigation.pathname)) navigation.replace("/dashboard");
    } finally { if (isCurrent()) setBusy(false); }
  }
  async function cancelSetup() {
    await client.logout(() => { setSetup(null); setRecoveryCodes(null); setUser(null); setCode(""); navigation.replace("/login"); });
  }
  async function signInApple(link = false, isCurrent: () => boolean = () => true) {
    const authorize = async (authCurrent: () => boolean = isCurrent) => {
      const check = () => { if (!isCurrent() || !authCurrent()) throw new NativeClientError("session_changed", 409); };
      check();
      const challenge = link ? await client.api<{ id: string; nonce: string; state: string }>("apple/challenge", { intent: "link", password, ...(code ? { code } : {}) })
      : await client.publicRequest<{ id: string; nonce: string; state: string }>("apple/challenge", { intent: "signin" });
      check();
      const result = await nativeAppleAuthorization(challenge.nonce, challenge.state);
      check();
      const input = { uiLanguage, challengeId: challenge.id, identityToken: result.identityToken, state: result.state, ...(result.displayName ? { displayName: result.displayName } : {}), ...(code ? { code } : {}), ...(!link && features.includes("security-setup-v1") ? { supportsSecuritySetup: true } : {}) };
      if (link) return client.api("apple/complete", input);
      return client.publicRequest("apple/complete", input);
    };
    if (link) await authorize();
    else { await applySignIn(await client.authenticate(authorize), isCurrent); return; }
    const data = await load(); if (!isCurrent()) return; setUser(data.me); setActivity(data.today.activity); setPassword("");
  }
  const button = `${secondaryButton} min-h-12 whitespace-normal`;
  const detail = legal || profile || passwordPage || deletionPage || resetPage || confirmationPage || !!chapterId;
  return <AccountActionsProvider actions={accountActions}><FocusModeController>
    <ShellMetrics />
    <StickyHeader>
    <header data-app-global-header className="border-b border-vs-line bg-vs-elevated pt-[var(--vs-safe-area-top)]">
    <div className="mx-auto flex min-h-14 max-w-2xl flex-wrap items-center gap-3 pl-[max(1.25rem,var(--vs-safe-area-left))] pr-[max(1.25rem,var(--vs-safe-area-right))] py-2">
      {/* Bestaand appicoon, geen nieuwe merkasset. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-512.png" width="44" height="44" alt="" />
      <span className="text-xl font-extrabold">Versado</span>
      {user && <button type="button" disabled={busy} className={`${button} ml-auto`} onClick={() => { setPassword(""); setCode(""); void action(() => client.logout(() => { setUser(null); setChapter(null); setSetup(null); setRecoveryCodes(null); setIdentifier(""); navigation.replace("/login"); })); }}><LogOut className="h-4 w-4" />{t("nativeFoundation.logout")}</button>}
    </div></header>
    {detail && <div data-subpage-back-bar className="border-b border-vs-line bg-vs-elevated pl-[max(1.25rem,var(--vs-safe-area-left))] pr-[max(1.25rem,var(--vs-safe-area-right))] py-2">
      <button className={button} onClick={() => navigation.back()}><ArrowLeft className="h-4 w-4" />{t("nativeFoundation.back")}</button>
    </div>}
    </StickyHeader>
    <main className="native-foundation mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 bg-vs-bg text-vs-fg">
    {buildBanner}
    {offline && <p role="status" className="flex gap-2 rounded-xl bg-vs-surface p-3"><WifiOff className="h-5 w-5 shrink-0" />{t("nativeFoundation.offline")}</p>}
    {error && <p role="alert" className="rounded-xl border border-vs-line bg-vs-surface p-3">{error}</p>}
    {busy && <p role="status">{t("nativeFoundation.loading")}</p>}
    {legal ? navigation.pathname === "/privacy" ? <PrivacyContent /> : navigation.pathname === "/disclaimer" ? <DisclaimerContent /> : navigation.pathname === "/contact" ? <ContactContent /> : <CookiesContent /> : resetPage ? <NativePasswordReset key={mailRequest.id} client={client} initialToken={mailRequest.route === navigation.pathname ? mailRequest.token : null} onTokenCleared={() => setMailRequest(value => ({ ...value, token: null }))} onContinue={() => void action(() => client.logout(() => { setUser(null); setChapter(null); setSetup(null); setRecoveryCodes(null); navigation.replace("/login"); }))} /> : confirmationPage ? <NativeEmailConfirmation key={mailRequest.id} client={client} initialToken={mailRequest.route === navigation.pathname ? mailRequest.token : null} onTokenCleared={() => setMailRequest(value => ({ ...value, token: null }))} onContinue={() => void action(() => client.logout(() => { setUser(null); setChapter(null); setSetup(null); setRecoveryCodes(null); navigation.replace("/login"); }))} /> : recoveryCodes ? <>
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("profile.twoFactor")}</h1>
      <RecoveryCodesCard recoveryCodes={recoveryCodes} onSaved={() => setRecoveryCodes(null)} />
    </> : setup ? <>
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t(setup.step === "password" ? "profile.changePassword" : "profile.twoFactor")}</h1>
      {setup.step === "password" ? <AccountActionsProvider actions={{ async deleteAccount() { throw new AccountActionError("request_failed"); }, async changePassword({ newPassword }) {
        const id = ++sequence.current; setBusy(true); setError("");
        try { await applySignIn(await client.completeSecuritySetup({ newPassword }), () => id === sequence.current); }
        catch (error) { if (id === sequence.current) report(error); throw error; }
        finally { if (id === sequence.current) setBusy(false); }
      } }}><PasswordChangeForm key={setup.token} forced currentPasswordRequired={false} /></AccountActionsProvider> : <>
        <p>{t("twoFactor.adminRequired")}</p>
        {setup.secret && setup.otpauthUri && <TwoFactorSetupCard setup={{ secret: setup.secret, otpauthUri: setup.otpauthUri }} code={code} onCode={setCode} busy={busy} onConfirm={() => void action(async isCurrent => applySignIn(await client.completeSecuritySetup({ code }), isCurrent))} />}
      </>}
      <button className={button} disabled={busy} onClick={() => void action(cancelSetup)}>{t("activeGames.cancel")}</button>
    </> : !user ? <>
      <MascotSlot character="novi" state="greeting" size={100} />
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("nativeFoundation.welcome")}</h1>
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void action(async isCurrent => {
        if (mode === "login") await applySignIn(await client.login(identifier, password, code || undefined, features.includes("security-setup-v1")), isCurrent);
        else { await client.publicRequest(mode === "register" ? "register" : "forgot-password", mode === "register" ? { email: identifier, password, handle } : { identifier }); if (isCurrent()) setNotice(true); }
      }); }}>
        <label>{t("nativeFoundation.email")}<input className="input mt-1 w-full" value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" inputMode="email" required maxLength={320} /></label>
        {mode === "register" && <label>{t("nativeFoundation.handle")}<input className="input mt-1 w-full" value={handle} onChange={e => setHandle(e.target.value)} required maxLength={HANDLE_MAX_LENGTH} /></label>}
        {mode !== "forgot" && <label>{t("nativeFoundation.password")}<input className="input mt-1 w-full" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : 1} required maxLength={256} /></label>}
        {mode === "login" && <label>{t("nativeFoundation.code")}<input className="input mt-1 w-full" value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" maxLength={100} /></label>}
        <button disabled={busy} className={`${primaryButton} min-h-12 whitespace-normal`} type="submit">{t(mode === "login" ? "nativeFoundation.login" : mode === "register" ? "nativeFoundation.register" : "nativeFoundation.forgot")}</button>
      </form>
      {mode === "forgot" && features.includes("password-reset-v1") && <AppLink className={button} href="/reset-password">{t("password.openResetLink")}</AppLink>}
      {features.includes("email-confirmation-v1") && <AppLink className={button} href="/verify-email">{t("verify.openLink")}</AppLink>}
      {notice && <p role="status">{t("nativeFoundation.registrationSent")}</p>}
      {isIOSApp() && <button type="button" disabled={busy || !apple} className={`${button} !bg-black !text-white`} onClick={() => void action(isCurrent => signInApple(false, isCurrent))}>{t("nativeFoundation.apple")}</button>}
      {isIOSApp() && !apple && <p>{t("nativeFoundation.appleUnavailable")}</p>}
      <div className="flex flex-wrap gap-3">{(["login", "register", "forgot"] as const).filter(v => v !== mode).map(value => <button className={button} disabled={busy} key={value} onClick={() => { navigation.push(value === "forgot" ? "/forgot-password" : `/${value}`); setError(""); setNotice(false); }}>{t(`nativeFoundation.${value}`)}</button>)}</div>
      <p className="text-sm">{t("nativeFoundation.appleResetHelp")}</p>
      {!termsUrl && <p className="text-sm">{t("nativeFoundation.termsUnavailable")}</p>}
    </> : <>
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{passwordPage ? t("profile.changePassword") : deletionPage ? t("accountDeletion.title") : profile ? t("nativeFoundation.account") : (chapterId ? chapter?.title ?? t("pages.lesson") : `${t("nativeFoundation.today")}, ${user.handle}`)}</h1>
      {deletionPage ? <AccountDeletionForm passwordLoginEnabled={user.passwordLoginEnabled} totpEnabled={user.totpEnabled} /> : passwordPage ? <PasswordChangeForm forced={false} requiresSecondFactor={user.totpEnabled} onChanged={async () => {
        await client.logout(() => { setUser(null); setChapter(null); setRecoveryCodes(null); navigation.replace("/login"); }).catch(report);
      }} /> : profile ? <>
        <p>{user.appleLinked ? t("nativeFoundation.appleLinked") : t("nativeFoundation.appleUnavailable")}</p>
        <label>{t("nativeFoundation.password")}<input type="password" autoComplete="current-password" className="input w-full" value={password} onChange={e => setPassword(e.target.value)} maxLength={256} /></label>
        <label>{t("nativeFoundation.code")}<input className="input w-full" value={code} onChange={e => setCode(e.target.value)} maxLength={100} /></label>
        {(apple || user.appleLinked) && <button className={button} disabled={busy || !password || !user.passwordLoginEnabled} onClick={() => void action(async isCurrent => { if (user.appleLinked) { await client.api("apple", { password, ...(code ? { code } : {}) }, "DELETE"); setUser(null); setPassword(""); setCode(""); await client.logout(); } else await signInApple(true, isCurrent); })}>{t(user.appleLinked ? "nativeFoundation.appleUnlink" : "nativeFoundation.appleLink")}</button>}
        {user.passwordLoginEnabled && features.includes("account-password-v1") && <AppLink className={button} href="/change-password">{t("profile.changePassword")}</AppLink>}
        {!user.passwordLoginEnabled && <p>{t("nativeFoundation.alternativeRequired")}</p>}
        {features.includes("account-deletion-v1") && <AppLink className={button} href="/account-verwijderen">{t("profile.deleteAccount")}</AppLink>}
      </> : chapterId ? chapter ? <>
        {chapter.verses.map(verse => <p key={verse.number} className="leading-relaxed"><sup className="mr-2">{verse.number}</sup>{verse.text}</p>)}
        <button className={`${primaryButton} min-h-12 whitespace-normal`} disabled={busy || saved} onClick={() => void action(async isCurrent => { await client.api(`chapters/${encodeURIComponent(chapter.id)}/complete`, {}); if (!isCurrent()) return; setSaved(true); await lightHaptic(); })}>{t(saved ? "nativeFoundation.completeSaved" : "nativeFoundation.complete")}</button>
      </> : null : <>
        {user.onboardingRequired && <p>{t("nativeFoundation.onboardingNote")}</p>}
        {activity ? <button className={`${primaryButton} min-h-12 whitespace-normal`} disabled={busy} onClick={() => navigation.push(`/lesson/${encodeURIComponent(activity.id)}`)}>{activity.title} — {t("nativeFoundation.continue")}</button> : <p>{t("nativeFoundation.empty")}</p>}
        <button className={button} onClick={() => navigation.push("/profile")}>{t("nativeFoundation.account")}</button>
      </>}
    </>}
    <footer className="mt-auto flex flex-wrap gap-3 pt-6">
      <button className={button} onClick={() => void bootstrap()} disabled={busy || !!setup || !!recoveryCodes}>{t("nativeFoundation.retry")}</button>
      <button className={button} onClick={() => void dismissNativeKeyboard()}>{t("nativeFoundation.keyboardDone")}</button>
      <AppLink className={button} href="/privacy">{t("nativeFoundation.privacy")}</AppLink>
      <button className={button} disabled={!termsUrl} title={!termsUrl ? t("nativeFoundation.termsUnavailable") : undefined} onClick={() => { if (termsUrl) void openExternalUrl(termsUrl); }}>{t("nativeFoundation.terms")}</button>
    </footer>
  </main></FocusModeController></AccountActionsProvider>;
}
