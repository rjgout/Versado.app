import {promises as fs} from "node:fs";
import {join} from "node:path";
import {markAudioCurrent} from "../src/lib/audioCheck.ts";
import {io} from "socket.io-client";
import {nativeGamesContent} from "./fixtures/native-games-content.mjs";
import {GAME_CATALOG} from "../src/lib/gameCatalog.ts";
import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {issueNativeSession} from '../src/lib/native/sessions.ts';
import {createSessionToken} from '../src/lib/auth.ts';
import {nativeGamePageSchema} from '../src/lib/native/gamesPageContract.ts';
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
const base=new URL(process.env.NATIVE_TEST_BASE_URL??'http://invalid');
if(database.hostname!=='127.0.0.1'||database.pathname!=='/versado_content_access_test'||database.href!==process.env.DATABASE_URL||base.hostname!=='127.0.0.1')throw Error('Alleen eigen geïsoleerde speltestomgeving');
const users=[];let a,b,sourceBefore,fixture;
async function account(hints){const user=await prisma.user.create({data:{email:`native-games-${randomUUID()}@example.invalid`,handle:`Speler${randomUUID().slice(0,8)}`,discriminator:'42',passwordHash:'synthetic-only',emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:'content_bom',hintBalance:hints}});users.push(user.id);return{user,tokens:await issueNativeSession(user.id,user.sessionVersion),cookie:await createSessionToken(user.id)};}
async function call(path,{user=a,method='GET',body,origin='capacitor://localhost',cookie}={}){
 const response=await fetch(new URL('/api/v1/native/'+path,base),{method,headers:{Origin:origin,'X-Versado-Client':'native-v1',...(user?{Authorization:'Bearer '+user.tokens.accessToken}:{}),...(cookie?{Cookie:'bvm_session='+cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const raw=await response.text(),data=raw?JSON.parse(raw):null;return{response,data};
}
before(async()=>{
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 sourceBefore=await prisma.contentCollection.findUnique({where:{id:'content_bom'}});
 await prisma.contentCollection.upsert({where:{id:'content_bom'},create:{id:'content_bom',slug:'native-games-fixture',name:'Synthetische spelbron',icon:'book',work:'bofm',editionKey:'bofm',language:'nl',publicationState:'LEGACY',enabled:true,visibleToUsers:true},update:{enabled:true,visibleToUsers:true,publicationState:'LEGACY',work:'bofm',editionKey:'bofm',language:'nl'}});
 fixture=await nativeGamesContent(prisma);
 a=await account(7);b=await account(2);
 await prisma.friendship.create({data:{senderId:a.user.id,receiverId:b.user.id,status:"ACCEPTED"}});
});
after(async()=>{for(const id of users)await prisma.user.deleteMany({where:{id}});if(fixture)await fixture.cleanup();if(sourceBefore)await prisma.contentCollection.update({where:{id:'content_bom'},data:{enabled:sourceBefore.enabled,visibleToUsers:sourceBefore.visibleToUsers,publicationState:sourceBefore.publicationState,work:sourceBefore.work,editionKey:sourceBefore.editionKey,language:sourceBefore.language}});await prisma.$disconnect();});

test('dezelfde spelhandeling houdt de native actor, zelfs bij een vreemde webcookie',async()=>{
 const {response,data}=await call('games/hints',{cookie:b.cookie});
 assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.version,1);assert.equal(data.userId,a.user.id);assert.equal(data.status,200);assert.equal(data.data.hintBalance,7);
 const anonymous=await call('games/hints',{user:null,cookie:a.cookie});assert.equal(anonymous.response.status,401);
 const foreign=await call('games/hints',{origin:'https://evil.invalid'});assert.equal(foreign.response.status,403);
});

test('native pagina gebruikt de bestaande volledige webingang, zonder HTML of sessies in het antwoord',async()=>{
 const {response,data}=await call('games/page?route=%2Flive');
 assert.equal(response.status,200,JSON.stringify(data));const page=nativeGamePageSchema.parse(data);
 assert.equal(page.userId,a.user.id);assert.equal(page.result.kind,'screen');assert.equal(page.result.screen.view,'hub');assert.equal(typeof page.result.screen.data.contentName,'string');
 assert.equal(JSON.stringify(data).includes(a.tokens.accessToken),false);assert.equal(response.headers.get('set-cookie'),null);assert.match(response.headers.get('cache-control'),/no-store/);
});

test('native oorsprong vervangt web-CSRF niet en geeft geen vrije API of beheerroute',async()=>{
 const web=await fetch(new URL('/api/word-search',base),{method:'POST',headers:{Origin:'capacitor://localhost',Cookie:'bvm_session='+a.cookie,'Content-Type':'application/json'},body:'{}'});
 assert.equal(web.status,403);
 const native=await call('games/word-search',{method:'POST',body:{}});
 assert.equal(native.response.status,200,JSON.stringify(native.data));assert.equal(native.data.status,400,'Bestaande invoercontrole blijft actief achter de native oorsprongspoort');
 for(const path of ['games/admin/users','games/auth/login','games/hints?token=secret','games/page?route=%2Fadminbackend'])assert.equal((await call(path)).response.status,404,path);
 const oversize=await call('games/word-game/guess',{method:'POST',body:{text:'x'.repeat(16_385)}});assert.equal(oversize.response.status,413);
});


test('alle tien catalogusspellen gebruiken op iOS hun volledige bestaande webingang',async()=>{
 assert.equal(GAME_CATALOG.length,10);
 for(const game of GAME_CATALOG){
  const {response,data}=await call('games/page?route='+encodeURIComponent(game.href));
  assert.equal(response.status,200,game.id+': '+JSON.stringify(data));
  const page=nativeGamePageSchema.parse(data);assert.equal(page.result.kind,'screen',game.id);
 }
});

test('start en hervatten gebruiken dezelfde bestaande spelrijen',async()=>{
 const actions=[
  ['games/word-search',{difficulty:'EASY'},data=>'/word-search/'+data.id],
  ['games/jigsaw-v2',{action:'start',imageIndex:0,pieceCount:6,difficulty:'DISCOVERER'},()=>'/jigsaw'],
  ['games/chapter-guess/start',{level:'BEGINNER',questionCount:5},data=>'/chapter-guess/solo/'+data.gameId],
  ['games/snelle-zendeling/runs',{},data=>'/snelle-zendeling/run/'+data.runId],
  ['games/alleskenner/solo',{mode:'PRACTICE'},data=>'/alleskenner/alleen/'+data.runId],
  ['games/live/create-family-game',{minutes:15,diceMode:'DIGITAL'},data=>'/live/'+data.code],
  ['games/live/create-alleskenner',{},data=>'/live/'+data.code],
  ['games/live/create',{chapterId:fixture.chapters[0].id},data=>'/live/'+data.code],
  ['games/scrabble',{friendUserId:b.user.id},()=>'/scrabble'],
  ['games/challenges',{friendUserId:b.user.id,chapterId:fixture.chapters[0].id},()=>'/challenges'],
  ['games/mysteries/attempts',{action:'start',variant:'001a',actionId:randomUUID()},()=>'/mysteries/001a/play'],
 ];
 for(const [path,body,route]of actions){
  const started=await call(path,{method:'POST',body});
  assert.equal(started.response.status,200,path+': '+JSON.stringify(started.data));
  assert.ok(started.data.status>=200&&started.data.status<300,path+': '+JSON.stringify(started.data));
  const href=route(started.data.data);
  assert.ok(!href.includes('undefined'),path+': onbekende identiteit '+JSON.stringify(started.data.data));
  for(let i=0;i<2;i++){
   const page=await call('games/page?route='+encodeURIComponent(href));
   assert.equal(page.response.status,200,href+': '+JSON.stringify(page.data));
   assert.equal(nativeGamePageSchema.parse(page.data).result.kind,'screen',href);
  }
 }
});

test('spel-leesopdracht gebruikt dezelfde native audiolease en streng geversioneerde privéannotaties',async()=>{
 const chapter=fixture.chapters[0],route='games/reading/'+chapter.id;
 const metadata=await call(route+'/audio/playback');
 assert.equal(metadata.response.status,200,JSON.stringify(metadata.data));
 assert.equal(metadata.data.reader.game.kind,'reading');
 assert.equal(metadata.data.reader.chapterId,chapter.id);
 assert.deepEqual(metadata.data.audio.sources,[],'Geen onbestaande opname in synthetische bron');
 const reader=metadata.data.reader,verse=reader.verses[0];
 const context=Object.fromEntries(['activeCollectionId','selectionVersion','language','chapterId','startVerse','endVerse'].map(key=>[key,reader[key]]));
 const action={kind:'note',target:{type:'verse',verseId:verse.id},text:'Privé spelnotitie',expectedVersion:0,actionId:randomUUID()};
 const request={operation:'put',context,action};
 const saved=await call(route+'/annotations',{method:'POST',body:request});
 assert.equal(saved.response.status,200,JSON.stringify(saved.data));assert.equal(saved.data.annotation.text,action.text);assert.equal(saved.data.annotation.mutationVersion,1);
 const repeated=await call(route+'/annotations',{method:'POST',body:request});assert.equal(repeated.response.status,200);assert.equal(repeated.data.annotation.mutationVersion,1,'Herhalen geeft geen tweede write');
 const own=await call(route+'/annotations');assert.equal(own.data.annotations.length,1);
 const foreign=await call(route+'/annotations',{user:b});assert.equal(foreign.response.status,200);assert.equal(foreign.data.annotations.length,0);
 const wrongVerse=await call(route+'/annotations/outside');assert.equal(wrongVerse.response.status,404);
 const deleted=await call(route+'/annotations',{method:'POST',body:{operation:'delete',context,action:{kind:'note',target:action.target,expectedVersion:1,actionId:randomUUID()}}});
 assert.equal(deleted.response.status,200,JSON.stringify(deleted.data));assert.equal(deleted.data.annotation.deleted,true);assert.equal(deleted.data.annotation.mutationVersion,2);
 const conflict=await call(route+'/annotations',{method:'POST',body:{...request,action:{...action,actionId:randomUUID()}}});assert.equal(conflict.response.status,409);
 assert.equal((await call(route+'/annotations')).data.annotations[0].deleted,true,'Tombstone blijft zichtbaar voor versiecontrole');
 const otherSource=await prisma.contentCollection.create({data:{id:'native-other-'+randomUUID(),slug:'native-other-'+randomUUID(),name:'Andere synthetische bron',icon:'book',work:'bofm',editionKey:'native-fixture-'+randomUUID(),language:'en',publicationState:'LEGACY',enabled:true,visibleToUsers:true}});
 try{
  await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:otherSource.id}});
  await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:'content_bom'}});
  const aba=await call(route+'/annotations',{method:'POST',body:{...request,action:{...action,expectedVersion:2,actionId:randomUUID()}}});assert.equal(aba.response.status,409,'Terugkeren naar dezelfde bron geeft geen oude schrijfbevoegdheid');
 }finally{await prisma.contentCollection.delete({where:{id:otherSource.id}});}
 assert.equal((await call(route+'/annotations?user=B')).response.status,400);
 assert.equal((await call('games/annotations?view=reader&chapterId='+chapter.id)).response.status,404);
});

test('audio van Raad het hoofdstuk onthult geen antwoord-ID en weigert een vreemde eigenaar of vorige vraag',async()=>{
 const started=await call('games/chapter-guess/start',{method:'POST',body:{level:'BEGINNER',questionCount:5}});
 assert.equal(started.data.status,200,JSON.stringify(started.data));const id=started.data.data.gameId;
 const metadata=await call(`games/intro-solo/${id}/0/audio/playback`);
 assert.equal(metadata.response.status,200,JSON.stringify(metadata.data));
 const game=await prisma.chapterGuessGame.findUnique({where:{id},include:{questions:{where:{order:0}}}});
 assert.notEqual(metadata.data.reader.chapterId,game.questions[0].chapterId);assert.equal(JSON.stringify(metadata.data).includes(game.questions[0].chapterId),false);
 assert.equal((await call(`games/intro-solo/${id}/0/audio/playback`,{user:b})).response.status,404);
 assert.equal((await call(`games/intro-solo/${id}/1/audio/playback`)).response.status,404);
 const expired=await account(0);await prisma.nativeSession.updateMany({where:{userId:expired.user.id},data:{revokedAt:new Date()}});
 assert.equal((await call('games/reading/'+fixture.chapters[0].id+'/audio/playback',{user:expired})).response.status,401);
});


test('Woordzoeker voltooit via native dezelfde puzzel met één XP-beloning en zonder gelekte oplossingen',async()=>{
 const start=await call('games/word-search',{method:'POST',body:{difficulty:'EASY'}});
 assert.equal(start.data.status,200,JSON.stringify(start.data));const id=start.data.data.id;
 assert.ok(start.data.data.words.every(word=>!('start' in word)&&!('end' in word)));
 const secret=await prisma.wordSearchGame.findUnique({where:{id}}),words=JSON.parse(secret.words);
 assert.ok(words.length>0);
 const before=await prisma.user.findUnique({where:{id:a.user.id},select:{xpTotal:true}});
 for(const word of words){const found=await call('games/word-search/'+id+'/find',{method:'POST',body:{start:word.start,end:word.end}});assert.equal(found.data.status,200,JSON.stringify(found.data));assert.equal(found.data.data.correct,true);}
 const done=await call('games/word-search/'+id);assert.equal(done.data.data.status,'COMPLETED');assert.ok(done.data.data.xpEarned>0);
 const last=words.at(-1);
 await Promise.all([0,1].map(()=>call('games/word-search/'+id+'/find',{method:'POST',body:{start:last.start,end:last.end}})));
 const after=await prisma.user.findUnique({where:{id:a.user.id},select:{xpTotal:true}});assert.equal(after.xpTotal-before.xpTotal,done.data.data.xpEarned);
 const foreign=await call('games/word-search/'+id,{user:b});assert.equal(foreign.data.status,404);
});

test('Scrabble deelt uitnodiging en beurten met web, maar nooit het rack van de tegenstander',async()=>{
 const invite=await call('games/scrabble',{method:'POST',body:{friendUserId:b.user.id}});assert.equal(invite.data.status,200,JSON.stringify(invite.data));const id=invite.data.data.id;
 const accepted=await call('games/scrabble/'+id+'/accept',{user:b,method:'POST',body:{}});assert.equal(accepted.data.status,200,JSON.stringify(accepted.data));
 const own=await call('games/scrabble/'+id),other=await call('games/scrabble/'+id,{user:b});
 assert.equal(own.data.status,200);assert.equal(other.data.status,200);
 for(const game of [own.data.data,other.data.data])for(const key of ['player1Rack','player2Rack','opponentRack','bag'])assert.equal(key in game,false,key);
 const stored=await prisma.scrabbleGame.findUnique({where:{id}});assert.ok(own.data.data.myRack);assert.ok(other.data.data.myRack);
 const turn=stored.turnUserId===a.user.id?a:b;
 const passed=await call('games/scrabble/'+id+'/pass',{user:turn,method:'POST',body:{}});assert.equal(passed.data.status,200,JSON.stringify(passed.data));
 const state=await prisma.scrabbleGame.findUnique({where:{id}});assert.notEqual(state.turnUserId,stored.turnUserId);
 const third=await account(0);assert.equal((await call('games/scrabble/'+id,{user:third})).data.status,404);
});

function socketEvent(socket,name,predicate=()=>true){return new Promise((resolve,reject)=>{const done=value=>{if(!predicate(value))return;clearTimeout(timer);socket.off(name,done);resolve(value);};const timer=setTimeout(()=>{socket.off(name,done);reject(Error('Ontbrekend spel-event: '+name));},8000);socket.on(name,done);});}
async function gameSocket(actor,native=true){
 const ticket=native?await call('realtime/session',{user:actor,method:'POST',body:{}}):null;
 if(native)assert.equal(ticket.response.status,200);
 const socket=io(base.origin,{transports:['websocket'],autoConnect:false,reconnection:false,auth:native?{client:'native-v1',ticket:ticket.data.socketTicket}:{},extraHeaders:native?{Origin:'capacitor://localhost'}:{Origin:base.origin,Cookie:'bvm_session='+actor.cookie}});
 const connected=socketEvent(socket,'connect');socket.connect();await connected;return socket;
}
test('native en web spelen dezelfde live-oefening, met herverbinden via een nieuw eenmalig ticket',async()=>{
 const created=await call('games/live/create',{method:'POST',body:{chapterId:fixture.chapters[1].id}});assert.equal(created.data.status,200,JSON.stringify(created.data));const code=created.data.data.code;
 let native,web,reconnected;
 try{
  native=await gameSocket(a);web=await gameSocket(b,false);
  let lobby=socketEvent(native,'lobby_update');native.emit('join_game',{code});await lobby;
  lobby=socketEvent(native,'lobby_update',value=>value.players.length===2);web.emit('join_game',{code});await lobby;
  const question=socketEvent(native,'question'),sameQuestion=socketEvent(web,'question');native.emit('start_game');
  const [one,two]=await Promise.all([question,sameQuestion]);for(const key of ["index","total","type","prompt"])assert.deepEqual(one[key],two[key]);assert.equal('answers' in one,false,'Antwoord blijft servergeheim');
  native.disconnect();reconnected=await gameSocket(a);
  const resumed=socketEvent(reconnected,'question');reconnected.emit('join_game',{code});const restored=await resumed;assert.equal(restored.index,one.index);assert.equal(restored.prompt,one.prompt);
  const result=socketEvent(reconnected,'answer_result');reconnected.emit('submit_answer',{questionIndex:one.index,given:['true']});const answer=await result;assert.equal(answer.questionIndex,one.index);
 }finally{native?.disconnect();web?.disconnect();reconnected?.disconnect();}
});


test('native spel-lezer gebruikt dezelfde beschermde MP3-ranges, sessiecontrole en bestandsintegriteit',async()=>{
 const root=process.env.AUDIO_TEST_ROOT;
 assert.ok(root&&root===process.env.AUDIO_DIR&&root.startsWith('/tmp/versado-native-audio-'));
 const chapter=fixture.chapters[2],name='native-game-'+randomUUID()+'.mp3',file=join(root,name),bytes=await fs.readFile('tests/fixtures/native-audio/synthetic.mp3');
 await fs.writeFile(file,bytes);
 try{
  await prisma.chapter.update({where:{id:chapter.id},data:{audioUrl:'https://assets.churchofjesuschrist.org/'+name}});
  await prisma.verse.updateMany({where:{chapterId:chapter.id},data:{audioStart:0}});await markAudioCurrent(prisma,chapter.id);
  const route='games/reading/'+chapter.id+'/audio',metadata=await call(route+'/playback');assert.equal(metadata.response.status,200,JSON.stringify(metadata.data));assert.equal(metadata.data.audio.sources.length,1);
  const source=metadata.data.audio.sources[0],path=route+'/'+source.id+'/stream';
  const request=(actor,range,method='GET')=>fetch(new URL('/api/v1/native/'+path,base),{method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1',Authorization:'Bearer '+actor.tokens.accessToken,...(range?{Range:range}:{})},redirect:'manual'});
  const stream=await request(a,'bytes=0-127');assert.equal(stream.status,206);assert.equal(stream.headers.get('content-range'),`bytes 0-127/${bytes.length}`);assert.deepEqual(Buffer.from(await stream.arrayBuffer()),bytes.subarray(0,128));
  const head=await request(a,undefined,'HEAD');assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const range of [undefined,'bytes=0-','bytes=-128','bytes=0-262144','bytes=0-1,8-9']){const denied=await request(a,range);assert.equal(denied.status,416,String(range));assert.equal((await denied.arrayBuffer()).byteLength,0);}
  const foreign=await request(b,'bytes=0-127');assert.equal(foreign.status,404);assert.equal(foreign.headers.get('content-type')?.startsWith('audio/'),false);
  const corrupt=Buffer.from(bytes);corrupt[100]^=1;await fs.writeFile(file,corrupt);
  const changed=await request(a,'bytes=0-127');assert.equal(changed.status,404);assert.equal(changed.headers.get('content-type')?.startsWith('audio/'),false);
 }finally{await prisma.chapter.update({where:{id:chapter.id},data:{audioUrl:null}});await fs.unlink(file);}
});

test('woordenboek behoudt gecontroleerde Unicode door de echte Next-catchall, zonder gecodeerde padgrenzen',async()=>{
 const found=await call('games/dictionary/%C3%89CRIT');assert.equal(found.response.status,200,JSON.stringify(found.data));assert.equal(found.data.status,200);assert.ok(Array.isArray(found.data.data.verses));
 for(const path of ['games/dictionary/%2Fadmin','games/dictionary/%252Fadmin'])assert.equal((await call(path)).response.status,404,path);
});


test('extra spelmethoden behouden de bestaande 405-grens en beperken voorkeuren tot de spel- en cursuslijst',async()=>{
 for(const method of ['PUT','PATCH'])assert.equal((await call('courses/course/read/chapters/chapter/annotations',{method,body:{}})).response.status,405);
 const saved=await call('games/list-order',{method:'PUT',body:{listKey:'games',itemKeys:GAME_CATALOG.map(game=>game.id)}});assert.equal(saved.response.status,200,JSON.stringify(saved.data));assert.equal(saved.data.status,200);
 const order=await call('games/list-order?listKey=games');assert.equal(order.data.data.order.length,10);
 assert.equal((await call('games/list-order?listKey=courses')).response.status,200);
 for(const listKey of ['unknown','today-continue'])assert.equal((await call('games/list-order',{method:'PUT',body:{listKey,itemKeys:[]}})).response.status,400);
 assert.equal(await prisma.userListOrder.count({where:{userId:a.user.id,listKey:'games'}}),10);
});

test('Alleskenner-luisteren gebruikt de actuele vraag van de echte spelserver en weigert vreemde of oude vragen',async()=>{
 const player=await account(4),started=await call('games/alleskenner/solo',{user:player,method:'POST',body:{mode:'PRACTICE'}});
 assert.equal(started.data.status,200,JSON.stringify(started.data));const runId=started.data.data.runId;
 const run=await prisma.alleskennerSoloRun.findUnique({where:{id:runId}}),items=JSON.parse(run.items);
 const questions=await prisma.alleskennerItem.findMany({where:{id:{in:items.questions},kind:'QUESTION'}});
 const listening=questions.find(item=>JSON.parse(item.data).listen),normal=questions.find(item=>!JSON.parse(item.data).listen);assert.ok(listening&&normal);
 // Deterministische eigen fixture: dezelfde toegekende set, luistervraag op de
 // tweede toegestane positie en uitsluitend een bestaande synthetische passage.
 const ordered={...items,questions:[normal.id,listening.id,...items.questions.filter(id=>id!==normal.id&&id!==listening.id)]};
 await prisma.alleskennerSoloRun.update({where:{id:runId},data:{items:JSON.stringify(ordered)}});
 await prisma.alleskennerItem.update({where:{id:listening.id},data:{data:JSON.stringify({...JSON.parse(listening.data),listen:{ref:'Synthetisch spelboek 1:1'}})}});
 let socket;
 try{
  socket=await gameSocket(player);
  const first=socketEvent(socket,'ak:state',state=>state.phase==='R369'&&state.r369?.number===1&&!state.r369.reveal&&!state.intermission);socket.emit('ak:solo_join',{runId});await first;
  const next=socketEvent(socket,'ak:state',state=>state.phase==='R369'&&state.r369?.number===2&&!state.r369.reveal&&!state.intermission);socket.emit('ak:tap_369',{option:JSON.parse(normal.data).answer});const state=await next;
  assert.equal(state.r369.listenText,'Synthetische speltekst 1.');
  const path=`games/ak-solo/${runId}/2/audio/playback`,metadata=await call(path,{user:player});assert.equal(metadata.response.status,200,JSON.stringify(metadata.data));assert.equal(metadata.data.reader.verses[0].text,state.r369.listenText);assert.deepEqual(metadata.data.audio.sources,[]);
  assert.equal((await call(path,{user:b})).response.status,404);
  assert.equal((await call(`games/ak-solo/${runId}/1/audio/playback`,{user:player})).response.status,404);
  assert.equal((await call(`games/ak-live/${runId}/2/audio/playback`,{user:player})).response.status,404);
  await prisma.nativeSession.updateMany({where:{userId:player.user.id},data:{revokedAt:new Date()}});
  assert.equal((await call(path,{user:player})).response.status,401);
 }finally{socket?.disconnect();await prisma.alleskennerItem.update({where:{id:listening.id},data:{data:listening.data}});}
});


test('dezelfde XP-winkel ondersteunt spelhints en Genees zonder vreemde accounts of dubbele beloning',async()=>{
 const player=await account(0);await prisma.user.update({where:{id:player.user.id},data:{xpTotal:2000}});
 const page=await call('games/page?route=%2Fshop',{user:player});assert.equal(page.response.status,200);assert.equal(nativeGamePageSchema.parse(page.data).result.screen.view,'shop');
 const shop=(await call('games/shop',{user:player})).data.data;assert.equal(shop.xpTotal,2000);
 const hints=await call('games/shop/hints',{user:player,cookie:b.cookie,method:'POST',body:{quantity:2}});assert.equal(hints.data.status,200);assert.equal(hints.data.data.hintBalance,2);assert.equal(hints.data.data.xpTotal,2000-2*shop.hintPriceXp);
 const key=randomUUID(),genees=await call('games/shop/genees',{user:player,method:'POST',body:{idempotencyKey:key}});assert.equal(genees.data.status,200);
 const replay=await call('games/shop/genees',{user:player,method:'POST',body:{idempotencyKey:key}});assert.equal(replay.data.status,200);assert.equal(replay.data.data.xpTotal,genees.data.data.xpTotal);assert.equal(replay.data.data.geneesBalance,genees.data.data.geneesBalance);
 const freeze=await call('games/shop/freezes',{user:player,method:'POST',body:{quantity:1}});assert.equal(freeze.data.status,200);assert.equal(freeze.data.data.freezeCount,shop.freezeCount+1);assert.equal(freeze.data.data.xpTotal,genees.data.data.xpTotal-shop.freezePriceXp);
 const unchanged=await prisma.user.findUniqueOrThrow({where:{id:player.user.id}});
 for(const quantity of [-1,0,1001]){const invalid=await call('games/shop/hints',{user:player,method:'POST',body:{quantity}});assert.equal(invalid.data.status,400);}
 assert.equal((await call('games/shop/hints',{user:null,cookie:player.cookie,method:'POST',body:{quantity:1}})).response.status,401);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:player.user.id}})).xpTotal,unchanged.xpTotal);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.user.id}})).hintBalance,2);
});
