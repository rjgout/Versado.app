import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeGameFetch} from '../src/lib/native/gamesClient.ts';
import {NativeClientError} from '../src/lib/native/client.ts';

test('gedeelde spelverzoeken gebruiken alleen het bestaande native contract, ook PUT voor spelvolgorde',async()=>{
 const calls=[];const client={getSessionStamp:()=> 'A',async api(path,body,method,replay){calls.push({path,body,method,replay});return {version:1,userId:'A',path:'list-order',search:'',method,status:200,data:{ok:true}};}};
 const request=nativeGameFetch(client,()=>({id:'A',stamp:'A'}));
 assert.equal((await request('/api/list-order',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"listKey":"games","itemKeys":[]}' })).status,200);
 assert.deepEqual(calls,[{path:'games/list-order',body:{listKey:'games',itemKeys:[]},method:'PUT',replay:false}]);
 for(const path of ['/api/admin/users','/api/auth/login','https://evil.invalid/api/word-game'])await assert.rejects(request(path),e=>e instanceof NativeClientError&&e.code==='access_request_invalid');
 assert.equal(calls.length,1);
});
test('een late spelbevestiging kruist nooit een sessiewissel en wordt niet herhaald',async()=>{
 let stamp='A',finish,calls=0;
 const client={getSessionStamp:()=>stamp,api(){calls++;return new Promise(done=>{finish=done;});}};
 const request=nativeGameFetch(client,()=>({id:stamp,stamp}));
 const pending=request('/api/word-game/guess',{method:'POST',body:'{"guess":"appel"}'});
 stamp='B';finish({version:1,userId:'A',path:'word-game/guess',search:'',method:'POST',status:200,data:{ok:true}});
 await assert.rejects(pending,e=>e.code==='session_changed');assert.equal(calls,1);
});
test('vreemde responseactor/pad/methode faalt dicht; HTTP-domeinfouten blijven behouden',async()=>{
 const actor={id:'A',stamp:'A'},base={version:1,userId:'A',path:'hints',search:'',method:'GET',status:403,data:{error:'forbidden'}};
 for(const changed of [{userId:'B'},{path:'admin/users'},{method:'POST'}]){
  const request=nativeGameFetch({getSessionStamp:()=> 'A',api:async()=>({...base,...changed})},()=>actor);
  await assert.rejects(request('/api/hints'),e=>e.code==='invalid_response');
 }
 const request=nativeGameFetch({getSessionStamp:()=> 'A',api:async()=>base},()=>actor);
 const response=await request('/api/hints');assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'forbidden'});
});


test('de native buildadapter geeft uitsluitend dezelfde bestaande ticketsocket door en faalt dicht zonder runtime',async()=>{
 const {getSocket}=await import('../src/lib/native/sharedSocketClient.ts');
 const {installNativeApplicationRuntime}=await import('../src/lib/data/applicationRuntime.ts');
 assert.throws(()=>getSocket(),/native_realtime_unavailable/);
 const socket={id:'synthetic-existing-ticket-socket'},stop=installNativeApplicationRuntime({socket:()=>socket});
 assert.equal(getSocket(),socket);assert.equal(getSocket(),socket);
 stop();assert.throws(()=>getSocket(),/native_realtime_unavailable/);
});
