"use client";
import { useRef, useState } from "react";
import FriendRequestButtonsView from "./FriendRequestButtonsView";
/** Eén controller en presentatie voor beide platformen. Geen optimistische
 * vriendschap; de bevestiging blijft staan als een vervolg-GET mislukt. */
export default function FriendRequestControl({ name, respond }: { name: string; respond: (action: "accept" | "decline") => Promise<void> }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [completed, setCompleted] = useState<"accept" | "decline" | null>(null);
  async function act(action: "accept" | "decline") {
    if (pending.current || completed) return;
    pending.current = true; setBusy(true); setFailed(false);
    try { await respond(action); setCompleted(action); }
    catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  }
  return <FriendRequestButtonsView name={name} busy={busy} failed={failed} completed={completed} respond={action => { void act(action); }}/>;
}
