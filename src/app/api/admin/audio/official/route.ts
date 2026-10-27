import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { boundedJson } from "@/lib/requestBody";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { officialOverview, requestOfficialAudio, runOfficialAudioTick, officialErrorCode, publishOfficialSelection } from "@/lib/audio/officialJobs";
import {OFFICIAL_BATCH_SIZE,officialReasons} from "@/lib/audio/officialControls";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("apiErrors.notLoggedIn",401);
  if (!user.isAdmin) return apiError("apiErrors.forbidden",403);
  return NextResponse.json(await officialOverview(),{headers});
}
export async function POST(req: NextRequest) {
  const user=await getCurrentUser();
  if(!user)return apiError("apiErrors.notLoggedIn",401);
  if(!user.isAdmin||!inventoryOriginAllowed(req.headers,req.url,process.env.APP_URL))return apiError("apiErrors.forbidden",403);
  try {
    const input=await boundedJson(req,32768);
    if(input&&typeof input==="object"&&"ids" in input&&Array.isArray(input.ids)&&input.ids.length>OFFICIAL_BATCH_SIZE)return apiError("officialAudio.batchTooLarge",413);
    const id=z.string().regex(/^[a-f0-9]{64}$/);
    const body=z.discriminatedUnion("action",[
      z.object({action:z.enum(["download","register","resume"]),ids:z.array(id).max(OFFICIAL_BATCH_SIZE)}).strict(),
      z.object({action:z.literal("publish"),selections:z.array(z.object({id,recordingId:z.string().min(1).max(200)}).strict()).min(1).max(OFFICIAL_BATCH_SIZE)}).strict(),
    ]).parse(input);
    if(body.action==="publish")return NextResponse.json(await publishOfficialSelection(user,body.selections),{headers});
    const result=await requestOfficialAudio(user,body.action,body.ids);
    void runOfficialAudioTick().catch(()=>console.error("Officiële audiotaak kon niet worden gestart."));
    return NextResponse.json(result,{headers});
  } catch(error) {
    if(error instanceof Error&&error.message==="FORBIDDEN")return apiError("apiErrors.forbidden",403);
    if(error instanceof z.ZodError)return apiError("apiErrors.invalidInput",409);
    const code=officialErrorCode(error);
    if(["SOURCE_UNKNOWN","INVALID_ACTION"].includes(code))return apiError("apiErrors.invalidInput",409);
    const status=code==="DATABASE_BUSY"||code==="DATABASE_UNAVAILABLE"?503:code==="AUDIO_TASK_FAILED"?500:409;
    if(status===500)console.error("Officiële audioaanvraag mislukt:",code);
    return apiError(officialReasons[code]??"officialAudio.serviceError",status);
  }
}
