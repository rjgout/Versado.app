import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { audioDir } from "@/lib/audioMirror";
import { sha256, type AudioManifest } from "./contract";
const exec = promisify(execFile);
export async function audioRoot() {
  const root = audioDir();
  if (!root || !(await fs.lstat(root)).isDirectory()) throw new Error("STORAGE_UNAVAILABLE");
  return root;
}
export async function safeDirectory(parent: string, name: string, create = false) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(name)) throw new Error("UNSAFE_PATH");
  const result = path.join(parent, name);
  if (create) await fs.mkdir(result, { mode: 0o750 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  if (!(await fs.lstat(result)).isDirectory()) throw new Error("UNSAFE_DIRECTORY");
  return result;
}
export async function readBounded(file: string, limit: number) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) throw new Error("FILE_SIZE");
    // Beperkte read voorkomt groei tijdens lezen; ook geen FIFO/device/symlink.
    const buffer = Buffer.alloc(stat.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const next = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!next.bytesRead) break;
      bytesRead += next.bytesRead;
    }
    if (bytesRead !== stat.size) throw new Error("FILE_CHANGED");
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
export async function verifyObject(hash: string, bytes: number) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("UNSAFE_HASH");
  const folder = await safeDirectory(await audioRoot(), "objects");
  const file = path.join(folder, hash + ".mp3");
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== bytes || bytes <= 0 || bytes > 256 * 1024 * 1024) throw new Error("OBJECT_CORRUPT");
    const digest = createHash("sha256");
    let count = 0;
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      count += chunk.length;
      if (count > bytes) { stream.destroy(); throw new Error("OBJECT_CORRUPT"); }
      digest.update(chunk);
    }
    if (count !== bytes || digest.digest("hex") !== hash) throw new Error("OBJECT_CORRUPT");
    return file;
  } finally { await handle.close().catch(() => {}); }
}
export async function storeAudio(folder: string, manifest: AudioManifest) {
  const data = await readBounded(path.join(folder, manifest.audio.file), 256 * 1024 * 1024);
  if (data.length !== manifest.audio.bytes || sha256(data) !== manifest.audio.sha256) throw new Error("AUDIO_CHECKSUM");
  if (!(data.subarray(0, 3).toString() === "ID3" || (data[0] === 255 && (data[1] & 224) === 224))) throw new Error("AUDIO_FORMAT");
  const objects = await safeDirectory(await audioRoot(), "objects", true);
  const temp = path.join(objects, randomUUID() + ".part");
  await fs.writeFile(temp, data, { flag: "wx", mode: 0o640 });
  try {
    const { stdout } = await exec("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", "mp3", "-show_entries", "format=duration:stream=codec_name,codec_type,width,height:stream_disposition=attached_pic", "-of", "json", temp], { timeout: 30000, maxBuffer: 65536 });
    const result = JSON.parse(stdout);
    const streams: { codec_type?: string; codec_name?: string; width?: number; height?: number; disposition?: { attached_pic?: number } }[] = Array.isArray(result.streams) ? result.streams : [];
    const audio = streams.filter((stream) => stream.codec_type === "audio"), covers = streams.filter((stream) => stream.codec_type !== "audio");
    const coversValid = covers.length <= 4 && covers.every((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic === 1 && ["png", "mjpeg"].includes(stream.codec_name ?? "") && Number.isInteger(stream.width) && Number.isInteger(stream.height) && stream.width! > 0 && stream.height! > 0 && stream.width! <= 4096 && stream.height! <= 4096);
    if (Math.abs(Number(result.format?.duration) - manifest.audio.duration) > 0.15 || !Number.isFinite(Number(result.format?.duration)) || Number(result.format?.duration) <= 0 || audio.length !== 1 || audio[0].codec_name !== "mp3" || !coversValid) throw new Error("AUDIO_DURATION_FORMAT");
    await exec("ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-f", "mp3", "-i", temp, "-f", "null", "-"], { timeout: 120000, maxBuffer: 65536 });
    const handle = await fs.open(temp, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
    const destination = path.join(objects, manifest.audio.sha256 + ".mp3");
    await fs.link(temp, destination).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      await verifyObject(manifest.audio.sha256, manifest.audio.bytes);
    });
    const directory = await fs.open(objects, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.unlink(temp).catch(() => {}); }
}
