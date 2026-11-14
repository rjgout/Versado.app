import type {Prisma} from "@/generated/prisma/client";
import {gameListeningSource} from "@/lib/games/listeningSource.server";
import {prisma} from "@/lib/db";
import {readingAccessWhere} from "@/lib/contentAccess";
import {canResumeGameContent} from "@/lib/gameAvailability";
import {getChapterGuessGameView} from "@/lib/chapterGuess";
import {getT} from "@/lib/i18n";
import type {QuizPayload} from "@/lib/liveQuiz";
import {context,envelope,recheck} from "./courses.server";
import {NativeAuthError,type NativeSessionBinding} from "./sessions";
import {gameAudioIntroId,nativeGameAudioInput,nativeGameReaderSchema,type NativeGameAudioInput} from "./gamesAudioContract";
function unavailable():never{throw new NativeAuthError("content_unavailable",404);}
/** Alleen bestaande bronrechten en de eigen/huidige canonieke quizvraag.
 * Bij raden gebruiken tekst-/bron-ID's de vraagidentiteit; het antwoord-ID
 * blijft serverdata, ook in de native opnamecatalogus. */
export async function resolveNativeGameAudio(binding:NativeSessionBinding,raw:NativeGameAudioInput,db:Prisma.TransactionClient=prisma){
 const input=nativeGameAudioInput.parse(raw),value=await context(binding,db);
 if(!value.picker.activeCollectionId)unavailable();
 if(input.kind==="reading"){
  const where={id:input.id,book:{contentCollection:readingAccessWhere(value.user)}};
  const chapter=await db.chapter.findFirst({where,include:{book:{include:{contentCollection:true}},verses:{orderBy:{number:"asc"}}}});
  if(!chapter||!chapter.verses.length||chapter.verses.length>500)unavailable();
  await recheck(binding,value,db);
  if(!await db.chapter.findFirst({where,select:{id:true}}))unavailable();
  const reader=nativeGameReaderSchema.parse({...envelope(value),activeCollectionId:value.picker.activeCollectionId,game:input,chapterId:chapter.id,collectionName:chapter.book.contentCollection.name,bookName:chapter.book.name,chapterNumber:chapter.number,sourceLanguage:chapter.book.contentCollection.language,startVerse:1,endVerse:chapter.verses.length,focusVerse:1,verses:chapter.verses.map(({id,number,text})=>({id,number,text}))});
  return {reader,chapterId:chapter.id};
 }
 if(input.kind==="ak-solo"||input.kind==="ak-live"){
  const source=await gameListeningSource(value.user.id,input);
  if(!source)unavailable();
  await recheck(binding,value,db);
  const opaque=gameAudioIntroId(input);
  const collection=value.picker.works.flatMap(work=>work.editions).find(edition=>edition.id===value.picker.activeCollectionId);
  if(!collection)unavailable();
  const reader=nativeGameReaderSchema.parse({...envelope(value),activeCollectionId:value.picker.activeCollectionId,game:input,chapterId:opaque,collectionName:collection.name,bookName:getT(value.user.uiLanguage)("pages.alleskenner"),chapterNumber:input.index,sourceLanguage:source.language,startVerse:1,endVerse:1,focusVerse:1,verses:[{id:opaque+"-intro",number:1,text:source.text}]});
  return {reader,chapterId:null,intro:{clip:null}};
 }
 let chapterId:string,introText:string,clip:{url:string;start:number;end:number}|null;
 if(input.kind==="intro-solo"){
  const game=await prisma.chapterGuessGame.findFirst({where:{id:input.id,userId:value.user.id,status:"IN_PROGRESS",currentIndex:input.index},include:{questions:{where:{order:input.index}}}});
  if(!game||game.questions.length!==1)unavailable();
  const view=await getChapterGuessGameView(game.id,value.user.id);
  if("error" in view||!view.question||view.question.index!==input.index)unavailable();
  chapterId=game.questions[0].chapterId;introText=view.question.introText;clip=view.question.introAudio;
 }else{
  const game=await prisma.liveGame.findFirst({where:{code:input.id.toUpperCase(),mode:"CHAPTER_GUESS",status:"IN_PROGRESS",quizIndex:input.index,OR:[{hostId:value.user.id},{players:{some:{userId:value.user.id}}}]},include:{quizQuestions:{where:{questionIndex:input.index}}}});
  if(!game||game.quizQuestions.length!==1)unavailable();
  const payload=game.quizQuestions[0].payload as unknown as QuizPayload;
  if(payload.mode!=="CHAPTER_GUESS")unavailable();
  chapterId=payload.question.chapterId;introText=payload.question.introText;clip=payload.question.introAudio;
 }
 const chapter=await prisma.chapter.findFirst({where:{id:chapterId,book:{contentCollection:readingAccessWhere(value.user)}},include:{book:{include:{contentCollection:true}}}});
 if(!chapter||!await canResumeGameContent(chapter.book.contentCollectionId))unavailable();
 await recheck(binding,value,db);
 const opaque=gameAudioIntroId(input);
 const reader=nativeGameReaderSchema.parse({...envelope(value),activeCollectionId:value.picker.activeCollectionId,game:input,chapterId:opaque,collectionName:chapter.book.contentCollection.name,bookName:getT(value.user.uiLanguage)("pages.chapterGuess"),chapterNumber:input.index+1,sourceLanguage:chapter.book.contentCollection.language,startVerse:1,endVerse:1,focusVerse:1,verses:[{id:opaque+"-intro",number:1,text:introText}]});
 return {reader,chapterId,intro:{clip}};
}
