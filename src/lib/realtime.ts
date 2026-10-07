import type { Server as SocketIOServer } from "socket.io";
import { DATA_EVENT_SOCKET_NAME, LIVE_TOPICS, topicRoom, type LiveTopic } from "@/lib/data/scopes";

// Next kan API-routes in een andere modulebundel laden dan gameServer.ts.
// globalThis zorgt dat beide bundels binnen hetzelfde Node-proces dezelfde
// Socket.io-server zien, zonder de eager-importketen van server.ts uit te
// breiden. Over meerdere instanties verspreidt de Redis-adapter de room-emit.
const realtimeGlobal = globalThis as typeof globalThis & {
  __versadoRealtimeServer?: SocketIOServer;
};

export function setRealtimeServer(server: SocketIOServer): void {
  realtimeGlobal.__versadoRealtimeServer = server;
}

export function emitToUser(userId: string, event: string, payload?: unknown): void {
  realtimeGlobal.__versadoRealtimeServer?.to(`user:${userId}`).emit(event, payload);
}

/** Een room (bv. een lopende gezamenlijke run) laten weten dat er iets veranderd is; de client haalt zelf opnieuw op. */
export function emitToRoom(room: string, event: string, payload?: unknown): void {
  realtimeGlobal.__versadoRealtimeServer?.to(room).emit(event, payload);
}

// Realtime-onderwerpen (zie LIVE_TOPICS in src/lib/data/scopes.ts): alleen
// clients die het onderwerp volgen (klassement in beeld) ontvangen dit, en
// alleen de naam van de gebeurtenis, nooit gegevens: de client haalt zelf
// opnieuw op. Meerdere meldingen kort na elkaar worden samengevoegd, zodat een
// drukke periode niet voor elke score een golf aanvragen veroorzaakt.
const TOPIC_COALESCE_MS = 1_000;
const pendingTopics = new Set<LiveTopic>();

export function emitTopicEvent(topic: LiveTopic): void {
  if (pendingTopics.has(topic)) return;
  pendingTopics.add(topic);
  const timer = setTimeout(() => {
    pendingTopics.delete(topic);
    realtimeGlobal.__versadoRealtimeServer?.to(topicRoom(topic)).emit(DATA_EVENT_SOCKET_NAME, { event: LIVE_TOPICS[topic] });
  }, TOPIC_COALESCE_MS);
  // Een openstaande timer mag het afsluiten van het proces niet tegenhouden.
  timer.unref?.();
}
