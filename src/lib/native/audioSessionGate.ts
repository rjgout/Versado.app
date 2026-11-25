import { NativeClientError, type NativeSessionClient } from "./client";

export interface NativeAudioSessionBoundary {
  audioSession(options: { sessionStamp: string }): Promise<void>;
}
/** Geen authenticatie: dit ordent alleen bestaande sessiewissels vóór de
 * native HTTPS-requests. Server/Bearer en de native response-anchor blijven
 * onafhankelijk autoritatief. Oude requests kunnen geen nieuwe reset lenen. */
export class NativeAudioSessionGate {
  private stamp: string | null = null;
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly bridge: NativeAudioSessionBoundary) {}
  reset = (stamp: string) => {
    this.stamp = stamp;
    this.pending = Promise.resolve().then(() => this.bridge.audioSession({ sessionStamp: stamp })).catch(() => { throw new NativeClientError("access_changed"); });
    // De requestpoort blijft de fout zien, zonder een losse unhandled rejection.
    void this.pending.catch(() => {});
  };
  attach(client: NativeSessionClient) {
    this.reset(client.getSessionStamp());
    const off = client.onSessionChange(this.reset);
    return () => { off(); this.reset(crypto.randomUUID()); };
  }
  beforeRequest = async (stamp: string | undefined) => {
    if (!stamp || stamp !== this.stamp) throw new NativeClientError("access_changed");
    await this.pending;
    if (stamp !== this.stamp) throw new NativeClientError("access_changed");
  };
}
