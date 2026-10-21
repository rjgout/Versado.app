/** JSON begrenzen tijdens het lezen, ook zonder Content-Length of bij chunked requests. */
export async function boundedJson(req: Request, limit = 16_384): Promise<unknown> {
  if (Number(req.headers.get("content-length") || 0) > limit) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) return null;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); }
}
