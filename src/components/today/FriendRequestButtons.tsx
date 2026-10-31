"use client";
import FriendRequestButtonsView from "./FriendRequestButtonsView";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socketClient";

// Zelfde endpoints en seintje als de vriendenpagina (FriendsClient): na
// accepteren krijgt de ander het via "friendship_changed" meteen te zien.
export default function FriendRequestButtons({ friendshipId, otherUserId, name }: { friendshipId: string; otherUserId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    const res = await fetch(`/api/friends/${friendshipId}/${action}`, { method: "POST" }).catch(() => null);
    if (res?.ok && action === "accept") getSocket().emit("friendship_changed", { otherUserId });
    router.refresh();
    setBusy(false);
  }

  return <FriendRequestButtonsView name={name} busy={busy} respond={action => { void respond(action); }}/>;
}
