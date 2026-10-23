import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import config from "../../tailwind.config";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { staticMascotAsset } from "../../src/lib/mascots";

const raw = process.env.NATIVE_API_BASE_URL;
if (!raw) throw new Error("NATIVE_API_BASE_URL ontbreekt; geen impliciete productiebackend.");
const url = new URL(raw);
const local = process.env.NATIVE_ALLOW_LOCAL_HTTP_API === "1" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname) && url.protocol === "http:";
if ((!local && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Een HTTPS backend-origin is vereist (alleen expliciete loopback-ontwikkeling mag HTTP).");
const terms = process.env.NATIVE_TERMS_URL ? new URL(process.env.NATIVE_TERMS_URL) : null;
if (terms && (terms.protocol !== "https:" || terms.username || terms.password)) throw new Error("Voorwaarden vereisen een expliciete veilige HTTPS-URL.");
const outdir = "dist/native";
await rm(outdir, { recursive: true, force: true }); await mkdir(outdir, { recursive: true });
await build({ entryPoints: ["src/components/native/entry.tsx"], outdir, entryNames: "index", bundle: true, minify: true, platform: "browser", target: ["safari16", "chrome105"], define: { NATIVE_API_BASE_URL: JSON.stringify(url.origin), NATIVE_TERMS_URL: JSON.stringify(terms?.href ?? null), "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "shared-versado-css", setup(api) { api.onLoad({ filter: /\.css$/ }, async args => ({ loader: "css", contents: (await postcss([tailwind(config), autoprefixer()]).process(await readFile(args.path, "utf8"), { from: args.path })).css })); } }] });
const mascot = staticMascotAsset("novi", "greeting");
for (const path of ["/icons/icon-512.png", ...(mascot ? [mascot.src] : [])]) {
  const target = join(outdir, path.slice(1)); await mkdir(join(target, ".."), { recursive: true }); await cp(join("public", path), target);
}
const csp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${url.origin} ${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'`;
await writeFile(join(outdir, "index.html"), `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Versado</title><link rel="stylesheet" href="index.css"></head><body><div id="root"></div><script src="index.js" defer></script></body></html>`);
await writeFile(join(outdir, "build.json"), JSON.stringify({ apiVersion: 1, profile: "local-development", apiOrigin: url.origin, releaseApproved: false }));
console.log("Lokale native development-bundel gereed; store-release blijft geblokkeerd.");
