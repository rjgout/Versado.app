import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeStudyUrlSchema } from "./schema";
import { StudyPublishingError } from "./policy";
import {
  STUDY_MEDIA_MAX_BYTES,
  studyStorage,
  validateStudyImage,
} from "./storage";

export function publicStudyAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const parts = address.toLowerCase().split("::");
  if (parts.length > 2 || address.includes(".")) return false;
  const left = parts[0].split(":").filter(Boolean),
    right = (parts[1] ?? "").split(":").filter(Boolean);
  const words = [
    ...left,
    ...Array(8 - left.length - right.length).fill("0"),
    ...right,
  ].map((v) => parseInt(v, 16));
  // Alleen global-unicast; blokkeer ook transition/documentatie/protocol-ranges.
  return (
    words[0] >= 0x2000 &&
    words[0] <= 0x3fff &&
    words[0] !== 0x2002 &&
    !(words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8))
  );
}
export function studyDownloadUrl(value: string, hosts: readonly string[]) {
  if (!safeStudyUrlSchema.safeParse(value).success)
    throw new StudyPublishingError("MEDIA");
  const url = new URL(value);
  if (
    (url.port && url.port !== "443") ||
    !hosts.includes(url.hostname) ||
    !/^[a-z0-9.-]+$/.test(url.hostname) ||
    url.hostname.endsWith(".")
  )
    throw new StudyPublishingError("MEDIA");
  return url;
}
interface Address {
  address: string;
  family: number;
}
interface DownloadResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer>;
  close: () => void;
}
export interface StudyDownloadOptions {
  allowedHosts: readonly string[];
  timeoutMs?: number;
  /** Uitsluitend dependency-injectie voor tests, nooit uit een API-payload. */
  resolve?: (host: string) => Promise<Address[]>;
  transport?: (
    url: URL,
    address: Address,
    signal: AbortSignal,
  ) => Promise<DownloadResponse>;
}
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error());
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export function studyHttpsTransport(
  url: URL,
  address: Address,
  signal: AbortSignal,
): Promise<DownloadResponse> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        agent: false,
        signal,
        servername: url.hostname,
        rejectUnauthorized: true,
        // Geen tweede DNS lookup nadat de publieke bestemming bewezen is.
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [
              { address: address.address, family: address.family },
            ]);
          else callback(null, address.address, address.family);
        },
      },
      (response) =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          close: () => response.destroy(),
        }),
    );
    request.on("error", reject);
  });
}
export async function downloadStudyImage(
  source: string,
  options: StudyDownloadOptions,
  expectedChecksum: string,
) {
  const store = await studyStorage();
  const controller = new AbortController(),
    signal = controller.signal;
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(options.timeoutMs ?? 15_000, 15_000)),
  );
  let current = source,
    response: DownloadResponse | undefined,
    handle;
  const quarantine = path.join(
    store.root,
    `.quarantine-download-${randomUUID()}.part`,
  );
  try {
    for (let hop = 0; hop <= 3; hop++) {
      signal.throwIfAborted();
      const url = studyDownloadUrl(current, options.allowedHosts);
      const addresses = await abortable(
        (
          options.resolve ??
          ((host) => lookup(host, { all: true, verbatim: true }))
        )(url.hostname),
        signal,
      );
      if (
        !addresses.length ||
        addresses.some(
          (a) => !publicStudyAddress(a.address) || a.family !== isIP(a.address),
        )
      )
        throw new Error();
      response = await abortable(
        (options.transport ?? studyHttpsTransport)(url, addresses[0], signal),
        signal,
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        response.close();
        if (hop === 3 || typeof location !== "string") throw new Error();
        current = new URL(location, url).href;
        continue;
      }
      if (response.status !== 200) throw new Error();
      const length = response.headers["content-length"],
        mime = response.headers["content-type"];
      if (
        typeof mime !== "string" ||
        (length !== undefined &&
          (typeof length !== "string" ||
            !/^\d+$/.test(length) ||
            Number(length) > STUDY_MEDIA_MAX_BYTES))
      )
        throw new Error();
      handle = await fs.open(
        quarantine,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      let size = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      for (;;) {
        const step = await abortable(iterator.next(), signal);
        if (step.done) break;
        const chunk = step.value;
        size += chunk.length;
        if (size > STUDY_MEDIA_MAX_BYTES) throw new Error();
        await handle.writeFile(chunk);
      }
      if (size === 0 || (length !== undefined && size !== Number(length)))
        throw new Error();
      await handle.sync();
      await handle.close();
      handle = undefined;
      const bytes = await fs.readFile(quarantine),
        image = await validateStudyImage(bytes, mime, expectedChecksum);
      return { bytes, image };
    }
    throw new Error();
  } catch {
    throw new StudyPublishingError("MEDIA");
  } finally {
    clearTimeout(timer);
    response?.close();
    await handle?.close().catch(() => {});
    await fs.unlink(quarantine).catch(() => {});
  }
}
