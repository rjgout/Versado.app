import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { OfficialSource } from "../../../src/lib/audio/officialCatalogue";
import type { OfficialNetwork } from "../../../src/lib/audio/officialDownload";
import type { officialPage } from "./official-source";
import { setTimeout as delay } from "node:timers/promises";
export interface OfficialMock { sources:OfficialSource[];pages:Record<string,ReturnType<typeof officialPage>>;audio:Record<string,string>;logFile:string;controlFile:string }
/** Test-IPC: lezende workers zien uitsluitend de oude of nieuwe complete JSON,
 * nooit de truncate/write-tussenstand van writeFile op een gedeeld bestand. */
export async function writeOfficialControl(file: string, control: {pauseUrl?:string;failUrl?:string;corruptUrl?:string;wrongPage?:string}) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(control), {flag:"wx",mode:0o600});
    await fs.rename(temporary,file);
  } finally { await fs.unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;}); }
}
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
