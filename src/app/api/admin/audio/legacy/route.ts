import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { boundedJson } from "@/lib/requestBody";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { legacyInventory, prepareLegacyConversion, assertLegacySource, legacySources } from "@/lib/audio/legacyConversion";
import { requestLegacyAudio, approveLegacyPilot, publishOfficialSelection, officialErrorCode, runOfficialAudioTick } from "@/lib/audio/officialJobs";
import { officialReasons } from "@/lib/audio/officialControls";
const headers = { "Cache-Control":"private, no-store" };
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("apiErrors.notLoggedIn",401);
  if (!user.isAdmin) return apiError("apiErrors.forbidden",403);
  return NextResponse.json(await legacyInventory(),{headers});
}
export async function POST(req:NextRequest) {
  const user=await getCurrentUser();
  if(!user)return apiError("apiErrors.notLoggedIn",401);
  if(!user.isAdmin||!inventoryOriginAllowed(req.headers,req.url,process.env.APP_URL))return apiError("apiErrors.forbidden",403);
  try {
    const id=z.string().regex(/^[a-f0-9]{64}$/),ids=z.array(id).min(1).max(3);
    const body=z.discriminatedUnion("action",[
      z.object({action:z.literal("prepare"),ids}).strict(),
      z.object({action:z.literal("download"),ids,planHash:id,confirmed:z.literal(true)}).strict(),
      z.object({action:z.enum(["register","resume"]),ids,confirmed:z.literal(true)}).strict(),
      z.object({action:z.literal("publish"),selections:z.array(z.object({id,recordingId:z.string().min(1).max(200)}).strict()).min(1).max(3),confirmed:z.literal(true)}).strict(),
      z.object({action:z.literal("approve"),confirmed:z.literal(true)}).strict(),
    ]).parse(await boundedJson(req,16384));
    if(body.action==="prepare")return NextResponse.json(await prepareLegacyConversion(body.ids),{headers});
    if(body.action==="approve")return NextResponse.json(await approveLegacyPilot(user),{headers});
    if(body.action==="publish") {
      for(const selection of body.selections){const source=legacySources.find(s=>s.id===selection.id);if(!source)throw Error("SOURCE_PROTECTED");assertLegacySource(source);}
      return NextResponse.json(await publishOfficialSelection(user,body.selections,undefined,undefined,true),{headers});
    }
    const result=await requestLegacyAudio(user,body.action,body.ids,body.action==="download"?body.planHash:undefined);
    void runOfficialAudioTick().catch(()=>console.error("Legacy-audiotaak kon niet worden gestart."));
    return NextResponse.json(result,{headers});
  } catch(error) {
    if(error instanceof z.ZodError)return apiError("apiErrors.invalidInput",409);
    const code=officialErrorCode(error);
    if(code==="FORBIDDEN")return apiError("apiErrors.forbidden",403);
    if(code==="INVALID_ACTION")return apiError("apiErrors.invalidInput",409);
    return apiError(officialReasons[code]??"officialAudio.serviceError",["DATABASE_BUSY","DATABASE_UNAVAILABLE"].includes(code)?503:code==="AUDIO_TASK_FAILED"?500:409);
  }
}
