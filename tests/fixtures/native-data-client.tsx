// Alleen browserbewijs van de gedeelde hooks; dit is geen appscherm of authenticatielaag.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ContentScopeContext, useLiveQuery } from "../../src/lib/data/hooks";
import { NativeDataProvider, useNativeData, useNativeLiveQuery } from "../../src/lib/data/nativeHooks";
import type { NativeSessionClient } from "../../src/lib/native/client";
import type { NativeChapter } from "../../src/lib/native/contract";

type State = { adapter: "web" | "native"; content: string; language: string; chapter: string; user: string };
let account = "A";
const sessionListeners = new Set<() => void>();
const client = {
  async api(path: string) { const response = await fetch(`/query?account=${account}&path=${encodeURIComponent(path)}`); if (!response.ok) throw Error("synthetic read failure"); return response.json(); },
  onSessionChange(listener: () => void) { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; },
} as unknown as NativeSessionClient;
declare global { interface Window { wp6Probe: { set: (patch: Partial<State>) => void } } }
function NativeReader({ state, index }: { state: State; index: number }) {
  const runtime = useNativeData();
  const id = `${state.content}-${state.language}-${state.chapter}`;
  const result = useNativeLiveQuery<NativeChapter>(["chapter", state.user, id], () => runtime.chapter(id), { scopes: ["content", "progress"], contentScoped: true });
  return <output data-query={index} data-loading={result.isLoading} data-error={!!result.error}>{result.data?.title ?? "empty"}</output>;
}
function WebReader({ state, index }: { state: State; index: number }) {
  const result = useLiveQuery<{ label: string }>(["browser-proof", state.chapter], async () => {
    const response = await fetch(`/query?content=${state.content}&language=${state.language}&chapter=${state.chapter}`);
    if (!response.ok) throw Error("synthetic read failure"); return response.json();
  }, { scopes: ["content"], contentScoped: true, initialData: { label: "SSR-A" }, keepPreviousData: true });
  return <output data-query={index} data-loading={result.isLoading} data-error={!!result.error}>{result.data?.label ?? "empty"}</output>;
}
function App() {
  const [state, setState] = useState<State>({ adapter: "web", content: "A", language: "nl", chapter: "one", user: "A" });
  useEffect(() => {
    window.wp6Probe = { set(patch) {
      if (patch.user && patch.user !== account) { account = patch.user; for (const listener of sessionListeners) listener(); }
      setState(previous => ({ ...previous, ...patch }));
    } };
  }, []);
  return <ContentScopeContext.Provider value={{ collectionId: state.content, language: state.language }}>
    {state.adapter === "native" ? <NativeDataProvider client={client}>{[0, 1].map(index => <NativeReader key={index} state={state} index={index} />)}</NativeDataProvider>
      : [0, 1].map(index => <WebReader key={index} state={state} index={index} />)}
  </ContentScopeContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<App />);
