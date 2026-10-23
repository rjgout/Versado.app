// Controleer de daadwerkelijk gesynchroniseerde/verpakte native assets.
// Geen signing, publicatie, remote-preview of apparaatacceptatie.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

const platform=process.argv[2];
assert.ok(['android','ios'].includes(platform),'Kies android of ios');
const root=resolve(process.argv[3]??(platform==='android'?'android/app/src/main/assets':'ios/App/App'));
const expected=new URL(process.env.NATIVE_API_BASE_URL??'http://invalid');
assert.equal(expected.protocol,'https:','De CI-compileproef gebruikt uitsluitend een expliciete HTTPS-backend');
const manifest=JSON.parse(readFileSync('dist/native/build.json','utf8'));
assert.equal(manifest.profile,'local-development');assert.equal(manifest.releaseApproved,false);
assert.equal(manifest.apiOrigin,expected.origin);assert.equal(manifest.apiVersion,1);
const config=JSON.parse(readFileSync(join(root,'capacitor.config.json'),'utf8'));
assert.equal(config.appId,'app.versado.app');assert.equal(config.server?.url,undefined,'Alle clientcode moet lokaal gebundeld zijn');
const digest=value=>createHash('sha256').update(value).digest('hex');
for(const file of ['index.html','index.js','index.css','build.json']){
  assert.equal(digest(readFileSync(join(root,'public',file))),digest(readFileSync(join('dist/native',file))),`${platform}: ${file} wijkt af van de lokale bundel`);
}
console.log(`${platform}: verpakte development-assets gelijk aan dist/native; release niet goedgekeurd.`);
