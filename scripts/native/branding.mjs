// Alleen deterministische formaten uit het door de eigenaar aangeleverde origineel.
// Geen uitsnede, hertekening of wijziging van de web/PWA-iconen.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const source = 'assets/native/versado-vlam-logo-bron.png';
const ios = 'ios/App/App/Assets.xcassets';
const android = 'android/app/src/main/res';
async function save(path, image) {
  await mkdir(dirname(path), { recursive: true });
  await image.removeAlpha().png().toFile(path);
}
async function centered(width, height, size, background = '#ffffff') {
  const logo = await sharp(source).resize(size, size).removeAlpha().png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: logo, gravity: 'centre' }]);
}
await save('public/icons/native/versado-flame.png', sharp(source).resize(132, 132).removeAlpha());
await save(`${ios}/AppIcon.appiconset/versado-flame-1024.png`, sharp(source).resize(1024, 1024).removeAlpha());
// Eén 1x/2x/3x-bron, zoals voorheen; de witte launch-layout blijft behouden.
await save(`${ios}/Splash.imageset/versado-flame-splash.png`, await centered(2732, 2732, 320));
for (const [density, factor, portrait, landscape] of [
  ['mdpi', 1, [320, 480], [480, 320]],
  ['hdpi', 1.5, [480, 800], [800, 480]],
  ['xhdpi', 2, [720, 1280], [1280, 720]],
  ['xxhdpi', 3, [960, 1600], [1600, 960]],
  ['xxxhdpi', 4, [1280, 1920], [1920, 1280]],
]) {
  await save(`${android}/mipmap-${density}/ic_launcher.png`, sharp(source).resize(48 * factor, 48 * factor).removeAlpha());
  // Het volledige vierkante bronbeeld past binnen de ronde/adaptieve veilige zone.
  await save(`${android}/mipmap-${density}/ic_launcher_round.png`, await centered(48 * factor, 48 * factor, Math.round(32 * factor), '#0632b5'));
  await save(`${android}/mipmap-${density}/ic_launcher_foreground.png`, await centered(108 * factor, 108 * factor, 48 * factor, '#0632b5'));
  for (const [orientation, [width, height]] of [['port', portrait], ['land', landscape]]) {
    await save(`${android}/drawable-${orientation}-${density}/splash.png`, await centered(width, height, Math.round(80 * factor)));
  }
}
await save(`${android}/drawable/splash.png`, await centered(480, 320, 80));
await writeFile(`${ios}/Splash.imageset/Contents.json`, JSON.stringify({
  images: ['1x', '2x', '3x'].map(scale => ({ idiom: 'universal', filename: 'versado-flame-splash.png', scale })),
  info: { version: 1, author: 'xcode' },
}, null, 2) + '\n');
