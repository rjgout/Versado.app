import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/components/I18nProvider";
import { messagesFor } from "@/lib/i18n";
import { toLanguageCode } from "@/lib/languages";
import NativeFoundation from "./NativeFoundation";
import NativeNavigationProvider from "./NativeNavigationProvider";
import NativeBuildBanner from "./NativeBuildBanner";
import { NativeClientError, NativeSessionClient } from "@/lib/native/client";
import { nativeSecureSessionStore, nativeBridge } from "@/lib/native/bridge";
import { nativeAccessTransport } from "@/lib/native/access";
import NativeAccessPanel from "./NativeAccessPanel";
import "@/app/globals.css";
import "./native.css";

declare const NATIVE_API_BASE_URL: string;
declare const NATIVE_TERMS_URL: string | null;
// Door scripts/native/build.ts ingebouwd; alleen distributieprofielen tonen een testbanner.
declare const NATIVE_BUILD_DISTRIBUTION: boolean;
declare const NATIVE_BUILD_CHANNEL: string;
declare const NATIVE_BUILD_VERSION: string;
declare const NATIVE_BUILD_NUMBER: number;
declare const NATIVE_INTERNAL_ACCESS: boolean;
const client = new NativeSessionClient(NATIVE_API_BASE_URL, nativeSecureSessionStore, NATIVE_INTERNAL_ACCESS ? nativeAccessTransport(nativeBridge) : undefined, !NATIVE_INTERNAL_ACCESS);
function NativeRoot() {
  const [language, setLanguage] = useState(toLanguageCode(navigator.language));
  const [accessEpoch, setAccessEpoch] = useState(0);
  const beforeAccessClear = useCallback(async () => {
    try { await client.logout(); }
    catch (error) {
      // Een netwerk-/Access-fout volgt ná de duurzame logoutintentie. Een opslagfout mag wissen niet bevestigen.
      if (!(error instanceof NativeClientError) || error.code === "secure_storage_unavailable") throw error;
    }
  }, []);
  const accessChanged = useCallback(async () => {
    // Bestaande duurzame logout-/intrekkingsintentie gebruiken, ook als Access al dicht is.
    try { await client.logout(() => setAccessEpoch(value => value + 1)); }
    catch (error) {
      if (!(error instanceof NativeClientError) || error.code === "secure_storage_unavailable") throw error;
    }
  }, []);
  const changeLanguage = useCallback((value: string) => { const code = toLanguageCode(value); document.documentElement.lang = code; setLanguage(code); }, []);
  return <I18nProvider language={language} messages={messagesFor(language)}><NativeNavigationProvider><NativeFoundation key={accessEpoch} client={client} termsUrl={NATIVE_TERMS_URL} onLanguage={changeLanguage} internalAccess={NATIVE_INTERNAL_ACCESS ? <NativeAccessPanel onChanged={accessChanged} onBeforeClear={beforeAccessClear} /> : null} buildBanner={NATIVE_BUILD_DISTRIBUTION ? <NativeBuildBanner channel={NATIVE_BUILD_CHANNEL} version={NATIVE_BUILD_VERSION} build={NATIVE_BUILD_NUMBER} /> : null} /></NativeNavigationProvider></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<NativeRoot />);
