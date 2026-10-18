import test from 'node:test';
import assert from 'node:assert/strict';
import {getWordSearchCandidates} from '../src/lib/wordSearch/content';
import {GAME_CATALOG} from '../src/lib/gameCatalog';
import {GAME_CONTENT_ADAPTERS,resolveGameContent,wordSearchPoolIdentity} from '../src/lib/gameContentResolver';
test('alle bestaande catalogusspellen en live oefeningen hebben één concrete adapter',()=>{
 assert.deepEqual(new Set(GAME_CONTENT_ADAPTERS.map(a=>a.gameId)),new Set([...GAME_CATALOG.map(g=>g.id),'live-exercises']));
 for(const a of GAME_CONTENT_ADAPTERS){assert.equal(a.supports({work:'fsy',editionKey:'fsy',language:'nl',kind:'STUDY_PROGRAM'}),false);assert.equal(a.supports({work:'bofm',editionKey:'bofm',language:'xx',kind:'SCRIPTURE'}),false);assert.equal(a.rulesVersion,1);}
});
test('poolhash bewaart bron, editie, taal en echte kandidaatset; geen databasevolgorde',()=>{
 const source={id:'bom-nl',editionKey:'bofm',language:'nl'},pool=[{display:'Geloof',normalized:'GELOOF'},{display:'Hoop',normalized:'HOOP'}];
 const hash=wordSearchPoolIdentity(source,pool);assert.equal(hash,wordSearchPoolIdentity(source,[...pool].reverse()));assert.notEqual(hash,wordSearchPoolIdentity({...source,language:'en'},pool));assert.notEqual(hash,wordSearchPoolIdentity({...source,id:'different-edition'},pool));assert.notEqual(hash,wordSearchPoolIdentity(source,pool.slice(1)));
});
test('ongeldige modus, spel en poolvereisten worden zonder bronfallback geweigerd',async()=>{
 for(const request of [{userId:'x',gameId:'unknown',mode:'start'},{userId:'x',gameId:'word-search',mode:'resume'},{userId:'x',gameId:'word-search',mode:'start',requiredChapters:0}])assert.equal((await resolveGameContent(request as Parameters<typeof resolveGameContent>[0])).available,false);
});

test('onbekende pooltaal geeft geen Nederlandse vervangingswoorden of databasequery',async()=>{assert.deepEqual(await getWordSearchCandidates('missing','xx'),[]);});
