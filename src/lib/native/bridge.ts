import { registerPlugin } from "@capacitor/core";
import { NativeClientError, type SecureSessionStore } from "./client";
import type { NativeAccessBridge } from "./access";
interface NativeBridge extends NativeAccessBridge {
  readSession(): Promise<{ value?: string }>;
  writeSession(options: { value: string }): Promise<void>;
  clearSession(): Promise<void>;
  signInWithApple(options: { nonce: string; state: string }): Promise<{ identityToken: string; state: string; displayName?: string }>;
}
export const nativeBridge = registerPlugin<NativeBridge>("VersadoNative");
/** Geen browser/localStorage-terugval voor sessiegeheimen. */
export const nativeSecureSessionStore: SecureSessionStore = {
  async read() { try { return (await nativeBridge.readSession()).value ?? null; } catch { throw new NativeClientError("secure_storage_unavailable"); } },
  async write(value) { try { await nativeBridge.writeSession({ value }); } catch { throw new NativeClientError("secure_storage_unavailable"); } },
  async clear() { try { await nativeBridge.clearSession(); } catch { throw new NativeClientError("secure_storage_unavailable"); } },
};
