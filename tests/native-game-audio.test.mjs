import assert from 'node:assert/strict';
import test from 'node:test';
import {gameAudioPath,gameAudioRoute,nativeGameAudioInput,nativeGamePlaybackSchema} from '../src/lib/native/gamesAudioContract.ts';
const reader={version:1,userId:'A',activeCollectionId:'bom',selectionVersion:0,language:'nl',game:{kind:'reading',id:'chapter'},chapterId:'chapter',collectionName:'Schrift',bookName:'Synthetisch boek',chapterNumber:1,sourceLanguage:'nl',startVerse:1,endVerse:1,focusVerse:1,verses:[{id:'verse',number:1,text:'Synthetische tekst.'}]};
const {collectionName,bookName,chapterNumber,focusVerse,verses,sourceLanguage,...scope}=reader;
void collectionName;void bookName;void chapterNumber;void focusVerse;void verses;
const audio={...scope,sessionId:'session',readerHash:'a'.repeat(64),serverTime:Date.now(),maxAgeMs:300000,sourceLanguage,sources:[]};
test('spelgebonden metadata houdt dezelfde reader-, lease- en omvanggrenzen, zonder gefingeerde cursus',()=>{
 assert.ok(nativeGamePlaybackSchema.safeParse({version:1,reader,audio}).success);
 for(const change of [{userId:'B'},{game:{kind:'reading',id:'other'}},{selectionVersion:1},{startVerse:2},{courseId:'not-a-course'},{sourceLanguage:'en'}])assert.equal(nativeGamePlaybackSchema.safeParse({version:1,reader,audio:{...audio,...change}}).success,false,JSON.stringify(change));
 assert.equal(nativeGamePlaybackSchema.safeParse({version:1,reader:{...reader,courseId:'fake',kind:'chapters',targetId:'chapter'},audio}).success,false);
 assert.equal(nativeGamePlaybackSchema.safeParse({version:1,reader:{...reader,verses:[{...reader.verses[0],text:'x'.repeat(600000)}]},audio}).success,false);
});
test('alleen vaste lees-/vraagselecties en eindige indices, nooit vrije media-URLs of vraagantwoorden',()=>{
 for(const input of [{kind:'reading',id:'chapter'},{kind:'intro-solo',id:'run',index:0},{kind:'intro-live',id:'ABCDE',index:14}]){
  const path=gameAudioPath(nativeGameAudioInput.parse(input));
  assert.deepEqual(gameAudioRoute(path+'/playback','GET')?.input,input);
  assert.equal(gameAudioRoute(path+'/playback','POST'),null);
  assert.equal(gameAudioRoute(path+'/'+'a'.repeat(64)+'/stream','GET')?.sourceId,'a'.repeat(64));
 }
 for(const input of [{kind:'reading',id:'https://evil.invalid'},{kind:'intro-solo',id:'run',index:500},{kind:'intro-live',id:'run',index:-1},{kind:'reading',id:'chapter',url:'/api/audio/x'},{kind:'recording',id:'file'}])assert.equal(nativeGameAudioInput.safeParse(input).success,false);
 for(const path of ['games/reading/chapter/audio/playback?token=x','games/intro-solo/run/01/audio/playback','games/intro-live/run/1e1/audio/playback','games/reading/../audio/playback','games/reading/chapter/audio/../playback'])assert.equal(gameAudioRoute(path,'GET'),null,path);
});

test('Alleskenner luisteren kiest uitsluitend een bestaande actuele spelvraag en nooit een audiobestand',()=>{
 for(const kind of ['ak-solo','ak-live']){
  const input={kind,id:'game',index:1},path=gameAudioPath(input);
  assert.deepEqual(gameAudioRoute(path+'/playback','GET')?.input,input);
  assert.equal(gameAudioRoute(path+'/'+'a'.repeat(64)+'/stream','GET'),null);
  assert.equal(nativeGameAudioInput.safeParse({...input,text:'eigen tekst'}).success,false);
 }
});
