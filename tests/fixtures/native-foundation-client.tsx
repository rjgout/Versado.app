import { useTestMaterial } from "./native-material-client";
// Alleen browserharnas: simuleert Keychain via eigen testservergeheugen.
// Dit bestand wordt nooit in dist/native of de productie-app gebundeld.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/components/I18nProvider";
import { messagesFor } from "../../src/lib/i18n";
import { toLanguageCode } from "../../src/lib/languages";
import NativeBuildBanner from "../../src/components/native/NativeBuildBanner";
import NativeFoundation from "../../src/components/native/NativeFoundation";
import NativeNavigationProvider from "../../src/components/native/NativeNavigationProvider";
import {nativeDirectTransport,TEST_API_ORIGIN} from "../../src/lib/native/access";
import { NativeSessionClient } from "../../src/lib/native/client";
const key = new URLSearchParams(location.search).get("device") ?? "device-a";
const storage = `/test-keychain/${encodeURIComponent(key)}`;
const bridged=new URLSearchParams(location.search).get("folderBridge")==="1";
const transport:typeof fetch=bridged?nativeDirectTransport({
  async accessStatus(){return {enabled:true,configured:true};},
  async enrollAccess(){return {changed:false};},async clearAccess(){return {changed:false};},
  async accessRequest({path,method,authorization,body}){
    const response=await fetch(`${location.origin}/api/v1/native/${path}`,{method,headers:{...(authorization?{Authorization:authorization}:{}),...(body?{"Content-Type":"application/json"}:{})},body});
    if(!response.headers.get("Content-Type")?.startsWith("application/json"))throw new Error("access_invalid_response");
    return {status:response.status,body:await response.text()};
  },
}):((input,init)=>fetch(input,init));
const client = new NativeSessionClient(bridged?TEST_API_ORIGIN:location.origin, {
  async read() { return (await (await fetch(storage)).json()).value; },
  async write(value) { const res=await fetch(storage,{method:"PUT",body:value});if(!res.ok)throw Error("synthetic secure storage failure"); },
  async clear() { await fetch(storage,{method:"DELETE"}); },
},transport);
// De nieuwe Vandaag-proef volgt net als productie-entry het bevestigde account; legacyproeven houden hun vaste locale.
const followAccount = new URLSearchParams(location.search).get("accountLanguage") === "1";
function FoundationTestRoot() {
  useTestMaterial();
  const [language, setLanguage] = useState(toLanguageCode(navigator.language));
  const changeLanguage = useCallback((value: string) => { const code = toLanguageCode(value); document.documentElement.lang = code; setLanguage(code); }, []);
  return <I18nProvider language={language} messages={messagesFor(language)}><NativeNavigationProvider><NativeFoundation client={client} onLanguage={followAccount ? changeLanguage : undefined} internalTools buildIndicator={<NativeBuildBanner compact channel="internal" version="0.1.0" build={1}/>} buildBanner={<NativeBuildBanner channel="internal" version="0.1.0" build={1}/>}/></NativeNavigationProvider></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<FoundationTestRoot/>);
