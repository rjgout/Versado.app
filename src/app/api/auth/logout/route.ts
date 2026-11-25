import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";
import { logoutAccount } from "@/lib/account/logout";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    // JWT's hebben geen individuele serverrij: uitloggen trekt daarom alle apparaten in.
    await logoutAccount(user);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
