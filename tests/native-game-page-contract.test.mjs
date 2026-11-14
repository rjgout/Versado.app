import assert from 'node:assert/strict';
import test from 'node:test';
import {GAME_CATALOG} from '../src/lib/gameCatalog.ts';
import {GAME_PAGE_ROUTES,gamePageRoute} from '../src/lib/native/gamesPagesRoutes.ts';
import {encodeGameProps,decodeGameProps,gameJsonValid,nativeGamePageSchema} from '../src/lib/native/gamesPageContract.ts';

test('alle bestaande spellen en compatibiliteitsroutes hebben een begrensde lokale paginapoort',()=>{
  for(const game of GAME_CATALOG)assert.ok(gamePageRoute(game.href),game.id);
  for(const route of GAME_PAGE_ROUTES){const path=route.path.replace(/\[[a-zA-Z]+\]/g,'synthetic');assert.equal(gamePageRoute(path)?.id,route.path,path);}
  for(const path of ['/adminbackend','/api/admin/users','//evil.invalid/live','https://evil.invalid/live','/live/../word-game','/live/a%2fb','/live/a?token=x','/live?availability=no','/mysteries/001a/play?resume=wrong'])assert.equal(gamePageRoute(path),null,path);
  assert.equal(gamePageRoute('/mysteries/001a/play?resume=completed')?.query.resume,'completed');
});

test('gedeelde componentgegevens behouden datums; functies, prototypes, cycli en te diepe data worden geweigerd',()=>{
  const date=new Date('2026-11-14T10:00:00.000Z'),shared={label:'synthetisch'};
  const wire=encodeGameProps({date,records:[{date}],one:shared,two:shared,optional:undefined});
  assert.equal(gameJsonValid(wire),true);
  const restored=decodeGameProps(JSON.parse(JSON.stringify(wire)));
  assert.equal(restored.date.toISOString(),date.toISOString());assert.equal(restored.records[0].date instanceof Date,true);assert.deepEqual(restored.one,restored.two);
  const cyclic={};cyclic.self=cyclic;
  for(const value of [{click(){}},{value:Infinity},cyclic,JSON.parse('{"__proto__":{}}'),{__versadoGameDate:'2026-11-14T10:00:00.000Z'}])assert.throws(()=>encodeGameProps(value));
  let deep={};for(let i=0;i<42;i++)deep={child:deep};assert.throws(()=>encodeGameProps(deep));
  assert.equal(gameJsonValid({__versadoGameDate:'geen datum'}),false);
});

test('paginaprotocol verwerpt HTML, vrije componentnamen, tokens en onbekende contractversies',()=>{
  const base={version:1,userId:'a',activeCollectionId:'collection',selectionVersion:0,language:'nl',path:'/word-game',shareOrigin:'https://dev.versado.app',result:{kind:'screen',screen:{view:'wordOfDay',data:{},frame:'plain'}}};
  assert.equal(nativeGamePageSchema.safeParse(base).success,true);
  for(const change of [{version:2},{path:'/adminbackend'},{result:{kind:'html',html:'<script/>'}},{result:{kind:'screen',screen:{view:'RemoteWebView',data:{},frame:'plain'}}},{result:{kind:'redirect',href:'/login?token=secret'}}])assert.equal(nativeGamePageSchema.safeParse({...base,...change}).success,false);
});
