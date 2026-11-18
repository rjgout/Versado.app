import {randomUUID} from 'node:crypto';
import {alleskennerItems} from '../../prisma/alleskennerContent.ts';
import {GAME_SCOPE_KEYS} from '../../src/lib/gameAvailabilityPolicy.ts';
/** Eigen wegwerpdatabase; dezelfde contentmodellen/engines, geen seed op DEV. */
export async function nativeGamesContent(db){
 const database=new URL(process.env.DATABASE_URL??'http://invalid');
 if(database.hostname!=='127.0.0.1'||database.pathname!=='/versado_content_access_test')throw Error('Uitsluitend eigen lokale speltestdatabase');
 const prefix='native-games-'+randomUUID();
 await db.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 await db.contentCollection.upsert({where:{id:'content_bom'},create:{id:'content_bom',slug:'native-games-fixture',name:'Synthetische spelbron',icon:'book',work:'bofm',editionKey:'bofm',language:'nl',publicationState:'LEGACY',enabled:true,visibleToUsers:true},update:{enabled:true,visibleToUsers:true,publicationState:'LEGACY',work:'bofm',editionKey:'bofm',language:'nl'}});
 const settings=Object.fromEntries(['wordGame','scrabble','gezinsavond','chapterGuess','challenges','liveExercises','alleskenner','jigsaw','wordSearch','quickMissionary','mystery'].map(key=>[key+'Enabled',true]));
 await db.gameSettings.upsert({where:{id:'singleton'},create:{id:'singleton',...settings},update:settings});
 await db.gameContentScope.createMany({data:GAME_SCOPE_KEYS.map(gameKey=>({gameKey,contentCollectionId:'content_bom'})),skipDuplicates:true});
 const book=await db.book.create({data:{contentCollectionId:'content_bom',slug:prefix,key:"bofm/1-ne",name:'Synthetisch spelboek',order:90}});
 const chapters=[];
 for(let i=1;i<=12;i++){
  const chapter=await db.chapter.create({data:{bookId:book.id,number:i,order:i,heading:`Synthetische samenvatting ${i}`,verses:{create:[{number:1,text:`Synthetische speltekst ${i}.`}]},exercises:{create:[{order:1,type:'TRUE_FALSE',verseRef:`Spelboek ${i}:1`,prompt:'Een synthetische stelling.',answers:'["true"]'},{order:2,type:'FILL_BLANK',verseRef:`Spelboek ${i}:1`,prompt:'Een ____ tekst.',answers:'["synthetische"]',options:{create:[{label:'synthetische',isCorrect:true,order:0},{label:'andere',order:1}]}},{order:3,type:'WORD_BANK',verseRef:`Spelboek ${i}:1`,prompt:'Een ____ tekst.',answers:'["synthetische"]',wordBank:'["synthetische","andere"]'}]}}});chapters.push(chapter);
 }
 const items=alleskennerItems.map(item=>({id:prefix+'-'+item.id,kind:item.kind,data:JSON.stringify(item.data),enabled:true}));
 await db.alleskennerItem.createMany({data:items});
 return {chapters,async cleanup(){await db.book.delete({where:{id:book.id}});await db.alleskennerItem.deleteMany({where:{id:{startsWith:prefix}}});}};
}
