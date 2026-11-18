// Composeert uitsluitend de werkelijk verpakte assets. Dit zijn geometrische
// previews, geen screenshots van een draaiende simulator of fysieke launcher.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'docs/native-branding/previews';
await mkdir(out, { recursive: true });
const bg = '#051e7b';
const res = 'android/app/src/main/res';
const ios = 'ios/App/App/Assets.xcassets/Splash.imageset/versado-flame-splash.png';
async function mask(png, size, shape) {
  const paths = {
    circle: `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>`,
    rounded: `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="white"/>`,
    squircle: `<path d="M${size / 2},0 C${size * 0.95},0 ${size},${size * 0.05} ${size},${size / 2} S${size * 0.95},${size} ${size / 2},${size} S0,${size * 0.95} 0,${size / 2} S${size * 0.05},0 ${size / 2},0" fill="white"/>`,
  };
  return sharp(png).composite([{ input: Buffer.from(`<svg width="${size}" height="${size}">${paths[shape]}</svg>`), blend: 'dest-in' }]).png().toBuffer();
}
const samples = [];
for (const [name, width, height] of [
  ['iPhone-SE', 320, 568], ['iPhone', 390, 844],
  ['iPad-portrait', 768, 1024], ['iPad-landscape', 1024, 768],
]) {
  const png = await sharp(ios).resize(width, height, { fit: 'cover' }).png().toBuffer();
  await writeFile(`${out}/${name}.png`, png); samples.push([name, png]);
}
for (const name of ['Android-pre12', 'Android12']) {
  let logo;
  if (name === 'Android12') {
    // Android 12 zonder icon-background: 288dp box, centrale 192dp cirkel.
    const foreground = await sharp(`${res}/mipmap-xxxhdpi/ic_launcher_foreground.png`).resize(288, 288).extract({ left: 48, top: 48, width: 192, height: 192 }).png().toBuffer();
    logo = await mask(foreground, 192, 'circle');
  } else logo = await sharp(`${res}/drawable-xxxhdpi/versado_splash_flame.png`).resize(256, 256).png().toBuffer();
  const png = await sharp({ create: { width: 360, height: 800, channels: 3, background: bg } }).composite([{ input: logo, gravity: 'centre' }]).png().toBuffer();
  await writeFile(`${out}/${name}.png`, png); samples.push([name, png]);
}
const icons = [];
for (const shape of ['circle', 'rounded', 'squircle']) {
  // Android adaptive: 108dp laag, 72dp maskervenster; centrale veilige cirkel 66dp.
  const png = await sharp(`${res}/mipmap-xxxhdpi/ic_launcher_foreground.png`).extract({ left: 72, top: 72, width: 288, height: 288 }).png().toBuffer();
  icons.push([`Adaptive-${shape}`, await mask(png, 288, shape)]);
}
icons.push(['Legacy-round', await mask(await sharp(`${res}/mipmap-xxxhdpi/ic_launcher_round.png`).resize(288).png().toBuffer(), 288, 'circle')]);
icons.push(['Launcher-square', await sharp(`${res}/mipmap-xxxhdpi/ic_launcher.png`).resize(288).png().toBuffer()]);
async function sheet(entries, name, columns, cellWidth, cellHeight) {
  const layers = [];
  for (const [i, [label, png]] of entries.entries()) {
    const left = (i % columns) * cellWidth, top = Math.floor(i / columns) * cellHeight;
    const image = await sharp(png).resize(cellWidth - 32, cellHeight - 65, { fit: 'inside' }).png().toBuffer();
    const { width, height } = await sharp(image).metadata();
    layers.push({ input: image, left: left + Math.floor((cellWidth - width) / 2), top: top + 45 + Math.floor((cellHeight - 65 - height) / 2) });
    layers.push({ input: Buffer.from(`<svg width="${cellWidth}" height="36"><text x="16" y="26" fill="#ffffff" font-family="sans-serif" font-size="20">${label}</text></svg>`), left, top });
  }
  await sharp({ create: { width: columns * cellWidth, height: Math.ceil(entries.length / columns) * cellHeight, channels: 3, background: '#17202f' } }).composite(layers).png().toFile(`${out}/${name}.png`);
}
await sheet(samples, 'splash-contact-sheet', 3, 400, 560);
await sheet(icons, 'android-masks', 3, 360, 370);
console.log('Brandingpreviews uit verpakte assets:', out);
