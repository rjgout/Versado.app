import { constants, promises as fs } from "node:fs";
import { Readable } from "node:stream";
/** Gedeeld voor legacy en V2: dezelfde descriptor voor controle en stream; geen symlink/fifo. */
export async function streamAudio(file: string, range: string | null, withBody: boolean) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let transferred = false;
  try {
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
    const body = withBody ? Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream<Uint8Array> : null;
    transferred = withBody;
    return new Response(body, { status: range ? 206 : 200, headers });
  } finally { if (!transferred) await handle.close(); }
}
