"use client";

import { useCallback, useEffect, useState } from "react";
import {useGameRouter as useRouter} from "@/components/games/GameNavigation";
import { getSocket } from "@/lib/socketClient";
import { useConfirm } from "@/components/ConfirmProvider";

// Lang genoeg om de melding te lezen, kort genoeg om niet te blijven hangen.
const REDIRECT_AFTER_MS = 2500;

/**
 * Gedeeld door alle spelkamers met een lobby. Sluit de host de lobby, dan
 * krijgt iedereen die erin zat "game_cancelled" (zie cancel_game in
 * gameServer.ts): toon kort een melding en ga terug naar Spelen. `leave`
 * haalt een speler (niet de host) zelf uit de lobby.
 */
export function useLobbyExit(code: string, options: { isHost: boolean; alleskenner?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [closedByHost, setClosedByHost] = useState(false);
  const { isHost, alleskenner = false } = options;

  useEffect(() => {
    const socket = getSocket();
    const upper = code.toUpperCase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onCancelled({ code: cancelled }: { code: string }) {
      if (cancelled.toUpperCase() !== upper) return;
      // De host koos er zelf voor: die hoeft geen uitleg.
      if (isHost) {
        router.push("/live");
        return;
      }
      setClosedByHost(true);
      timer = setTimeout(() => router.push("/live"), REDIRECT_AFTER_MS);
    }
    function onLeft({ code: left }: { code: string }) {
      if (left.toUpperCase() === upper) router.push("/live");
    }
    socket.on("game_cancelled", onCancelled);
    socket.on("game_left", onLeft);
    return () => {
      socket.off("game_cancelled", onCancelled);
      socket.off("game_left", onLeft);
      if (timer) clearTimeout(timer);
    };
  }, [code, isHost, router]);

  const leave = useCallback(async () => {
    if (!(await confirm("Deze lobby verlaten?"))) return;
    const socket = getSocket();
    if (alleskenner) socket.emit("ak:leave");
    else socket.emit("leave_game", { code });
  }, [code, alleskenner, confirm]);

  return { closedByHost, leave };
}
