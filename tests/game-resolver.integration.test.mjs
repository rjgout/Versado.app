import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {prisma} from '../src/lib/db.ts';
import {referenceAccount,assertReferenceTestEnvironment} from './fixtures/reference-content.mjs';
import {resolveGameContent,checkGameAvailability} from '../src/lib/gameContentResolver.ts';
import {startWordSearch,getActiveWordSearch} from '../src/lib/wordSearch/game.ts';
assertReferenceTestEnvironment();let actor,collection,original,settings,scope;
before(async()=>{
 actor=await referenceAccount();
 original=await prisma.contentCollection.findUniqueOrThrow({where:{id:'content_bom'}});
 collection=await prisma.contentCollection.update({where:{id:original.id},data:{enabled:true,visibleToUsers:true,publicationState:'PUBLISHED'}});
 settings=await prisma.gameSettings.findUnique({where:{id:'singleton'}});
 scope=await prisma.gameContentScope.findUnique({where:{gameKey_contentCollectionId:{gameKey:'word-search',contentCollectionId:collection.id}}});
 await prisma.user.update({where:{id:actor.user.id},data:{activeContentCollectionId:collection.id,contentLanguage:'nl'}});
 await prisma.gameSettings.upsert({where:{id:'singleton'},create:{id:'singleton',wordSearchEnabled:true},update:{wordSearchEnabled:true}});
 await prisma.gameContentScope.upsert({where:{gameKey_contentCollectionId:{gameKey:'word-search',contentCollectionId:collection.id}},create:{gameKey:'word-search',contentCollectionId:collection.id},update:{}});
 });after(async()=>{
 await prisma.contentCollection.update({where:{id:original.id},data:{enabled:original.enabled,visibleToUsers:original.visibleToUsers,publicationState:original.publicationState,language:original.language,work:original.work}});
 if(settings)await prisma.gameSettings.update({where:{id:'singleton'},data:settings});else await prisma.gameSettings.deleteMany({where:{id:'singleton'}});
 if(scope)await prisma.gameContentScope.upsert({where:{id:scope.id},create:scope,update:{}});else await prisma.gameContentScope.deleteMany({where:{gameKey:'word-search',contentCollectionId:collection.id}});
 await prisma.$disconnect();
});
test('concrete woordpool is reproduceerbaar; aanbod lekt geen woorden of resolverdata',async()=>{
 const a=await resolveGameContent(actor.user.id,'word-search'),b=await resolveGameContent(actor.user.id,'word-search');assert.equal(a.available,true);assert.equal(a.context.poolHash,b.context.poolHash);assert.match(a.context.poolHash,/^[a-f0-9]{64}$/);assert.ok(a.wordCandidates.length>20);assert.equal(a.context.collectionId,collection.id);assert.equal(a.context.poolLanguage,'nl');assert.equal(a.context.rulesVersion,1);
 const availability=await checkGameAvailability('word-search',collection.id);assert.equal('wordCandidates' in availability,false);assert.equal('context' in availability,false);
});
test('nieuwe sessie bevriest bron/pool; retry, bronwissel en settingswijziging behouden grid en context',async()=>{
 const before=await prisma.user.findUnique({where:{id:actor.user.id}});const game=await startWordSearch(actor.user.id,'EASY');
 const stored=await prisma.wordSearchGame.findUniqueOrThrow({where:{id:game.id}});assert.equal(stored.sourceContext.collectionId,collection.id);assert.equal(stored.sourceContext.normalizationVersion,1);assert.match(stored.sourceContext.poolHash,/^[a-f0-9]{64}$/);
 assert.equal((await startWordSearch(actor.user.id,'HARD')).id,game.id);
 await assert.rejects(prisma.contentCollection.delete({where:{id:collection.id}}),/WORD_SEARCH_SOURCE_IN_USE/);
 assert.deepEqual(await prisma.wordSearchGame.findUnique({where:{id:game.id}}),stored);
 await prisma.user.update({where:{id:actor.user.id},data:{activeContentCollectionId:(await prisma.contentCollection.findFirstOrThrow({where:{work:'podcasts'}})).id}});
 await prisma.gameSettings.update({where:{id:'singleton'},data:{wordSearchEnabled:false}});
 const resumed=await getActiveWordSearch(actor.user.id);assert.equal(resumed.id,game.id);assert.deepEqual(resumed.grid,game.grid);
 assert.deepEqual(await prisma.wordSearchGame.findUnique({where:{id:game.id}}),stored);
 await assert.rejects(prisma.wordSearchGame.update({where:{id:game.id},data:{sourceContext:{...stored.sourceContext,language:'en'}}}),/WORD_SEARCH_SOURCE_IMMUTABLE/);
 const after=await prisma.user.findUnique({where:{id:actor.user.id}});assert.equal(after.xpTotal,before.xpTotal);assert.equal(after.hintBalance,before.hintBalance);
 await prisma.gameSettings.update({where:{id:'singleton'},data:{wordSearchEnabled:true}});
 await prisma.user.update({where:{id:actor.user.id},data:{activeContentCollectionId:collection.id}});
 const en=await prisma.contentCollection.findFirstOrThrow({where:{work:'bofm',editionKey:'bofm',language:'en'}});
 await prisma.contentCollection.update({where:{id:en.id},data:{enabled:true,visibleToUsers:true,publicationState:'PUBLISHED'}});
 await prisma.gameContentScope.upsert({where:{gameKey_contentCollectionId:{gameKey:'word-search',contentCollectionId:en.id}},create:{gameKey:'word-search',contentCollectionId:en.id},update:{}});
 try {
  await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:false}});
  await prisma.user.update({where:{id:actor.user.id},data:{activeContentCollectionId:en.id}});
  await assert.rejects(startWordSearch(actor.user.id,'EASY'),/niet beschikbaar/);
  assert.deepEqual(await prisma.wordSearchGame.findUnique({where:{id:game.id}}),stored);
 } finally {
  await prisma.contentCollection.update({where:{id:en.id},data:{enabled:en.enabled,visibleToUsers:en.visibleToUsers,publicationState:en.publicationState}});
  await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:true}});
  await prisma.user.update({where:{id:actor.user.id},data:{activeContentCollectionId:collection.id}});
 }
});
test('lege/ongeschikte bron of ongeldige scope start geen pool en verandert niets',async()=>{
 for(const patch of [{visibleToUsers:false},{enabled:false},{publicationState:'DRAFT'},{language:'xx'},{work:'podcasts'}]){
  await prisma.contentCollection.update({where:{id:collection.id},data:patch});const r=await resolveGameContent(actor.user.id,'word-search');assert.equal(r.available,false);assert.equal(r.wordCandidates,undefined);
  await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:true,enabled:true,publicationState:'PUBLISHED',language:'nl',work:'bofm'}});
 }
 await prisma.gameContentScope.deleteMany({where:{contentCollectionId:collection.id,gameKey:'word-search'}});assert.equal((await resolveGameContent(actor.user.id,'word-search')).reason,'scope');
 assert.equal((await resolveGameContent(actor.user.id,'fake-game')).reason,'unsupported');
});

test('oude sessie zonder verzonnen metadata blijft hervatbaar',async()=>{
 const old=await prisma.wordSearchGame.findUniqueOrThrow({where:{id:'legacy-word-search-migration'}});assert.equal(old.sourceContext,null);
 const resumed=await getActiveWordSearch(old.userId);assert.equal(resumed.id,old.id);assert.equal((await prisma.wordSearchGame.findUnique({where:{id:old.id}})).sourceContext,null);
});
