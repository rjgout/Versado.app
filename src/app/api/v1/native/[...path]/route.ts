import type { NextRequest } from "next/server";
import { nativeApi } from "@/lib/native/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return nativeApi(req, (await context.params).path);
}
/** De extra spelmethoden verruimen geen bestaande native methodecontracten. */
async function gameMutation(req:NextRequest,context:{params:Promise<{path:string[]}>}){
  const {path}=await context.params;
  if(path[0]!=="games")return new Response(null,{status:405});
  return nativeApi(req,path);
}
export { handle as GET, handle as HEAD, handle as POST, handle as DELETE, handle as OPTIONS,gameMutation as PATCH,gameMutation as PUT };
