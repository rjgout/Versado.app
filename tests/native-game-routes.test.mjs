import assert from 'node:assert/strict';
import test from 'node:test';
import {GAME_API_ROUTES,gameApiRoute} from '../src/lib/native/gamesRoutes.ts';
import {GAME_HANDLERS} from '../src/lib/native/gamesHandlers.server.ts';

test('iedere expliciete spelroute/methode heeft precies dezelfde lokale backendhandeling',()=>{
  assert.deepEqual(Object.keys(GAME_HANDLERS).sort(),GAME_API_ROUTES.map(route=>route.path).sort());
  for(const route of GAME_API_ROUTES){
    assert.deepEqual(Object.keys(GAME_HANDLERS[route.path]).sort(),[...route.methods].sort());
    const url='/api/'+route.path.replace(/\[[a-zA-Z]+\]/g,'synthetic');
    for(const method of route.methods)assert.equal(gameApiRoute(url+(route.path==='list-order'&&method==='GET'?'?listKey=games':''),method)?.id,route.path,`${method} ${url}`);
  }
});

test('geen websites, beheer, auth, externe doelen, traversal, vreemde methoden of querycredentials',()=>{
  for(const url of ['/api/admin/users','/api/auth/login','/api/v1/native/account','https://evil.invalid/api/word-game','//evil.invalid/api/word-game','/api/../api/word-game','/api/scrabble/%2e%2e/word-game','/api/scrabble/x%2fy','/api/word-game?token=secret','/api/word-game?url=https://evil.invalid','/api/users/search?q=a&q=b','/api/word-game#x','/api/word-game\\x','/api/mysteries/001a/progress'])assert.equal(gameApiRoute(url,'GET'),null,url);
  assert.equal(gameApiRoute('/api/word-game','DELETE'),null);
  assert.equal(gameApiRoute('/api/alleskenner/seasons/x','PATCH')?.id,'alleskenner/seasons/[id]');
  assert.equal(gameApiRoute('/api/users/search?q=Jan%2342','GET')?.id,'users/search');
});

test('alleen het woordenboek accepteert gecontroleerde Unicode, nooit gecodeerde padgrenzen',()=>{
  assert.equal(gameApiRoute('/api/dictionary/%C3%89CRIT','GET')?.params.word,'ÉCRIT');
  for(const word of ['%2fadmin','%252fadmin','..','%2e%2e','%00test','foo%3Ftoken'])assert.equal(gameApiRoute('/api/dictionary/'+word,'GET'),null,word);
});

test('spelvoorkeuren openen geen andere persoonlijke lijst via een gedeelde webhandler',()=>{
 assert.ok(gameApiRoute('/api/list-order?listKey=games','GET'));
 assert.ok(gameApiRoute('/api/list-order','PUT'));
 for(const path of ['/api/list-order','/api/list-order?listKey=courses','/api/list-order?listKey=today-continue'])assert.equal(gameApiRoute(path,'GET'),null);
 assert.equal(gameApiRoute('/api/list-order?listKey=games','PUT'),null);
});
