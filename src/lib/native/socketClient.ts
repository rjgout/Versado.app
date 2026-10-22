import { io, type Socket, type ManagerOptions, type SocketOptions } from "socket.io-client";
import { z } from "zod";
import { NativeClientError, type NativeSessionClient } from "./client";

const proofSchema = z.object({ socketTicket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresIn: z.literal(60) }).strict();
type SocketFactory = (url: string, options: Partial<ManagerOptions & SocketOptions>) => Socket;
/** Eén accountgebonden transport. Elke poging krijgt een vers eenmalig bewijs.
 * Socket.io's eventlisteners blijven bij reconnect bestaan; spelmutaties worden
 * nooit door deze laag herhaald. Na accountwissel is dit transport definitief dicht. */
export class NativeSocketConnection {
  readonly socket: Socket;
  private disposed = false;
  private connecting = false;
  private epoch = 0;
  private retries = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: () => void;
  constructor(private client: NativeSessionClient, private onError?: (error: unknown) => void, factory: SocketFactory = io) {
    this.socket = factory(client.baseUrl, { path: "/socket.io", forceNew: true, autoConnect: false, reconnection: false, transports: ["websocket"], withCredentials: false, auth: {}, timeout: 15_000 });
    this.unsubscribe = client.onSessionChange(() => this.dispose());
    this.socket.on("connect", () => { this.socket.auth = {}; this.retries = 0; });
    this.socket.on("disconnect", () => { this.socket.auth = {}; this.socket.sendBuffer.length = 0; this.socket.receiveBuffer.length = 0; this.socket.disconnect(); this.schedule(); });
    this.socket.on("connect_error", () => { this.socket.auth = {}; this.socket.disconnect(); this.schedule(); });
  }
  start() { void this.connect(); }
  private schedule() {
    if (this.disposed || this.retry) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.retries++, 6));
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, delay);
  }
  private async connect() {
    if (this.disposed || this.connecting || this.socket.connected || this.socket.active) return;
    const epoch = ++this.epoch; this.connecting = true;
    try {
      const proof = proofSchema.parse(await this.client.api("realtime/session", {}));
      if (this.disposed || epoch !== this.epoch) return;
      this.socket.sendBuffer.length = 0; this.socket.receiveBuffer.length = 0;
      this.socket.auth = { client: "native-v1", ticket: proof.socketTicket };
      this.socket.connect();
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return;
      if (error instanceof NativeClientError && error.status === 401) { this.dispose(); this.onError?.(error); return; }
      this.onError?.(error); this.schedule();
    } finally { this.connecting = false; }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.epoch++; clearTimeout(this.retry); this.retry = undefined;
    this.unsubscribe(); this.socket.auth = {};
    // Verwijder ook oude featurelisteners en niet-verzonden acties van account A.
    this.socket.removeAllListeners(); this.socket.disconnect(); this.socket.sendBuffer.length = 0; this.socket.receiveBuffer.length = 0;
  }
}
