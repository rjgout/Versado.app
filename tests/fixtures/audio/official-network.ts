import { promises as fs } from "node:fs";
import type { OfficialSource } from "../../../src/lib/audio/officialCatalogue";
import type { OfficialNetwork } from "../../../src/lib/audio/officialDownload";
import type { officialPage } from "./official-source";
import { setTimeout as delay } from "node:timers/promises";
export interface OfficialMock { sources:OfficialSource[];pages:Record<string,ReturnType<typeof officialPage>>;audio:Record<string,string>;logFile:string;controlFile:string }
export function mockOfficialNetwork(config:OfficialMock):OfficialNetwork {
  return {resolve:async()=>[{address:"8.8.8.8",family:4}],transport:async(url)=>{
    await fs.appendFile(config.logFile,url.href+"\n");
    const control=await fs.readFile(config.controlFile,"utf8").then(JSON.parse).catch(()=>({})) as {pauseUrl?:string;failUrl?:string;corruptUrl?:string;wrongPage?:string};
    const page=config.pages[url.href]?structuredClone(config.pages[url.href]):undefined;
    if(page&&control.wrongPage===url.href)page.meta.pageAttributes["data-bcp47-lang"]="wrong";
    const bytes=config.audio[url.href]?await fs.readFile(config.audio[url.href]):Buffer.from(JSON.stringify(page));
    if(control.corruptUrl===url.href)bytes[0]^=1;
    return {status:control.failUrl===url.href?503:200,headers:{"content-type":config.audio[url.href]?"audio/mpeg":"application/json","content-length":String(bytes.length)},body:(async function*(){
      if(control.pauseUrl===url.href){yield bytes.subarray(0,1);while((JSON.parse(await fs.readFile(config.controlFile,"utf8")) as {pauseUrl?:string}).pauseUrl===url.href)await delay(25);yield bytes.subarray(1);}
      else yield bytes;
    })(),close:()=>{}};
  }};
}
