import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, DorpVillage } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { lockUsers, lockGroup } from "@/lib/social/common";
import { DORP_OBJECTS, DORP_OBJECT_BY_ID } from "./catalog";
import { chapterThresholdForPhase, radiusForPhase, placementIsValid } from "./geometry";
import { reconcileInstancesForRadius, placedObjects } from "./ownership";
import { dorpPrototypeEnabled } from "./access";
import type { DorpWorldState, DorpOwnedInstance, DorpLevel } from "./types";
import { getT } from "@/lib/i18n";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import { emitToUser } from "@/lib/realtime";

type Tx = Prisma.TransactionClient;
export class DorpError extends Error {
  constructor(public code: "INVALID" | "UNAVAILABLE" | "CONFLICT" | "LIMIT" | "COOLDOWN" | "BALANCE", public status = 400, public retryAt?: string) { super(code); }
}
const id=z.string().min(1).max(128);
const tile=z.object({u:z.number().int().min(-62).max(62),v:z.number().int().min(-62).max(62)}).strict();
export const dorpCommand=z.object({villageId:id,expectedVersion:z.number().int().nonnegative(),actionId:z.string().uuid(),operation:z.discriminatedUnion("type",[
  z.object({type:z.literal("place"),objectId:id,position:tile}).strict(),
  z.object({type:z.literal("store"),objectId:id}).strict(),
  z.object({type:z.literal("upgrade"),objectId:id,expectedLevel:z.number().int().min(1).max(2)}).strict(),
  z.object({type:z.literal("paths"),tiles:z.array(tile).min(1).max(1024),erase:z.boolean()}).strict(),
  z.object({type:z.literal("request"),objectId:id}).strict(),
  z.object({type:z.literal("dismiss"),requestId:id}).strict(),
])}).strict();
export type DorpCommand=z.infer<typeof dorpCommand>;
export type DorpSnapshot={villageId:string;version:number;groupId:string|null;readOnly:boolean;world:DorpWorldState;ownedIds:string[];owners:Record<string,string>;requests:{id:string;objectId:string}[]};

export async function requireDorpAccess(tx: Pick<Tx,"user"|"contentSwitcherSettings">, userId:string) {
  if(!dorpPrototypeEnabled())throw new DorpError("UNAVAILABLE",404);
  const user=await tx.user.findUnique({where:{id:userId},select:{isAdmin:true}});
  if(!user)throw new DorpError("UNAVAILABLE",404);
  if(!user.isAdmin && !(await tx.contentSwitcherSettings.findUnique({where:{id:"singleton"},select:{dorpVisibleToUsers:true}}))?.dorpVisibleToUsers)throw new DorpError("UNAVAILABLE",404);
}
async function member(tx:Tx,groupId:string,userId:string){
  const found=await tx.groupMembership.findUnique({where:{groupId_userId:{groupId,userId}},select:{leftAt:true}});
  if(!found||found.leftAt)throw new DorpError("UNAVAILABLE",404);
}
async function lockVillage(tx:Tx,id:string){await tx.$queryRaw`SELECT "id" FROM "DorpVillage" WHERE "id"=${id} FOR UPDATE`;}
async function grantPilotInventory(tx:Tx,userId:string){
  // Expliciete proefrechten, geen XP-aankoop of import van lokale prototypeopslag.
  await tx.dorpOwnedObject.createMany({data:DORP_OBJECTS.flatMap(o=>Array.from({length:o.repeatable?Math.min(2,o.maxInstances):1},(_,ordinal)=>({userId,objectId:o.id,ordinal,level:1}))),skipDuplicates:true});
}
export function phaseForContribution(readChapters:number,members=1){
  const contribution=Math.max(0,readChapters)+Math.max(0,members-1)*3;
  let phase=0;while(phase<16&&contribution>=chapterThresholdForPhase(phase+1))phase++;return phase;
}
async function contributors(tx:Tx,village:DorpVillage){
  return village.ownerId?[village.ownerId]:(await tx.groupMembership.findMany({where:{groupId:village.groupId!,leftAt:null},select:{userId:true}})).map(m=>m.userId);
}
/** Aanroeper houdt de groepsrij (indien van toepassing) en vervolgens de dorpsrij vast. */
export async function reconcileVillage(tx:Tx,village:DorpVillage){
  const ids=await contributors(tx,village);
  if(village.groupId){
    await tx.dorpPlacement.deleteMany({where:{villageId:village.id,object:{userId:{notIn:ids}}}});
    await tx.dorpPath.deleteMany({where:{villageId:village.id,userId:{notIn:ids}}});
    await tx.dorpMember.deleteMany({where:{villageId:village.id,userId:{notIn:ids}}});
  }
  // lastChapterId is alleen een hoofdstukverwijzing; studieles-READ telt niet mee.
  const read=await tx.contentProgress.count({where:{userId:{in:ids},readStatus:"READ",lastChapterId:{not:null}}});
  const phase=phaseForContribution(read,ids.length),radius=radiusForPhase(phase);
  const placements=await tx.dorpPlacement.findMany({where:{villageId:village.id},include:{object:true},orderBy:{objectId:"asc"}});
  const instances:DorpOwnedInstance[]=placements.map(p=>({instanceId:p.objectId,objectId:p.object.objectId,level:p.object.level as DorpLevel,position:{u:p.u,v:p.v}}));
  const reconciled=reconcileInstancesForRadius(instances,radius);
  const invalid=reconciled.instances.filter(i=>!i.position).map(i=>i.instanceId);
  if(invalid.length)await tx.dorpPlacement.deleteMany({where:{villageId:village.id,objectId:{in:invalid}}});
  const paths=await tx.dorpPath.findMany({where:{villageId:village.id},select:{u:true,v:true}});
  const outside=paths.filter(p=>p.u*p.u+p.v*p.v>radius*radius);
  if(outside.length)await tx.dorpPath.deleteMany({where:{villageId:village.id,OR:outside}});
  if(phase!==village.phase||invalid.length||outside.length)return tx.dorpVillage.update({where:{id:village.id},data:{phase,version:{increment:1}}});
  return village;
}
/** Wordt binnen de bestaande vertrektransactie aangeroepen, zonder User-lock na Group. */
export async function removeMemberFromVillage(tx:Tx,groupId:string,userId:string){
  const village=await tx.dorpVillage.findUnique({where:{groupId}});if(!village)return;
  await lockVillage(tx,village.id);
  await tx.dorpPlacement.deleteMany({where:{villageId:village.id,object:{userId}}});
  await tx.dorpPath.deleteMany({where:{villageId:village.id,userId}});
  await tx.dorpMember.deleteMany({where:{villageId:village.id,userId}});
  const updated=await tx.dorpVillage.update({where:{id:village.id},data:{version:{increment:1}}});
  await reconcileVillage(tx,updated);
}
async function snapshot(tx:Tx,village:DorpVillage,userId:string,readOnly=false):Promise<DorpSnapshot>{
  const [placements,inventory,paths,requests]=await Promise.all([
    tx.dorpPlacement.findMany({where:{villageId:village.id},include:{object:true},orderBy:{objectId:"asc"}}),
    readOnly?Promise.resolve([]):tx.dorpOwnedObject.findMany({where:{userId},orderBy:{id:"asc"}}),
    tx.dorpPath.findMany({where:{villageId:village.id},select:{u:true,v:true}}),
    readOnly?Promise.resolve([]):tx.dorpMoveRequest.findMany({where:{villageId:village.id,status:"OPEN",object:{userId}},select:{id:true,objectId:true},take:100,orderBy:{createdAt:"desc"}}),
  ]);
  const byId=new Map(placements.map(p=>[p.objectId,p]));
  const objects=new Map([...placements.map(p=>p.object),...inventory].map(o=>[o.id,o]));
  return {villageId:village.id,version:village.version,groupId:village.groupId,readOnly,ownedIds:inventory.map(o=>o.id),owners:Object.fromEntries(placements.map(p=>[p.objectId,p.object.userId])),requests,
    world:{version:3,phase:village.phase,paths,instances:[...objects.values()].map(o=>{const p=byId.get(o.id);return{instanceId:o.id,objectId:o.objectId,level:o.level as DorpLevel,position:p?{u:p.u,v:p.v}:null};})}};
}
export async function openVillage(userId:string,groupId?:string){
 return prisma.$transaction(async tx=>{
  await lockUsers(tx,[userId]);await requireDorpAccess(tx,userId);
  if(groupId){if(!await lockGroup(tx,groupId))throw new DorpError("UNAVAILABLE",404);await member(tx,groupId,userId);}
  const village=groupId?await tx.dorpVillage.upsert({where:{groupId},create:{groupId},update:{}}):await tx.dorpVillage.upsert({where:{ownerId:userId},create:{ownerId:userId},update:{}});
  await lockVillage(tx,village.id);
  if(groupId){
   const exists=await tx.dorpMember.findUnique({where:{villageId_userId:{villageId:village.id,userId}}});
   if(!exists){if(await tx.dorpMember.count({where:{userId}})>=5)throw new DorpError("LIMIT",409);await tx.dorpMember.create({data:{villageId:village.id,userId}});}
  }
  await grantPilotInventory(tx,userId);
  return snapshot(tx,await reconcileVillage(tx,village),userId);
 },{timeout:15000});
}
async function authorizeVillage(tx:Tx,userId:string,villageId:string){
 await requireDorpAccess(tx,userId);
 const village=await tx.dorpVillage.findUnique({where:{id:villageId}});if(!village)throw new DorpError("UNAVAILABLE",404);
 if(village.ownerId!==userId){
  if(!village.groupId||!await lockGroup(tx,village.groupId))throw new DorpError("UNAVAILABLE",404);
  await member(tx,village.groupId,userId);
  if(!await tx.dorpMember.findUnique({where:{villageId_userId:{villageId,userId}}}))throw new DorpError("UNAVAILABLE",404);
 }
 await lockVillage(tx,villageId);return (await tx.dorpVillage.findUnique({where:{id:villageId}}))!;
}
export async function readVillage(userId:string,villageId:string){return prisma.$transaction(async tx=>{
 await lockUsers(tx,[userId]);const village=await authorizeVillage(tx,userId,villageId);return snapshot(tx,village,userId);
});}
export async function mutateVillage(userId:string,input:unknown){
 const parsed=dorpCommand.safeParse(input);if(!parsed.success)throw new DorpError("INVALID");const command=parsed.data;
 const hash=createHash("sha256").update(JSON.stringify(command)).digest("hex");
 const result=await prisma.$transaction(async tx=>{
  await lockUsers(tx,[userId]);const village=await authorizeVillage(tx,userId,command.villageId);
  const previous=await tx.dorpAction.findUnique({where:{userId_actionId:{userId,actionId:command.actionId}}});
  if(previous){if(previous.payloadHash!==hash)throw new DorpError("CONFLICT",409);return snapshot(tx,village,userId);}
  if(village.version!==command.expectedVersion)throw new DorpError("CONFLICT",409);
  const op=command.operation,radius=radiusForPhase(village.phase);
  if(op.type==="paths"){
   if(op.tiles.some(p=>p.u*p.u+p.v*p.v>radius*radius))throw new DorpError("INVALID");
   if(op.erase)await tx.dorpPath.deleteMany({where:{villageId:village.id,userId,OR:op.tiles}});
   else await tx.dorpPath.createMany({data:op.tiles.map(p=>({...p,userId,villageId:village.id})),skipDuplicates:true});
  }else if(op.type==="dismiss"){
   const found=await tx.dorpMoveRequest.findFirst({where:{id:op.requestId,villageId:village.id,object:{userId}}});if(!found)throw new DorpError("UNAVAILABLE",404);
   await tx.dorpMoveRequest.update({where:{id:found.id},data:{status:"CLOSED"}});
  }else{
   const object=await tx.dorpOwnedObject.findUnique({where:{id:op.objectId}});if(!object)throw new DorpError("UNAVAILABLE",404);
   if(op.type==="request"){
    if(!village.groupId||object.userId===userId||!await tx.dorpPlacement.findUnique({where:{villageId_objectId:{villageId:village.id,objectId:object.id}}}))throw new DorpError("INVALID");
    await tx.dorpMoveRequest.upsert({where:{villageId_objectId_requesterId:{villageId:village.id,objectId:object.id,requesterId:userId}},create:{villageId:village.id,objectId:object.id,requesterId:userId},update:{status:"OPEN"}});
   }else{
    if(object.userId!==userId)throw new DorpError("UNAVAILABLE",404);
    if(op.type==="place"){
     const current=await snapshot(tx,village,userId);
     if(!placementIsValid({...op.position,instanceId:object.id,objectId:object.objectId},placedObjects(current.world),radius))throw new DorpError("INVALID");
     await tx.dorpPlacement.upsert({where:{villageId_objectId:{villageId:village.id,objectId:object.id}},create:{villageId:village.id,objectId:object.id,...op.position},update:op.position});
    }else if(op.type==="store"){await tx.dorpPlacement.deleteMany({where:{villageId:village.id,objectId:object.id}});await tx.dorpMoveRequest.updateMany({where:{villageId:village.id,objectId:object.id,status:"OPEN"},data:{status:"CLOSED"}});}
    else{
     if(object.level!==op.expectedLevel)throw new DorpError("CONFLICT",409);
     const max=DORP_OBJECT_BY_ID.get(object.objectId)?.maxLevel??1;
     if(object.level>=max)throw new DorpError("INVALID");
     await tx.dorpOwnedObject.update({where:{id:object.id},data:{level:{increment:1}}});
    }
   }
  }
  const updated=await tx.dorpVillage.update({where:{id:village.id},data:{version:{increment:1}}});
  await tx.dorpAction.create({data:{userId,actionId:command.actionId,villageId:village.id,payloadHash:hash}});
  return snapshot(tx,updated,userId);
 },{timeout:15000});
 const affectedGroups=new Set(result.groupId?[result.groupId]:[]);
 if(command.operation.type==="upgrade")for(const p of await prisma.dorpPlacement.findMany({where:{objectId:command.operation.objectId},select:{village:{select:{groupId:true}}}}))if(p.village.groupId)affectedGroups.add(p.village.groupId);
 const recipients=new Set([userId,...(affectedGroups.size?(await prisma.groupMembership.findMany({where:{groupId:{in:[...affectedGroups]},leftAt:null},select:{userId:true}})).map(m=>m.userId):[])]);
 for(const recipient of recipients)emitToUser(recipient,DATA_EVENT_SOCKET_NAME,{event:"dorpChanged"});return result;
}
async function requireVisit(tx:Tx,viewerId:string,ownerId:string){
 await requireDorpAccess(tx,viewerId);if(viewerId===ownerId)throw new DorpError("UNAVAILABLE",404);
 const owner=await tx.user.findUnique({where:{id:ownerId},select:{shareVillageWithFriends:true}});
 const friend=await tx.friendship.findFirst({where:{status:"ACCEPTED",OR:[{senderId:viewerId,receiverId:ownerId},{senderId:ownerId,receiverId:viewerId}]},select:{id:true}});
 if(!owner?.shareVillageWithFriends||!friend)throw new DorpError("UNAVAILABLE",404);
 // Serializeert ook een intrekking van deze vriendschap tijdens een gift.
 await tx.$queryRaw`SELECT "id" FROM "Friendship" WHERE "id"=${friend.id} FOR UPDATE`;
 const still=await tx.friendship.findUnique({where:{id:friend.id},select:{status:true}});if(still?.status!=="ACCEPTED")throw new DorpError("UNAVAILABLE",404);
}
export async function visitVillage(viewerId:string,ownerId:string){return prisma.$transaction(async tx=>{
 await lockUsers(tx,[viewerId,ownerId]);await requireVisit(tx,viewerId,ownerId);
 const village=await tx.dorpVillage.findUnique({where:{ownerId}});if(!village)throw new DorpError("UNAVAILABLE",404);
 await lockVillage(tx,village.id);
 const last=await tx.dorpGift.findFirst({where:{senderId:viewerId,receiverId:ownerId},orderBy:{createdAt:"desc"},select:{createdAt:true}});
 return {...await snapshot(tx,village,viewerId,true),giftAvailableAt:last?new Date(last.createdAt.getTime()+86400000).toISOString():null};
});}
export async function sendVillageGift(senderId:string,input:unknown){
 const parsed=z.object({receiverId:id,actionId:z.string().uuid()}).strict().safeParse(input);if(!parsed.success)throw new DorpError("INVALID");const {receiverId,actionId}=parsed.data;
 const result=await prisma.$transaction(async tx=>{
  await lockUsers(tx,[senderId,receiverId]);await requireVisit(tx,senderId,receiverId);
  if(!await tx.dorpVillage.findUnique({where:{ownerId:receiverId},select:{id:true}}))throw new DorpError("UNAVAILABLE",404);
  const previous=await tx.dorpGift.findUnique({where:{senderId_actionId:{senderId,actionId}}});
  if(previous){if(previous.receiverId!==receiverId)throw new DorpError("CONFLICT",409);const latest=await tx.dorpGift.findFirst({where:{senderId,receiverId},orderBy:{createdAt:"desc"}});return {id:previous.id,giftAvailableAt:new Date((latest??previous).createdAt.getTime()+86400000).toISOString()};}
  // Na verkrijgen van locks meten; geen verouderde aankomsttijd gebruiken.
  const now=new Date();
  const last=await tx.dorpGift.findFirst({where:{senderId,receiverId},orderBy:{createdAt:"desc"}});
  if(last&&now.getTime()-last.createdAt.getTime()<86400000)throw new DorpError("COOLDOWN",409,new Date(last.createdAt.getTime()+86400000).toISOString());
  const sender=await tx.user.findUnique({where:{id:senderId},select:{xpTotal:true}});if(!sender||sender.xpTotal<5)throw new DorpError("BALANCE",409);
  const gift=await tx.dorpGift.create({data:{senderId,receiverId,actionId,createdAt:now}});
  await tx.user.update({where:{id:senderId},data:{xpTotal:{decrement:5}}});await tx.user.update({where:{id:receiverId},data:{xpTotal:{increment:5}}});
  await tx.xPTransaction.createMany({data:[{userId:senderId,amount:-5,reason:"VILLAGE_GIFT_SENT",metadata:JSON.stringify({giftId:gift.id})},{userId:receiverId,amount:5,reason:"VILLAGE_GIFT_RECEIVED",metadata:JSON.stringify({giftId:gift.id})}]});
  // Gift-XP is een saldo-overdracht, nooit verdiende competitie-XP of een leeractiviteit.
  const receiver=await tx.user.findUnique({where:{id:receiverId},select:{uiLanguage:true}}),t=getT(receiver?.uiLanguage);
  await tx.notification.create({data:{userId:receiverId,kind:"friends",title:t("dorp2.giftReceived"),body:t("dorp2.giftReceivedBody"),url:"/dorp"}});
  return {id:gift.id,giftAvailableAt:new Date(now.getTime()+86400000).toISOString()};
 },{timeout:15000});
 emitToUser(senderId,DATA_EVENT_SOCKET_NAME,{event:"dorpGiftChanged"});emitToUser(receiverId,DATA_EVENT_SOCKET_NAME,{event:"dorpGiftChanged"});return result;
}

export async function leaveVillage(userId:string,villageId:string,expectedVersion:number,actionId:string){
 const input=z.object({villageId:id,expectedVersion:z.number().int().nonnegative(),actionId:z.string().uuid()}).strict().safeParse({villageId,expectedVersion,actionId});
 if(!input.success)throw new DorpError("INVALID");
 const hash=createHash("sha256").update(JSON.stringify({type:"leave",...input.data})).digest("hex");
 return prisma.$transaction(async tx=>{
  await lockUsers(tx,[userId]);await requireDorpAccess(tx,userId);
  const previous=await tx.dorpAction.findUnique({where:{userId_actionId:{userId,actionId}}});
  if(previous){if(previous.payloadHash!==hash)throw new DorpError("CONFLICT",409);return {left:true};}
  const village=await authorizeVillage(tx,userId,villageId);
  if(!village.groupId)throw new DorpError("INVALID");
  if(village.version!==expectedVersion)throw new DorpError("CONFLICT",409);
  await tx.dorpPlacement.deleteMany({where:{villageId,object:{userId}}});
  await tx.dorpPath.deleteMany({where:{villageId,userId}});
  await tx.dorpMember.delete({where:{villageId_userId:{villageId,userId}}});
  await tx.dorpVillage.update({where:{id:villageId},data:{version:{increment:1}}});
  await tx.dorpAction.create({data:{userId,actionId,villageId,payloadHash:hash}});
  return {left:true};
 });
}
/** Geen nieuw dorp aanmaken vanuit een groepsactie; alleen bestaande wereldgroei bijwerken. */
export async function syncGroupVillage(tx:Tx,groupId:string){
 const village=await tx.dorpVillage.findUnique({where:{groupId}});if(!village)return;
 await lockVillage(tx,village.id);await reconcileVillage(tx,village);
}
