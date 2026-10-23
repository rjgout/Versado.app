import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { consumeAuthToken } from "@/lib/authTokens";
import { confirmPendingRegistration } from "@/lib/registration";
import type { User } from "@/generated/prisma/client";

export type EmailConfirmationResult = { status: "confirmed"; user: User | null; returnTo: string | null } | { status: "already" | "expired" | "invalid" };
/** De bestaande registratieclaim voor web/native; oude accountlinks blijven geldig.
 * Alleen de webadapter mag na nieuwe registratie een cookie zetten. */
export async function confirmAccountEmail(token: string): Promise<EmailConfirmationResult> {
  const result = await confirmPendingRegistration(token);
  if (result.status === "confirmed") return result;
  if (result.status !== "notPending") return { status: result.status };
  const candidate = await prisma.authToken.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") }, select: { userId: true, type: true } });
  if (!candidate || candidate.type !== "EMAIL_VERIFY") return { status: "invalid" };
  const confirmed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
    const userId = await consumeAuthToken(token, "EMAIL_VERIFY", tx);
    if (!userId) return false;
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return true;
  });
  return confirmed ? { status: "confirmed", user: null, returnTo: null } : { status: "invalid" };
}
