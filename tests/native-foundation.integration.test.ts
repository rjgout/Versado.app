import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, decodeJwt } from "jose";
import { prisma } from "../src/lib/db";
import { createSessionToken, createTwoFactorChallengeToken, hashPassword, verifySessionToken } from "../src/lib/auth";
import { issueNativeSession, nativeUser, rotateNativeSession } from "../src/lib/native/sessions";
import { createAppleChallenge, finishAppleChallenge, unlinkApple } from "../src/lib/native/apple";
import { nativePasswordLogin } from "../src/lib/native/password";
const database = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.DATABASE_URL)throw Error("Alleen eigen geïsoleerde database");
const base=process.env.NATIVE_TEST_BASE_URL!;
const password="Synthetic-password-42", hash=await hashPassword(password);
async function user(extra: Record<string,unknown>={}) {return prisma.user.create({data:{email:`native-${randomUUID()}@example.invalid`,handle:`Native${randomUUID().slice(0,12)}`,discriminator:"01",passwordHash:hash,emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),...extra}});}
async function call(path:string,body?:unknown,token?:string,extra:Record<string,string>={},method=body===undefined?"GET":"POST"){
 const response=await fetch(`${base}/api/v1/native/${path}`,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1","x-real-ip":"127.0.0.20",...(body===undefined?{}:{"Content-Type":"application/json"}),...(token?{Authorization:`Bearer ${token}`} :{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 return {response,data:response.status===204?null:await response.json()};
}
after(async()=>prisma.$disconnect());

test("webcookie en native Bearer zijn gescheiden, versies trekken beide sessies in",async()=>{
 const account=await user(),pair=await issueNativeSession(account.id,account.sessionVersion),web=await createSessionToken(account.id);
 assert.equal((await nativeUser(pair.accessToken)).id,account.id);assert.equal((await verifySessionToken(web))?.userId,account.id);
 assert.equal(await verifySessionToken(pair.accessToken),null);await assert.rejects(nativeUser(web));
 assert.equal(decodeJwt(pair.accessToken).exp!-decodeJwt(pair.accessToken).iat!,300);
 assert.equal((await call("me",undefined,undefined,{Cookie:`bvm_session=${web}`})).response.status,401);
 const me=await call("me",undefined,pair.accessToken);assert.equal(me.data.id,account.id);assert.equal(me.response.headers.get("cache-control"),"private, no-store");assert.equal(me.response.headers.get("access-control-allow-credentials"),null);
 await prisma.user.update({where:{id:account.id},data:{sessionVersion:{increment:1}}});await assert.rejects(nativeUser(pair.accessToken));assert.equal(await verifySessionToken(web),null);await assert.rejects(rotateNativeSession(pair.refreshToken,randomUUID()));
});
test("gelijktijdige refresh en verloren-response retry roteren precies één keer; replay trekt in",async()=>{
 const account=await user(),initial=await issueNativeSession(account.id,0),action=randomUUID();
 const [a,b]=await Promise.all([rotateNativeSession(initial.refreshToken,action),rotateNativeSession(initial.refreshToken,action)]);
 assert.ok(a&&b);assert.equal(a.refreshToken,b.refreshToken);assert.notEqual(a.refreshToken,initial.refreshToken);
 const next=await rotateNativeSession(a.refreshToken,randomUUID());assert.ok(next);
 await assert.rejects(rotateNativeSession(initial.refreshToken,action));assert.equal((await nativeUser(next.accessToken)).id,account.id,"oude retry herstelt geen oude keuze en vernietigt geen nieuwe sessie");
 await assert.rejects(rotateNativeSession(a.refreshToken,randomUUID()));await assert.rejects(nativeUser(next.accessToken),"herkend vorige-token replay trekt de familie in");
});
test("logout is idempotent; een willekeurig refreshgeheim kan andermans sessie niet intrekken",async()=>{
 const account=await user(),pair=await issueNativeSession(account.id,0);
 await assert.rejects(rotateNativeSession(`${pair.refreshToken.split('.')[0]}.${'X'.repeat(43)}`,randomUUID(),true));assert.equal((await nativeUser(pair.accessToken)).id,account.id);
 await rotateNativeSession(pair.refreshToken,randomUUID(),true);await rotateNativeSession(pair.refreshToken,randomUUID(),true);await assert.rejects(nativeUser(pair.accessToken));
});
test("accountverwijdering verwijdert identiteits-/sessiekoppelingen en maakt tokens ongeldig",async()=>{
 const account=await user(),pair=await issueNativeSession(account.id,0);
 await prisma.externalIdentity.create({data:{userId:account.id,provider:"APPLE",scope:"TESTTEAM01",subject:randomUUID()}});
 await prisma.user.delete({where:{id:account.id}});await assert.rejects(nativeUser(pair.accessToken));assert.equal(await prisma.externalIdentity.count({where:{userId:account.id}}),0);
});
test("normale web-login blijft werken; native accepteert geen vervalste userId of onveilige origin",async()=>{
 const account=await user();
 const web=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identifier:account.email,password})});assert.equal(web.status,200);assert.ok(web.headers.get("set-cookie")?.includes("bvm_session="));
 assert.equal((await call("login",{identifier:account.email,password,userId:"other"})).response.status,400);
 assert.equal((await call("login",{identifier:account.email,password},undefined,{Origin:"https://evil.invalid"})).response.status,403);
 const login=await call("login",{identifier:account.email,password});assert.equal(login.response.status,200);assert.equal((await call("me",undefined,login.data.accessToken)).data.id,account.id);
});
test("TOTP, securitysetup en wachtwoordloze Apple-accounts worden niet omzeild",async()=>{
 const admin=await user({isAdmin:true});await assert.rejects(nativePasswordLogin(admin.email,password),/web_security_setup_required/);
 const protectedUser=await user({totpEnabled:true});await assert.rejects(nativePasswordLogin(protectedUser.email,password),/two_factor_required/);
 assert.equal(await verifySessionToken(await createTwoFactorChallengeToken(protectedUser.id)),null,"2FA-challenge is geen websessie");
 const appleOnly=await user({passwordLoginEnabled:false});await assert.rejects(nativePasswordLogin(appleOnly.email,password),/wrong_credentials/);
});
const keypair=await generateKeyPair("RS256"),jwk=await exportJWK(keypair.publicKey);jwk.kid="isolated-apple";
const verifier=createLocalJWKSet({keys:[jwk]});
async function appleToken(challenge:{nonce:string},subject:string,email?:string){return new SignJWT({sub:subject,nonce:challenge.nonce,...(email?{email,email_verified:true}:{})}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer("https://appleid.apple.com").setAudience("app.versado.synthetic").setIssuedAt().setExpirationTime("5m").sign(keypair.privateKey);}
async function signIn(subject:string,email?:string){const challenge=await createAppleChallenge("signin");return finishAppleChallenge({challengeId:challenge.id,state:challenge.state,identityToken:await appleToken(challenge,subject,email)},undefined,verifier);}
test("Apple relay-account ontstaat één keer; ontbrekende/veranderde e-mail verandert de eigenaar niet",async()=>{
 const subject=randomUUID(),email=`${randomUUID()}@privaterelay.appleid.com`,before=await prisma.user.count();
 const [first,second]=await Promise.all([signIn(subject,email),signIn(subject,email)]);assert.equal(first.id,second.id);assert.equal(await prisma.user.count(),before+1);assert.equal(first.passwordLoginEnabled,false);
 const again=await signIn(subject);assert.equal(again.id,first.id);const changed=await signIn(subject,`changed-${email}`);assert.equal(changed.id,first.id);assert.equal(changed.email,email);
 await assert.rejects(unlinkApple(first),/alternative_login_required/);
});
test("gelijke e-mail koppelt nooit automatisch; expliciete link behoudt accountdata en is eenmalig",async()=>{
 const account=await user({xpTotal:17,currentStreak:3}),subject=randomUUID(),before=await prisma.user.findUniqueOrThrow({where:{id:account.id}});
 await assert.rejects(signIn(subject,account.email),/sign_in_then_link_apple/);
 const challenge=await createAppleChallenge("link",account.id),input={challengeId:challenge.id,state:challenge.state,identityToken:await appleToken(challenge,subject,account.email)};
 const other=await user();await assert.rejects(finishAppleChallenge(input,other,verifier));
 const linked=await finishAppleChallenge(input,account,verifier);assert.equal(linked.id,account.id);await assert.rejects(finishAppleChallenge(input,account,verifier));
 const after=await prisma.user.findUniqueOrThrow({where:{id:account.id}});assert.deepEqual(after,before);
 await unlinkApple(account);assert.equal(await prisma.externalIdentity.count({where:{userId:account.id}}),0);const unlinked=await prisma.user.findUniqueOrThrow({where:{id:account.id}});assert.equal(unlinked.xpTotal,17);assert.equal(unlinked.currentStreak,3);assert.equal(unlinked.sessionVersion,before.sessionVersion+1);
});
test("Apple zonder betrouwbare e-mail maakt geen fictief account en verlopen challenges falen",async()=>{
 const before=await prisma.user.count();await assert.rejects(signIn(randomUUID()),/apple_email_required/);assert.equal(await prisma.user.count(),before);
 const challenge=await createAppleChallenge("signin");await prisma.nativeAuthChallenge.update({where:{id:challenge.id},data:{expiresAt:new Date(0)}});
 await assert.rejects(finishAppleChallenge({challengeId:challenge.id,state:challenge.state,identityToken:await appleToken(challenge,randomUUID(),"missing@example.invalid")},undefined,verifier));
});
test("leesproef schrijft bestaande canonieke voortgang, nooit XP; ontoegankelijke content blijft dicht",async()=>{
 const work=await prisma.contentWork.upsert({where:{key:"bofm"},create:{key:"bofm",kind:"SCRIPTURE"},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:`native-${randomUUID()}`,work:work.key,language:"nl",editionKey:"native-test",name:"Testbron",slug:`native-${randomUUID()}`,icon:"book",enabled:true,visibleToUsers:true,publicationState:"LEGACY"}});
 const book=await prisma.book.create({data:{slug:`native-${randomUUID()}`,name:"Testboek",order:1,key:"bofm/1-ne",contentCollectionId:collection.id}});
 const chapter=await prisma.chapter.create({data:{bookId:book.id,number:1,order:1,verses:{create:[{number:1,text:"Synthetische leestekst."}]}}});
 const account=await user({activeContentCollectionId:collection.id}),pair=await issueNativeSession(account.id,0);
 assert.equal((await call("today",undefined,pair.accessToken)).data.activity.id,chapter.id);
 assert.equal((await call(`chapters/${chapter.id}`,undefined,pair.accessToken)).data.verses.length,1);
 const complete=await call(`chapters/${chapter.id}/complete`,{},pair.accessToken);assert.equal(complete.response.status,200);assert.equal(complete.data.content.read,"READ");
 const repeated=await call(`chapters/${chapter.id}/complete`,{},pair.accessToken);assert.equal(repeated.data.counted,false);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:account.id}})).xpTotal,0);
 await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:false}});assert.equal((await call(`chapters/${chapter.id}`,undefined,pair.accessToken)).response.status,404);
 await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:true,publicationState:"DRAFT"}});assert.equal((await call(`chapters/${chapter.id}`,undefined,pair.accessToken)).response.status,404);
});
