"use client";

import { useEffect, useRef, useState } from "react";
import ContentPickerView, { type PickerMessage } from "@/components/content/ContentPickerView";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { useNativeData } from "@/lib/data/nativeHooks";
import { NativeClientError } from "@/lib/native/client";
import type { NativeContentState } from "@/lib/native/contract";
import type { PickerEdition } from "@/lib/contentPickerContract";

/** Alleen native transport/navigatie; kaarten, edities en talen zijn dezelfde React-view. */
export default function NativeContentPicker({ userId, state, error, onRetry, onCommitted }: {
  userId: string; state?: NativeContentState; error: boolean; onRetry: () => void;
  onCommitted: (state: NativeContentState) => void;
}) {
  const runtime = useNativeData(), navigation = useAppNavigation();
  const alive = useRef(true), locked = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<PickerMessage | null>(null), [noDestination, setNoDestination] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function select(edition: PickerEdition) {
    if (!state || locked.current) return false;
    const epoch = runtime.getSnapshot();locked.current = true;setBusy(true);setMessage(null);
    try {
      const response = await runtime.selectContent(userId, { contentCollectionId: edition.id, expectedSelection: state.picker.selection,
        expectedSelectionVersion: state.picker.selectionVersion, location: navigation.contentDeparture?.() ?? "/dashboard" });
      if (!alive.current || runtime.getSnapshot() !== epoch) return false;
      onCommitted(response.state);
      setNoDestination(response.destination === "/content");
      if (response.destination !== "/content") navigation.replace(response.destination);
      return true;
    } catch (error) {
      if (!alive.current || runtime.getSnapshot() !== epoch) return false;
      setMessage(error instanceof NativeClientError && error.code === "content_selection_conflict" ? "conflict" : "error");
      onRetry(); // Alleen GET-herstel; nooit een automatische selectie-/schrijfretry.
      return false;
    } finally { if (alive.current) { locked.current = false;setBusy(false); } }
  }
  return <ContentPickerView data={state?.picker} busy={busy || !state && !error} message={message ?? (error ? "error" : null)}
    onSelect={select} onRetry={() => { setMessage(null);onRetry(); }} noDestination={noDestination} />;
}
