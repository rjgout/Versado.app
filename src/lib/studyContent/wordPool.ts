import {z} from 'zod';
import {normalizeAnnotationText} from '@/lib/annotations/contract';
import {parseStudyDocument} from './schema';

export const LESSON_WORD_NORMALIZATION_VERSION = 1 as const;
const languages = ['nl','en','de','fr','es'] as const;
const blockTypes = ['paragraph','heading','quote','list','table','question','assignment'] as const;
export const lessonWordOptionsSchema = z.object({
 minLength:z.number().int().min(1).max(64),maxLength:z.number().int().min(1).max(64),
 minCandidates:z.number().int().min(1).max(5000),maxCandidates:z.number().int().min(1).max(5000),
 blockTypes:z.array(z.enum(blockTypes)).min(1).max(7),excludeWords:z.array(z.string().min(1).max(64)).max(500).optional(),
}).strict().refine(o=>o.minLength<=o.maxLength&&o.minCandidates<=o.maxCandidates);
export type LessonWordOptions=z.infer<typeof lessonWordOptionsSchema>;
export type LessonWordCandidate=Readonly<{word:string;display:string;occurrences:readonly Readonly<{sectionId:string;blockId:string}>[]}>;
export type WordExtraction = {available:false;reason:'language'|'content'|'size'|'pool';candidateCount?:number}
 | {available:true;options:LessonWordOptions;candidates:readonly LessonWordCandidate[];totalCandidates:number;truncated:boolean};
/** Alleen bronproza: geen HTML, URL-doelen, referentielabels, media, metadata of gebruikersdata. */
export function extractLessonWords(raw:unknown,language:string,rawOptions:LessonWordOptions):WordExtraction {
 const options=lessonWordOptionsSchema.parse(rawOptions);
 if(!(languages as readonly string[]).includes(language))return {available:false,reason:'language'};
 options.blockTypes=[...new Set(options.blockTypes)].sort();
 options.excludeWords=[...new Set((options.excludeWords??[]).map(w=>normalizeAnnotationText(w).toLocaleLowerCase(language)))].sort();
 let document;try{document=parseStudyDocument(raw);}catch{return {available:false,reason:'content'};}
 const excluded=new Set(options.excludeWords),allowed=new Set<string>(options.blockTypes);
 const words=new Map<string,{display:string;occurrences:Array<{sectionId:string;blockId:string}>}>();
 let chars=0,oversized=false;
 function inline(value:unknown):string {
  if(!Array.isArray(value))return '';
  return value.map(v=>v.type==='text'||v.type==='link'?v.text:'\uFFFC').join('');
 }
 function add(content:unknown,sectionId:string,blockId:string){
  if(oversized)return;
  const text=normalizeAnnotationText(inline(content));chars += [...text].length;
  if(chars>250_000){oversized=true;return;}
  // Apostrof-/koppeltekensamenstellingen blijven één token en worden niet tot gegokte woordfragmenten geknipt.
  // Cijfers blijven in de token tot validatie: 'les2026' wordt geen verzonnen 'les'.
  for(const token of text.match(/[\p{L}\p{M}\p{N}\uFFFC]+(?:[-‐‑'’][\p{L}\p{M}\p{N}\uFFFC]+)*/gu)??[]){
   if(!/^\p{L}[\p{L}\p{M}]*$/u.test(token)||! /^(?:\p{Script=Latin}|\p{M})+$/u.test(token))continue;
   const word=token.toLocaleLowerCase(language).normalize('NFC'),length=[...word].length;
   if(length<options.minLength||length>options.maxLength||excluded.has(word))continue;
   const existing=words.get(word);
   if(existing){if(existing.occurrences.length<16&&!existing.occurrences.some(a=>a.sectionId===sectionId&&a.blockId===blockId))existing.occurrences.push({sectionId,blockId});}
   else words.set(word,{display:token,occurrences:[{sectionId,blockId}]});
  }
 }
 function items(values:unknown,sectionId:string){
  if(!Array.isArray(values)||oversized)return;
  for(const item of values){add(item.content,sectionId,item.id);items(item.children,sectionId);blocks(item.blocks,sectionId);if(oversized)return;}
 }
 function blocks(values:unknown,sectionId:string){
  if(!Array.isArray(values)||oversized)return;
  for(const block of values){
   if(!allowed.has(block.type))continue;
   if(block.type==='list')items(block.items,sectionId);
   else if(block.type==='table')for(const row of block.rows)for(const cell of row.cells)add(cell.content,sectionId,cell.id);
   else {add(block.content,sectionId,block.id);items(block.items,sectionId);}
   if(oversized)return;
  }
 }
 for(const section of document.sections){blocks(section.blocks,section.id);if(oversized)return {available:false,reason:'size'};}
 if(words.size<options.minCandidates)return {available:false,reason:'pool',candidateCount:words.size};
 const candidates=[...words.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,options.maxCandidates).map(([word,value])=>Object.freeze({word,display:value.display,occurrences:Object.freeze(value.occurrences.map(a=>Object.freeze(a)))}));
 return {available:true,options,candidates:Object.freeze(candidates),totalCandidates:words.size,truncated:words.size>options.maxCandidates};
}
