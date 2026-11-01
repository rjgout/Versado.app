"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { LocalAppImage, type AppImageProps } from "@/components/navigation/AppNavigation";
import { useNativeData, useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { studyMediaIdFromSource } from "@/lib/native/studyMediaContract";
import type { NativeTodayOverview } from "@/lib/native/todayContract";
const Context = createContext<Pick<NativeTodayOverview, "userId" | "activeCollectionId" | "selectionVersion"> | null>(null);
export function NativeStudyMediaProvider({ state, children }: { state: Pick<NativeTodayOverview, "userId" | "activeCollectionId" | "selectionVersion">; children: ReactNode }) { return <Context.Provider value={state}>{children}</Context.Provider>; }
function ProtectedImage({ mediaId, ...props }: AppImageProps & { mediaId: string }) {
  const runtime = useNativeData(), state = useContext(Context);
  const [failedChecksum, setFailedChecksum] = useState<string | null>(null);
  if (!state) throw new Error("NativeStudyMediaProvider ontbreekt");
  const query = useNativeLiveQuery(["study-media", state.userId, state.activeCollectionId, state.selectionVersion, mediaId], () => runtime.studyImage(mediaId, state), {
    scopes: ["studyContent", "content"], staleTime: 60_000, pollMs: 60_000, discardOnRevalidate: true,
    validUntil: data => data.validUntil,
  });
  if (!query.data || query.data.checksum === failedChecksum) return <span aria-hidden="true" data-native-study-placeholder className="pointer-events-none absolute inset-0 flex items-center justify-center bg-vs-overlay"><BookOpen className="h-12 w-12 text-white/25"/></span>;
  return <LocalAppImage {...props} src={query.data.src} onError={event => { setFailedChecksum(query.data!.checksum); props.onError?.(event); }}/>;
}
/** De private web-URL bereikt nooit img.src/fetch. Alleen de exacte ID gaat
 * via de bestaande Bearer-/Service Auth-bridge naar de read-only native poort. */
export default function NativeStudyImage(props: AppImageProps) {
  const id = studyMediaIdFromSource(props.src);
  return id ? <ProtectedImage {...props} key={id} mediaId={id}/> : <LocalAppImage {...props}/>;
}
