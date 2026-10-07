"use client";

// Realtime-abonnementen met een teller per onderwerp: meerdere componenten
// mogen hetzelfde onderwerp volgen, de server ziet één abonnement, en na een
// herverbinding worden ze opnieuw aangemeld (rooms verdwijnen met de socket).
import { getSocket } from "@/lib/socketClient";
import type { LiveTopic } from "./scopes";

const counts = new Map<LiveTopic, number>();
let reconnectBound = false;

function bindReconnect() {
  if (reconnectBound) return;
  reconnectBound = true;
  getSocket().on("connect", () => {
    for (const topic of counts.keys()) getSocket().emit("data_subscribe", { topic });
  });
}

/** Volg een onderwerp zolang de bijbehorende gegevens in beeld zijn. Geeft de afmelding terug. */
export function subscribeTopic(topic: LiveTopic): () => void {
  bindReconnect();
  const next = (counts.get(topic) ?? 0) + 1;
  counts.set(topic, next);
  if (next === 1) getSocket().emit("data_subscribe", { topic });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (counts.get(topic) ?? 1) - 1;
    if (left <= 0) {
      counts.delete(topic);
      getSocket().emit("data_unsubscribe", { topic });
    } else {
      counts.set(topic, left);
    }
  };
}
