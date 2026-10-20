import type { NextRequest } from "next/server";
import { nativeApi } from "@/lib/native/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return nativeApi(req, (await context.params).path);
}
export { handle as GET, handle as POST, handle as DELETE, handle as OPTIONS };
