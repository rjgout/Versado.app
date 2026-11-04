import test from "node:test";
import assert from "node:assert/strict";
import { accessRouteAllowed } from "../src/lib/native/access";
import { nativeLearningStart, nativeLearningSubmit, nativeLearningCheck } from "../src/lib/native/learningContract";
const scope={activeCollectionId:"source",selectionVersion:3,language:"nl",chapterId:"chapter",startVerse:1,endVerse:4};
const actionId="00112233-4455-4677-8899-aabbccddeeff";
test("native leerintenties zijn strikt, begrensd en bevatten nooit clientbeloningen",()=>{
  assert.ok(nativeLearningStart.safeParse({...scope,actionId}).success);
  for(const extra of [{xpEarned:20},{readStatus:"READ"},{sessionId:"foreign"},{courseId:"other"}])assert.equal(nativeLearningStart.safeParse({...scope,actionId,...extra}).success,false);
  assert.equal(nativeLearningSubmit.safeParse({...scope,sessionId:actionId,answers:[]}).success,false);
  assert.equal(nativeLearningCheck.safeParse({...scope,sessionId:actionId,exerciseId:"e",given:["true"]}).success,true);
});
test("uitsluitend exacte scoped learning-routes, geen GET die start of afrondt",()=>{
  for(const kind of ["steps","chapters"]) {
    const prefix=`courses/c/read/${kind}/t/learning`;
    const get=`${prefix}/sessions/${actionId}`;
    assert.equal(accessRouteAllowed(get,"GET"),true);
    assert.equal(accessRouteAllowed(get,"POST"),false);
    for(const action of ["start","submit","read","check"]) {
      const path=`${prefix}/${action}`;
      assert.equal(accessRouteAllowed(path,"POST"),true);
      for(const method of ["GET","PUT","DELETE"])assert.equal(accessRouteAllowed(path,method),false);
      for(const suffix of ["/extra","?source=other","#fragment","\n","/../read","%2f"])assert.equal(accessRouteAllowed(path+suffix,"POST"),false);
    }
    for(const invalid of ["not-a-uuid",actionId+"/extra",actionId+"?x=1"])assert.equal(accessRouteAllowed(prefix+"/sessions/"+invalid,"GET"),false);
  }
});

test("client herhaalt geen start/submit/read/check na onzekere fout; status is alleen GET", async()=>{
  const {nativeLearningClient}=await import("../src/lib/native/learningClient");
  const calls:unknown[][]=[];
  const {NativeSessionClient}=await import("../src/lib/native/client");
  const client=new NativeSessionClient("https://example.invalid",{async read(){return null;},async write(){},async clear(){} });
  client.api=async (...args:unknown[])=>{calls.push(args);throw Error("synthetic uncertain response");};
  const api=nativeLearningClient(client,"c","steps","s");
  for(const invoke of [()=>api.start({...scope,language:"nl",actionId}),()=>api.read({...scope,language:"nl",actionId}),()=>api.submit({...scope,language:"nl",sessionId:actionId,answers:[{exerciseId:"e",given:["true"]}]}),()=>api.check({...scope,language:"nl",sessionId:actionId,exerciseId:"e",given:["true"]})]) {
    const before=calls.length;
    await assert.rejects(invoke,/synthetic uncertain/);
    assert.equal(calls.length,before+1);
    assert.deepEqual(calls.at(-1)?.slice(2),["POST",false]);
  }
  await assert.rejects(()=>api.status(actionId));
  assert.equal(calls.at(-1)?.length,1);
});

test("oude leeradapter doet na logout/accountwisseling geen enkel verzoek",async()=>{
 const {nativeLearningClient}=await import("../src/lib/native/learningClient");
 const {NativeSessionClient}=await import("../src/lib/native/client");
 const client=new NativeSessionClient("https://example.invalid",{async read(){return null;},async write(){},async clear(){}});
 let stamp="A",calls=0;client.getSessionStamp=()=>stamp;
 client.api=async()=>{calls++;throw Error("mocht niet verzenden");};
 const adapter=nativeLearningClient(client,"c","steps","s");
 stamp="B";
 for(const invoke of [()=>adapter.start({...scope,language:"nl",actionId}),()=>adapter.read({...scope,language:"nl",actionId}),()=>adapter.status(actionId)])assert.throws(invoke,/session_changed/);
 assert.equal(calls,0);
});
