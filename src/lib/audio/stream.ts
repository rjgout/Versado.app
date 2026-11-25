import { constants, promises as fs } from "node:fs";
import { Readable } from "node:stream";
/** Gedeeld voor legacy en V2: dezelfde descriptor voor controle en stream; geen symlink/fifo. */
export interface AudioStreamGuard {
  verify(handle: import("node:fs/promises").FileHandle): Promise<void>;
  authorize(): Promise<void>;
}
export async function streamAudio(file: string, range: string | null, withBody: boolean, guard?: AudioStreamGuard) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let transferred = false;
  try {
    await guard?.verify(handle);
    await guard?.authorize();
    const stat = await handle.stat(), size = stat.size;
    if (!stat.isFile() || !Number.isSafeInteger(size) || size <= 0) throw new Error("AUDIO_UNAVAILABLE");
    const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    let start = 0, end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let valid = Boolean(match && (match[1] || match[2]));
      if (match && valid) {
        if (match[1]) { start = Number(match[1]); if (match[2]) { const requestedEnd = Number(match[2]); valid = Number.isSafeInteger(requestedEnd); end = Math.min(requestedEnd, end); } }
        else { const suffix = Number(match[2]); valid = Number.isSafeInteger(suffix) && suffix > 0; start = Math.max(size - suffix, 0); }
      }
      if (!valid || !Number.isSafeInteger(start) || start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    const source = withBody ? Readable.toWeb(handle.createReadStream({ start, end, autoClose: !guard })) as ReadableStream<Uint8Array> : null;
    const reader=source&&guard?source.getReader():null;
    const body=reader&&guard?new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          await guard.verify(handle);await guard.authorize();const next=await reader.read();await guard.verify(handle);await guard.authorize();
          if(next.done){await handle.close();controller.close();}else controller.enqueue(next.value);
        } catch(error){await reader.cancel(error).catch(()=>{});await handle.close().catch(()=>{});controller.error(error);}
      },
      async cancel(reason){try{await reader.cancel(reason);}finally{await handle.close().catch(()=>{});}},
    },{highWaterMark:0}):source;
    transferred = withBody;
    return new Response(body, { status: range ? 206 : 200, headers });
  } finally { if (!transferred) await handle.close(); }
}
