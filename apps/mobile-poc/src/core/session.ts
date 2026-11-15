import { NativeSessionClient, type SecureSessionStore } from "@/lib/native/client";
import { nativeGameFetch, type GameActor } from "@/lib/native/gamesClient";
import { NativeSocketConnection } from "@/lib/native/socketClient";
import { nativeTodayOverviewSchema } from "@/lib/native/todayContract";
import { io } from "socket.io-client";
import { z } from "zod";

/** Het bestaande native clientcontract, zonder tweede sessie-, tokenrotatie- of spellaag.
 * Alleen de opslag (Keychain/Keystore) en de transportport verschillen per platform. */
export interface AppSession {
  client: NativeSessionClient;
  gameFetch: typeof fetch;
  actor(): GameActor | null;
  today(): Promise<z.infer<typeof nativeTodayOverviewSchema>>;
  /** Eén accountgebonden realtime-verbinding; geeft een afmeldfunctie voor `friends_changed`. */
  onFriendsChanged(listener: () => void, onError?: (e: unknown) => void): () => void;
  signIn(identifier: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const NATIVE_ORIGIN = "https://localhost";

/** React Native stuurt anders geen Origin mee; de bestaande servercontrole eist er één van de twee native origins. */
export function nativeTransport(baseFetch: typeof fetch = fetch): typeof fetch {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", NATIVE_ORIGIN);
    headers.set("X-Versado-Client", "native-v1");
    return baseFetch(input, { ...init, headers, credentials: "omit" });
  };
}

export function createAppSession(baseUrl: string, store: SecureSessionStore, transport: typeof fetch = nativeTransport()): AppSession {
  const client = new NativeSessionClient(baseUrl, store, transport);
  let actor: GameActor | null = null;
  let socket: NativeSocketConnection | null = null;
  const listeners = new Set<() => void>();
  const closeSocket = () => { socket?.dispose(); socket = null; };
  // Elke sessiewissel (login, logout, vernieuwing naar een ander account) sluit de socket en wist de actor.
  client.onSessionChange(() => { closeSocket(); actor = null; });

  const resolveActor = async () => {
    const t = nativeTodayOverviewSchema.parse(await client.api("today-overview"));
    actor = { id: t.userId, stamp: client.getSessionStamp() };
    return t;
  };
  return {
    client,
    gameFetch: nativeGameFetch(client, () => actor),
    actor: () => actor,
    async signIn(identifier, password) {
      await client.login(identifier, password);
      await resolveActor();
    },
    async today() { const t = nativeTodayOverviewSchema.parse(await client.api("today-overview")); if (!actor || actor.id !== t.userId) actor = { id: t.userId, stamp: client.getSessionStamp() }; return t; },
    onFriendsChanged(listener, onError) {
      listeners.add(listener);
      if (!socket) {
        // De server eist ook bij de websocket een native Origin; RN/Node sturen die niet vanzelf mee.
        socket = new NativeSocketConnection(client, onError, (url, options) => io(url, { ...options, extraHeaders: { Origin: NATIVE_ORIGIN } }));
        socket.socket.on("friends_changed", () => { for (const l of [...listeners]) l(); });
        socket.start();
      }
      return () => { listeners.delete(listener); if (!listeners.size) closeSocket(); };
    },
    async signOut() { closeSocket(); actor = null; await client.logout(); },
  };
}
