import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { failureLockSeconds, registerFailure } from "@/lib/rateLimit";
import { leaveVillage, requireDorpAccess, openVillage, readVillage, mutateVillage, visitVillage, sendVillageGift, DorpError } from "@/lib/dorp/service";
import { getT } from "@/lib/i18n";
export const runtime="nodejs";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store, private",Vary:"Cookie"}});
const id=z.string().min(1).max(128);
export async function GET(req:NextRequest){
 const user=await getCurrentUser();if(!user)return json({error:"Unauthorized"},401);
 try{
  const query=z.union([z.object({villageId:id}).strict(),z.object({ownerId:id}).strict(),z.object({}).strict()]).parse(Object.fromEntries(req.nextUrl.searchParams));
  await requireDorpAccess(prisma,user.id);
  if("ownerId"in query)return json(await visitVillage(user.id,query.ownerId));
  if("villageId"in query)return json(await readVillage(user.id,query.villageId));
  const groups=await prisma.groupMembership.findMany({where:{userId:user.id,leftAt:null},select:{group:{select:{id:true,name:true}}},orderBy:{joinedAt:"asc"},take:10});
  return json({groups:groups.map(g=>g.group),personal:await prisma.dorpVillage.findUnique({where:{ownerId:user.id},select:{id:true}})});
 }catch(error){return failure(error,user.uiLanguage);}
}
function failure(error:unknown,language:string){
 const t=getT(language);
 if(error instanceof DorpError)return json({code:error.code,error:t(error.code==="COOLDOWN"?"dorp2.cooldown":error.code==="BALANCE"?"dorp2.balance":error.code==="LIMIT"?"dorp2.limit":error.code==="CONFLICT"?"dorp2.conflict":"dorp2.unavailable"),retryAt:error.retryAt},error.status);
 if(error instanceof z.ZodError)return json({code:"INVALID",error:t("apiErrors.invalidInput")},400);
 return json({error:t("apiErrors.notSaved")},503);
}
export async function POST(req:NextRequest){
 const user=await getCurrentUser();if(!user)return json({error:"Unauthorized"},401);
 if(!inventoryOriginAllowed(req.headers,req.url,process.env.APP_URL))return json({error:"Forbidden"},403);
 const key=`dorp:${user.id}`;if(failureLockSeconds(key,60))return json({error:getT(user.uiLanguage)("apiErrors.notSaved")},429);
 try{
  if(Number(req.headers.get("content-length"))>100000)throw new DorpError("INVALID");
  const reader=req.body?.getReader();let bytes=0,text="";if(!reader)throw new DorpError("INVALID");const decoder=new TextDecoder();
  while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>100000){await reader.cancel();throw new DorpError("INVALID");}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  let body:unknown;try{body=JSON.parse(text);}catch{throw new DorpError("INVALID");}
  const parsed=z.discriminatedUnion("type",[
   z.object({type:z.literal("leave"),villageId:id,expectedVersion:z.number().int().nonnegative(),actionId:z.string().uuid()}).strict(),
   z.object({type:z.literal("open"),groupId:id.optional()}).strict(),
   z.object({type:z.literal("mutate"),command:z.unknown()}).strict(),
   z.object({type:z.literal("gift"),receiverId:id,actionId:z.string().uuid()}).strict(),
  ]).parse(body);
  if(parsed.type==="leave")return json(await leaveVillage(user.id,parsed.villageId,parsed.expectedVersion,parsed.actionId));
  if(parsed.type==="open")return json(await openVillage(user.id,parsed.groupId));
  if(parsed.type==="mutate")return json(await mutateVillage(user.id,parsed.command));
  return json(await sendVillageGift(user.id,{receiverId:parsed.receiverId,actionId:parsed.actionId}));
 }catch(error){if(error instanceof DorpError||error instanceof z.ZodError)registerFailure(key,60000);return failure(error,user.uiLanguage);}
}
