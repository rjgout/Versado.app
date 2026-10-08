import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getOpenActions, type OpenActionTab } from "@/lib/openActions";

const validTabs = new Set<OpenActionTab>(["required", "continue", "waiting"]);

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const tabParam = req.nextUrl.searchParams.get("tab");
  const tab = validTabs.has(tabParam as OpenActionTab) ? (tabParam as OpenActionTab) : "required";
  const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20));
  const data = await getOpenActions(user);
  const all = data.items[tab];
  return NextResponse.json({
    tab,
    counts: data.counts,
    activeContentCollectionId: data.activeContentCollectionId,
    items: all.slice(offset, offset + limit),
    nextOffset: offset + limit < all.length ? offset + limit : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
