import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { boundedJson } from "@/lib/requestBody";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { officialOverview, requestOfficialAudio, runOfficialAudioTick, officialErrorCode } from "@/lib/audio/officialJobs";
import type {MessageKey} from "@/lib/i18n/core";
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
    const body=z.object({action:z.enum(["download","register","resume","approvePilot"]),ids:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(300)}).strict().parse(await boundedJson(req,32768));
    const result=await requestOfficialAudio(user,body.action,body.ids);
    void runOfficialAudioTick().catch(()=>console.error("Officiële audiotaak kon niet worden gestart."));
    return NextResponse.json(result,{headers});
  } catch(error) {
    if(error instanceof Error&&error.message==="FORBIDDEN")return apiError("apiErrors.forbidden",403);
    const reasons:Record<string,MessageKey>={STORAGE_FULL:"officialAudio.storageFull",STORAGE_PERMISSION:"officialAudio.storagePermission",STORAGE_UNAVAILABLE:"officialAudio.storageMissing",PILOT_REQUIRED:"officialAudio.bulkLocked",TARGET_MISSING:"officialAudio.editionMissing",SOURCE_MISMATCH:"officialAudio.sourceChanged",SOURCE_PROTECTED:"officialAudio.protection"};
    return apiError(reasons[officialErrorCode(error)]??"apiErrors.invalidInput",409);
  }
}
