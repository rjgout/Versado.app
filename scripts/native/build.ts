import autoprefixer from "autoprefixer";
import { build } from "esbuild";
import { cp,mkdir,readFile,rm,writeFile } from "node:fs/promises";
import { join } from "node:path";
import postcss from "postcss";
import sharp from "sharp";
import tailwind from "tailwindcss";
import { NATIVE_PROFILE_ARTWORK,nativeProfileArtworkPath } from "../../src/lib/native/profileAssets";
import { NATIVE_TODAY_ARTWORK,nativeArtworkPath } from "../../src/lib/native/todayAssets";
import config from "../../tailwind.config";
import { nativeStaticAssets } from "./assets";
import { buildMetadata,bundleDirectory,contentSecurityPolicy,findSecrets,hashBundleFiles,INTERNAL_ACCESS_FILE,internalAccessEnabled,resolveBuildProfile } from "./profiles.cjs";

// Het profiel (en met name de toegestane backend-origin) komt uit scripts/native/profiles.cjs; zonder
// CAPACITOR_BUILD_PROFILE blijft het bestaande gedrag: een lokale development-bundel.
const resolved = resolveBuildProfile(process.env, { stage: "build", defaultProfile: "local-development" });
const access = internalAccessEnabled(resolved);
if (!resolved.apiOrigin) throw new Error("De backend-origin ontbreekt; geen impliciete productiebackend.");
const url = new URL(resolved.apiOrigin);
const terms = process.env.NATIVE_TERMS_URL ? new URL(process.env.NATIVE_TERMS_URL) : null;
if (terms && (terms.protocol !== "https:" || terms.username || terms.password)) throw new Error("Voorwaarden vereisen een expliciete veilige HTTPS-URL.");
const outdir = bundleDirectory(process.env);
await rm(outdir, { recursive: true, force: true }); await mkdir(outdir, { recursive: true });
const compilation = await build({ metafile: true, entryPoints: ["src/components/native/entry.tsx"], outdir, entryNames: "index", bundle: true, minify: true, platform: "browser", target: ["safari16", "chrome105"], define: { NATIVE_INTERNAL_ACCESS: JSON.stringify(access), NATIVE_API_BASE_URL: JSON.stringify(url.origin), NATIVE_TERMS_URL: JSON.stringify(terms?.href ?? null), NATIVE_BUILD_DISTRIBUTION: JSON.stringify(resolved.distribution), NATIVE_BUILD_CHANNEL: JSON.stringify(resolved.channel), NATIVE_BUILD_VERSION: JSON.stringify(resolved.version ?? ""), NATIVE_BUILD_NUMBER: JSON.stringify(resolved.buildNumber ?? 0), "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "shared-versado-css", setup(api) { api.onLoad({ filter: /\.css$/ }, async args => ({ loader: "css", contents: (await postcss([tailwind(config), autoprefixer()]).process(await readFile(args.path, "utf8"), { from: args.path })).css })); } }] });
// Bewijs buiten de verpakte webDir: geen bronpaden of testmetadata in de app.
await writeFile(`${outdir}.inputs.json`, JSON.stringify(Object.keys(compilation.metafile!.inputs).sort(), null, 2) + "\n");
for (const path of nativeStaticAssets()) {
  const target = join(outdir, path.slice(1)); await mkdir(join(target, ".."), { recursive: true }); await cp(join("public", path), target);
}
// De originelen blijven ongewijzigd. Zelfde beeld/compositie, begrensde lokale variant zoals Next Image op web.
let artworkBytes = 0;
for (const source of NATIVE_TODAY_ARTWORK) {
  const target = join(outdir, nativeArtworkPath(source).slice(1)); await mkdir(join(target, ".."), { recursive: true });
  const result = await sharp(join("public", source)).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toFile(target);
  artworkBytes += result.size;
}
if (artworkBytes > 8 * 1024 * 1024) throw new Error("Het begrensde native Vandaag-artwork overschrijdt 8 MiB; onderzoek de assetselectie.");
console.log(`Geregistreerd Vandaag-artwork: ${NATIVE_TODAY_ARTWORK.length} beelden, ${artworkBytes} bytes; geen externe download.`);
const csp = contentSecurityPolicy(url.origin);
await writeFile(join(outdir, "index.html"), `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Versado</title><link rel="stylesheet" href="index.css"></head><body><div id="root"></div><script src="index.js" defer></script></body></html>`);
// De profielhero gebruikt dezelfde personages; alleen de build maakt lokale WebP-varianten.
let profileArtworkBytes=0;
for(const source of NATIVE_PROFILE_ARTWORK){
  const target=join(outdir,nativeProfileArtworkPath(source).slice(1));await mkdir(join(target,".."),{recursive:true});
  const result=await sharp(join("public",source)).resize({width:1024,withoutEnlargement:true}).webp({quality:88}).toFile(target);
  profileArtworkBytes+=result.size;
}
if(profileArtworkBytes>16*1024*1024)throw new Error("Het lokale profielbeeld overschrijdt de begrensde 16 MiB; controleer de bestaande assetselectie.");
// Geheimen horen nooit in de bundel; dit is een tweede vangnet naast de verificatie op de verpakte assets.
for (const name of ["index.html", "index.js", "index.css"]) {
  const found = findSecrets(await readFile(join(outdir, name), "utf8"));
  if (found.length > 0) throw new Error(`${name} bevat een mogelijk geheim (${found.join(", ")}); de build wordt afgebroken.`);
}
if (access) await writeFile(join(outdir, INTERNAL_ACCESS_FILE), '{"enabled":true}\n');
await writeFile(join(outdir, "build.json"), JSON.stringify(buildMetadata(resolved, hashBundleFiles(outdir)), null, 2) + "\n");
console.log(resolved.distribution
  ? `${resolved.label} gereed: profiel ${resolved.profile}, kanaal ${resolved.channel}, versie ${resolved.version} (${resolved.buildNumber}), origin ${url.origin}${resolved.compileProbe ? " (compileproef, niet uploadbaar)" : ""}. Dit is geen release; store-release blijft geblokkeerd.`
  : "Lokale native development-bundel gereed; store-release blijft geblokkeerd.");
