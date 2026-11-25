import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeGameRequestUser,withNativeGameIdentity,nativeGameOriginAllowed} from '../src/lib/games/requestIdentity.server.ts';

test('spelidentiteit blijft geïsoleerd per verzoek; buiten native blijft de webauth intact',async()=>{
  assert.equal(await nativeGameRequestUser(),undefined);
  const [a,b]=await Promise.all(['a','b'].map(id=>withNativeGameIdentity(async()=>({id}),async()=>{
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await nativeGameRequestUser()).id,id);
    return id;
  })));
  assert.deepEqual([a,b],['a','b']);
  assert.equal(await nativeGameRequestUser(),undefined);
});

test('intrekking binnen een verzoek wordt opnieuw gecontroleerd en valt niet terug op cookies',async()=>{
  let valid=true,checks=0;
  await withNativeGameIdentity(async()=>{checks++;return valid?{id:'a'}:null;},async()=>{
    assert.equal((await nativeGameRequestUser()).id,'a');valid=false;
    assert.equal(await nativeGameRequestUser(),null);
  });
  assert.equal(checks,2);
});

test('achtergrondwerk na het antwoord houdt geen actorbevoegdheid',async()=>{
  let continueRead;const later=new Promise(resolve=>{continueRead=resolve;});let background;
  await withNativeGameIdentity(async()=>({id:'a'}),async()=>{background=later.then(()=>nativeGameRequestUser());});
  continueRead();assert.equal(await background,null);
  await assert.rejects(withNativeGameIdentity(async()=>({id:'a'}),async()=>{throw Error('synthetisch');}));
  assert.equal(await nativeGameRequestUser(),undefined);
});


test('native Origin geeft uitsluitend toegang binnen een levende geverifieerde spelscope',async()=>{
  const headers=new Headers({origin:'capacitor://localhost'});
  assert.equal(await nativeGameOriginAllowed(headers),false);
  await withNativeGameIdentity(async()=>({id:'a'}),async()=>{
    assert.equal(await nativeGameOriginAllowed(headers),true);
    assert.equal(await nativeGameOriginAllowed(new Headers({origin:'https://evil.invalid'})),false);
    assert.equal(await nativeGameOriginAllowed(new Headers()),false);
  },'capacitor://localhost');
  await withNativeGameIdentity(async()=>null,async()=>assert.equal(await nativeGameOriginAllowed(headers),false),'capacitor://localhost');
  await withNativeGameIdentity(async()=>({id:'a'}),async()=>assert.equal(await nativeGameOriginAllowed(headers),false),'https://evil.invalid');
});
