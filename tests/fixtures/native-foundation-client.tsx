// Alleen browserharnas: simuleert Keychain via eigen testservergeheugen.
// Dit bestand wordt nooit in dist/native of de productie-app gebundeld.
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/components/I18nProvider";
import { messagesFor } from "../../src/lib/i18n";
import { toLanguageCode } from "../../src/lib/languages";
import NativeFoundation from "../../src/components/native/NativeFoundation";
import { NativeSessionClient } from "../../src/lib/native/client";
const key = new URLSearchParams(location.search).get("device") ?? "device-a";
const storage = `/test-keychain/${encodeURIComponent(key)}`;
const client = new NativeSessionClient(location.origin, {
  async read() { return (await (await fetch(storage)).json()).value; },
  async write(value) { const res=await fetch(storage,{method:"PUT",body:value});if(!res.ok)throw Error("synthetic secure storage failure"); },
  async clear() { await fetch(storage,{method:"DELETE"}); },
});
const language=toLanguageCode(navigator.language);
createRoot(document.getElementById("root")!).render(<I18nProvider language={language} messages={messagesFor(language)}><NativeFoundation client={client}/></I18nProvider>);
