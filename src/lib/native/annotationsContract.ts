import { z } from "zod";
import { annotationPutSchema, annotationDeleteSchema } from "@/lib/annotations/contract";
import { ANNOTATION_COLORS } from "@/lib/annotations/clientContract";
import { nativeReaderSchema } from "./readerContract";

/** Alleen bestaande versannotaties binnen de huidige geautoriseerde leesroute. */
export const nativeAnnotationScope = z.object(nativeReaderSchema.shape).pick({ version:true,userId:true,activeCollectionId:true,selectionVersion:true,language:true,courseId:true,kind:true,targetId:true,chapterId:true,startVerse:true,endVerse:true });
export const nativeAnnotationContext = nativeAnnotationScope.pick({ activeCollectionId:true,selectionVersion:true,language:true,chapterId:true,startVerse:true,endVerse:true });
export const nativeAnnotationView = z.object({
  id:z.string().min(1).max(128), kind:z.enum(["bookmark","highlight","note"]),
  targetKey:z.string().min(1).max(134),target:z.object({type:z.literal("verse"),verseId:z.string().min(1).max(128)}).strict(),
  mutationVersion:z.number().int().nonnegative(),deleted:z.boolean(),anchorStatus:z.string().max(32),
  text:z.string().max(2000).optional(),color:z.enum(ANNOTATION_COLORS).optional(),
}).superRefine((row,ctx)=>{if(row.targetKey!==`verse:${row.target.verseId}` || (row.kind==="note" ? row.text===undefined||row.color!==undefined : row.kind==="highlight" ? row.color===undefined||row.text!==undefined : row.text!==undefined||row.color!==undefined))ctx.addIssue({code:"custom",message:"annotation_identity_invalid"});});
export const nativeAnnotationList = nativeAnnotationScope.extend({ annotations:z.array(nativeAnnotationView).max(600),complete:z.boolean() }).strict();
export const nativeAnnotationMutation = z.discriminatedUnion("operation",[
  z.object({operation:z.literal("put"),context:nativeAnnotationContext.strict(),action:annotationPutSchema}).strict(),
  z.object({operation:z.literal("delete"),context:nativeAnnotationContext.strict(),action:annotationDeleteSchema}).strict(),
]).refine(value=>value.action.target.type==="verse");
export const nativeAnnotationResult = nativeAnnotationScope.extend({actionId:z.uuid(),changed:z.boolean(),annotation:nativeAnnotationView}).strict();
export type NativeAnnotationMutation = z.infer<typeof nativeAnnotationMutation>;
export type NativeAnnotationList = z.infer<typeof nativeAnnotationList>;
