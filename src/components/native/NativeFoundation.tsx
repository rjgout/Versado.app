"use client";
import ProfilePageView from "@/components/profile/ProfilePageView";
import { parseProfileView,PROFILE_VIEWS } from "@/lib/profileViews";
import NativeProfileView from "./NativeProfileView";

import { AccountActionsProvider } from "@/components/account/AccountActionsProvider";
import AccountDeletionForm from "@/components/account/AccountDeletionForm";
import PasswordChangeForm from "@/components/account/PasswordChangeForm";
import { RecoveryCodesCard,TwoFactorSetupCard } from "@/components/account/TwoFactorCards";
import { useT,useUiLanguage } from "@/components/I18nProvider";
import ContactContent from "@/components/legal/ContactContent";
import CookiesContent from "@/components/legal/CookiesContent";
import DisclaimerContent from "@/components/legal/DisclaimerContent";
import PrivacyContent from "@/components/legal/PrivacyContent";
import { AppLink,useAppNavigation } from "@/components/navigation/AppNavigation";
import { SettingsSection } from "@/components/profile/settings";
import AppShellFrame from "@/components/shell/AppShellFrame";
import SubpageBackBarView from "@/components/shell/SubpageBackBarView";
import MascotSlot from "@/components/versado/MascotSlot";
import { primaryButton,secondaryButton } from "@/components/versado/styles";
import { AccountActionError } from "@/lib/account/contracts";
import { nativeContentQueryKey,nativeTodayQueryKey } from "@/lib/data/native";
import { NativeDataProvider,useNativeData,useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { HANDLE_MAX_LENGTH } from "@/lib/handle";
import { nativeAccountActions } from "@/lib/native/account";
import { NativeClientError,type NativeSessionClient,type NativeSignInOutcome } from "@/lib/native/client";
import { nativeCapabilitiesSchema,type NativeAccount,type NativeContentState,type NativeSecuritySetup } from "@/lib/native/contract";
import { nativeDeepLink,nativeEmailConfirmationLink,nativePasswordResetLink } from "@/lib/native/navigation";
import { nativeReaderRoute } from "@/lib/native/readerNavigation";
import { focusNativeRouteHeading } from "@/lib/native/routeFocus";
import { nativeAppleLoginUIAvailable,nativePrimaryNav } from "@/lib/native/shell";
import { NativeSocketConnection } from "@/lib/native/socketClient";
import { type NativeTodayOverview } from "@/lib/native/todayContract";
import { dismissNativeKeyboard,isIOSApp,isNativeApp,nativeAppleAuthorization,openExternalUrl,startNativeFoundationRuntime } from "@/lib/platform";
import { LogOut,WifiOff } from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import NativeContentPicker from "./NativeContentPicker";
import NativeEmailConfirmation from "./NativeEmailConfirmation";
import NativeLearningView from "./NativeLearningView";
import NativePasswordReset from "./NativePasswordReset";
import NativeShellHeader from "./NativeShellHeader";
import NativeTodayView from "./NativeTodayView";

import ReadAloudMiniPlayer from "@/components/ReadAloudMiniPlayer";
import type { NativeReadAloudOutput } from "@/lib/native/audioOutput";
import { ReadAloudPlayerProvider } from "@/lib/readAloudPlayerContext";

type Account = NativeAccount;
type FoundationProps = { audioOutput?: NativeReadAloudOutput; client: NativeSessionClient; termsUrl?: string | null; onLanguage?: (language: string) => void; buildBanner?: ReactNode; buildIndicator?: ReactNode; internalTools?: boolean; internalAccess?: ReactNode };
export default function NativeFoundation(props: FoundationProps) {
  return <NativeDataProvider client={props.client}><ReadAloudPlayerProvider output={props.audioOutput}><NativeFoundationContent {...props} /></ReadAloudPlayerProvider></NativeDataProvider>;
}
function NativeFoundationContent({ audioOutput, client, termsUrl = null, onLanguage, buildBanner = null, buildIndicator = null, internalTools = false, internalAccess = null }: FoundationProps) {
  const t = useT(), uiLanguage = useUiLanguage(), navigation = useAppNavigation();
  const diagnostics = navigation.pathname === "/diagnostics";
  const pickerPage = navigation.pathname === "/content";
  const canDiagnose = internalTools || internalAccess !== null;
  const profile = navigation.pathname === "/profile" || navigation.pathname === "/profile/avatar" || navigation.pathname.startsWith("/profile?view=");
  const profileView = profile ? parseProfileView(new URLSearchParams(navigation.pathname.split("?")[1] ?? "").get("view")) : null;
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
  const dataRuntime = useNativeData();
  const [reloadKey, setReloadKey] = useState(0);
  const contentEnabled = !!user && features.includes("content-picker-v1") && !setup && !recoveryCodes;
  const pickerAvailable = pickerPage && contentEnabled;
  const contentQuery = useNativeLiveQuery<NativeContentState>(nativeContentQueryKey(user?.id ?? null), () => dataRuntime.contentContext(user!.id), {
    scopes: ["content", "studyContext"], enabled: contentEnabled, staleTime: 15_000, pollMs: 15_000,
  });
  const refreshContent = contentQuery.refetch;
  const content = contentEnabled && contentQuery.data?.userId === user?.id ? contentQuery.data : undefined;
  const contentStamp = content ? `${content.picker.activeCollectionId}:${content.picker.selectionVersion}` : null;
  const todayQuery = useNativeLiveQuery(["today", user?.id ?? null, contentStamp], async () => {
    const today = await dataRuntime.today();
    if (content && today.selectionVersion !== content.picker.selectionVersion) throw new NativeClientError("content_context_changed", 409);
    return today;
  }, { scopes: ["today", "content"], enabled: contentEnabled && !!content && !features.includes("today-overview-v1") && navigation.pathname === "/dashboard" });

  const overviewEnabled = !!user && features.includes("today-overview-v1") && !setup && !recoveryCodes;
  const overviewKey = user && content ? nativeTodayQueryKey({ userId: user.id, activeCollectionId: content.picker.activeCollectionId, selectionVersion: content.picker.selectionVersion, language: user.uiLanguage as NativeTodayOverview["language"] }) : ["today-overview", null];
  const overviewQuery = useNativeLiveQuery<NativeTodayOverview>(overviewKey, () => dataRuntime.todayOverview(user!.id, content!.picker), {
    scopes: ["today", "content", "progress", "xp", "streak", "courses", "studyContext", "studyContent", "friends", "groups", "kompas"],
    enabled: overviewEnabled && !!content && navigation.pathname === "/dashboard", staleTime: 60_000, pollMs: 60_000,
    validUntil: (data, fetchedAt) => fetchedAt + Math.max(1000, Date.parse(data.expiresAt) - data.serverNow),
  });
  const overview = overviewEnabled && overviewQuery.data?.userId === user?.id && overviewQuery.data.selectionVersion === content?.picker.selectionVersion ? overviewQuery.data : undefined;
  const overviewReady = navigation.pathname === "/dashboard" && !!overview;

  const [identifier, setIdentifier] = useState(""), [password, setPassword] = useState(""), [code, setCode] = useState(""), [handle, setHandle] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(false), [busy, setBusy] = useState(false), [offline, setOffline] = useState(false), [apple, setApple] = useState(false);
  const launchHandled = useRef(false), fullTodayBackend = useRef(false);
  const sequence = useRef(0), current = useRef({ busy, navigation, setup, recoveryCodes });
  useEffect(() => { current.current = { busy, navigation, setup, recoveryCodes }; }, [busy, navigation, setup, recoveryCodes]);
  const accountLanguage = navigation.pathname === "/dashboard" ? overview?.language ?? user?.uiLanguage : user?.uiLanguage;
  useEffect(() => { if (accountLanguage) onLanguage?.(accountLanguage); }, [accountLanguage, onLanguage]);
  useEffect(() => focusNativeRouteHeading(), [chapterId, navigation.pathname, user?.id, setup?.step, recoveryCodes, pickerAvailable, overviewReady]);
  const report = useCallback((err: unknown) => {
    const key = err instanceof NativeClientError ? err.code : "request_failed";
    if (key.startsWith("access_")) {
      setError(t(key === "access_missing" ? "nativeAccess.missing" : key === "access_disabled" ? "nativeAccess.disabled" : key === "access_denied" ? "nativeAccess.denied" : "nativeAccess.error"));
      if (key === "access_network_unavailable") setOffline(true);
      return;
    }
    const mapping = { wrong_credentials: "wrongCredentials", two_factor_required: "twoFactorRequired", sign_in_then_link_apple: "appleConflict", alternative_login_required: "alternativeRequired", network_unavailable: "offline", session_expired: "sessionExpired", secure_storage_unavailable: "storageUnavailable" } as const;
    setError(key === "email_confirmation_required" ? t("apiErrors.emailNotConfirmed") : key === "email_confirmation_sent" ? t("apiErrors.emailNotConfirmedSent") : key === "wrong_code" ? t("apiErrors.verificationCodeWrong") : t(`nativeFoundation.${mapping[key as keyof typeof mapping] ?? "error"}`));
    if (key === "network_unavailable") setOffline(true);
    if (err instanceof NativeClientError && err.status === 401 && key !== "two_factor_required" && key !== "wrong_credentials") { setUser(null); dataRuntime.reset(); setSetup(null); setRecoveryCodes(null); }
  }, [t, dataRuntime]);
  const accountDeleted = useCallback(() => { setUser(null); dataRuntime.reset(); setRecoveryCodes(null); setSetup(null); navigation.replace("/login"); }, [dataRuntime, navigation]);
  const accountActions = useMemo(() => nativeAccountActions(client, () => report(new NativeClientError("session_expired", 401)), accountDeleted), [client, report, accountDeleted]);
  const load = useCallback(async () => {
    const [me, today] = await Promise.all([dataRuntime.account(), fullTodayBackend.current ? Promise.resolve({ activity: null }) : dataRuntime.today()]);
    return { me, today };
  }, [dataRuntime]);
  const bootstrap = useCallback(async () => {
    const id = ++sequence.current; setBusy(true); setError("");
    try {
      const capabilities = nativeCapabilitiesSchema.parse(await client.publicRequest("capabilities"));
      if (id !== sequence.current) return;
      fullTodayBackend.current = capabilities.features.includes("today-overview-v1");
      setApple(capabilities.apple && isIOSApp()); setFeatures(capabilities.features);
      if (await client.restore()) {
        const data = await load(); if (id !== sequence.current) return; setUser(data.me); setActivity(data.today.activity);
      } else { setUser(null); dataRuntime.reset(); }
      setOffline(false); dataRuntime.resume(); setReloadKey(value => value + 1);
    } catch (err) { if (id === sequence.current) report(err); }
    finally { if (id === sequence.current) setBusy(false); }
  }, [client, load, report, dataRuntime]);
  const profileAccountRequest=useRef(0);
  const profileAccountOwner=user?.id;
  const profileSessionStamp=client.getSessionStamp();
  // Een profielwijziging ververst alleen de bevestigde accountgegevens.
  // De bootstrap roteert de sessie en wordt door een routewissel geannuleerd;
  // dat mag de nieuwe 2FA-status voor wachtwoord-/wisformulieren niet verliezen.
  const refreshProfileAccount=useCallback(async()=>{
    const owner=profileAccountOwner,stamp=client.getSessionStamp(),epoch=dataRuntime.getSnapshot(),request=++profileAccountRequest.current;
    if(!owner)return;
    const current=()=>request===profileAccountRequest.current && stamp===client.getSessionStamp() && epoch===dataRuntime.getSnapshot();
    try{const account=await dataRuntime.account();if(current() && account.id===owner)setUser(account);}
    catch(reason){if(current())report(reason);}
  },[profileAccountOwner,client,dataRuntime,report]);
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
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (dialog) {
        const event = new Event("cancel", { cancelable: true }); dialog.dispatchEvent(event);
        if (!event.defaultPrevented) dialog.close();
        return true;
      }
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
  useEffect(()=>{
    if(user && profile && (profileView || navigation.pathname==="/profile/avatar") && !features.includes("profile-settings-v1"))navigation.replace("/profile");
  },[user,profile,profileView,navigation,features]);
  useEffect(() => {
    if (diagnostics && !canDiagnose) navigation.replace(user ? "/profile" : "/login");
  }, [diagnostics, canDiagnose, navigation, user]);
  useEffect(() => {
    if ([todayQuery.error, overviewQuery.error].some(error => error instanceof NativeClientError && error.code === "content_context_changed")) void refreshContent();
  }, [todayQuery.error, overviewQuery.error, refreshContent]);
  useEffect(() => {
    let current = true;
    const failure = contentQuery.error ?? (navigation.pathname === "/dashboard" ? overviewEnabled ? overviewQuery.error : todayQuery.error : null);
    void Promise.resolve().then(() => {
      const securityFailure = failure instanceof NativeClientError && (failure.status === 401 || failure.code.startsWith("access_"));
      if (current && failure && (!pickerPage || securityFailure) && !(overviewEnabled && failure === overviewQuery.error && !securityFailure) && !(failure instanceof NativeClientError && failure.code === "content_context_changed")) report(failure);
    });
    return () => { current = false; };
  }, [contentQuery.error, todayQuery.error, overviewQuery.error, overviewEnabled, pickerPage, navigation.pathname, report]);
  const accountId = user?.id;
  const realtime = features.includes("realtime-ticket-v1") && client.realtimeSupported;
  useEffect(() => {
    if (!accountId || !realtime || !isNativeApp()) return;
    const connection = new NativeSocketConnection(client, error => {
      if (error instanceof NativeClientError && error.status === 401) report(error);
    });
    const detach = dataRuntime.attachSocket(connection.socket);
    connection.start();
    return () => { detach(); connection.dispose(); };
  }, [accountId, realtime, reloadKey, client, report, dataRuntime]);
  async function action(run: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return;
    const id = ++sequence.current; setBusy(true); setError(""); setNotice(false);
    try { await run(() => id === sequence.current); if (id === sequence.current) setOffline(false); }
    catch (err) { if (id === sequence.current) report(err); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  async function applySignIn(outcome: NativeSignInOutcome, isCurrent: () => boolean) {
    if (!isCurrent()) return;
    if (outcome.securitySetup) { setSetup(outcome.securitySetup); setUser(null); dataRuntime.reset(); setPassword(""); setCode(""); return; }
    // De sessie is al veilig geïnstalleerd. Een storing in me/today mag de
    // verbruikte setup niet terugzetten of herstelcodes onzichtbaar maken.
    setSetup(null); setRecoveryCodes(outcome.recoveryCodes ?? null); setPassword(""); setCode(""); setBusy(true);
    try {
      const data = await load(); if (!isCurrent()) return;
      setUser(data.me); setActivity(data.today.activity);
      if (["/dashboard", "/login", "/register", "/forgot-password"].includes(navigation.pathname)) navigation.replace("/dashboard");
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
  const appleLoginAvailable = isIOSApp() && nativeAppleLoginUIAvailable(apple, features);
  const readerRoute = nativeReaderRoute(navigation.pathname);
  const learningPage = /^\/courses(?:\/|$)/.test(navigation.pathname);
  const destinations = nativePrimaryNav(features);
  const detail = !!readerRoute || (learningPage && navigation.pathname !== "/courses") || diagnostics || pickerPage || legal || profile || passwordPage || deletionPage || resetPage || confirmationPage || !!chapterId;
  const shellAccount = user && !setup && !recoveryCodes ? user : null;
  return <AccountActionsProvider actions={accountActions}><AppShellFrame
    header={<NativeShellHeader account={shellAccount} onError={report} content={content} buildIndicator={buildIndicator} destinations={destinations} />}
    headerExtras={<>
      {detail && <SubpageBackBarView title={diagnostics ? t("nativeDiagnostics.title") : pickerPage ? t("contentSwitcher.picker.title") : passwordPage ? t("profile.changePassword") : deletionPage ? t("accountDeletion.title") : profile ? t(navigation.pathname==="/profile/avatar" ? "profile.avatarEditorTitle" : profileView ? PROFILE_VIEWS[profileView].title : "nav.profile") : readerRoute ? t("pages.lesson") : learningPage ? t("pages.course") : chapterId ? t("pages.lesson") : t("common.back")} onBack={() => navigation.back(passwordPage || deletionPage || profile && (profileView || navigation.pathname==="/profile/avatar") ? "/profile" : readerRoute ? `/courses/${readerRoute.courseId}/pad` : learningPage ? navigation.pathname.endsWith("/archief") ? navigation.pathname.replace(/archief$/, "pad") : "/courses" : "/dashboard")} />}
      {/* De terugbalk reserveert in Focus de veilige bovenrand, ook voor de speler eronder. */}
      <ReadAloudMiniPlayer />
    </>}
    showNavigation={!!shellAccount} destinations={destinations}
    mainClassName="native-foundation flex min-h-dvh w-full flex-col gap-5 bg-vs-bg text-vs-fg"
  >
    {offline && <p role="status" className="flex gap-2 rounded-xl bg-vs-surface p-3"><WifiOff className="h-5 w-5 shrink-0" />{t("nativeFoundation.offline")}</p>}
    {error && <p role="alert" className="rounded-xl border border-vs-line bg-vs-surface p-3">{error}</p>}
    {busy && <p role="status">{t("nativeFoundation.loading")}</p>}
    {diagnostics && canDiagnose ? <>
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("nativeDiagnostics.title")}</h1>
      {buildBanner}{internalAccess}
      <SettingsSection title={t("nativeDiagnostics.recovery")}>
        <button className={button} onClick={() => void bootstrap()} disabled={busy || !!setup || !!recoveryCodes}>{t("nativeFoundation.retry")}</button>
        <button className={button} onClick={() => void dismissNativeKeyboard()}>{t("nativeFoundation.keyboardDone")}</button>
      </SettingsSection>
    </> : pickerPage && !setup && !recoveryCodes ? user && contentEnabled ? <NativeContentPicker key={user.id} userId={user.id} state={content} error={!!contentQuery.error}
      onRetry={() => { void refreshContent(); }} onCommitted={value => { contentQuery.setData(value); }} /> : <section data-native-content-unavailable className="flex flex-col gap-4">
      <h1 tabIndex={-1} className="text-3xl font-extrabold">{t("contentSwitcher.picker.title")}</h1>
      <p role="status">{t(busy ? "nativeFoundation.loading" : user ? "nativeContentFallback.unsupported" : "nativeContentFallback.signIn")}</p>
      <AppLink className={button} href={user ? "/dashboard" : "/login"}>{t(user ? "nav.today" : "nativeFoundation.login")}</AppLink>
    </section> : legal ? navigation.pathname === "/privacy" ? <PrivacyContent /> : navigation.pathname === "/disclaimer" ? <DisclaimerContent /> : navigation.pathname === "/contact" ? <ContactContent /> : <CookiesContent /> : resetPage ? <NativePasswordReset key={mailRequest.id} client={client} initialToken={mailRequest.route === navigation.pathname ? mailRequest.token : null} onTokenCleared={() => setMailRequest(value => ({ ...value, token: null }))} onContinue={() => void action(() => client.logout(() => { setUser(null); dataRuntime.reset(); setSetup(null); setRecoveryCodes(null); navigation.replace("/login"); }))} /> : confirmationPage ? <NativeEmailConfirmation key={mailRequest.id} client={client} initialToken={mailRequest.route === navigation.pathname ? mailRequest.token : null} onTokenCleared={() => setMailRequest(value => ({ ...value, token: null }))} onContinue={() => void action(() => client.logout(() => { setUser(null); dataRuntime.reset(); setSetup(null); setRecoveryCodes(null); navigation.replace("/login"); }))} /> : recoveryCodes ? <>
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
      {appleLoginAvailable && <button type="button" disabled={busy} className={`${button} !bg-black !text-white`} onClick={() => void action(isCurrent => signInApple(false, isCurrent))}>{t("nativeFoundation.apple")}</button>}
      <div className="flex flex-wrap gap-3">{(["login", "register", "forgot"] as const).filter(v => v !== mode).map(value => <button className={button} disabled={busy} key={value} onClick={() => { navigation.push(value === "forgot" ? "/forgot-password" : `/${value}`); setError(""); setNotice(false); }}>{t(`nativeFoundation.${value}`)}</button>)}</div>
      {appleLoginAvailable && <p className="text-sm">{t("nativeFoundation.appleResetHelp")}</p>}
      {!termsUrl && <p className="text-sm">{t("nativeFoundation.termsUnavailable")}</p>}
    </> : learningPage ? <NativeLearningView key={`${user.id}:${dataRuntime.getSnapshot()}:${contentStamp}`} userId={user.id} language={user.uiLanguage} content={content} enabled={features.includes("courses-overview-v1")} learningEnabled={features.includes("scripture-learning-v1")} readerEnabled={features.includes("scripture-reader-v1")} positionEnabled={features.includes("scripture-reading-position-v1")} audioEnabled={!!audioOutput?.enabled&&features.includes("scripture-audio-v1")} annotationsEnabled={features.includes("scripture-annotations-v1")} studyEnabled={features.includes("study-course-overview-v1")} mediaEnabled={features.includes("study-media-v1")} onError={error => { if (error instanceof NativeClientError && error.code === "content_context_changed") { void refreshContent(); } else report(error); }}/> : overviewEnabled && navigation.pathname === "/dashboard" ? overview ? <>
      {!!overviewQuery.error && <section role="alert" className="rounded-2xl border border-vs-line p-4"><p>{t("nativeFoundation.error")}</p><button type="button" className={button} onClick={() => { void overviewQuery.refetch(); }}>{t("nativeFoundation.retry")}</button></section>}
      {user.onboardingRequired && <p>{t("nativeFoundation.onboardingNote")}</p>}
      <NativeTodayView key={`${user.id}:${dataRuntime.getSnapshot()}:${contentStamp}`} state={overview} coursesEnabled={features.includes("courses-overview-v1")} mediaEnabled={features.includes("study-media-v1")} actions={features.includes("today-actions-v1") ? (() => {
        const actions = dataRuntime.todayActions(overview, overviewKey);
        const perform = async (run: () => Promise<void>) => { try { await run(); } catch (error) { if (error instanceof NativeClientError && (error.status === 401 || error.code.startsWith("access_"))) report(error); throw error; } };
        return { hideContinue: item => perform(() => actions.hideContinue(item)), respondFriend: (id, action) => perform(() => actions.respondFriend(id, action)) };
      })() : undefined}/></> : <section aria-busy={overviewQuery.isFetching}>
      <h1 tabIndex={-1} className="text-2xl font-extrabold">{t("nativeFoundation.today")}</h1>
      <p role="status">{t(overviewQuery.error ? "nativeFoundation.error" : "nativeFoundation.loading")}</p>
      {!!overviewQuery.error && <button type="button" className={button} onClick={() => { void overviewQuery.refetch(); }}>{t("nativeFoundation.retry")}</button>}
    </section> : <>
      {!(passwordPage || deletionPage || profile && features.includes("profile-settings-v1")) && <h1 tabIndex={-1} className="text-2xl font-extrabold">{passwordPage ? t("profile.changePassword") : deletionPage ? t("accountDeletion.title") : profile ? t(navigation.pathname==="/profile/avatar" ? "profile.avatarEditorTitle" : profileView ? PROFILE_VIEWS[profileView].title : "nav.profile") : (chapterId ? t("pages.lesson") : `${t("nativeFoundation.today")}, ${user.handle}`)}</h1>}
      {deletionPage ? <ProfilePageView title={t("accountDeletion.title")}><AccountDeletionForm passwordLoginEnabled={user.passwordLoginEnabled} totpEnabled={user.totpEnabled} /></ProfilePageView> : passwordPage ? <ProfilePageView title={t("profile.changePassword")}><PasswordChangeForm forced={false} requiresSecondFactor={user.totpEnabled} onChanged={async () => {
        await client.logout(() => { setUser(null); dataRuntime.reset(); setRecoveryCodes(null); navigation.replace("/login"); }).catch(report);
      }} /></ProfilePageView> : profile && features.includes("profile-settings-v1") ? <NativeProfileView key={user.id} account={user} content={content} accountExtras={<>
        {(appleLoginAvailable || user.appleLinked) && <>
        {user.appleLinked && <p>{t("nativeFoundation.appleLinked")}</p>}
        <label>{t("nativeFoundation.password")}<input type="password" autoComplete="current-password" className="input w-full" value={password} onChange={e => setPassword(e.target.value)} maxLength={256} /></label>
        <label>{t("nativeFoundation.code")}<input className="input w-full" value={code} onChange={e => setCode(e.target.value)} maxLength={100} /></label>
        <button className={button} disabled={busy || !password || !user.passwordLoginEnabled} onClick={() => void action(async isCurrent => { if (user.appleLinked) { await client.api("apple", { password, ...(code ? { code } : {}) }, "DELETE"); setUser(null); setPassword(""); setCode(""); await client.logout(); } else await signInApple(true, isCurrent); })}>{t(user.appleLinked ? "nativeFoundation.appleUnlink" : "nativeFoundation.appleLink")}</button>
        </>}
        {!user.passwordLoginEnabled && <p>{t("nativeFoundation.alternativeRequired")}</p>}
        {canDiagnose && <AppLink className={button} href="/diagnostics">{t("nativeDiagnostics.open")}</AppLink>}
        {termsUrl && <button className={button} onClick={()=>void openExternalUrl(termsUrl)}>{t("nativeFoundation.terms")}</button>}
      </>} onAccountChanged={()=>void refreshProfileAccount()} onError={report} onLogout={async()=>{if(client.getSessionStamp()!==profileSessionStamp)throw new NativeClientError("session_changed",409);await client.logout(()=>{setUser(null);dataRuntime.reset();setSetup(null);setRecoveryCodes(null);setPassword("");setCode("");setIdentifier("");navigation.replace("/login");});}}/> : profile ? <>
        {(appleLoginAvailable || user.appleLinked) && <>
        {user.appleLinked && <p>{t("nativeFoundation.appleLinked")}</p>}
        <label>{t("nativeFoundation.password")}<input type="password" autoComplete="current-password" className="input w-full" value={password} onChange={e => setPassword(e.target.value)} maxLength={256} /></label>
        <label>{t("nativeFoundation.code")}<input className="input w-full" value={code} onChange={e => setCode(e.target.value)} maxLength={100} /></label>
        <button className={button} disabled={busy || !password || !user.passwordLoginEnabled} onClick={() => void action(async isCurrent => { if (user.appleLinked) { await client.api("apple", { password, ...(code ? { code } : {}) }, "DELETE"); setUser(null); setPassword(""); setCode(""); await client.logout(); } else await signInApple(true, isCurrent); })}>{t(user.appleLinked ? "nativeFoundation.appleUnlink" : "nativeFoundation.appleLink")}</button>
        </>}
        {user.passwordLoginEnabled && features.includes("account-password-v1") && <AppLink className={button} href="/change-password">{t("profile.changePassword")}</AppLink>}
        {!user.passwordLoginEnabled && <p>{t("nativeFoundation.alternativeRequired")}</p>}
        {features.includes("account-deletion-v1") && <AppLink className={button} href="/account-verwijderen">{t("profile.deleteAccount")}</AppLink>}
      </> : chapterId ? <><p role="status">{t("nativeReader.legacy")}</p><AppLink className={button} href="/courses">{t("nav.learn")}</AppLink></> : <>
        {user.onboardingRequired && <p>{t("nativeFoundation.onboardingNote")}</p>}
        {(contentEnabled ? todayQuery.data?.activity : activity) ? <button className={`${primaryButton} min-h-12 whitespace-normal`} disabled={busy} onClick={() => navigation.push(`/lesson/${encodeURIComponent((contentEnabled ? todayQuery.data!.activity : activity)!.id)}`)}>{(contentEnabled ? todayQuery.data!.activity : activity)!.title} — {t("nativeFoundation.continue")}</button> : <p>{t("nativeFoundation.empty")}</p>}
      </>}
    </>}
    {(profile && user && !features.includes("profile-settings-v1") || !user && !setup && !recoveryCodes) && <SettingsSection title={profile ? t(navigation.pathname==="/profile/avatar" ? "profile.avatarEditorTitle" : profileView ? PROFILE_VIEWS[profileView].title : "nav.profile") : undefined}>
      {user && <button type="button" disabled={busy} className={button} onClick={() => { setPassword(""); setCode(""); void action(() => client.logout(() => { setUser(null); dataRuntime.reset(); setSetup(null); setRecoveryCodes(null); setIdentifier(""); navigation.replace("/login"); })); }}><LogOut className="h-4 w-4" />{t("nativeFoundation.logout")}</button>}
      {canDiagnose && <AppLink className={button} href="/diagnostics">{t("nativeDiagnostics.open")}</AppLink>}
      <AppLink className={button} href="/privacy">{t("nativeFoundation.privacy")}</AppLink>
      {termsUrl && <button className={button} onClick={() => void openExternalUrl(termsUrl)}>{t("nativeFoundation.terms")}</button>}
    </SettingsSection>}
    {(error || offline) && canDiagnose && user && !profile && !diagnostics && !setup && !recoveryCodes && <AppLink className={button} href="/diagnostics">{t("nativeDiagnostics.open")}</AppLink>}
    {(error || offline) && !diagnostics && !setup && !recoveryCodes && <button className={button} disabled={busy} onClick={() => void bootstrap()}>{t("nativeFoundation.retry")}</button>}
  </AppShellFrame></AccountActionsProvider>;
}
