import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLessonWords,lessonWordOptionsSchema,type LessonWordOptions} from '../src/lib/studyContent/wordPool';
const options:LessonWordOptions={minLength:3,maxLength:30,minCandidates:2,maxCandidates:100,blockTypes:['paragraph','quote','list','table','question','assignment']};
const text=(text:string)=>({type:'text',text});
const body=(blocks:unknown[])=>({schemaVersion:1,sections:[{id:'intro',blocks}]});
const prose=(value:string)=>body([{id:'paragraph',type:'paragraph',content:[text(value)]}]);
test('alleen echte woorden: NFC, Unicode, duplicaten, interpunctie, samenstellingen en geen cijferfragmenten',()=>{
 const result=extractLessonWords(prose('Geloof GELOOF geloof. café cafe\u0301 schriftstudie zelf-beheersing les2026 123 日本語 🙂'),'nl',options);
 assert.equal(result.available,true);if(!result.available)return;
 assert.deepEqual(result.candidates.map(c=>c.word),['café','geloof','schriftstudie']);assert.equal(result.candidates.find(c=>c.word==='café')?.display,'café');
 assert.ok(Object.isFrozen(result.candidates));assert.equal(result.totalCandidates,3);
});
test('inline-tekst sluit direct aan; links leveren alleen zichtbare tekst, referenties nooit nieuwe woorden',()=>{
 const source=body([{id:'paragraph',type:'paragraph',content:[text('schrift'),{type:'link',text:'studie',href:'https://example.invalid/GEHEIMEURL'},text(' geloof '),{type:'reference',id:'ref',label:'Ongewenstlabel',target:{sourceKey:'unknown'}},text(' hoop')]}]);
 const r=extractLessonWords(source,'nl',options);assert.equal(r.available,true);if(!r.available)return;assert.deepEqual(r.candidates.map(c=>c.word),['geloof','hoop','schriftstudie']);
});
test('lijsten, geneste blokken, citaten, tabellen en officiële opdrachten behouden echte ankers',()=>{
 const source=body([
  {id:'list',type:'list',ordered:false,items:[{id:'item',content:[text('geduld')],children:[{id:'child',content:[text('vriendelijkheid')]}],blocks:[{id:'nested',type:'paragraph',content:[text('zachtmoedigheid')]}]}]},
  {id:'quote',type:'quote',content:[text('naastenliefde')],attribution:[text('GeenAuteursPool')]},
  {id:'table',type:'table',rows:[{id:'row',cells:[{id:'cell',header:false,colSpan:1,rowSpan:1,content:[text('volharding')]}]}]},
  {id:'question',type:'question',content:[text('vertrouwen')]},
 ]);
 const r=extractLessonWords(source,'nl',options);assert.equal(r.available,true);if(!r.available)return;
 assert.equal(r.candidates.length,6);assert.deepEqual(r.candidates.find(c=>c.word==='volharding')?.occurrences,[{sectionId:'intro',blockId:'cell'}]);assert.equal(r.candidates.some(c=>c.word==='geenauteurspool'),false);
});
test('expliciete filters, deterministische begrenzing en onvoldoende geschikte inhoud',()=>{
 const r=extractLessonWords(prose('zachtmoedigheid vertrouwen hoop geloof'),'nl',{...options,maxLength:8,maxCandidates:2,excludeWords:['HOOP']});assert.equal(r.available,false);
 const bounded=extractLessonWords(prose('vertrouwen hoop geloof geduld'),'nl',{...options,maxCandidates:2});assert.equal(bounded.available,true);if(bounded.available){assert.deepEqual(bounded.candidates.map(c=>c.word),['geduld','geloof']);assert.equal(bounded.truncated,true);}
});
test('onbekende taal, ongeldige inhoud en onvoldoende woorden leveren geen vervangingspool',()=>{
 assert.deepEqual(extractLessonWords(prose('geloof vertrouwen'),'xx',options),{available:false,reason:'language'});
 assert.deepEqual(extractLessonWords({schemaVersion:2},'nl',options),{available:false,reason:'content'});
 assert.equal(extractLessonWords(prose('a b 123'),'nl',options).available,false);
 assert.throws(()=>lessonWordOptionsSchema.parse({...options,minLength:20,maxLength:3}));
});
test('beschikbare Latin-taalregels behouden diakritische tekens en mengen geen fallbacktaal',()=>{
 for(const [language,source,word] of [['en','faith kindness','faith'],['de','Größe Vertrauen','größe'],['fr','bonté espérance','bonté'],['es','corazón esperanza','corazón']]){
  const r=extractLessonWords(prose(source),language,options);assert.equal(r.available,true);if(r.available)assert.ok(r.candidates.some(c=>c.word===word));
 }
});
test('tekstbudget begrenst verwerking zonder gedeeltelijke speelbare pool',()=>{
 const source=body(Array.from({length:20},(_,i)=>({id:'paragraph-'+i,type:'paragraph',content:[text('geloof '.repeat(2700))]})));
 assert.deepEqual(extractLessonWords(source,'nl',options),{available:false,reason:'size'});
});
test('referentiegrenzen en samentrekkingen leveren geen gegokte woordfragmenten',()=>{
 const source=body([{id:'paragraph',type:'paragraph',content:[text("geloof hoop don't zelf-beheersing ver"),{type:'reference',id:'ref',label:'Label',target:{sourceKey:'unknown'}},text('trouwen')]}]);
 const r=extractLessonWords(source,'nl',options);assert.equal(r.available,true);if(r.available)assert.deepEqual(r.candidates.map(c=>c.word),['geloof','hoop']);
});
