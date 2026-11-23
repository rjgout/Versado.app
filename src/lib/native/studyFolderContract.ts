import { z } from "zod";
import { annotationKind, annotationTargetSchema, annotationPutSchema } from "@/lib/annotations/contract";
import { ANNOTATION_COLORS } from "@/lib/annotations/clientContract";
import { nativeReaderBounds } from "./readerContract";
export { studyFolderQuery } from "@/lib/annotations/studyFolderQuery";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value=>!/[\r\n]/.test(value));
export const folderRef = z.object({ kind: annotationKind, id }).strict();
export type FolderRef = z.infer<typeof folderRef>;
export const folderRefPath = (ref: FolderRef) => { const v=folderRef.parse({kind:ref.kind,id:ref.id}); return `${v.kind}/${v.id}`; };
const ownAnnotation = z.object({
  id, kind: annotationKind, targetKey:z.string().min(1).max(134),target:annotationTargetSchema,
  mutationVersion:z.number().int().nonnegative(),deleted:z.boolean(),anchorStatus:z.string().max(32),
  text:z.string().max(2000).optional(),color:z.enum(ANNOTATION_COLORS).optional(),
});
const source = z.union([
  z.object({status:z.literal("unavailable")}).strict(),
  z.object({status:z.enum(["available","revision-changed"]),collectionId:id,collectionName:z.string().max(256),language:z.string().max(16),label:z.string().max(1024),href:z.string().max(2048)}).strict(),
]);
export const folderItem = ownAnnotation.omit({deleted:true}).extend({
  createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),source,
  quote:z.string().max(12000).optional(),snippet:z.string().max(1120).optional(),recovery:z.enum(["found","review","missing"]).optional(),
}).strict();
export const folderPage = z.object({items:z.array(folderItem).max(50),nextCursor:z.string().max(400).nullable()}).strict();
export const folderSources = z.object({sources:z.array(z.object({id,name:z.string().max(256),language:z.string().max(16),editionKey:z.string().max(128)}).strict()).max(200)}).strict();
export const folderQueryResult = z.object({version:z.literal(1),userId:id,data:z.union([folderPage,folderSources,z.object({item:folderItem}).strict()])}).strict();
export const folderAnnotations = z.object({version:z.literal(1),userId:id,ref:folderRef,annotations:z.array(ownAnnotation).max(600),complete:z.boolean()}).strict();
// Het transport bevat een eigen referentie en canonical targetKey. De server haalt
// het oorspronkelijke target, de revisie en quote op; lange Unicode-quotes vereisen
// daardoor geen extractie of groter bridgebudget voor het bewerken van een notitie.
const mutationFields={kind:annotationPutSchema.shape.kind,expectedVersion:annotationPutSchema.shape.expectedVersion,actionId:annotationPutSchema.shape.actionId};
export const folderMutation = z.discriminatedUnion("operation",[
  z.object({ref:folderRef,targetKey:z.string().min(1).max(134),operation:z.literal("put"),action:z.object({...mutationFields,text:annotationPutSchema.shape.text,color:annotationPutSchema.shape.color}).strict()}).strict(),
  z.object({ref:folderRef,targetKey:z.string().min(1).max(134),operation:z.literal("delete"),action:z.object(mutationFields).strict()}).strict(),
]);
export const folderMutationResult = z.object({version:z.literal(1),userId:id,ref:folderRef,actionId:z.uuid(),changed:z.boolean(),annotation:ownAnnotation}).strict();
const chapter = z.object({
  collectionId:id,work:z.literal("bofm"),editionKey:z.string().max(128),language:z.string().min(2).max(16),
  chapterId:id,bookName:z.string().max(256),chapterNumber:z.number().int().positive(),
  startVerse:z.number().int().positive().max(500),endVerse:z.number().int().positive().max(500),focusVerse:z.number().int().positive().max(500),
  verses:z.array(z.object({id,number:z.number().int().positive().max(500),text:z.string().min(1).max(20000)}).strict()).min(1).max(500),
}).strict().superRefine(nativeReaderBounds);
export const folderPassage = z.object({version:z.literal(1),userId:id,ref:folderRef,item:folderItem,destination:z.discriminatedUnion("status",[
  z.object({status:z.literal("unavailable")}).strict(),
  z.object({status:z.literal("unsupported"),kind:z.enum(["scripture","study"])}).strict(),
  z.object({status:z.literal("ready"),reader:chapter}).strict(),
])}).strict();
export function folderRoute(path:string,method:string) {
  if(/[\r\n]/.test(path))return null;
  if(method==="POST"&&(path==="study-folder/query"||path==="study-folder/annotations"))return path.endsWith("query")?{operation:"query" as const}:{operation:"mutate" as const};
  const match=/^study-folder\/(bookmark|highlight|note)\/([A-Za-z0-9_-]{1,128})\/(annotations|passage)$/.exec(path);
  return match&&method==="GET"?{operation:match[3] as "annotations"|"passage",ref:folderRef.parse({kind:match[1],id:match[2]})}:null;
}
