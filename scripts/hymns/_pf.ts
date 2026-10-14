import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ChromaExtractor } from "/home/user/Versado.app/src/lib/hymns/audio/features";
import { CandidatePrefilter } from "/home/user/Versado.app/src/lib/hymns/recognize/prefilter";
import { loadRecognitionBundle } from "/home/user/Versado.app/src/lib/hymns/library/server";
const index = JSON.parse(readFileSync(".cache/hymns/nld/index.json","utf8")).hymns as {number:number;slug:string}[];
const b = loadRecognitionBundle();
const comps = b.compositions.map(c=>({id:c.id,composition:c}));
const pf0 = new CandidatePrefilter(comps);
const nums = process.argv.slice(2).map(Number);
const ranks: Record<number,number[]> = {};
for (const n of nums) {
  const m = b.members.find(x=>x.number===n)!; const slug = index.find(h=>h.number===n)!.slug;
  const r = spawnSync("ffmpeg",["-v","error","-i",`.cache/hymns/nld/audio/${slug}.mp3`,"-t","60","-ac","1","-ar","44100","-f","f32le","-"],{maxBuffer:1<<30});
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength/4)).slice();
  const ex = new ChromaExtractor({sampleRate:44100}); const pf = new CandidatePrefilter(comps);
  const row:number[]=[]; let next=5;
  for (let i=0;i<x.length;i+=4096) for (const f of ex.push(x.subarray(i,i+4096))) { pf.tracker.push(f); if (f.time>=next){ const rk=pf.rankNow(); row.push(rk? rk.findIndex(e=>e.id===m.compositionId)+1:-1); next+=5; } }
  console.log(n, row.join(" "));
}
void pf0;
