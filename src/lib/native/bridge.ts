import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { NativeClientError, type SecureSessionStore } from "./client";
import type { NativeAudioBridge } from "./audioBridge";
import type { NativeAccessBridge } from "./access";
import { registerPairedListeners, type NativeTabBarBridge } from "./tabBar";
interface NativeBridge extends NativeAccessBridge, NativeAudioBridge {
  interfacePreferences(): Promise<unknown>;
  tabBarSupport(): Promise<unknown>;
  tabBarSync(options: Record<string, unknown>): Promise<unknown>;
  tabBarClear(): Promise<void>;
  addListener(event: "tabBarSelect" | "tabBarLayout", callback: (value: unknown) => void): Promise<PluginListenerHandle>;
  addListener(event: "audioState", callback: (value: unknown) => void): Promise<PluginListenerHandle>;
  addListener(event: "interfacePreferences", callback: (value: unknown) => void): Promise<PluginListenerHandle>;
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
/** Dunne adapter voor de systeemtabbalk; de plugin zelf blijft de enige native ingang. */
export const nativeTabBarBridge: NativeTabBarBridge = {
  support: () => nativeBridge.tabBarSupport(),
  sync: payload => nativeBridge.tabBarSync(payload),
  clear: () => nativeBridge.tabBarClear(),
  listen: (callbacks, signal) => registerPairedListeners(
    (name, callback) => nativeBridge.addListener(name, callback), callbacks, signal),
};
