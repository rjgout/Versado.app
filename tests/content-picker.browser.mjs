// Echte productie-UI op de bestaande eigen layout-testdatabase; geen productieaccount.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { prisma } from '../src/lib/db.ts';
import { createSessionToken,SESSION_COOKIE } from '../src/lib/auth.ts';
import { getT } from '../src/lib/i18n/index.ts';
const db = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? 'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_layout_test'||process.env.DATABASE_URL!==db.href) throw new Error('Uitsluitend eigen layout-runner');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base=process.env.LAYOUT_TEST_BASE_URL ?? 'http://localhost:3110';
const output=process.env.LAYOUT_TEST_OUTPUT ?? '/tmp/versado-layout-browser';
mkdirSync(output,{recursive:true});
const results=[];
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});
let context,page;
try {
  // Alleen metadata/zichtbaarheidsfixtures in deze wegwerpdatabase.
  // De OTB-collecties ontstaan via import, niet via schema-migraties.
  // Alle 21 geverifieerde identiteiten als synthetische metadatafixture opbouwen.
  const catalog=JSON.parse(readFileSync('tests/fixtures/content-1a-catalog.json','utf8'));
  for(const c of catalog.collections) {
    const title=c.work==='old-testament'?'Oude Testament':c.work==='new-testament'?'Nieuwe Testament':c.id;
    await prisma.contentCollection.upsert({where:{id:c.id},create:{...c,name:title,icon:'',enabled:true,visibleToUsers:true,publicationState:'LEGACY'},update:{enabled:true,visibleToUsers:true}});
  }
  await prisma.contentCollection.updateMany({data:{enabled:true,visibleToUsers:true}});
  await prisma.contentSwitcherSettings.upsert({where:{id:'singleton'},create:{enabled:true},update:{enabled:true}});
  for(const [collectionId,key] of [['content_bom','picker/bofm/1-ne'],['content_dc','picker/dc-testament/dc'],[catalog.collections.find(c=>c.work==='old-testament'&&c.language==='nl').id,'picker/old-testament/gen']]) {
    const book=await prisma.book.create({data:{slug:`picker-${randomUUID()}`,key,name:'Synthetisch boek',order:1,contentCollectionId:collectionId}});
    const chapter=await prisma.chapter.create({data:{bookId:book.id,number:1,order:1,verses:{create:{number:1,text:'Synthetische tekst voor de browsercontrole.'}}}});
    await prisma.course.create({data:{slug:`picker-${randomUUID()}`,name:'Vrije keuze',type:'FREE_CHOICE',contentCollectionId:collectionId,chapters:{create:{chapterId:chapter.id,order:1}}}});
  }
  const user=await prisma.user.create({data:{email:`${randomUUID()}@picker-browser.test.invalid`,handle:'Picker',discriminator:'00',passwordHash:'synthetic',activeContentCollectionId:'content_bom',contentLanguage:'nl',uiLanguage:'nl',hintBalance:8,xpTotal:100,currentStreak:0,onboardingSeenAt:new Date(),onboardingProfilePrivacyAt:new Date(),avatarCharacterId:'nephi',kompasOffersEnabled:false,timeZone:'UTC'}});
  const fsy=await prisma.fsyLesson.create({data:{contentCollectionId:'content_fsy',year:2026,month:10,category:'TEST',slug:`test-${randomUUID()}`,title:'Synthetische les',content:'[]',images:'[]',sourceUrl:`https://test.invalid/${randomUUID()}`,sourceHash:'test',status:'PUBLISHED',publishedContent:'[{"type":"paragraph","text":"Synthetische publicatie"}]'}});
  const study=await prisma.userStudyContext.create({data:{userId:user.id,workKey:'fsy',activeLessonKey:`fsy:${fsy.id}`,lastActionId:randomUUID()}});
  const cookie=await createSessionToken(user.id);
  const names=Object.fromEntries((await prisma.contentCollection.findMany({where:{language:'nl'},select:{work:true,name:true}})).map(c=>[c.work,c.name]));
  const errors=[];
  async function fresh(width,height,scheme='light') {
    await context?.close();
    context=await browser.newContext({viewport:{width,height},colorScheme:scheme,isMobile:width<=430||height===390,hasTouch:width<1024,serviceWorkers:'block'});
    await context.addCookies([{name:SESSION_COOKIE,value:cookie,url:base}]);
    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  }
  async function ready(path) { await page.goto(`${base}${path}`);await page.waitForFunction(()=>document.querySelector('html').style.getPropertyValue('--header-height'));await page.evaluate(()=>document.fonts.ready); }
  async function shell() {
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-sticky-header]').getBoundingClientRect().height-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')))<1);
    const state=await page.evaluate(()=>{
      const h=document.querySelector('[data-sticky-header]').getBoundingClientRect();
      const p=document.querySelector('[data-content-picker]');
      const title=p.querySelector('h1').getBoundingClientRect();
      return {top:title.top,headerBottom:h.bottom,headerPosition:getComputedStyle(document.querySelector('[data-sticky-header]')).position,nav:getComputedStyle(document.querySelector('[data-main-nav]')).display,global:getComputedStyle(document.querySelector('[data-app-global-header]')).display,overflow:document.documentElement.scrollWidth>innerWidth+1,groups:document.querySelectorAll('[data-content-group]').length,focused:document.activeElement===p.querySelector('h1')};
    });
    assert.equal(state.global,'none');assert.equal(state.nav,'none');assert.equal(state.groups,2);assert.equal(state.overflow,false);assert.ok(state.top>=state.headerBottom-1);assert.ok(state.focused);
    return state;
  }
  const interactionsOnly=process.argv.includes('--interactions-only');
  const views=[[320,844],[375,844],[390,844],[430,932],[768,1024],[1280,900],[844,390]];
  for(const [width,height] of (interactionsOnly?[]:views))for(const scheme of ['light','dark'])for(const font of [100,200]) {
    await fresh(width,height,scheme);await ready('/dashboard');
    await page.evaluate(font=>{document.documentElement.style.fontSize=`${font===200?32:16}px`;document.documentElement.style.setProperty('--safe-area-inset-top','20px');document.documentElement.style.setProperty('--safe-area-inset-bottom','20px');document.documentElement.style.setProperty('--safe-area-inset-left','12px');document.documentElement.style.setProperty('--safe-area-inset-right','12px');},font);
    await page.locator('[data-kompas-target="content-switcher"] a').click();await page.waitForURL(`${base}/content`);await page.locator('[data-content-picker]').waitFor();
    const state=await shell();
    assert.ok(await page.evaluate(()=>document.querySelector('[data-content-language]').getBoundingClientRect().top>=document.querySelector('[data-content-group=studyPrograms]').getBoundingClientRect().bottom),'Taal volgt beide brongroepen');
    assert.equal(await page.locator('[data-content-menu]').count(),0);
    assert.equal(await page.locator('[data-content-picker] details, [data-content-picker] summary').count(),0);
    assert.equal(await page.locator('[data-content-picker] a').count(),0,'Geen beheerlinks voor gewone gebruikers');
    assert.equal(await page.locator('[data-admin-hymns-link]').count(),0,'Proef niet zichtbaar voor gewone gebruikers');
    assert.ok(!(await page.locator('[data-content-work]').allTextContents()).some(text=>text.includes('Beschikbaar in ')));
    const chips=await page.locator('[data-content-language] button').evaluateAll(buttons=>buttons.map(button=>({name:button.textContent,height:button.getBoundingClientRect().height,width:button.clientWidth,scrollWidth:button.scrollWidth,overflow:button.scrollWidth>button.clientWidth+1})));
    for(const chip of chips){assert.ok(chip.height>=44);assert.equal(chip.overflow,false,`${width}/${font}: taalchip blijft leesbaar zonder clipping: ${JSON.stringify(chip)}`);}
    if(width===390&&font===100){
      assert.ok((await page.locator('[data-content-language]').boundingBox()).height<=190,'Taalblok is compact');
      assert.ok((await page.locator('[data-content-work="bofm"]').boundingBox()).height<=140,'Bronkaart is compact');
    }
    assert.equal(await page.locator('[data-content-work="podcasts"]').getAttribute('data-content-kind'),'OTHER');
    assert.equal(await page.locator('[data-content-group="studyPrograms"] [data-content-work="podcasts"]').count(),1);
    assert.equal(await page.locator('[data-content-work="bofm"] > button').getAttribute('aria-pressed'),'true');
    if(font===200)assert.equal(await page.locator('[data-content-group="scriptures"] > div').evaluate(el=>getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length),1,'Grote tekst gebruikt één leesbare kaartkolom');
    const cards=await page.locator('[data-content-work] > button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return{left:r.left,right:r.right,height:r.height};}));
    for(const card of cards) {assert.ok(card.left>=0&&card.right<=width+1);assert.ok(card.height>=44);}
    const tag=`${width}x${height}-${scheme}-${font}`;
    await page.screenshot({path:`${output}/content-picker-${tag}.png`,fullPage:true});
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    const tail=await page.locator('[data-content-language]').evaluate(el=>{const r=el.getBoundingClientRect();return{bottom:r.bottom,visible:r.top<innerHeight};});assert.ok(tail.visible&&tail.bottom<=height+1);
    results.push({tag,...state,cards:cards.length});
    await page.locator('[data-subpage-back-bar] button').click();await page.waitForURL(`${base}/dashboard`);
  }
  // Bredere fontmetingen (zoals op de CI-host): vinkje mag ombreken, het woord niet.
  if(!interactionsOnly) {
    await fresh(320,844);await ready('/content');
    await page.evaluate(()=>document.documentElement.style.fontSize='32px');
    const selectedChip=page.locator('[data-content-language] button[aria-pressed="true"]');
    await selectedChip.evaluate(el=>el.style.letterSpacing='0.03em');
    assert.ok(await selectedChip.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Brede letters mogen niet worden afgekapt');
    await page.screenshot({path:`${output}/content-picker-320x844-wide-font-200.png`,fullPage:true});
  }
  // Alle vijf interfacetalen blijven onafhankelijk van de Nederlandse bron.
  for(const language of (interactionsOnly?[]:['nl','en','de','fr','es'])) {
    await prisma.user.update({where:{id:user.id},data:{uiLanguage:language,activeContentCollectionId:'content_fsy',contentLanguage:'nl'}});
    await fresh(320,844);await ready('/content');await page.evaluate(()=>document.documentElement.style.fontSize='32px');
    await shell();const title=getT(language)('contentSwitcher.picker.title');
    assert.equal(await page.locator('[data-content-picker] h1').textContent(),title);
    assert.ok((await page.locator('[data-content-work="fsy"] > button').textContent()).includes(names.fsy));
    await page.screenshot({path:`${output}/content-picker-language-${language}-320-200.png`,fullPage:true});
  }
  await prisma.user.update({where:{id:user.id},data:{uiLanguage:'nl',activeContentCollectionId:'content_bom',contentLanguage:'nl'}});
  await fresh(390,844);
  // Een echte vertrekroute en scrollpositie blijven behouden bij terug/vooruit.
  for(const path of ['/dashboard','/courses','/live']) {
    await ready(path);await page.evaluate(()=>scrollTo(0,Math.min(180,document.documentElement.scrollHeight-innerHeight)));
    await page.locator('[data-kompas-target="content-switcher"] a').evaluate(el=>el.addEventListener('click',()=>{window.__pickerLeaveScroll=scrollY;},{once:true,capture:true}));
    const withoutPresence=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['lastSeenAt','onlineSocketCount'].includes(key)));
    const before=withoutPresence(await prisma.user.findUniqueOrThrow({where:{id:user.id}}));
    await page.locator('[data-kompas-target="content-switcher"] a').click();await page.waitForURL(`${base}/content`);await shell();
    const beforeScroll=await page.evaluate(()=>window.__pickerLeaveScroll);
    await page.locator('[data-subpage-back-bar] button').click();await page.waitForURL(`${base}${path}`);
    await page.waitForFunction(y=>Math.abs(scrollY-y)<2,beforeScroll).catch(async error=>{console.error('Scrollbewijs',await page.evaluate(expected=>({expected,actual:scrollY,path:location.pathname,height:document.documentElement.scrollHeight,current:window.navigation?.currentEntry?.key,positions:JSON.parse(sessionStorage.getItem('vs-scroll-positions')??'[]').slice(-8)}),beforeScroll));throw error;});
    assert.deepEqual(withoutPresence(await prisma.user.findUniqueOrThrow({where:{id:user.id}})),before);
    await page.goForward();await page.waitForURL(`${base}/content`);await page.locator('[data-content-picker]').waitFor();
    const selected=page.locator('[data-content-work="dc-testament"] > button');
    const saved=page.waitForResponse(r=>r.url().includes('/api/content-context')&&r.request().method()==='PUT');
    await selected.tap();assert.equal((await saved).status(),200);await page.waitForURL(`${base}${path}`);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,'content_dc');
    await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:'content_bom',contentLanguage:'nl'}});
  }
  // Direct openen krijgt een semantische fallback; toetsenbordselectie blijft een gewone knop.
  await ready('/content');await shell();
  await page.locator('[data-content-work="bofm"] > button').focus();await page.keyboard.press('Enter');await page.waitForURL(`${base}/dashboard`);
  await ready('/content');await page.locator('[data-content-work="dc-testament"] > button').focus();await page.keyboard.press('Space');await page.waitForURL(`${base}/dashboard`);
  await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:'content_bom',contentLanguage:'nl'}});
  await ready('/dashboard');await page.locator('[data-kompas-target="content-switcher"] a').click();await page.waitForURL(`${base}/content`);
  await page.getByRole('button',{name:'English',exact:true}).click();await page.waitForURL(`${base}/dashboard`);
  const english=await prisma.user.findUniqueOrThrow({where:{id:user.id}});assert.equal(english.contentLanguage,'en');assert.equal(english.uiLanguage,'nl');assert.equal(english.activeContentCollectionId,'content_bom_en');
  // Een bron zonder gekozen taal krijgt geen onverwachte taalfallback of mutatie.
  await ready('/content');let missingWrites=0;
  const countMissing=request=>{if(request.url().endsWith('/api/content-context')&&request.method()==='PUT')missingWrites++;};page.on('request',countMissing);
  await page.locator('[data-content-work="fsy"] > button').focus();await page.keyboard.press('Enter');
  await page.locator('[data-content-picker]').getByRole('alert').waitFor();assert.equal(missingWrites,0);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,'content_bom_en');page.off('request',countMissing);
  // Netwerkfout: geen optimistische bron, actuele data opnieuw ophalen en focus niet verliezen.
  await ready('/content');
  await page.route('**/api/content-context',async route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic"}'}):route.continue());
  const target=page.locator('[data-content-work="dc-testament"] > button');await target.focus();await page.keyboard.press('Enter');await page.locator('[data-content-picker]').getByRole('alert').waitFor();
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,'content_bom_en');
  assert.ok(await target.evaluate(el=>document.activeElement===el));await page.unroute('**/api/content-context');
  // Dubbel tikken tijdens een vertraagde request gebruikt één centrale selectieflow.
  let writes=0;await page.route('**/api/content-context',async route=>{if(route.request().method()==='PUT'){writes++;await new Promise(resolve=>setTimeout(resolve,250));}await route.continue();});
  await target.evaluate(el=>{el.click();el.click();});await page.waitForURL(`${base}/dashboard`);assert.equal(writes,1);await page.unroute('**/api/content-context');
  // Een laat antwoord mag de gebruiker na terugnavigeren niet naar het oude doel sturen.
  await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:'content_bom',contentLanguage:'nl'}});
  await ready('/profile');await page.locator('[data-kompas-target="content-switcher"] a').click();await page.waitForURL(`${base}/content`);
  await page.route('**/api/content-context',async route=>{if(route.request().method()==='PUT'){const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({response});}else await route.continue();});
  await page.locator('[data-content-work="dc-testament"] > button').click();await page.locator('[data-subpage-back-bar] button').click();await page.waitForURL(`${base}/profile`);
  await page.waitForTimeout(700);assert.equal(new URL(page.url()).pathname,'/profile');await page.unroute('**/api/content-context');
  assert.equal(await page.locator('[data-kompas-target="content-switcher"] a').getAttribute('title'),names['dc-testament'],'Header volgt de daadwerkelijk gecommitte bron, ook na een laat antwoord');
  // Een nieuwere keuze vanaf een tweede apparaat wint van een oud vertraagd antwoord.
  await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:'content_bom',contentLanguage:'nl'}});
  await ready('/content');
  await page.route('**/api/content-context',async route=>{
    if(route.request().method()==='PUT') {
      const response=await route.fetch();
      const current=await (await page.request.get(`${base}/api/content-context?view=picker`)).json();
      const newer=await page.request.put(`${base}/api/content-context`,{headers:{Origin:base},data:{picker:true,contentCollectionId:'content_bom',expectedSelection:current.selection,location:{pathname:'/dashboard',search:''}}});
      assert.equal(newer.status(),200);await route.fulfill({response});
    } else await route.continue();
  });
  await page.locator('[data-content-work="dc-testament"] > button').click();await page.locator('[data-content-picker]').getByRole('alert').waitFor();
  assert.equal(new URL(page.url()).pathname,'/content');assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,'content_bom');
  await page.unroute('**/api/content-context');
  // Een ontbrekende taal is uitlegbaar en schrijft niets; een andere familie is expliciet.
  await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:'content_fsy',contentLanguage:'nl'}});
  await ready('/content');let invalidWrites=0;
  page.on('request',request=>{if(request.url().endsWith('/api/content-context')&&request.method()==='PUT')invalidWrites++;});
  await page.getByRole('button',{name:'English',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('[data-content-picker]').getByRole('alert').waitFor();assert.equal(invalidWrites,0);
  await prisma.contentCollection.create({data:{id:'picker_other_edition',slug:'picker-other-edition',name:'Andere uitgave',icon:'',work:'bofm',editionKey:'explicit-other',language:'en',enabled:true,visibleToUsers:true,publicationState:'PUBLISHED'}});
  await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:'content_dc_en',contentLanguage:'en'}});
  await ready('/content');const beforeEdition=(await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId;
  await page.locator('[data-content-work="bofm"] > button').click();
  const editionChoice=page.locator('[data-content-edition-choice] select');await editionChoice.waitFor();
  assert.ok(await editionChoice.evaluate(el=>el===document.activeElement));assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,beforeEdition);
  assert.equal(await page.locator('[data-content-work] select, [data-content-work] details').count(),0,'Geen editievelden per kaart');
  await editionChoice.selectOption('picker_other_edition');await page.waitForURL(`${base}/dashboard`);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,'picker_other_edition');
  assert.deepEqual(await prisma.userStudyContext.findUniqueOrThrow({where:{userId_workKey:{userId:user.id,workKey:'fsy'}}}),study);
  const final=await prisma.user.findUniqueOrThrow({where:{id:user.id}});assert.equal(final.xpTotal,100);assert.equal(final.hintBalance,8);assert.equal(final.currentStreak,0);
  // Gerenderde beschikbaarheid: gewone keuze krijgt geen verborgen/conceptbron.
  const flags=await prisma.contentCollection.findMany({select:{id:true,enabled:true,visibleToUsers:true,publicationState:true}});
  try {
    await prisma.contentCollection.updateMany({where:{work:'old-testament'},data:{visibleToUsers:false}});
    await prisma.contentCollection.updateMany({where:{work:'pgp'},data:{enabled:false}});
    await prisma.contentCollection.updateMany({where:{work:'fsy'},data:{publicationState:'DRAFT'}});
    await ready('/content');assert.equal(await page.locator('[data-content-work="old-testament"]').count(),0);assert.equal(await page.locator('[data-content-work="pgp"]').count(),0);assert.equal(await page.locator('[data-content-work="fsy"]').count(),0);
    await prisma.user.update({where:{id:user.id},data:{isAdmin:true}});
    await ready('/content');assert.equal(await page.locator('[data-content-work="old-testament"]').count(),0,'Ook admins krijgen een publieke kiezer zonder verborgen bronnen');
    assert.equal(await page.locator('[data-content-picker] a').count(),2);
    assert.equal(await page.locator('[data-admin-content-link]').getAttribute('href'),'/adminbackend/content/inspect');
    assert.equal(await page.locator('[data-admin-hymns-link]').getAttribute('href'),'/dev/lofzangen');
    await page.locator('[data-admin-hymns-link]').click();await page.waitForURL(`${base}/dev/lofzangen`);
    assert.equal(await page.locator('h1').filter({hasText:'Lofzangen, technische proef'}).count(),1);
    await ready('/content');
    assert.ok(await page.locator('[data-admin-content-link]').evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('[data-content-language]').getBoundingClientRect().bottom));
    const adminSelection=()=>prisma.user.findUniqueOrThrow({where:{id:user.id},select:{activeContentCollectionId:true,contentLanguage:true,activeCourseId:true,xpTotal:true,hintBalance:true,currentStreak:true}});
    const adminBefore=await adminSelection();
    for(const [width,height] of [[320,844],[390,844],[768,1024],[1280,900],[844,390]])for(const dark of [false,true])for(const scale of [16,32]) {
      await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});
      await ready('/adminbackend/content/inspect');await page.locator('[data-admin-content-inspection]').waitFor();
      await page.evaluate(({scale,dark})=>{document.documentElement.style.fontSize=`${scale}px`;document.documentElement.classList.toggle('dark',dark);},{scale,dark});
      assert.equal(await page.locator('[data-admin-content-inspection] details').count(),await prisma.contentCollection.count());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Beheerkiezer zonder overflow');
      assert.ok(await page.locator('[data-main-nav]').evaluate(el=>{const rect=el.getBoundingClientRect();return getComputedStyle(el).display==='none'||(getComputedStyle(el).position==='fixed'&&Math.abs(rect.bottom-innerHeight)<2);}), 'Beheeronderbalk blijft onderaan de viewport');
      await page.screenshot({path:`${output}/admin-content-${width}x${height}-${dark?'dark':'light'}-${scale===32?200:100}.png`,fullPage:true});
      results.push({tag:`admin-${width}x${height}-${dark}-${scale}`,admin:true});
    }
    for(const lang of ['nl','en','de','fr','es']) {
      await prisma.user.update({where:{id:user.id},data:{uiLanguage:lang}});await page.setViewportSize({width:320,height:844});
      await ready('/adminbackend/content/inspect');await page.evaluate(()=>document.documentElement.style.fontSize='32px');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Beheerlabels ${lang} op 320/200%`);
    }
    await prisma.user.update({where:{id:user.id},data:{uiLanguage:'nl'}});await ready('/adminbackend/content/inspect');
    await page.locator('[data-admin-content-inspection] select').nth(0).selectOption('old-testament');
    assert.equal(await page.locator('[data-admin-content-inspection] details').count(),5);
    await page.locator('[data-admin-content-inspection] select').nth(2).selectOption('nl');
    assert.equal(await page.locator('[data-admin-content-inspection] details').count(),1);
    await page.getByRole('link',{name:'Open preview',exact:true}).click();await page.waitForURL(/content-preview/);await page.locator('[data-subpage-back-bar]').waitFor();
    assert.equal(await page.locator('main button').filter({hasText:'Markeren als gelezen'}).count(),0);
    assert.deepEqual(await adminSelection(),adminBefore,'Inspectie en preview wijzigen geen voorkeur of beloning');
    await ready('/content');
    const hidden=await prisma.contentCollection.findFirstOrThrow({where:{work:'old-testament',language:'nl'}});
    const own=(await (await page.request.get(`${base}/api/content-context?view=picker`)).json()).selection;
    const denied=await page.request.put(`${base}/api/content-context`,{headers:{Origin:base},data:{picker:true,contentCollectionId:hidden.id,expectedSelection:own}});assert.equal(denied.status(),404);
    assert.equal(await page.locator('[data-content-work="fsy"]').count(),0);
    await prisma.user.update({where:{id:user.id},data:{isAdmin:false}});
    await prisma.contentCollection.updateMany({data:{enabled:false}});
    const preserved=await prisma.user.findUniqueOrThrow({where:{id:user.id}});
    await ready('/content');assert.equal(await page.locator('[data-content-work]').count(),0);assert.equal(await page.locator('[data-content-group]').count(),2);
    assert.equal(await page.locator('[data-admin-hymns-link]').count(),0);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,preserved.activeContentCollectionId);
  } finally {
    await prisma.user.update({where:{id:user.id},data:{isAdmin:false}});
    for(const flag of flags)await prisma.contentCollection.update({where:{id:flag.id},data:{enabled:flag.enabled,visibleToUsers:flag.visibleToUsers,publicationState:flag.publicationState}});
  }
  // Anoniem: de bestaande loginconventie.
  await context.close();context=await browser.newContext();page=await context.newPage();await page.goto(`${base}/content`);assert.equal(new URL(page.url()).pathname,'/login');
  assert.deepEqual(errors,[]);
  writeFileSync(`${output}/content-picker-results.json`,JSON.stringify({matrix:results,uiLanguages:5,realNavigation:true,scrollRestore:true,doubleClick:true,lateResponse:true,noProgressRewards:true,compactCards:true,noCardAccordions:true,noPreviewButtons:true,strictCardLanguage:true},null,2));
  console.log(`Fullscreen contentkiezer: ${results.length} viewport/thema/tekstcombinaties, vijf talen, touch/toetsenbord, route-/scrollherstel, fouten en vertraagde antwoorden geslaagd.`);
} catch(error) {
  if(page){await page.screenshot({path:`${output}/content-picker-failure.png`,fullPage:true});writeFileSync(`${output}/content-picker-failure.html`,await page.content());}
  console.error(error);process.exitCode=1;
} finally {await browser.close();await prisma.$disconnect();}
