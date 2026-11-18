// Alleen browserbewijs: native bridge en veilige sessieopslag worden door het Node-harnas gesimuleerd.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/components/I18nProvider";
import { messagesFor } from "../../src/lib/i18n";
import { toLanguageCode } from "../../src/lib/languages";
import NativeFoundation from "../../src/components/native/NativeFoundation";
import NativeAccessPanel from "../../src/components/native/NativeAccessPanel";
import NativeNavigationProvider from "../../src/components/native/NativeNavigationProvider";
import { NativeClientError, NativeSessionClient } from "../../src/lib/native/client";
import { nativeBridge } from "../../src/lib/native/bridge";
import { nativeAccessTransport, INTERNAL_ACCESS_ORIGIN } from "../../src/lib/native/access";
const device = new URLSearchParams(location.search).get("device")!;
const storage = `/safe-session?device=${encodeURIComponent(device)}`;
const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, {
  async read() { return (await (await fetch(storage)).json()).value; },
  async write(value) { const response = await fetch(storage, { method: "PUT", body: value }); if (!response.ok) throw Error("synthetic storage failure"); },
  async clear() { await fetch(storage, { method: "DELETE" }); },
}, nativeAccessTransport(nativeBridge), false);
const language = toLanguageCode(navigator.language);
function App() {
  const [epoch, setEpoch] = useState(0);
  return <I18nProvider language={language} messages={messagesFor(language)}><NativeNavigationProvider><NativeFoundation key={epoch} client={client} internalAccess={<NativeAccessPanel onBeforeClear={async () => { try { await client.logout(); } catch (error) { if (!(error instanceof NativeClientError) || error.code === "secure_storage_unavailable") throw error; } }} onChanged={async () => { try { await client.logout(() => setEpoch(value => value + 1)); } catch (error) { if (!(error instanceof NativeClientError) || error.code === "secure_storage_unavailable") throw error; } }} />} /></NativeNavigationProvider></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
