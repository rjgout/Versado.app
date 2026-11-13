/** De bestaande accountwisselproeven volgen nu ook de gedeelde logoutbevestiging.
 * De expliciete oude-backendproeven blijven hun oorspronkelijke pad controleren. */
export async function logoutNativeProfile(page,t){
 const shared=await page.locator('[data-profile-page]').count()>0;
 await page.getByRole('button',{name:t(shared?'profile.logout':'nativeFoundation.logout'),exact:true}).click();
 if(shared)await page.getByRole('dialog').getByRole('button',{name:t('profile.logoutYes'),exact:true}).click();
}
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** De nieuwe gedeelde profielbeelden komen ook in bestaande browserharnassen
 * uit de verpakte bundel; een ontbrekend bestand krijgt geen public-fallback. */
export function serveNativeProfileAsset(pathname,res){
 if(!['/native-profile/','/native-artwork/'].some(prefix=>pathname.startsWith(prefix)))return false;
 const root=resolve('dist/native'),path=resolve(root,`.${pathname}`);
 if(!path.startsWith(root+'/')){res.writeHead(404);res.end();return true;}
 try{const bytes=readFileSync(path);res.setHeader('Content-Type','image/webp');res.end(bytes);}
 catch{res.writeHead(404);res.end();}
 return true;
}
