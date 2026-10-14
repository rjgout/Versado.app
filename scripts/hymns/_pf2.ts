import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { ChromaExtractor } from "../../src/lib/hymns/audio/features";
import { CandidatePrefilter } from "../../src/lib/hymns/recognize/prefilter";
import { loadRecognitionBundle } from "../../src/lib/hymns/library/server";
const index = JSON.parse(readFileSync(".cache/hymns/nld/index.json","utf8")).hymns as {number:number;slug:string}[];
const b = loadRecognitionBundle();
const comps = b.compositions.map(c=>({id:c.id,composition:c}));
const out: Record<string, unknown[]> = {};
const only = new Set(process.argv.slice(2).filter(a=>!a.startsWith("--")).map(Number));
const tempo = process.argv.find(a=>a.startsWith("--tempo="))?.slice(8) ?? "1";
for (const m of b.members) {
  if (only.size && !only.has(m.number)) continue;
  const slug = index.find(h=>h.number===m.number)!.slug;
  const r = spawnSync("ffmpeg",["-v","error","-i",`.cache/hymns/nld/audio/${slug}.mp3`,...(tempo!=="1"?["-af",`atempo=${tempo}`]:[]),"-t","75","-ac","1","-ar","44100","-f","f32le","-"],{maxBuffer:1<<30});
  if (r.status!==0) continue;
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength/4)).slice();
  const ex = new ChromaExtractor({sampleRate:44100}); const pf = new CandidatePrefilter(comps);
  const rows: unknown[] = []; let next=4;
  for (let i=0;i<x.length;i+=4096) for (const f of ex.push(x.subarray(i,i+4096))) { pf.tracker.push(f); if (f.time>=next){ next+=1; const rk=pf.rankNow(); if(!rk) continue; rows.push([Math.round(f.time*10)/10, rk[0].id, +rk[0].cost.toFixed(4), +rk[1].cost.toFixed(4), rk.findIndex(e=>e.id===m.compositionId)+1, rk.slice(0,3).map(e=>e.id)]); } }
  out[m.number+""] = [m.compositionId, rows];
  console.log(m.number, rows.length, flush);
}
function flush(){}
writeFileSync(`/tmp/pf2-${tempo}.json`, JSON.stringify(out));
