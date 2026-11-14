// Deterministische afleidingen van de eigenaarbron; geen hertekening van de vlam.
import sharp from 'sharp';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const source = 'assets/native/versado-vlam-logo-bron.png';
const ios = 'ios/App/App/Assets.xcassets';
const android = 'android/app/src/main/res';
// De rechteronderhoek van de originele achtergrond, ook de systeem-splashkleur.
const background = [5, 30, 123];
async function save(path, image) {
  await mkdir(dirname(path), { recursive: true });
  await image.removeAlpha().png().toFile(path);
}
async function seamless(width, height, size, outerRadius = 0.85) {
  const logo = await sharp(source).resize(size, size).removeAlpha().raw().toBuffer();
  const pixels = Buffer.alloc(width * height * 3);
  const left = Math.floor((width - size) / 2), top = Math.floor((height - size) / 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Randpixels doortrekken: geen rechthoekige bronrand tegen een andere kleur.
    const sx = Math.max(0, Math.min(size - 1, x - left));
    const sy = Math.max(0, Math.min(size - 1, y - top));
    const radius = Math.hypot(x - left - (size - 1) / 2, y - top - (size - 1) / 2) / size;
    // De vlam ligt volledig binnen r=0.52: deze pixels blijven exact behouden.
    // Alleen de omringende blauwe achtergrond vloeit geleidelijk uit naar de
    // bronkleur. De iconvariant is vóór de Android-maskerrand al volledig effen.
    const t = Math.max(0, Math.min(1, (radius - 0.52) / (outerRadius - 0.52)));
    const blend = t * t * (3 - 2 * t);
    const input = (sy * size + sx) * 3, output = (y * width + x) * 3;
    for (let c = 0; c < 3; c++) pixels[output + c] = Math.round(logo[input + c] * (1 - blend) + background[c] * blend);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}
// Deze al goedgekeurde assets blijven byte-identiek.
await save('public/icons/native/versado-flame.png', sharp(source).resize(132, 132).removeAlpha());
await save(`${ios}/AppIcon.appiconset/versado-flame-1024.png`, sharp(source).resize(1024, 1024).removeAlpha());
// Aspect-fill van het bestaande storyboard: vlam past ook binnen het smalle
// iPhone-venster; iPad portrait/landscape gebruikt exact dezelfde imageset.
await save(`${ios}/Splash.imageset/versado-flame-splash.png`, await seamless(2732, 2732, 768));
for (const [density, factor] of [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
]) {
  await save(`${android}/mipmap-${density}/ic_launcher.png`, sharp(source).resize(48 * factor, 48 * factor).removeAlpha());
  await save(`${android}/mipmap-${density}/ic_launcher_round.png`, await seamless(48 * factor, 48 * factor, Math.round(48 * factor * 0.82), 0.60));
  // De vlam past binnen de centrale veilige cirkel van 66dp in de 108dp-laag.
  await save(`${android}/mipmap-${density}/ic_launcher_foreground.png`, await seamless(108 * factor, 108 * factor, 60 * factor, 0.60));
  await save(`${android}/drawable-${density}/versado_splash_flame.png`, await seamless(256 * factor, 256 * factor, 180 * factor, 0.60));
  for (const orientation of ['port', 'land']) {
    await rm(`${android}/drawable-${orientation}-${density}/splash.png`, { force: true });
  }
}
await rm(`${android}/drawable/splash.png`, { force: true });
await writeFile(`${ios}/Splash.imageset/Contents.json`, JSON.stringify({
  images: ['1x', '2x', '3x'].map(scale => ({ idiom: 'universal', filename: 'versado-flame-splash.png', scale })),
  info: { version: 1, author: 'xcode' },
}, null, 2) + '\n');
