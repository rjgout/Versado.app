import { z } from "zod";
import type { NativeSessionClient } from "./client";

export const emailConfirmationStatus = z.enum(["confirmed", "already", "expired", "invalid"]);
export type EmailConfirmationStatus = z.infer<typeof emailConfirmationStatus>;
export async function confirmNativeEmail(client: NativeSessionClient, token: string): Promise<EmailConfirmationStatus> {
  const result = z.object({ status: emailConfirmationStatus }).strict().parse(await client.publicRequest("verify-email", z.object({ token: z.string().min(1).max(128) }).strict().parse({ token })));
  return result.status;
}
