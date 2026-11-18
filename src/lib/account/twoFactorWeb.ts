import { apiError } from "@/lib/apiError";
import { boundedJson } from "@/lib/requestBody";
import { getCurrentUser } from "@/lib/session";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { manageTwoFactor,TwoFactorSettingsError } from "./twoFactor";
import { twoFactorCommand,type TwoFactorCommand } from "./twoFactorContract";
export async function webTwoFactor(req:NextRequest,kind:TwoFactorCommand["kind"]){
  const user=await getCurrentUser();
  if(!user)return apiError("apiErrors.notLoggedIn",401);
  const body=kind==="setup"?{}:await boundedJson(req);
  const parsed=twoFactorCommand.safeParse({...(body && typeof body==="object"?body:{}),kind});
  if(!parsed.success)return apiError(kind==="verify"?"apiErrors.enterSixDigits":kind==="reset"?"apiErrors.enterRecoveryCode":kind==="disable"?"apiErrors.enterVerificationOrRecovery":"apiErrors.invalidInput",400);
  try{return NextResponse.json(await manageTwoFactor({userId:user.id},parsed.data));}
  catch(error){if(!(error instanceof TwoFactorSettingsError))throw error;return apiError(error.key,error.status,error.vars);}
}
