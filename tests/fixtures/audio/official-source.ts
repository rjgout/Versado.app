import { BOOK_KEYS_BY_SLUG } from "../../../prisma/bookKeys";
import { readFileSync } from "node:fs";
import {officialSources,type OfficialSource} from "../../../src/lib/audio/officialCatalogue";
// Alleen representatieve netwerk-/MP3-testfixtures; geen productiepilot of goedkeuringspoort.
export const sampleSources=officialSources.filter(s=>s.work==="bofm"&&s.bookKey==="bofm/ether"&&s.chapterNumber===1&&s.voice===(s.language==="en"?"male":"audio"));
interface Book { slug:string;key?:string; chapters:{number:number;heading?:string;verses:string[]}[] }
export function officialSeed(source: OfficialSource) {
  const suffix=source.language==="nl"?"":`.${source.language}`;
  const books=JSON.parse(readFileSync(`prisma/bomContent${suffix}.json`,"utf8")) as Book[];
  const book=books.find(b=>(b.key??BOOK_KEYS_BY_SLUG[b.slug])===source.bookKey)!;
  const chapter=book.chapters.find(c=>c.number===source.chapterNumber)!;
  const headings=JSON.parse(readFileSync("prisma/bomChapterHeadings.json","utf8")) as [string,number,string][];
  const heading=source.language==="nl"?headings.find(([slug,n])=>slug===book.slug&&n===source.chapterNumber)?.[2]??null:chapter.heading??null;
  return {heading,verses:chapter.verses};
}
const escape=(text:string)=>text.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
export function officialPage(source: OfficialSource) {
  const seed=officialSeed(source);
  return {meta:{pageAttributes:{"data-bcp47-lang":source.language,"data-uri":`/scriptures/${source.bookKey}/${source.chapterNumber}`},audio:[{mediaUrl:source.url,variant:source.voice}]},content:{body:(seed.heading?`<p class="study-summary">${escape(seed.heading)}</p>`:"")+seed.verses.map((text,i)=>`<p class="verse"><span>${i+1}</span> ${escape(text)}</p>`).join("")}};
}
