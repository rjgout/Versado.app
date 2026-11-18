import {z} from "zod";
import {GAME_VIEW_IDS} from "./gamesViewIds";
import {gamePageRoute} from "./gamesPagesRoutes";

export type GameJson=null|boolean|number|string|GameJson[]|{[key:string]:GameJson};
const DATE="__versadoGameDate";
const forbidden=new Set(["__proto__","constructor","prototype"]);
/** Begrensde JSON-gegevens, inclusief expliciete RSC-datums; geen functies of DOM. */
export function gameJsonValid(input:unknown):input is GameJson {
  const pending=[{value:input,depth:0}];let count=0;
  while(pending.length){const {value,depth}=pending.pop()!;
    if(++count>50_000||depth>40)return false;
    if(value===null||typeof value==="string"||typeof value==="boolean")continue;
    if(typeof value==="number"){if(!Number.isFinite(value))return false;continue;}
    if(!value||typeof value!=="object")return false;
    if(Array.isArray(value)){for(const child of value)pending.push({value:child,depth:depth+1});continue;}
    if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
    const entries=Object.entries(value);
    if(Object.hasOwn(value,DATE)){
      const date=(value as Record<string,unknown>)[DATE];
      if(entries.length!==1||typeof date!=="string"||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date)return false;
      continue;
    }
    for(const [key,child]of entries){if(forbidden.has(key))return false;pending.push({value:child,depth:depth+1});}
  }
  return true;
}
export function encodeGameProps(input:unknown):Record<string,GameJson> {
  const active=new WeakSet<object>();let count=0;
  function encode(value:unknown,depth:number):GameJson|undefined {
    if(++count>50_000||depth>40)throw Error("invalid_game_data");
    if(value===undefined)return undefined;
    if(value===null||typeof value==="string"||typeof value==="boolean")return value;
    if(typeof value==="number"&&Number.isFinite(value))return value;
    if(value instanceof Date)return {[DATE]:value.toISOString()};
    if(!value||typeof value!=="object"||active.has(value))throw Error("invalid_game_data");
    active.add(value);
    try {
      if(Array.isArray(value))return value.map(child=>{const result=encode(child,depth+1);if(result===undefined)throw Error("invalid_game_data");return result;});
      if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error("invalid_game_data");
      const result:Record<string,GameJson>={};
      for(const [key,child]of Object.entries(value)){
        if(forbidden.has(key)||key===DATE)throw Error("invalid_game_data");
        const encoded=encode(child,depth+1);if(encoded!==undefined)result[key]=encoded;
      }
      return result;
    }finally{active.delete(value);}
  }
  const result=encode(input,0);
  if(!result||Array.isArray(result)||typeof result!=="object"||Object.hasOwn(result,DATE)||new TextEncoder().encode(JSON.stringify(result)).length>1_000_000)throw Error("invalid_game_data");
  return result;
}
export function decodeGameProps(value:Record<string,GameJson>):Record<string,unknown> {
  if(!gameJsonValid(value))throw Error("invalid_game_data");
  function decode(item:GameJson):unknown{
    if(!item||typeof item!=="object")return item;
    if(Array.isArray(item))return item.map(decode);
    if(Object.hasOwn(item,DATE))return new Date(item[DATE] as string);
    return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,decode(child)]));
  }
  return decode(value) as Record<string,unknown>;
}
const props=z.custom<Record<string,GameJson>>(value=>!!value&&typeof value==="object"&&!Array.isArray(value)&&gameJsonValid(value));
export const nativeGameScreen=z.object({view:z.enum(GAME_VIEW_IDS),data:props,frame:z.enum(["plain","focus","hub"]),back:z.object({href:z.string().refine(value=>gamePageRoute(value)!==null||/^\/courses\/[A-Za-z0-9_-]{1,128}(?:\/pad)?$/.test(value)),parent:z.string().min(1).max(200),soft:z.boolean()}).strict().optional()}).strict();
export const nativeGamePageSchema=z.object({
  version:z.literal(1),userId:z.string().min(1).max(128),activeCollectionId:z.string().max(128).nullable(),selectionVersion:z.number().int().nonnegative(),language:z.enum(["nl","en","de","fr","es"]),
  path:z.string().refine(value=>gamePageRoute(value)!==null),shareOrigin:z.url().refine(value=>{try{return new URL(value).origin===value;}catch{return false;}}),
  result:z.discriminatedUnion("kind",[
    z.object({kind:z.literal("screen"),screen:nativeGameScreen}).strict(),
    z.object({kind:z.literal("redirect"),href:z.string().refine(value=>["/login","/dashboard","/courses","/content"].includes(value)||gamePageRoute(value)!==null)}).strict(),
  ]),
}).strict();
export type NativeGamePage=z.infer<typeof nativeGamePageSchema>;
export type NativeGameScreen=z.infer<typeof nativeGameScreen>;
