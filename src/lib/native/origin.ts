export const NATIVE_ORIGINS = ["capacitor://localhost", "https://localhost"] as const;
export function nativeOriginAllowed(origin: string | null | undefined) { return !!origin && (NATIVE_ORIGINS as readonly string[]).includes(origin); }
