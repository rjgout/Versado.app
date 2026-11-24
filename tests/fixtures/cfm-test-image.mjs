// Synthetische, deterministische rasters; nooit officiële illustraties of productie-importinput.
import sharp from 'sharp';
import {createHash} from 'node:crypto';
export async function cfmTestImage(asset) {
  if(!Number.isInteger(asset.width)||!Number.isInteger(asset.height)||asset.width<1||asset.height<1||asset.width*asset.height>16_000_000)throw Error('CFM_FIXTURE_DIMENSIONS');
  const digest=createHash('sha256').update(asset.url).digest();
  const image=sharp({create:{width:asset.width,height:asset.height,channels:3,background:{r:digest[0],g:digest[1],b:digest[2]}}});
  if(asset.mimeType==='image/jpeg')return image.jpeg({quality:80}).toBuffer();
  if(asset.mimeType==='image/png')return image.png().toBuffer();
  if(asset.mimeType==='image/webp')return image.webp({quality:80}).toBuffer();
  throw Error('CFM_FIXTURE_MIME');
}
