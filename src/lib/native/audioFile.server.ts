import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NATIVE_AUDIO_MAX_BYTES } from "./audioContract";

// Alleen integriteitsmetadata, nooit audiobytes, accounts, tokens of voortgang.
// Iedere geopende descriptor wordt opnieuw gefstat; andere inode/ctime/mtime
// betekent opnieuw hashen. Positieve bewijzen zijn begrensd en kortlevend.
const checked=new Map<string,{sha256:string;until:number}>();
function unavailable():never{throw Error("AUDIO_UNAVAILABLE");}
export async function verifyNativeAudioFile(handle:FileHandle,expected?:{sha256:string;byteSize:number}) {
  const stat=await handle.stat({bigint:true}),size=Number(stat.size);
  if(!stat.isFile()||!Number.isSafeInteger(size)||size<=0||size>NATIVE_AUDIO_MAX_BYTES||expected&&size!==expected.byteSize)unavailable();
  const key=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(":"),cached=checked.get(key);
  let digest=cached&&cached.until>performance.now()?cached.sha256:undefined;
  if(!digest){
    const hash=createHash("sha256"),buffer=Buffer.alloc(64*1024);let offset=0;
    while(offset<size){
      const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,size-offset),offset);
      if(!bytesRead)unavailable();
      if(offset===0&&!(buffer.subarray(0,3).toString()==="ID3"||buffer[0]===255&&(buffer[1]&224)===224))unavailable();
      hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;
    }
    const after=await handle.stat({bigint:true});
    if([after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(":")!==key)unavailable();
    digest=hash.digest("hex");
    if(checked.size>=128)checked.delete(checked.keys().next().value!);
    checked.set(key,{sha256:digest,until:performance.now()+300000});
  }
  if(expected&&digest!==expected.sha256)unavailable();
  return {sha256:digest,byteSize:size};
}
export async function nativeAudioFileIdentity(file:string,expected?:{sha256:string;byteSize:number}) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{return await verifyNativeAudioFile(handle,expected);}finally{await handle.close();}
}
