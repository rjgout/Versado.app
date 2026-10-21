import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { disconnectUserSockets } from "@/lib/realtime";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    // JWT's hebben geen individuele serverrij: uitloggen trekt daarom alle apparaten in.
    await prisma.user.updateMany({ where: { id: user.id, sessionVersion: user.sessionVersion }, data: { sessionVersion: { increment: 1 } } });
    disconnectUserSockets(user.id);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
