import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {GAME_POLICY_CASES,swiftPolicy,javaPolicy,updatePolicy} from '../scripts/native/games-policy.mjs';
import {accessRouteAllowed} from '../src/lib/native/access.ts';
import {nativeGameOwnsRoute} from "../src/lib/native/gamesPagesRoutes.ts";
import {nativeRoute} from '../src/lib/native/navigation.ts';
import {nativePrimaryNav} from '../src/lib/native/shell.ts';

test('iedere expliciete spelmethode en pagina deelt dezelfde native bridgegrens',()=>{
 for(const [path,method,expected]of GAME_POLICY_CASES)assert.equal(accessRouteAllowed(path,method),expected,method+' '+path);
 for(const [file,render]of [['ios/App/App/NativeAccessTransport.swift',swiftPolicy],['android/app/src/main/java/app/versado/app/NativeAccessTransport.java',javaPolicy]]){
  const source=readFileSync(file,'utf8');assert.equal(updatePolicy(source,render()),source,file);
 }
});
test('Spelen verschijnt uitsluitend met het volledige contract en tickettransport',()=>{
 for(const features of [[],['games-v1'],['realtime-ticket-v1']])assert.ok(!nativePrimaryNav(features).some(item=>item.id==='play'));
 assert.ok(nativePrimaryNav(['games-v1','realtime-ticket-v1']).some(item=>item.id==='play'));
 assert.equal(nativeRoute('/snelle-zendeling?view=leaderboard#quick-missionary-leaderboard'),'/snelle-zendeling?view=leaderboard');
 for(const route of ['/adminbackend','/live?token=x','/live#token','/snelle-zendeling?view=other'])assert.equal(nativeRoute(route),null,route);
});

test('de bestaande pre-signing-backendcontrole blokkeert een onvolledige Spelen-backend',async()=>{
 const {evaluate}=await import('../scripts/native/check-test-backend.mjs');
 const features=['security-setup-v1','account-password-v1','account-deletion-v1','password-reset-v1','email-confirmation-v1','games-v1','realtime-ticket-v1'];
 const base={origin:'https://test.example.invalid',capabilities:{status:200,redirected:false,body:{apiVersion:1,features}},native:{allowOrigin:'capacitor://localhost'},cross:{allowOrigin:null},root:{status:200,permissionsPolicy:'camera=(), microphone=(self), geolocation=()',hsts:'max-age=31536000'}};
 assert.equal(evaluate(base).ok,true);
 for(const feature of features){const missing={...base,capabilities:{...base.capabilities,body:{apiVersion:1,features:features.filter(item=>item!==feature)}}};assert.ok(evaluate(missing).problems.some(problem=>problem.includes(feature)),feature);}
});


test('oude Foundation-leeslinks krijgen pas volledige spel-leesacties met de bewezen backendcapability',()=>{
 assert.equal(nativeGameOwnsRoute('/lesson/chapter',[]),false);
 assert.equal(nativeGameOwnsRoute('/lesson/chapter',['scripture-reader-v1']),false);
 assert.equal(nativeGameOwnsRoute('/lesson/chapter',['games-v1']),true);
 assert.equal(nativeGameOwnsRoute('/adminbackend',['games-v1']),false);
});
