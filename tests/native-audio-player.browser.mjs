import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright'),out='/tmp/versado-native-audio-player-browser';mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['tests/fixtures/native-audio/player-client.tsx'],bundle:true,write:false,minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}}),css=readFileSync('dist/native/index.css');
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css);}else if(req.url?.includes('audio-languages')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({editions:[{language:'nl',url:null,verses:[{number:2,text:'Synthetische tekst voor de gedeelde lezer.'},{number:3,text:'Dit vers schrijft geen voortgang door audio.'}]}]}));}else{res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??undefined,headless:true,args:['--no-sandbox']});
try{
 for(const language of ['nl','en','de','fr','es'])for(const mode of ['recording','tts']){
  const page=await browser.newPage({viewport:{width:320,height:800},deviceScaleFactor:1});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('jehovaapp-read-aloud-voice','existing-web-Dutch-voice'));
  await page.goto(`http://127.0.0.1:${server.address().port}/?language=${language}&mode=${mode}&kind=steps`);await page.locator('[data-native-read-aloud] button.w-full:not(:disabled)').waitFor();
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.documentElement.classList.add('dark');});
  if(mode==='tts'){if(language==='nl'){await page.evaluate(()=>{document.documentElement.style.fontSize='100%';});await page.locator('#vers-2').hover();await page.mouse.wheel(0,5);await page.waitForTimeout(100);}await page.locator('[data-native-read-aloud] [role=combobox]').nth(1).click();if(language==='nl'){await page.getByRole('option').first().focus();await page.getByRole('option').first().hover();await page.mouse.wheel(0,10);await page.waitForTimeout(2700);assert.equal(await page.evaluate(()=>window.audioEvidence.positionWrites),0,'portaalkeuze is geen leesinteractie');}await page.getByRole('option').first().click();assert.equal(await page.evaluate(()=>localStorage.getItem('jehovaapp-read-aloud-voice')),'existing-web-Dutch-voice');assert.equal(await page.evaluate(language=>localStorage.getItem('jehovaapp-read-aloud-device-voice-'+language),language),language+'-local');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});}
  await page.locator('[data-native-read-aloud] button.w-full').click();await page.waitForFunction(()=>window.audioEvidence.commands.length===1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${language}/${mode} overflow`);
  assert.equal(await page.evaluate(()=>window.audioEvidence.commands[0].speed),1);
  assert.equal(await page.evaluate(()=>window.audioEvidence.commands[0].index),0);
  assert.equal(await page.evaluate(()=>window.audioEvidence.positionWrites),0);
  assert.deepEqual(await page.evaluate(()=>window.audioEvidence.postRoutes.map(path=>new URL(path).pathname)),['/api/v1/native/login']);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${out}/native-${language}-${mode}-320-200-dark.png`,fullPage:true});await page.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?platform=web&language=nl`);await page.locator('[data-scripture-reader]').waitFor();await page.screenshot({path:`${out}/web-nl-390-light.png`,fullPage:true});
 // Alleen spraakuitvoer gesimuleerd; de echte webprovider/mini blijft actief zonder native layoutmarker.
 await page.evaluate(()=>{window.speechSynthesis.speak=()=>{};});
 await page.locator('button.w-full:not(:disabled)').click();await page.locator('[data-read-aloud-mini-player]').waitFor();
 assert.equal(await page.locator('[data-read-aloud-mini-player]').getAttribute('data-shell-persistent-controls'),null,'Web houdt het bestaande tall-headerbeleid');
 await page.locator('[data-read-aloud-mini-player] button').last().click();

 await page.goto(`http://127.0.0.1:${server.address().port}/?language=nl`);await page.locator('[data-native-read-aloud] button.w-full:not(:disabled)').waitFor();await page.screenshot({path:`${out}/native-nl-390-light.png`,fullPage:true});
 await page.goto(`http://127.0.0.1:${server.address().port}/?mode=tts&voices=none`);await page.locator('[data-native-read-aloud] [role=status]').waitFor();assert.equal(await page.locator('[data-native-read-aloud] button.w-full').isDisabled(),true);assert.equal(await page.evaluate(()=>window.audioEvidence.commands.length),0);await page.close();
 const delayed=await browser.newPage({viewport:{width:390,height:844}});
 await delayed.goto(`http://127.0.0.1:${server.address().port}/?hold=1`);await delayed.locator('[data-native-read-aloud] button.w-full:not(:disabled)').click();await delayed.waitForFunction(()=>typeof window.releaseAudio==='function');
 assert.equal(await delayed.locator('header button[aria-busy=true]').isDisabled(),true);
 await delayed.locator('header button').last().click();await delayed.evaluate(()=>window.releaseAudio());await delayed.waitForTimeout(100);assert.equal(await delayed.evaluate(()=>window.audioEvidence.commands.length),0);await delayed.close();
 console.log('PASS: echte gedeelde speler/lezer/mini, 5 talen × opname/TTS, 320px/200% donker, geen voortgangswrite, ontbrekende stem, webpreview. OS-uitvoer gesimuleerd; geen fysieke acceptatie.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

// De oorspronkelijke componentproef blijft behouden; de echte shell is aanvullend verplicht.
await import("./native-audio-shell.browser.mjs");
