import test,{after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {prisma} from "../src/lib/db";
import {openVillage,readVillage,mutateVillage,visitVillage,sendVillageGift,phaseForContribution,leaveVillage,DorpError,type DorpSnapshot,type DorpCommand} from "../src/lib/dorp/service";
import {BOFM_CANONICAL_CONTENT_KEYS,countCanonicalReadContributions} from "../src/lib/dorp/growth";
import {chapterThresholdForPhase,radiusForPhase} from "../src/lib/dorp/geometry";
import {contentKeyForChapter} from "../src/lib/learning/contentIdentity";
import {createGroup,leaveGroup} from "../src/lib/social/groups";
import {createSessionToken,SESSION_COOKIE} from "../src/lib/auth";
const url=new URL(process.env.DORP_TEST_DATABASE_URL??"http://invalid");
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_content_access_test"||url.href!==process.env.DATABASE_URL)throw Error("Uitsluitend eigen Dorp-testdatabase");
after(()=>prisma.$disconnect());
const rejection=(code:string)=>(error:unknown)=>error instanceof DorpError&&error.code===code;
async function account(admin=true,xpTotal=100){const uid=randomUUID();return prisma.user.create({data:{email:`${uid}@example.invalid`,handle:`Dorp${uid.slice(0,7)}`,discriminator:"01",passwordHash:"synthetic-no-login",isAdmin:admin,xpTotal,emailVerifiedAt:new Date()}});}
function action(snapshot:DorpSnapshot,operation:DorpCommand["operation"],actionId=randomUUID()){return{villageId:snapshot.villageId,expectedVersion:snapshot.version,actionId,operation};}
test("persistente persoonlijke/groepswerelden, eigendom, krimp, privacy en XP-gifts",async t=>{
 const a=await account(),b=await account(),c=await account(false,0);
 let personal:DorpSnapshot,groupA:DorpSnapshot,groupB:DorpSnapshot;
 const {id:groupId}=await createGroup(a.id,"Eigen Dorp-testgroep");
 await prisma.groupMembership.create({data:{groupId,userId:b.id,eligibleFromDay:"2026-01-01"}});
 await prisma.socialGroup.update({where:{id:groupId},data:{memberCount:2}});
 await t.test("standaard verborgen; admin wel, gewone gebruiker en technische noodstop niet",async()=>{
  await assert.rejects(openVillage(c.id),rejection("UNAVAILABLE"));
  await assert.rejects(prisma.dorpVillage.create({data:{}}));
  personal=await openVillage(a.id);assert.equal(personal.world.phase,0);
  assert.ok(personal.ownedIds.length>5);assert.ok(personal.world.instances.every(i=>i.position===null&&i.level===1));
  assert.equal((await openVillage(a.id)).villageId,personal.villageId);
  const flag=process.env.VERSADO_DORP_PROTOTYPE_ENABLED;process.env.VERSADO_DORP_PROTOTYPE_ENABLED="false";
  try{await assert.rejects(openVillage(a.id),rejection("UNAVAILABLE"));}finally{process.env.VERSADO_DORP_PROTOTYPE_ENABLED=flag;}
  await prisma.contentSwitcherSettings.upsert({where:{id:"singleton"},create:{dorpVisibleToUsers:true},update:{dorpVisibleToUsers:true}});
  await openVillage(c.id);
 });
 const family=()=>personal.world.instances.find(i=>i.objectId==="vd-b001")!.instanceId;
 await t.test("globale levels, onafhankelijke posities en idempotente oude retries",async()=>{
  const initial=action(personal,{type:"place",objectId:family(),position:{u:0,v:0}});
  personal=await mutateVillage(a.id,initial);
  groupA=await openVillage(a.id,groupId);groupB=await openVillage(b.id,groupId);
  groupA=await mutateVillage(a.id,action(groupA,{type:"place",objectId:family(),position:{u:-4,v:0}}));
  personal=await mutateVillage(a.id,action(personal,{type:"upgrade",objectId:family(),expectedLevel:1}));
  assert.equal((await readVillage(a.id,groupA.villageId)).world.instances.find(i=>i.instanceId===family())?.level,2);
  await assert.rejects(mutateVillage(a.id,action(groupA,{type:"upgrade",objectId:family(),expectedLevel:1})),rejection("CONFLICT"));
  assert.deepEqual(personal.world.instances.find(i=>i.instanceId===family())?.position,{u:0,v:0});
  assert.deepEqual((await readVillage(a.id,groupA.villageId)).world.instances.find(i=>i.instanceId===family())?.position,{u:-4,v:0});
  const retry=await mutateVillage(a.id,initial);assert.equal(retry.version,personal.version);assert.equal(retry.world.instances.find(i=>i.instanceId===family())?.level,2);
  await assert.rejects(mutateVillage(a.id,{...initial,operation:{type:"store",objectId:family()}}),rejection("CONFLICT"));
 });
 await t.test("andermans objecten niet aanpassen; verzoek is eigendomsveilig",async()=>{
  groupB=await readVillage(b.id,groupA.villageId);
  await assert.rejects(mutateVillage(b.id,action(groupB,{type:"store",objectId:family()})),rejection("UNAVAILABLE"));
  groupB=await mutateVillage(b.id,action(groupB,{type:"request",objectId:family()}));
  const own=await readVillage(a.id,groupA.villageId);assert.equal(own.requests.length,1);assert.equal(groupB.requests.length,0);
  await assert.rejects(readVillage(c.id,groupA.villageId),rejection("UNAVAILABLE"));
 });
 await t.test("gelijktijdige plaatsingen serialiseren; padwissen respecteert eigenaar",async()=>{
  groupA=await readVillage(a.id,groupA.villageId);groupB=await readVillage(b.id,groupA.villageId);
  const residentA=groupA.world.instances.find(i=>i.objectId==="vd-c001")!.instanceId;
  const residentB=groupB.world.instances.find(i=>i.objectId==="vd-c001")!.instanceId;
  const attempts=await Promise.allSettled([mutateVillage(a.id,action(groupA,{type:"place",objectId:residentA,position:{u:0,v:4}})),mutateVillage(b.id,action(groupB,{type:"place",objectId:residentB,position:{u:0,v:4}}))]);
  assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);assert.equal(attempts.filter(r=>r.status==="rejected"&&rejection("CONFLICT")(r.reason)).length,1);
  groupA=await readVillage(a.id,groupA.villageId);groupA=await mutateVillage(a.id,action(groupA,{type:"paths",tiles:[{u:0,v:-3}],erase:false}));
  groupB=await readVillage(b.id,groupA.villageId);groupB=await mutateVillage(b.id,action(groupB,{type:"paths",tiles:[{u:1,v:-3}],erase:false}));
  groupA=await readVillage(a.id,groupA.villageId);groupA=await mutateVillage(a.id,action(groupA,{type:"paths",tiles:[{u:0,v:-3},{u:1,v:-3}],erase:true}));
  assert.deepEqual(groupA.world.paths,[{u:1,v:-3}]);
 });
 await t.test("echt lezen groeit kaart; vertrek krimpt zonder eigendom of levels te verliezen",async()=>{
  const work=await prisma.contentWork.upsert({where:{key:"bofm"},create:{key:"bofm",kind:"SCRIPTURE"},update:{}});
  const col=await prisma.contentCollection.create({data:{id:`dorp-${randomUUID()}`,name:"Synthetische hoofdstukken",slug:`dorp-${randomUUID()}`,icon:"",work:work.key,editionKey:"test",language:"nl",publicationState:"LEGACY"}});
  const books=new Map<string,string>();
  for(const contentKey of BOFM_CANONICAL_CONTENT_KEYS.slice(0,180)){
   const [key,number]=contentKey.split("#");
   if(!books.has(key)){const book=await prisma.book.create({data:{slug:randomUUID(),key,name:"Canonfixture",order:books.size+1,contentCollectionId:col.id}});books.set(key,book.id);}
   const chapter=await prisma.chapter.create({data:{bookId:books.get(key)!,number:Number(number),order:Number(number)}});
   await prisma.contentProgress.create({data:{userId:a.id,contentKey,lastChapterId:chapter.id,readStatus:"READ"}});
  }
  groupA=await openVillage(a.id,groupId);assert.equal(groupA.world.phase,phaseForContribution(180,2));assert.equal((await openVillage(a.id)).world.phase,phaseForContribution(180));
  groupB=await readVillage(b.id,groupA.villageId);const object=groupB.world.instances.find(i=>i.objectId==="vd-b001"&&groupB.ownedIds.includes(i.instanceId))!;
  groupB=await mutateVillage(b.id,action(groupB,{type:"upgrade",objectId:object.instanceId,expectedLevel:1}));
  groupB=await mutateVillage(b.id,action(groupB,{type:"place",objectId:object.instanceId,position:{u:25,v:0}}));
  await leaveGroup(a.id,groupId);
  groupB=await readVillage(b.id,groupA.villageId);assert.equal(groupB.world.phase,0);assert.equal(groupB.world.instances.find(i=>i.instanceId===object.instanceId)?.position,null);assert.equal(groupB.world.instances.find(i=>i.instanceId===object.instanceId)?.level,2);
  assert.equal(await prisma.dorpPlacement.count({where:{villageId:groupA.villageId,object:{userId:a.id}}}),0);
  assert.equal(await prisma.dorpOwnedObject.count({where:{userId:a.id}}),personal.ownedIds.length);
 });
 await t.test("maximaal vijf groepsdorpen, zonder gewone groepslidmaatschappen te verlagen",async()=>{
  const worlds=[];for(let i=0;i<5;i++){const group=await createGroup(a.id,`Dorptest ${i}`);worlds.push(await openVillage(a.id,group.id));}
  const sixth=await createGroup(a.id,"Zesde dorptest");await assert.rejects(openVillage(a.id,sixth.id),rejection("LIMIT"));
  assert.ok(await prisma.groupMembership.count({where:{userId:a.id,leftAt:null}})>=6);
  const blocked=await prisma.dorpVillage.create({data:{groupId:sixth.id}});await assert.rejects(prisma.dorpMember.create({data:{villageId:blocked.id,userId:a.id}}),/DorpMember maximum exceeded/);
  const current=await readVillage(a.id,worlds[0].villageId),leaveId=randomUUID();
  await leaveVillage(a.id,current.villageId,current.version,leaveId);await leaveVillage(a.id,current.villageId,current.version,leaveId);
  await openVillage(a.id,current.groupId!);
  const renewed=await readVillage(a.id,current.villageId);
  const object=renewed.world.instances.find(i=>i.objectId==="vd-c001")!;
  await mutateVillage(a.id,action(renewed,{type:"place",objectId:object.instanceId,position:{u:0,v:0}}));
  await leaveVillage(a.id,current.villageId,current.version,leaveId);
  assert.equal(await prisma.dorpPlacement.count({where:{villageId:current.villageId,objectId:object.instanceId}}),1);
  const latest=await readVillage(a.id,current.villageId);await leaveVillage(a.id,latest.villageId,latest.version,randomUUID());await openVillage(a.id,sixth.id);
 });
 let bVillage:DorpSnapshot;
 await t.test("bezoek alleen na privacytoestemming en echte geaccepteerde vriendschap",async()=>{
  bVillage=await openVillage(b.id);await assert.rejects(visitVillage(a.id,b.id),rejection("UNAVAILABLE"));
  await prisma.friendship.create({data:{senderId:a.id,receiverId:b.id,status:"ACCEPTED"}});
  await assert.rejects(visitVillage(a.id,b.id),rejection("UNAVAILABLE"));
  await prisma.user.update({where:{id:b.id},data:{shareVillageWithFriends:true}});
  const visit=await visitVillage(a.id,b.id);assert.equal(visit.readOnly,true);assert.deepEqual(visit.ownedIds,[]);assert.deepEqual(visit.world.instances,[]);
  await assert.rejects(readVillage(a.id,bVillage.villageId),rejection("UNAVAILABLE"));
  await assert.rejects(mutateVillage(a.id,action(bVillage,{type:"paths",tiles:[{u:0,v:0}],erase:false})),rejection("UNAVAILABLE"));
 });
 await t.test("gift precies eenmaal, per vriend en rollende 24 uur, zonder competitie- of leerboekingen",async()=>{
  const preserved={competition:await prisma.competitionXpEvent.count(),weekly:await prisma.weeklyScore.findMany({orderBy:{id:"asc"}}),progress:await prisma.contentProgress.count(),activity:await prisma.activityFeedItem.count(),streak:await prisma.streakDay.count()};
  const payload={receiverId:b.id,actionId:randomUUID()};
  const [first,duplicate]=await Promise.all([sendVillageGift(a.id,payload),sendVillageGift(a.id,payload)]);assert.equal(first.id,duplicate.id);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).xpTotal,95);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.id}})).xpTotal,105);
  assert.equal(await prisma.dorpGift.count({where:{senderId:a.id}}),1);assert.equal(await prisma.xPTransaction.count({where:{userId:{in:[a.id,b.id]},reason:{in:["VILLAGE_GIFT_SENT","VILLAGE_GIFT_RECEIVED"]}}}),2);
  await assert.rejects(sendVillageGift(a.id,{receiverId:b.id,actionId:randomUUID()}),rejection("COOLDOWN"));
  await prisma.dorpGift.update({where:{id:first.id},data:{createdAt:new Date(Date.now()-86400000+5000)}});
  await assert.rejects(sendVillageGift(a.id,{receiverId:b.id,actionId:randomUUID()}),rejection("COOLDOWN"));
  await prisma.dorpGift.update({where:{id:first.id},data:{createdAt:new Date(Date.now()-86400000-5000)}});
  await sendVillageGift(a.id,{receiverId:b.id,actionId:randomUUID()});await sendVillageGift(a.id,payload);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).xpTotal,90);
  assert.equal(await prisma.notification.count({where:{userId:b.id,kind:"friends"}}),2);
  assert.deepEqual({competition:await prisma.competitionXpEvent.count(),weekly:await prisma.weeklyScore.findMany({orderBy:{id:"asc"}}),progress:await prisma.contentProgress.count(),activity:await prisma.activityFeedItem.count(),streak:await prisma.streakDay.count()},preserved);
  await prisma.user.update({where:{id:b.id},data:{shareVillageWithFriends:false}});await assert.rejects(visitVillage(a.id,b.id),rejection("UNAVAILABLE"));
 });
 await t.test("giftlimiet per vriend, concurrerende acties, laag saldo en privacy-intrekking",async()=>{
  const d=await account();await openVillage(d.id);await prisma.user.update({where:{id:d.id},data:{shareVillageWithFriends:true}});
  await prisma.friendship.create({data:{senderId:a.id,receiverId:d.id,status:"ACCEPTED"}});
  const outcomes=await Promise.allSettled([sendVillageGift(a.id,{receiverId:d.id,actionId:randomUUID()}),sendVillageGift(a.id,{receiverId:d.id,actionId:randomUUID()})]);
  assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);assert.equal(outcomes.filter(o=>o.status==="rejected"&&rejection("COOLDOWN")(o.reason)).length,1);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).xpTotal,85);
  await prisma.friendship.create({data:{senderId:c.id,receiverId:d.id,status:"ACCEPTED"}});
  const before=await prisma.dorpGift.count();await assert.rejects(sendVillageGift(c.id,{receiverId:d.id,actionId:randomUUID()}),rejection("BALANCE"));assert.equal(await prisma.dorpGift.count(),before);
  await prisma.user.update({where:{id:d.id},data:{shareVillageWithFriends:false}});await assert.rejects(visitVillage(a.id,d.id),rejection("UNAVAILABLE"));
  await assert.rejects(sendVillageGift(a.id,{receiverId:d.id,actionId:randomUUID()}),rejection("UNAVAILABLE"));
 });
 await t.test("HTTP sessie, Origin, payload, privé-cache en ingetrokken beschikbaarheid",async()=>{
  const base=process.env.DORP_TEST_BASE_URL!,cookie=`${SESSION_COOKIE}=${await createSessionToken(c.id)}`;
  assert.equal((await fetch(`${base}/api/dorp`)).status,401);
  const post=(body:unknown,origin=base)=>fetch(`${base}/api/dorp`,{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await post({type:"open"},"https://attacker.example")).status,403);
  assert.equal((await post({type:"open",userId:a.id})).status,400);
  const privacy=await fetch(`${base}/api/account`,{method:"PATCH",headers:{Cookie:cookie,Origin:"https://attacker.example","Content-Type":"application/json"},body:JSON.stringify({shareVillageWithFriends:true})});assert.equal(privacy.status,403);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:c.id}})).shareVillageWithFriends,false);
  const ok=await post({type:"open"});assert.equal(ok.status,200);assert.match(ok.headers.get("cache-control")!,/no-store/);
  await prisma.contentSwitcherSettings.update({where:{id:"singleton"},data:{dorpVisibleToUsers:false}});
  assert.equal((await fetch(`${base}/api/dorp`,{headers:{Cookie:cookie}})).status,404);
  assert.equal((await post({type:"open"})).status,404);
  assert.equal((await fetch(`${base}/dorp`,{headers:{Cookie:cookie}})).status,404);
  await prisma.contentSwitcherSettings.update({where:{id:"singleton"},data:{dorpVisibleToUsers:true}});
 });
});


test("dorpsgroei telt uitsluitend de 239 canonieke BOM-hoofdstukken per gebruiker",async()=>{
 const a=await account(),b=await account();
 const {id:groupId}=await createGroup(a.id,"Canonieke hoofdstukken");
 await prisma.groupMembership.create({data:{groupId,userId:b.id,eligibleFromDay:"2026-01-01"}});
 await prisma.socialGroup.update({where:{id:groupId},data:{memberCount:2}});
 const work=await prisma.contentWork.upsert({where:{key:"bofm"},create:{key:"bofm",kind:"SCRIPTURE"},update:{}});
 const chapters=[],family=randomUUID();
 for(const [language,editionKey] of [["nl",family],["en",family],["nl",randomUUID()]]){
  const col=await prisma.contentCollection.create({data:{id:randomUUID(),name:"Eigen canonfixture",slug:randomUUID(),icon:"",work:work.key,editionKey,language,publicationState:"LEGACY"}});
  const book=await prisma.book.create({data:{slug:randomUUID(),key:"bofm/1-ne",name:"Nephi",order:1,contentCollectionId:col.id}});
  chapters.push(await prisma.chapter.create({data:{bookId:book.id,number:1,order:1},include:{book:true}}));
 }
 const preserved=async()=>({users:await prisma.user.findMany({where:{id:{in:[a.id,b.id]}},orderBy:{id:"asc"}}),xp:await prisma.xPTransaction.findMany(),weekly:await prisma.weeklyScore.findMany(),competition:await prisma.competitionXpEvent.findMany(),streak:await prisma.streakDay.findMany()});
 const before=await preserved();
 assert.equal(radiusForPhase((await openVillage(a.id)).world.phase),8);
 for(const chapter of [...chapters,...chapters]){
  const contentKey=contentKeyForChapter({id:chapter.id,bookKey:chapter.book.key,number:chapter.number});
  await prisma.contentProgress.upsert({where:{userId_contentKey:{userId:a.id,contentKey}},create:{userId:a.id,contentKey,lastChapterId:chapter.id,readStatus:"READ"},update:{lastChapterId:chapter.id,readStatus:"READ"}});
  assert.equal(await countCanonicalReadContributions(prisma,[a.id]),1);
 }
 const otherWork=await prisma.contentWork.upsert({where:{key:"old-testament"},create:{key:"old-testament",kind:"SCRIPTURE"},update:{}});
 const other=await prisma.contentCollection.create({data:{id:randomUUID(),slug:randomUUID(),name:"Ander werk",icon:"",work:otherWork.key}});
 const otherBook=await prisma.book.create({data:{slug:randomUUID(),key:"old-testament/gen",name:"Genesis",order:1,contentCollectionId:other.id}});
 const otherChapter=await prisma.chapter.create({data:{bookId:otherBook.id,number:1,order:1}});
 await prisma.contentProgress.createMany({data:[
  {userId:a.id,contentKey:"old-testament/gen#1",lastChapterId:otherChapter.id,readStatus:"READ"},
  {userId:a.id,contentKey:"study:synthetic",lastChapterId:chapters[0].id,readStatus:"READ"},
  {userId:a.id,contentKey:"bofm/alma#64",lastChapterId:chapters[0].id,readStatus:"READ"},
  {userId:a.id,contentKey:"bofm/unknown#1",lastChapterId:chapters[0].id,readStatus:"READ"},
  {userId:a.id,contentKey:"bofm/1-ne#2",lastChapterId:chapters[0].id,exerciseAnswered:12,exercisesCompletedAt:new Date()},
  {userId:a.id,contentKey:"bofm/1-ne#3",lastChapterId:chapters[0].id,readStatus:"READING"},
 ]});
 assert.equal(await countCanonicalReadContributions(prisma,[a.id]),1);
 // Hetzelfde hoofdstuk draagt bij ieder groepslid eenmaal bij.
 await prisma.contentProgress.create({data:{userId:b.id,contentKey:"bofm/1-ne#1",lastChapterId:chapters[1].id,readStatus:"READ"}});
 assert.equal(await countCanonicalReadContributions(prisma,[a.id,b.id]),2);
 for(const contentKey of BOFM_CANONICAL_CONTENT_KEYS){
  // lastChapterId is optioneel: een route- of editiegebonden teruglink is geen identiteit.
  await prisma.contentProgress.upsert({where:{userId_contentKey:{userId:a.id,contentKey}},create:{userId:a.id,contentKey,readStatus:"READ"},update:{readStatus:"READ"}});
  const count=await countCanonicalReadContributions(prisma,[a.id]);
  if([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].some(phase=>count===chapterThresholdForPhase(phase)||count===chapterThresholdForPhase(phase)-1)){
   const personal=await openVillage(a.id);
   const expected=Array.from({length:16},(_,i)=>i+1).filter(phase=>count>=chapterThresholdForPhase(phase)).length;
   assert.equal(personal.world.phase,expected);assert.equal(radiusForPhase(personal.world.phase),radiusForPhase(expected));
  }
 }
 assert.equal(await countCanonicalReadContributions(prisma,[a.id]),239);
 assert.equal(await countCanonicalReadContributions(prisma,[a.id,b.id]),240);
 assert.equal(radiusForPhase((await openVillage(a.id)).world.phase),62);
 const progress=await prisma.contentProgress.findMany({where:{userId:{in:[a.id,b.id]}},orderBy:{id:"asc"}});
 await openVillage(a.id);await openVillage(a.id,groupId);
 assert.deepEqual(await prisma.contentProgress.findMany({where:{userId:{in:[a.id,b.id]}},orderBy:{id:"asc"}}),progress);
 assert.deepEqual(await preserved(),before);
});
