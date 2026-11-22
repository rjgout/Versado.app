import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getAnnotation, readerAnnotations, mutateAnnotation } from "@/lib/annotations/service";
import { getStudyFolderItem, listStudyFolder, listStudyFolderSources } from "@/lib/annotations/studyFolder";
import { commitAccountMutation } from "@/lib/account/mutation";
import { activeNativeSession, NativeAuthError, type NativeSessionBinding } from "./sessions";
import { folderQueryResult,folderAnnotations,folderMutation,folderMutationResult,folderPassage,studyFolderQuery,type FolderRef } from "./studyFolderContract";

async function actor(binding:NativeSessionBinding) { return activeNativeSession(binding); }
async function recheck(binding:NativeSessionBinding,before:{isAdmin:boolean}) {
  const current=await actor(binding);
  if(current.isAdmin!==before.isAdmin)throw new NativeAuthError("session_changed",409);
}
/** Zoektermen blijven in de JSON-body, nooit in verzoek-URL of navigatiegeschiedenis. */
export async function queryNativeStudyFolder(binding:NativeSessionBinding,raw:unknown) {
  const user=await actor(binding),input=studyFolderQuery.parse(raw);
  const read=async()=>"view" in input?listStudyFolderSources(user):"item" in input?{item:await getStudyFolderItem(user,...input.item.split(":") as [FolderRef["kind"],string])}:listStudyFolder(user,input);
  let data=await read();
  // Behoud volledige rijen en de bestaande cursor; kleinere pagina’s kappen geen notities of quotes af.
  if("items" in data&&!("view" in input)&&!("item" in input)) {
    let limit=input.limit??25;
    while(Buffer.byteLength(JSON.stringify(data))>768*1024&&limit>1){limit=Math.max(1,Math.floor(limit/2));data=await listStudyFolder(user,{...input,limit});}
  }
  await recheck(binding,user);
  return folderQueryResult.parse({version:1,userId:user.id,data});
}
/** Eigen readback bevat ook tombstones, zoals in de bestaande editor. */
export async function nativeFolderAnnotations(binding:NativeSessionBinding,ref:FolderRef) {
  const user=await actor(binding),anchor=await getAnnotation(user,ref.kind,ref.id);
  const rows=await readerAnnotations(user,{targetKey:anchor.targetKey});
  await recheck(binding,user);
  return folderAnnotations.parse({version:1,userId:user.id,ref,...rows});
}
export async function mutateNativeFolderAnnotation(binding:NativeSessionBinding,raw:unknown) {
  const user=await actor(binding),input=folderMutation.parse(raw);
  const original=await getAnnotation(user,input.ref.kind,input.ref.id);
  if(original.targetKey!==input.targetKey)throw new NativeAuthError("invalid_input",400);
  const result=await mutateAnnotation(user,{...input.action,target:original.target},input.operation==="delete",prisma,run=>
    commitAccountMutation({userId:user.id,nativeSession:binding},[],async tx=>{
      const current=await activeNativeSession(binding,tx);
      if(current.isAdmin!==user.isAdmin)throw new NativeAuthError("session_changed",409);
      const anchor=await getAnnotation(current,input.ref.kind,input.ref.id,tx);
      if(anchor.targetKey!==original.targetKey||JSON.stringify(anchor.target)!==JSON.stringify(original.target))throw new NativeAuthError("content_context_changed",409);
      return run(tx);
    }));
  return folderMutationResult.parse({version:1,userId:user.id,ref:input.ref,actionId:input.action.actionId,...result});
}
export async function nativeFolderPassage(binding:NativeSessionBinding,ref:FolderRef) {
  const user=await actor(binding),item=await getStudyFolderItem(user,ref.kind,ref.id);
  const base={version:1,userId:user.id,ref,item};
  if(item.source.status==="unavailable") {await recheck(binding,user);return folderPassage.parse({...base,destination:{status:"unavailable"}});}
  if(item.target.type!=="verse") {await recheck(binding,user);return folderPassage.parse({...base,destination:{status:"unsupported",kind:"study"}});}
  const verse=await prisma.verse.findFirst({where:{id:item.target.verseId,chapter:{book:{contentCollection:readingAccessWhere(user)}}},include:{chapter:{include:{book:{include:{contentCollection:true}}}}}});
  if(!verse)throw new NativeAuthError("content_unavailable",404);
  const collection=verse.chapter.book.contentCollection;
  // Omzeil de afzonderlijke native Bijbellezeruitbreiding niet via de vrije spel-/leesadapter.
  if(collection.work!=="bofm") {await recheck(binding,user);return folderPassage.parse({...base,destination:{status:"unsupported",kind:"scripture"}});}
  const verses=await prisma.verse.findMany({where:{chapterId:verse.chapterId},orderBy:{number:"asc"},take:501,select:{id:true,number:true,text:true}});
  const finalSource=await prisma.verse.findFirst({where:{id:verse.id,chapter:{book:{contentCollection:readingAccessWhere(user)}}},select:{chapterId:true,chapter:{select:{book:{select:{contentCollection:{select:{id:true,work:true,language:true,editionKey:true}}}}}}}});
  if(!finalSource||finalSource.chapterId!==verse.chapterId||JSON.stringify(finalSource.chapter.book.contentCollection)!==JSON.stringify({id:collection.id,work:collection.work,language:collection.language,editionKey:collection.editionKey}))throw new NativeAuthError("content_context_changed",409);
  const fresh=await getStudyFolderItem(user,ref.kind,ref.id);
  if(JSON.stringify(fresh)!==JSON.stringify(item))throw new NativeAuthError("content_context_changed",409);
  await recheck(binding,user);
  return folderPassage.parse({...base,destination:{status:"ready",reader:{collectionId:collection.id,work:"bofm",editionKey:collection.editionKey,language:collection.language,chapterId:verse.chapterId,bookName:verse.chapter.book.name,chapterNumber:verse.chapter.number,startVerse:verses[0]?.number,endVerse:verses.at(-1)?.number,focusVerse:verse.number,verses}}});
}
