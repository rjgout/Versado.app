import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/components/I18nProvider";
import { messagesFor } from "@/lib/i18n";
import { toLanguageCode } from "@/lib/languages";
import NativeFoundation from "./NativeFoundation";
import { NativeSessionClient } from "@/lib/native/client";
import { nativeSecureSessionStore } from "@/lib/native/bridge";
import "@/app/globals.css";
import "./native.css";

declare const NATIVE_API_BASE_URL: string;
declare const NATIVE_TERMS_URL: string | null;
const client = new NativeSessionClient(NATIVE_API_BASE_URL, nativeSecureSessionStore);
function NativeRoot() {
  const [language, setLanguage] = useState(toLanguageCode(navigator.language));
  const changeLanguage = useCallback((value: string) => { const code = toLanguageCode(value); document.documentElement.lang = code; setLanguage(code); }, []);
  return <I18nProvider language={language} messages={messagesFor(language)}><NativeFoundation client={client} termsUrl={NATIVE_TERMS_URL} onLanguage={changeLanguage} /></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<NativeRoot />);
