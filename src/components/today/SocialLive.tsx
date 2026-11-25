"use client";

import { useEffect, useState } from "react";
import SocialView from "./SocialView";
import { getSocket } from "@/lib/socketClient";
import type { TodayData } from "@/lib/today";

// Wie er nu online is, live bijgewerkt: dezelfde socketberichten als de
// vriendenpagina (zie FriendsClient.tsx). De server stuurt alleen wat een
// vriend zelf deelt (presence.ts, ook incognito) en alleen aan wie de eigen
// status deelt, dus hier wordt niets gefilterd of afgeleid.

interface StatusUpdate {
  userId: string;
  hidden: boolean;
  online?: boolean;
  activity?: { icon: string; label: string };
}

export default function SocialLive({ social }: { social: TodayData["social"] }) {
  const [online, setOnline] = useState(social.online);

  // Na router.refresh (bv. een nieuwe vriend) komt er een nieuwe beginstand.
  useEffect(() => setOnline(social.online), [social.online]);

  useEffect(() => {
    const socket = getSocket();
    function onStatusUpdate(payload: StatusUpdate) {
      setOnline((prev) => {
        const next = { ...prev };
        if (payload.hidden || !payload.online) delete next[payload.userId];
        else next[payload.userId] = payload.activity?.label ?? null;
        return next;
      });
    }
    function onStatusReset() {
      setOnline({});
    }
    // Een nieuw verzoek of een geaccepteerde vriendschap ververst de hele pagina via de
    // live-data-laag (friends_changed → friendsChanged → LiveRefresh op Vandaag).
    // De activiteit van vrienden kent alleen de socketserver; vraag de
    // actuele stand op bij openen en bij terugkeren naar de app.
    function requestStatuses() {
      if (document.visibilityState === "visible") socket.emit("friend_statuses_request");
    }
    socket.on("friend_status_update", onStatusUpdate);
    socket.on("friend_status_reset", onStatusReset);
    socket.on("connect", requestStatuses);
    document.addEventListener("visibilitychange", requestStatuses);
    requestStatuses();
    return () => {
      socket.off("friend_status_update", onStatusUpdate);
      socket.off("friend_status_reset", onStatusReset);
      socket.off("connect", requestStatuses);
      document.removeEventListener("visibilitychange", requestStatuses);
    };
  }, []);

  return <SocialView social={{ ...social, online }} />;
}
