import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/components/I18nProvider";
import { messagesFor } from "@/lib/i18n";
import { toLanguageCode } from "@/lib/languages";
import NativeFoundation from "./NativeFoundation";
import NativeNavigationProvider from "./NativeNavigationProvider";
import NativeBuildBanner from "./NativeBuildBanner";
import { NativeSessionClient } from "@/lib/native/client";
import { nativeSecureSessionStore } from "@/lib/native/bridge";
import "@/app/globals.css";
import "./native.css";

declare const NATIVE_API_BASE_URL: string;
declare const NATIVE_TERMS_URL: string | null;
// Door scripts/native/build.ts ingebouwd; alleen distributieprofielen tonen een testbanner.
declare const NATIVE_BUILD_DISTRIBUTION: boolean;
declare const NATIVE_BUILD_CHANNEL: string;
declare const NATIVE_BUILD_VERSION: string;
declare const NATIVE_BUILD_NUMBER: number;
const client = new NativeSessionClient(NATIVE_API_BASE_URL, nativeSecureSessionStore);
function NativeRoot() {
  const [language, setLanguage] = useState(toLanguageCode(navigator.language));
  const changeLanguage = useCallback((value: string) => { const code = toLanguageCode(value); document.documentElement.lang = code; setLanguage(code); }, []);
  return <I18nProvider language={language} messages={messagesFor(language)}><NativeNavigationProvider><NativeFoundation client={client} termsUrl={NATIVE_TERMS_URL} onLanguage={changeLanguage} buildBanner={NATIVE_BUILD_DISTRIBUTION ? <NativeBuildBanner channel={NATIVE_BUILD_CHANNEL} version={NATIVE_BUILD_VERSION} build={NATIVE_BUILD_NUMBER} /> : null} /></NativeNavigationProvider></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<NativeRoot />);
