"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { NativeSessionClient } from "@/lib/native/client";
import { NativeDataRuntime } from "./native";
import { installNativeApplicationRuntime } from "./applicationRuntime";
import { subscribeTopic } from "./topics";
import { SharedDataRuntimeContext, useQueryStore, type UseLiveQueryOptions } from "./queryHooks";
import type { LiveEnvironment, QueryKey } from "./store";

const nativeEnvironment: LiveEnvironment = {
  now: () => Date.now(), random: () => Math.random(),
  isVisible: () => document.visibilityState !== "hidden", isOnline: () => navigator.onLine !== false,
  schedule: (fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); },
};

const Context = createContext<NativeDataRuntime | null>(null);
export function NativeDataProvider({ client, children }: { client: NativeSessionClient; children: ReactNode }) {
  const runtime = useMemo(() => new NativeDataRuntime(client, nativeEnvironment), [client]);
  const epoch=useSyncExternalStore(runtime.subscribe,runtime.getSnapshot,runtime.getSnapshot);
  const shared=useMemo(()=>({store:runtime.store,prefix:runtime.sharedQueryPrefix(),subscribeTopic:(topic:import("./scopes").LiveTopic)=>subscribeTopic(topic,runtime.gameSocket())}),[runtime,epoch,client]);
  useLayoutEffect(()=>installNativeApplicationRuntime(runtime.application()),[runtime]);
  useEffect(() => runtime.start(window, document), [runtime]);
  return <Context.Provider value={runtime}><SharedDataRuntimeContext.Provider value={shared}>{children}</SharedDataRuntimeContext.Provider></Context.Provider>;
}
export function useNativeData() {
  const runtime = useContext(Context);
  if (!runtime) throw new Error("NativeDataProvider ontbreekt");
  return runtime;
}
export function useNativeLiveQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: UseLiveQueryOptions<T>) {
  const runtime = useNativeData();
  const epoch = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return useQueryStore(runtime.store, ["native", epoch, ...key], fetcher, options);
}
