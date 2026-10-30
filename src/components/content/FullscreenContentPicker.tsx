"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { contentDepartureLocation, currentEntryKey } from "@/lib/navigationHistory";
import { useLiveQuery } from "@/lib/data/hooks";
import { liveMutation } from "@/lib/data/mutation";
import { fetchJson } from "@/lib/data/fetchJson";
import { type ContentPickerContext, type PickerEdition } from "@/lib/contentPickerContract";
import type { SwitchResult } from "@/lib/contentSwitch";
import ContentPickerView from "./ContentPickerView";

export default function FullscreenContentPicker({ initialData, sessionKey, isAdmin = false }: { initialData: ContentPickerContext; sessionKey: string; isAdmin?: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const query = useLiveQuery<ContentPickerContext>(["content", "picker", sessionKey], () => fetchJson("/api/content-context?view=picker"), {
    scopes: ["content", "studyContext"], initialData, staleTime: 0,
  });
  const data = query.data ?? initialData;
  const locked = useRef(false), alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"error" | "conflict" | "unavailableLanguage" | "unavailableSource" | null>(null);
  useEffect(() => { alive.current = true; contentDepartureLocation(sessionKey); return () => { alive.current = false; }; }, [sessionKey]);

  async function select(edition: PickerEdition) {
    if (locked.current || !edition.selectable) return false;
    locked.current = true; setBusy(true); setMessage(null);
    const entry = currentEntryKey();
    const location = contentDepartureLocation(sessionKey);
    let navigating = false;
    try {
      const result = await liveMutation(async () => {
        const response = await fetch("/api/content-context", {
          method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentCollectionId: edition.id, picker: true, expectedSelection: data.selection, location }),
        });
        if (response.status === 409) throw new Error("conflict");
        if (!response.ok) throw new Error("error");
        return response.json() as Promise<SwitchResult>;
      }, { invalidates: "contentChanged" });
      // Terug/vooruit of een andere navigatie tijdens de request mag niet worden overschreven.
      if (!alive.current || window.location.pathname !== "/content" || currentEntryKey() !== entry) return false;
      if (!result.applied || result.outcome.kind !== "redirect") throw new Error("error");
      // Een ander apparaat kan na deze commit alweer een nieuwere keuze hebben gemaakt.
      // Een vertraagd antwoord mag dan niet naar de inmiddels oude bron navigeren.
      const latest = await fetchJson<ContentPickerContext>("/api/content-context?view=picker");
      if (!alive.current || window.location.pathname !== "/content" || currentEntryKey() !== entry) return false;
      if (latest.selection.activeContentCollectionId !== result.selection?.activeContentCollectionId
        || latest.selection.contentLanguage !== result.selection?.contentLanguage) throw new Error("conflict");
      query.setData(latest);
      navigating = result.availability !== "no-destination";
      router.replace(result.availability === "no-destination" ? "/content?status=no-destination" : result.outcome.href);
      router.refresh();
      return true;
    } catch (error) {
      if (!alive.current || window.location.pathname !== "/content" || currentEntryKey() !== entry) return false;
      setMessage(error instanceof Error && error.message === "conflict" ? "conflict" : "error");
      await query.refetch();
      return false;
    } finally { if (!navigating && alive.current) { locked.current = false; setBusy(false); } }
  }

  return <ContentPickerView data={data} busy={busy} message={message ?? (query.error ? "error" : null)} onSelect={select}
    onRetry={() => { setMessage(null); void query.refetch(); }} noDestination={search.get("status") === "no-destination"}
    links={{ hymns: "/dev/lofzangen", studyFolder: "/study-folder", admin: isAdmin ? "/adminbackend/content/inspect" : undefined }} />;
}
