import { createHash } from "node:crypto";
import Redis from "ioredis";
import { NextResponse } from "next/server";
import { failureLockSeconds, registerFailure } from "./rateLimit";

const shared = globalThis as typeof globalThis & { __versadoAuthBudget?: Promise<Redis> };
const counterScript = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;

export function authBudgetKey(scope: string, value: string): string {
  return `auth-budget:${scope}:${createHash("sha256").update(value).digest("hex")}`;
}

/** Redis deelt budgetten tussen processen. Zonder Redis blijft de ondersteunde enkelvoudige opzet werken. */
export async function authBudget(key: string, max: number, windowMs: number): Promise<NextResponse | null> {
  let retry = 0;
  try {
    if (process.env.REDIS_URL) {
      shared.__versadoAuthBudget ??= (async () => {
        const client = new Redis(process.env.REDIS_URL!, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 1, retryStrategy: () => null });
        client.on("error", () => {}); // Geen verbindings-URL of credentials loggen.
        await client.connect();
        return client;
      })();
      const client = await shared.__versadoAuthBudget;
      const [count, ttl] = await client.eval(counterScript, 1, key, windowMs) as [number, number];
      if (count > max) retry = Math.max(1, Math.ceil(ttl / 1000));
    } else {
      retry = failureLockSeconds(key, max);
      if (!retry) registerFailure(key, windowMs);
    }
  } catch {
    shared.__versadoAuthBudget?.then(client => client.disconnect()).catch(() => {});
    shared.__versadoAuthBudget = undefined;
    return NextResponse.json({ error: "Beveiligingscontrole tijdelijk niet beschikbaar." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return retry ? NextResponse.json({ error: "Te veel pogingen. Probeer het later opnieuw." }, {
    status: 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" },
  }) : null;
}
