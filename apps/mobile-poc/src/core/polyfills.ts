import * as Crypto from "expo-crypto";
// NativeSessionClient gebruikt crypto.randomUUID(); Hermes heeft dat niet.
const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
g.crypto ??= {};
g.crypto.randomUUID ??= () => Crypto.randomUUID();
