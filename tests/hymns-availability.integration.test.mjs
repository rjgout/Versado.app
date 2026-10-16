import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '../src/lib/db.ts';
import { referenceFixture, assertReferenceTestEnvironment } from './fixtures/reference-content.mjs';
const base=assertReferenceTestEnvironment();
after(()=>prisma.$disconnect());
const children=[];
after(()=>{for(const child of children)if(child.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}});
async function additionalServer(flag){
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const url=`http://127.0.0.1:${port}`;
 const child=spawn('node',['scripts/content-architecture/test-server.mjs'],{detached:true,env:{...process.env,CONTENT_ACCESS_TEST_BASE_URL:url,APP_URL:url,HYMNS_POC:flag},stdio:'inherit'});children.push(child);
 for(let i=0;i<90;i++){try{if((await fetch(url+'/api/health')).ok)return url;}catch{}if(child.exitCode!==null)throw Error('Testserver gestopt');await delay(300);}
 throw Error('Eigen testserver niet beschikbaar');
}
test('persistente activiteitinstelling, normale rechten, adminpreview, HTTP-cache, procesherstart en noodstop', async()=>{
 const f=await referenceFixture();
 const models=['user','contentCollection','userStudyContext','course','contentProgress','contentExerciseCredit','readingSession','activityFeedItem','studyLessonEdition','studyPublicationAction','note','bookmark','highlight'];
 const fingerprint=()=>Promise.all(models.map(async name=>createHash('sha256').update(JSON.stringify((await prisma[name].findMany()).map(r=>JSON.stringify(r)).sort())).digest('hex')));
 const before=await fingerprint();
 const settings=()=>prisma.contentSwitcherSettings.findUnique({where:{id:'singleton'}});
 const request=(pathname,who=f.owner,options={},origin=base)=>fetch(origin+pathname,{...options,headers:{...(who?{Cookie:who.cookie}:{}),...options.headers},redirect:'manual',cache:'no-store'});
 const put=(body,who=f.admin,origin=base)=>request('/api/admin/content-switcher',who,{method:'PUT',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 for(const who of [null,f.owner]){
  assert.equal((await request('/api/admin/content-switcher',who)).status,who?403:401);
  assert.equal((await put({activity:'hymns',visibleToUsers:true},who)).status,who?403:401);
 }
 const initial=await settings();assert.equal(initial.hymnsVisibleToUsers,false);
 const csrf=await request('/api/admin/content-switcher',f.admin,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://evil.invalid'},body:JSON.stringify({activity:'hymns',visibleToUsers:true})});assert.equal(csrf.status,403);
 assert.equal((await request('/api/admin/content-switcher',f.admin,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"activity":"hymns","visibleToUsers":true}'})).status,403);
 for(const body of [{activity:'hymns',visibleToUsers:true,isAdmin:true},{enabled:true,activity:'hymns',visibleToUsers:true},{activity:'unknown',visibleToUsers:true}])assert.equal((await put(body)).status,400);
 const paths=['/api/hymns/index','/api/hymns/82','/api/hymns/82/sheet','/api/hymns/recognition','/api/hymns/report'];
 async function matrix(origin,emergency=false){
  const visible=(await settings()).hymnsVisibleToUsers;
  for(const who of [null,f.owner,f.admin]){
   const allowed=!emergency&&Boolean(who)&&(who===f.admin||visible);
   const page=await request('/dev/lofzangen',who,{},origin);
   assert.equal(page.status,allowed?200:!who&&!emergency?307:404);
   for(const pathname of paths){const response=await request(pathname,who,{},origin);const expected=allowed&&(pathname!=='/api/hymns/report'||who===f.admin)?200:404;assert.equal(response.status,expected,`${pathname}: ${who?.user.isAdmin?'admin':who?'user':'anoniem'}`);assert.match(response.headers.get('cache-control')??'',/no-store/);if(response.ok)assert.match(response.headers.get('vary')??'',/Cookie/i);await response.arrayBuffer();}
   if(who){const picker=await (await request('/api/content-context?view=picker',who,{},origin)).json();assert.equal(picker.hymnsAvailable,allowed);}
  }
 }
 await matrix(base);
 assert.equal((await put({activity:'hymns',visibleToUsers:true})).status,200);
 assert.equal((await settings()).enabled,initial.enabled,'Algemene switcherinstelling blijft apart');
 await matrix(base);
 // Een aparte server heeft geen eerder geladen rechten-/modulecache.
 const restarted=await additionalServer('');await matrix(restarted);
 const stopped=await additionalServer('0');await matrix(stopped,true);
 const stoppedAdmin=await (await request('/api/admin/content-switcher',f.admin,{},stopped)).json();assert.equal(stoppedAdmin.hymnsTechnicallyAvailable,false);assert.equal(stoppedAdmin.hymnsVisibleToUsers,true);
 assert.equal((await put({enabled:false})).status,200);assert.equal((await settings()).hymnsVisibleToUsers,true);
 assert.equal((await put({enabled:initial.enabled})).status,200);
 assert.equal((await put({activity:'hymns',visibleToUsers:false})).status,200);await matrix(base);
 assert.deepEqual(await fingerprint(),before,'Alle bestaande bron-, voorkeur-, publicatie-, progressie- en economierijen blijven gelijk');
 const output='/tmp/versado-hymns-availability-browser';await fs.mkdir(output,{recursive:true});
 await fs.writeFile(output+'/integration-results.json',JSON.stringify({accessMatrix:'passed',endpoints:paths.length,processRestart:true,killSwitch:true,noPublicCache:true,preservedModels:models.length,productionTouched:false},null,2));
 await fs.writeFile(path.join(path.dirname(process.env.CONTENT_MIGRATION_TEST_STATE),'hymns-flow.json'),JSON.stringify({adminToken:f.admin.token,userToken:f.owner.token,userId:f.owner.user.id,adminId:f.admin.user.id}),{mode:0o600});
});
