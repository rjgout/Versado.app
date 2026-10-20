import test,{after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {prisma} from "../src/lib/db";
import {openVillage,readVillage,mutateVillage,sendVillageGift,villageMarkers,DorpError} from "../src/lib/dorp/service";
import {createGroup,leaveGroup,removeMember,joinTx} from "../src/lib/social/groups";
import {BOFM_CANONICAL_CONTENT_KEYS} from "../src/lib/dorp/growth";
import {buyHints,buyFreezes,HINT_PRICE_XP,FREEZE_PRICE_XP} from "../src/lib/shop";
import {buyGeneesInShop} from "../src/lib/genees/inventory";
import {geneesPriceXp} from "../src/lib/genees/pricing";
import {weekStartKey} from "../src/lib/dates";
import {SESSION_COOKIE,createSessionToken} from "../src/lib/auth";
const url=new URL(process.env.DORP_TEST_DATABASE_URL??"http://invalid");
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_content_access_test"||url.href!==process.env.DATABASE_URL)throw Error("Alleen eigen Dorp-testdatabase");
after(()=>prisma.$disconnect());
async function account(xpTotal=100){const uid=randomUUID();return prisma.user.create({data:{email:`audit-${uid}@example.invalid`,handle:`Audit${uid.slice(0,6)}`,discriminator:"01",passwordHash:"synthetic",isAdmin:true,xpTotal,emailVerifiedAt:new Date(),shareVillageWithFriends:true}});}
async function pair(xp=100){const a=await account(xp),b=await account();await openVillage(b.id);await prisma.friendship.create({data:{senderId:a.id,receiverId:b.id,status:"ACCEPTED"}});return{a,b};}
const reject=(code:string)=>(e:unknown)=>e instanceof DorpError&&e.code===code;
async function wallet(userId:string){return (await prisma.user.findUniqueOrThrow({where:{id:userId}})).xpTotal;}
async function score(userId:string){return prisma.weeklyScore.findUnique({where:{userId_weekStart:{userId,weekStart:weekStartKey()}}});}
const summaries=async()=>({progress:await prisma.contentProgress.count(),competition:await prisma.competitionXpEvent.count(),streak:await prisma.streakDay.count(),activity:await prisma.activityFeedItem.count()});
async function history(userId:string){const res=await fetch(`${process.env.DORP_TEST_BASE_URL}/api/xp-history`,{headers:{Cookie:`${SESSION_COOKIE}=${await createSessionToken(userId)}`}});assert.equal(res.status,200);assert.match(res.headers.get("cache-control")!,/no-store/);return res.json();}

test("gift: senderdivisie daalt eenmaal, ontvanger verdient geen competitie-XP, historie scheidt verdiend en ontvangen",async()=>{
 const {a,b}=await pair();
 assert.equal((await openVillage(a.id)).inventoryPolicy,"ALPHA_PILOT_V1");
 await prisma.weeklyScore.createMany({data:[{userId:a.id,weekStart:weekStartKey(),xp:100},{userId:b.id,weekStart:weekStartKey(),xp:40}]});
 const before=await summaries(),actionId=randomUUID();
 await Promise.all([sendVillageGift(a.id,{receiverId:b.id,actionId}),sendVillageGift(a.id,{receiverId:b.id,actionId})]);
 assert.equal(await wallet(a.id),95);assert.equal(await wallet(b.id),105);assert.equal((await score(a.id))?.xp,95);assert.equal((await score(b.id))?.xp,40);
 assert.equal(await prisma.dorpGift.count({where:{senderId:a.id}}),1);assert.deepEqual(await summaries(),before);
 await assert.rejects(sendVillageGift(a.id,{receiverId:b.id,actionId:randomUUID()}),reject("COOLDOWN"));
 const sender=await history(a.id),receiver=await history(b.id);
 assert.equal(sender.xpThisWeek,0);assert.equal(sender.xpSentThisWeek,5);assert.equal(sender.competitionXpThisWeek,95);
 assert.equal(receiver.xpThisWeek,0);assert.equal(receiver.xpReceivedThisWeek,5);assert.equal(receiver.xpTotal,105);assert.equal(receiver.competitionXpThisWeek,40);
 await prisma.xPTransaction.create({data:{userId:b.id,amount:12,reason:"ACHIEVEMENT"}});
 assert.equal((await history(b.id)).xpThisWeek,12);
 const inactive=await account();await prisma.friendship.create({data:{senderId:inactive.id,receiverId:b.id,status:"ACCEPTED"}});
 const groups=await prisma.leagueGroup.count();
 await sendVillageGift(inactive.id,{receiverId:b.id,actionId:randomUUID()});
 assert.equal(await score(inactive.id),null);assert.equal(await prisma.leagueGroup.count(),groups);
 const poor=await account(4);await prisma.friendship.create({data:{senderId:poor.id,receiverId:b.id,status:"ACCEPTED"}});
 await assert.rejects(sendVillageGift(poor.id,{receiverId:b.id,actionId:randomUUID()}),reject("BALANCE"));assert.equal(await score(poor.id),null);
});

test("gifts concurreren veilig met hints, freezes en Genees-aankopen op hetzelfde saldo",async()=>{
 for(const [cost,buy] of [[HINT_PRICE_XP,(id:string)=>buyHints(id,1)],[FREEZE_PRICE_XP,(id:string)=>buyFreezes(id,1)],[geneesPriceXp(0),(id:string)=>buyGeneesInShop(id,randomUUID())]] as const){
  const {a,b}=await pair(cost);
  await prisma.weeklyScore.create({data:{userId:a.id,weekStart:weekStartKey(),xp:1000}});
  const [purchase,gift]=await Promise.allSettled([buy(a.id),sendVillageGift(a.id,{receiverId:b.id,actionId:randomUUID()})]);
  assert.equal(purchase.status,"fulfilled");
  const bought=purchase.status==="fulfilled"&&purchase.value.ok, sent=gift.status==="fulfilled";
  assert.equal(Number(bought)+Number(sent),1,"Niet genoeg saldo om beide te betalen");
  if(gift.status==="rejected")assert.ok(reject("BALANCE")(gift.reason));
  assert.equal(await wallet(a.id),cost-(bought?cost:5));assert.equal((await score(a.id))?.xp,1000-(bought?cost:5));
  assert.equal(await wallet(b.id),100+(sent?5:0));assert.equal(await score(b.id),null);
 }
 // Met voldoende saldo slagen beide en worden beide bestaande uitgaven afgetrokken.
 const {a,b}=await pair(55);await prisma.weeklyScore.create({data:{userId:a.id,weekStart:weekStartKey(),xp:100}});
 const [hint]=await Promise.all([buyHints(a.id,1),sendVillageGift(a.id,{receiverId:b.id,actionId:randomUUID()})]);
 assert.equal(hint.ok,true);assert.equal(await wallet(a.id),0);assert.equal((await score(a.id))?.xp,45);
});

test("PostgreSQL: bouwen versus verwijderen/vertrek, herhalen, opnieuw deelnemen en wereldkrimp bewaren eigendom",async()=>{
 for(const removal of ["remove","leave"]){
  const a=await account(),b=await account(),c=await account(),{id:groupId}=await createGroup(a.id,`Concurrent ${removal}`);
  await prisma.$transaction(tx=>joinTx(tx,b.id,groupId,new Date()));
  await prisma.contentProgress.createMany({data:BOFM_CANONICAL_CONTENT_KEYS.map(contentKey=>({userId:b.id,contentKey,readStatus:"READ" as const}))});
  let own=await openVillage(a.id,groupId),other=await openVillage(b.id,groupId);
  assert.equal(own.world.phase,16);
  const object=own.world.instances.find(i=>i.objectId==="vd-b001")!,memberObject=other.world.instances.find(i=>i.objectId==="vd-c001"&&other.ownedIds.includes(i.instanceId))!;
  own=await mutateVillage(a.id,{villageId:own.villageId,expectedVersion:own.version,actionId:randomUUID(),operation:{type:"upgrade",objectId:object.instanceId,expectedLevel:1}});
  own=await mutateVillage(a.id,{villageId:own.villageId,expectedVersion:own.version,actionId:randomUUID(),operation:{type:"place",objectId:object.instanceId,position:{u:25,v:0}}});
  other=await readVillage(b.id,own.villageId);
  const command={villageId:own.villageId,expectedVersion:other.version,actionId:randomUUID(),operation:{type:"place" as const,objectId:memberObject.instanceId,position:{u:0,v:0}}};
  // Houd de groepsrij vast tot alle drie onafhankelijke transacties aantoonbaar wachten.
  const held=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  const blocker=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "SocialGroup" WHERE "id"=${groupId} FOR UPDATE`;held.resolve();await release.promise;},{timeout:10000});
  await held.promise;
  const attempts=Promise.allSettled([mutateVillage(b.id,command),removal==="remove"?removeMember(a.id,groupId,b.id):leaveGroup(b.id,groupId),prisma.$transaction(tx=>joinTx(tx,c.id,groupId,new Date()))]);
  try{
   const deadline=Date.now()+5000;let waiting=0;
   while(waiting<3&&Date.now()<deadline){const rows=await prisma.$queryRaw<{n:bigint}[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SocialGroup%'`;waiting=Number(rows[0].n);}
   assert.ok(waiting>=3,"Bouw, vertrek/verwijdering en toetreding wachten tegelijk op PostgreSQL");
  }finally{release.resolve();await blocker;}
  const results=await attempts;
  assert.equal(results[1].status,"fulfilled");assert.equal(results[2].status,"fulfilled");
  if(results[0].status==="rejected")assert.ok(results[0].reason instanceof DorpError);
  const remaining=await readVillage(a.id,own.villageId);assert.equal(remaining.world.phase,0);
  assert.equal(remaining.world.instances.find(i=>i.instanceId===object.instanceId)?.position,null);assert.equal(remaining.world.instances.find(i=>i.instanceId===object.instanceId)?.level,2);
  assert.equal(await prisma.dorpPlacement.count({where:{villageId:own.villageId,object:{userId:b.id}}}),0);
  const property=await prisma.dorpOwnedObject.findMany({where:{userId:{in:[a.id,b.id]}},orderBy:{id:"asc"}});
  await assert.rejects(mutateVillage(b.id,command),reject("UNAVAILABLE"));
  // Bestaande herintredingswachttijd blijft intact; expliciete fixturetijd ligt erna.
  await prisma.$transaction(tx=>joinTx(tx,b.id,groupId,new Date(Date.now()+8*86400000)));
  const rejoined=await openVillage(b.id,groupId);assert.equal(rejoined.world.phase,16);
  try{await mutateVillage(b.id,command);}catch(e){assert.ok(reject("CONFLICT")(e));}
  assert.equal(await prisma.dorpPlacement.count({where:{villageId:own.villageId,objectId:memberObject.instanceId}}),0,"Oud verzoek herstelt geen verwijderde plaatsing");
  await assert.rejects(mutateVillage(b.id,{...command,expectedVersion:rejoined.version,actionId:randomUUID(),operation:{type:"store",objectId:object.instanceId}}),reject("UNAVAILABLE"));
  assert.deepEqual(await prisma.dorpOwnedObject.findMany({where:{userId:{in:[a.id,b.id]}},orderBy:{id:"asc"}}),property);
 }
});


test("gift: databasefout na saldo-/divisiemutatie rolt overdracht en audit volledig terug",async()=>{
 const {a,b}=await pair();await prisma.weeklyScore.create({data:{userId:a.id,weekStart:weekStartKey(),xp:30}});
 const before={sender:await wallet(a.id),receiver:await wallet(b.id),score:await score(a.id),gifts:await prisma.dorpGift.count(),ledger:await prisma.xPTransaction.count(),notifications:await prisma.notification.count()};
 await prisma.$executeRawUnsafe(`CREATE FUNCTION dorp_test_gift_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason::text = 'VILLAGE_GIFT_RECEIVED' THEN RAISE EXCEPTION 'DORP_TEST_GIFT_FAILURE'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER dorp_test_gift_failure BEFORE INSERT ON "XPTransaction" FOR EACH ROW EXECUTE FUNCTION dorp_test_gift_failure()`);
 try{
  await assert.rejects(sendVillageGift(a.id,{receiverId:b.id,actionId:randomUUID()}),/DORP_TEST_GIFT_FAILURE/);
  assert.deepEqual({sender:await wallet(a.id),receiver:await wallet(b.id),score:await score(a.id),gifts:await prisma.dorpGift.count(),ledger:await prisma.xPTransaction.count(),notifications:await prisma.notification.count()},before);
 }finally{
  await prisma.$executeRawUnsafe(`DROP TRIGGER dorp_test_gift_failure ON "XPTransaction"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION dorp_test_gift_failure()`);
 }
});

 test("wereldmarkers: alleen geaccepteerd, gedeeld en bestaand; minimaal DTO, begrensd, direct ingetrokken",async()=>{
 const prior=await prisma.contentSwitcherSettings.findUnique({where:{id:"singleton"},select:{dorpVisibleToUsers:true}});
 try{
 const {a,b}=await pair();
 assert.deepEqual(await villageMarkers(a.id),{markers:[{ownerId:b.id,label:b.handle}]});
 await prisma.user.update({where:{id:b.id},data:{shareVillageWithFriends:false}});
 assert.deepEqual(await villageMarkers(a.id),{markers:[]});
 await prisma.user.update({where:{id:b.id},data:{shareVillageWithFriends:true}});
 await prisma.friendship.updateMany({where:{senderId:a.id,receiverId:b.id},data:{status:"PENDING"}});
 assert.deepEqual(await villageMarkers(a.id),{markers:[]});
 await prisma.friendship.updateMany({where:{senderId:a.id,receiverId:b.id},data:{status:"ACCEPTED"}});
 await prisma.user.update({where:{id:a.id},data:{isAdmin:false}});
 await prisma.contentSwitcherSettings.upsert({where:{id:"singleton"},create:{dorpVisibleToUsers:false},update:{dorpVisibleToUsers:false}});
 await assert.rejects(villageMarkers(a.id),reject("UNAVAILABLE"));
 const markerUrl=`${process.env.DORP_TEST_BASE_URL}/api/dorp?markers=friends`;
 assert.equal((await fetch(markerUrl)).status,401);
 const denied=await fetch(markerUrl,{headers:{Cookie:`${SESSION_COOKIE}=${await createSessionToken(a.id)}`}});
 assert.equal(denied.status,404);assert.match(denied.headers.get("cache-control")!,/no-store/);

 await prisma.contentSwitcherSettings.update({where:{id:"singleton"},data:{dorpVisibleToUsers:true}});
 assert.equal((await villageMarkers(a.id)).markers.length,1);
 const extra=Array.from({length:26},()=>{const uid=randomUUID();return{id:uid,email:`marker-${uid}@example.invalid`,handle:`Marker${uid.slice(0,6)}`,discriminator:"01",passwordHash:"synthetic",shareVillageWithFriends:true};});
 await prisma.user.createMany({data:extra});
 await prisma.friendship.createMany({data:extra.map(u=>({senderId:a.id,receiverId:u.id,status:"ACCEPTED" as const}))});
 await prisma.dorpVillage.createMany({data:extra.map(u=>({ownerId:u.id}))});
 const limited=await villageMarkers(a.id);assert.equal(limited.markers.length,8);assert.deepEqual(await villageMarkers(a.id),limited);
 for(const marker of limited.markers)assert.deepEqual(Object.keys(marker).sort(),["label","ownerId"]);

 process.env.VERSADO_DORP_PROTOTYPE_ENABLED="false";
 try{await assert.rejects(villageMarkers(b.id),reject("UNAVAILABLE"));}finally{process.env.VERSADO_DORP_PROTOTYPE_ENABLED="true";}
 }finally{if(prior)await prisma.contentSwitcherSettings.update({where:{id:"singleton"},data:{dorpVisibleToUsers:prior.dorpVisibleToUsers}});else await prisma.contentSwitcherSettings.deleteMany({where:{id:"singleton"}});}
 });
