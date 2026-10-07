import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { canUseMystery002, completeMystery, getMysteryProgress, markMysteryTutorialSeen } from "@/lib/mysteries/progress";
import { MYSTERY_002A } from "@/lib/mysteries/mystery002a";
import { MYSTERY_002B } from "@/lib/mysteries/mystery002b";
import { MYSTERY_002C } from "@/lib/mysteries/mystery002c";
import type { MysteryDefinition, Placements } from "@/lib/mysteries/types";

const cell = z.object({ row: z.number().int().min(1).max(6), column: z.number().int().min(1).max(6) });
const placements = z.object({
  nephi: cell.nullable().optional(),
  laman: cell.nullable().optional(),
  lemuel: cell.nullable().optional(),
  sam: cell.nullable().optional(),
  laban: cell.nullable().optional(),
  zoram: cell.nullable().optional(),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), placements, hintCount: z.number().int().min(0).max(99) }),
  z.object({ action: z.literal("tutorial-seen") }),
]);

const definitions: Record<string, MysteryDefinition> = {
  "002a": MYSTERY_002A,
  "002b": MYSTERY_002B,
  "002c": MYSTERY_002C,
};

async function authorizedUser() {
  const user = await getCurrentUser();
  if (!user) return { user: null, status: 401 as const };
  if (!(await canUseMystery002(user.id, user.isAdmin))) return { user: null, status: 403 as const };
  return { user, status: 200 as const };
}

async function definitionFor(variant: string): Promise<MysteryDefinition | null> {
  return definitions[variant] ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ variant: string }> }) {
  const auth = await authorizedUser();
  if (!auth.user) return await apiError(auth.status === 401 ? "apiErrors.notLoggedIn" : "apiErrors.forbidden", auth.status);
  const definition = await definitionFor((await params).variant);
  if (!definition) return await apiError("apiErrors.itemNotFound", 404);
  return NextResponse.json(await getMysteryProgress(auth.user.id, definition));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ variant: string }> }) {
  const auth = await authorizedUser();
  if (!auth.user) return await apiError(auth.status === 401 ? "apiErrors.notLoggedIn" : "apiErrors.forbidden", auth.status);
  const definition = await definitionFor((await params).variant);
  if (!definition) return await apiError("apiErrors.itemNotFound", 404);
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (parsed.data.action === "tutorial-seen") {
    await markMysteryTutorialSeen(auth.user.id, definition);
    return NextResponse.json({ ok: true });
  }
  const result = await completeMystery(auth.user.id, definition, parsed.data.placements as Placements, parsed.data.hintCount);
  if (!result.correct) return NextResponse.json({ correct: false, error: "Er klopt nog iets niet." }, { status: 422 });
  return NextResponse.json(result);
}
