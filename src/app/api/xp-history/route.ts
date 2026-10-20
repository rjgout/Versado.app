import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { weekStartKey } from "@/lib/dates";
import { apiError } from "@/lib/apiError";

const PAGE_SIZE = 30;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { searchParams } = new URL(req.url);
  const skipParam = searchParams.get("skip");
  const skip = skipParam !== null ? Number(skipParam) : 0;
  if (!Number.isInteger(skip) || skip < 0) {
    return await apiError("apiErrors.invalidSkip", 400);
  }

  const transactions = await prisma.xPTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    skip,
    take: PAGE_SIZE + 1,
  });

  // Alleen op de eerste pagina nodig (voor de "deze week"-pil in de hero-
  // kaart) — bij "meer laden" onnodig opnieuw optellen.
  let totals: Record<string, number> = {};
  if (skip === 0) {
    const weekKey = weekStartKey();
    const weekStart = new Date(`${weekKey}T00:00:00.000Z`);
    const [movements, score] = await Promise.all([
      prisma.xPTransaction.groupBy({
        by: ["reason"], where: { userId: user.id, createdAt: { gte: weekStart } },
        _sum: { amount: true },
      }),
      prisma.weeklyScore.findUnique({ where: { userId_weekStart: { userId: user.id, weekStart: weekKey } }, select: { xp: true } }),
    ]);
    totals = {
      xpThisWeek: movements.filter(m => m.reason !== "VILLAGE_GIFT_RECEIVED" && (m._sum.amount ?? 0) > 0).reduce((sum, m) => sum + (m._sum.amount ?? 0), 0),
      xpReceivedThisWeek: movements.find(m => m.reason === "VILLAGE_GIFT_RECEIVED")?._sum.amount ?? 0,
      xpSentThisWeek: -(movements.find(m => m.reason === "VILLAGE_GIFT_SENT")?._sum.amount ?? 0),
      competitionXpThisWeek: score?.xp ?? 0,
    };
  }

  const hasMore = transactions.length > PAGE_SIZE;
  return NextResponse.json({
    transactions: transactions.slice(0, PAGE_SIZE),
    hasMore,
    xpTotal: user.xpTotal,
    ...totals,
  }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
}
