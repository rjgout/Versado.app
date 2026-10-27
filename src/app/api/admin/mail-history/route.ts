import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/db";
import { MAIL_KINDS, MAIL_STATUSES, MAIL_RETENTION_MS } from "@/lib/mailHistory";
import type { Prisma } from "@/generated/prisma/client";

const filters = z.object({ q: z.string().max(200).default(""), status: z.enum(MAIL_STATUSES).optional(), kind: z.enum(MAIL_KINDS).optional(), from: z.iso.date().optional(), until: z.iso.date().optional(), page: z.coerce.number().int().min(0).max(1000).default(0) });
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return apiError("apiErrors.forbidden", 403);
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || (parsed.data.from && parsed.data.until && parsed.data.from > parsed.data.until)) return apiError("mailLog.invalid", 400);
  const f = parsed.data, oldest = new Date(Date.now() - MAIL_RETENTION_MS);
  const where: Prisma.MailMessageWhereInput = {
    createdAt: { gte: f.from ? new Date(Math.max(new Date(f.from).getTime(), oldest.getTime())) : oldest, ...(f.until ? { lt: new Date(new Date(f.until).getTime() + 86400_000) } : {}) },
    ...(f.status ? { status: f.status } : {}), ...(f.kind ? { kind: f.kind } : {}),
    ...(f.q ? { OR: [{ recipient: { contains: f.q, mode: "insensitive" } }, { subject: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, failures] = await Promise.all([
    prisma.mailMessage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25, skip: f.page * 25,
      include: { user: { select: { email: true, emailVerifiedAt: true, passwordLoginEnabled: true } } } }),
    prisma.mailMessage.count({ where }), prisma.mailMessage.count({ where: { AND: [where, { status: { in: ["FAILED", "UNKNOWN"] } }] } }),
  ]);
  const actorIds = [...new Set(rows.flatMap(row => row.actorId ? [row.actorId] : []))];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, handle: true, discriminator: true } });
  const actorNames = new Map(actors.map(actor => [actor.id, `${actor.handle}#${actor.discriminator}`]));
  const items = rows.map(({ payloadEnc, trackingHash, user: recipientUser, ...row }) => ({ ...row,
    actor: row.actorId ? actorNames.get(row.actorId) ?? row.actorId : null,
    kind: MAIL_KINDS.includes(row.kind as typeof MAIL_KINDS[number]) ? row.kind : "OTHER",
    status: MAIL_STATUSES.includes(row.status as typeof MAIL_STATUSES[number]) ? row.status : "UNKNOWN",
    tracking: Boolean(trackingHash),
    canResend: !["SENDING", "SKIPPED"].includes(row.status) &&
      (!row.userId || recipientUser?.email === row.recipient) &&
      (row.kind === "PENDING_VERIFY" || (row.kind === "EMAIL_VERIFY" ? Boolean(recipientUser && !recipientUser.emailVerifiedAt) : row.kind === "PASSWORD_RESET" ? Boolean(recipientUser?.passwordLoginEnabled) : Boolean(payloadEnc))),
  }));
  return NextResponse.json({ items, total, failures }, { headers: { "Cache-Control": "no-store" } });
}
