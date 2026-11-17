import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {issueNativeSession} from '../src/lib/native/sessions.ts';
import {createSessionToken} from '../src/lib/auth.ts';
// Vrienden via de bestaande spelbrug: echte handlers, echte database, uitsluitend geïsoleerd.
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
const base=new URL(process.env.NATIVE_TEST_BASE_URL??'http://invalid');
if(database.hostname!=='127.0.0.1'||database.pathname!=='/versado_content_access_test'||database.href!==process.env.DATABASE_URL||base.hostname!=='127.0.0.1')throw Error('Alleen eigen geïsoleerde vriendentest');
const users=[];let a,b,c;
async function account(share){const user=await prisma.user.create({data:{email:`native-friends-${randomUUID()}@example.invalid`,handle:`Vriend${randomUUID().slice(0,8)}`,discriminator:'42',passwordHash:'synthetic-only',emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),shareAchievements:share,xpTotal:1234,currentStreak:9}});users.push(user.id);return{user,tokens:await issueNativeSession(user.id,user.sessionVersion),cookie:await createSessionToken(user.id)};}
async function call(path,{user=a,method='GET',body,origin='capacitor://localhost',cookie}={}){
 const response=await fetch(new URL('/api/v1/native/'+path,base),{method,headers:{Origin:origin,'X-Versado-Client':'native-v1',...(user?{Authorization:'Bearer '+user.tokens.accessToken}:{}),...(cookie?{Cookie:'bvm_session='+cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await response.text(),data=raw?JSON.parse(raw):null;return{response,data};
}
before(async()=>{a=await account(false);b=await account(false);c=await account(true);});
after(async()=>{for(const id of users)await prisma.user.deleteMany({where:{id}});await prisma.$disconnect();});

test('verzoek → accepteren → profiel → verwijderen, alles onder de native identiteit',async()=>{
 const sent=await call('games/friends/request',{method:'POST',body:{targetUserId:b.user.id}});
 assert.equal(sent.response.status,200,JSON.stringify(sent.data));assert.equal(sent.data.userId,a.user.id);
 const friendshipId=sent.data.data.id;assert.ok(friendshipId);
 // Dubbel verzoek (ook omgekeerd) → 409, geen tweede rij.
 assert.equal((await call('games/friends/request',{method:'POST',body:{targetUserId:b.user.id}})).data.status,409);
 assert.equal((await call('games/friends/request',{user:b,method:'POST',body:{targetUserId:a.user.id}})).data.status,409);
 assert.equal(await prisma.friendship.count({where:{OR:[{senderId:a.user.id,receiverId:b.user.id},{senderId:b.user.id,receiverId:a.user.id}]}}),1);
 // Nog geen vriend: geen profiel, ook niet bij een lopend verzoek.
 assert.equal((await call(`games/friends/profiles/${b.user.id}`)).data.status,404);
 // Alleen de ontvanger kan accepteren.
 assert.notEqual((await call(`games/friends/${friendshipId}/accept`,{method:'POST',body:{}})).data.status,200);
 assert.equal((await call(`games/friends/${friendshipId}/accept`,{user:b,method:'POST',body:{}})).data.status,200);
 const list=await call('games/friends');assert.equal(list.data.data.friends.length,1);assert.equal(list.data.data.friends[0].user.id,b.user.id);
 // Profiel: b deelt geen prestaties → alleen identiteit, geen statistieken.
 const profile=await call(`games/friends/profiles/${b.user.id}`);
 assert.equal(profile.data.status,200);assert.equal(profile.data.data.stats,null);assert.equal(profile.data.data.sharesAchievements,false);
 assert.equal(JSON.stringify(profile.data.data).includes('1234'),false);
 // Een derde is geen vriend: 404 zonder lek of de id bestaat.
 assert.equal((await call(`games/friends/profiles/${b.user.id}`,{user:c})).data.status,404);
 // Een niet-deelnemer kan de vriendschap niet verwijderen.
 assert.equal((await call(`games/friends/${friendshipId}`,{user:c,method:'DELETE'})).data.status,404);
 assert.equal(await prisma.friendship.count({where:{id:friendshipId}}),1);
 const removed=await call(`games/friends/${friendshipId}`,{method:'DELETE'});assert.equal(removed.data.status,200);
 assert.equal(await prisma.friendship.count({where:{id:friendshipId}}),0);
 assert.equal((await call(`games/friends/profiles/${b.user.id}`)).data.status,404);
});

test('deelt een vriend prestaties, dan komen alleen die velden mee',async()=>{
 await prisma.friendship.create({data:{senderId:a.user.id,receiverId:c.user.id,status:'ACCEPTED'}});
 const profile=await call(`games/friends/profiles/${c.user.id}`);
 assert.equal(profile.data.status,200);assert.equal(profile.data.data.stats.xpTotal,1234);assert.equal(profile.data.data.stats.currentStreak,9);
 assert.equal(profile.data.data.friend.email,undefined);assert.equal(JSON.stringify(profile.data.data).includes('example.invalid'),false);
 await prisma.friendship.deleteMany({where:{senderId:a.user.id,receiverId:c.user.id}});
});

test('identiteit en grenzen: geen sessie, vreemde origin, vreemde cookie en niet-toegestane routes',async()=>{
 assert.equal((await call('games/friends',{user:null})).response.status,401);
 assert.equal((await call('games/friends',{origin:'https://evil.invalid'})).response.status,403);
 // Een webcookie van een ander account verandert de actor niet.
 const withCookie=await call('games/friends',{cookie:b.cookie});assert.equal(withCookie.data.userId,a.user.id);
 // Niet in de allowlist: uitnodigingslink, verkeerde methode, onbekend pad.
 assert.equal((await call('games/friends/invite')).response.status,404);
 assert.equal((await call('games/friends/request')).response.status,404);
 assert.equal((await call(`games/friends/profiles/${b.user.id}`,{method:'POST',body:{}})).response.status,404);
 const self=await call('games/friends/request',{method:'POST',body:{targetUserId:a.user.id}});assert.equal(self.data.status,400);
});
