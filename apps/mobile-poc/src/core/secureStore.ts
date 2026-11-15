import * as SecureStore from "expo-secure-store";
import type { SecureSessionStore } from "@/lib/native/client";

const KEY = "versado.native.session.v1";
/** Keychain (iOS) / Keystore (Android): nooit AsyncStorage of bestandsopslag voor tokens. */
export const secureSessionStore: SecureSessionStore = {
  read: () => SecureStore.getItemAsync(KEY),
  write: v => SecureStore.setItemAsync(KEY, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
