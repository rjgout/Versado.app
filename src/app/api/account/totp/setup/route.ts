import { webTwoFactor } from "@/lib/account/twoFactorWeb";
import type { NextRequest } from "next/server";
export async function POST(req:NextRequest){return webTwoFactor(req,"setup");}
