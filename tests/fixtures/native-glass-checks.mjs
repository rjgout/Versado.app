import assert from 'node:assert/strict';

export async function checkGlassShell(page) {
  await page.waitForFunction(()=>document.documentElement.dataset.vsMaterial==='glass'&&document.documentElement.dataset.vsReduceTransparency==='false');
  await page.waitForFunction(()=>{const nav=document.querySelector('[data-main-nav]');return Math.abs((nav?.getBoundingClientRect().height??0)-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')))<2;});
  const geometry=await page.evaluate(()=>{
    const nav=document.querySelector('[data-main-nav]');
    const panel=nav?.querySelector('[data-vs-surface="navigation"]');
    return {height:nav?.getBoundingClientRect().height??0,reserved:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')),
      filteredCards:[...document.querySelectorAll('[data-vs-surface="card"],.vs-material-card')].filter(el=>getComputedStyle(el).backdropFilter!=='none').length,
      panel:panel?{left:panel.getBoundingClientRect().left,right:panel.getBoundingClientRect().right}:null};
  });
  assert.equal(geometry.filteredCards,0,'Scrollende kaarten maken geen extra blur-lagen');
  assert.ok(Math.abs(geometry.height-geometry.reserved)<2,'De bestaande shell reserveert ook de zwevende navigatieruimte');
  if(geometry.height>0){assert.ok(geometry.panel.left>=0);assert.ok(geometry.panel.right<=await page.evaluate(()=>innerWidth));}
}

/** Echte UI, uitsluitend de UIKit-voorkeurgrens is gesimuleerd.
 * Viewportverkleining modelleert toetsenbordgeometrie; geen fysieke IME-/VoiceOver-claim. */
export async function checkGlassAccessibility(page,t,out) {
  const preferences={version:1,reduceTransparency:false,reduceMotion:false,increaseContrast:false,fontScale:1};
  const set=async patch=>{await page.evaluate(value=>window.dispatchEvent(new CustomEvent('glass:test-preferences',{detail:value})),{...preferences,...patch});};
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{document.documentElement.style.removeProperty('font-size');document.documentElement.style.setProperty('--safe-area-inset-bottom','18px');document.documentElement.style.setProperty('--safe-area-inset-top','24px');});
  await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-app-global-header]')).backdropFilter),'none');
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
  await set({reduceTransparency:true,reduceMotion:true,increaseContrast:true});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-app-global-header]')).backdropFilter==='none');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-app-global-header]')).backgroundColor.includes('rgba')),false);
  assert.ok(await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('[data-vs-surface="card"]')).transitionDuration)<.001));
  await page.screenshot({path:`${out}/native-nl-reduced-transparency.png`,fullPage:false});
  await set({reduceMotion:true,fontScale:2});
  await page.setViewportSize({width:320,height:844});
  await page.waitForFunction(()=>parseFloat(getComputedStyle(document.documentElement).fontSize)===32&&document.documentElement.hasAttribute('data-text-large'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Dynamic Type 200% behoudt de viewport');
  await page.getByRole('button',{name:t('profile.logout'),exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.ok(await dialog.getAttribute('aria-labelledby'));
  assert.equal(await dialog.evaluate(el=>el.matches(':modal')),true,'De native profielbevestiging gebruikt de bestaande top-layer dialoog');
  assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'De dialoog houdt lange teksten binnen het paneel');
  for(let i=0;i<4;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,'Dialoog behoudt toetsenbordfocus');}
  await page.screenshot({path:`${out}/native-nl-glass-sheet-200.png`,fullPage:false});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await set({reduceMotion:true,fontScale:3.1});
  await page.waitForFunction(()=>parseFloat(getComputedStyle(document.documentElement).fontSize)>49);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Ook een grote toegankelijkheidscategorie behoudt de viewport');
  const clipped=await page.locator('[data-app-global-header] :is(a,button,[role="img"])').evaluateAll(nodes=>nodes.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth+1);}).map(el=>({text:el.textContent,right:el.getBoundingClientRect().right})));
  assert.deepEqual(clipped,[],'Ook de zichtbare headerbediening blijft binnen de viewport bij Dynamic Type');
  const labelLines=await page.locator('[data-main-nav] a').evaluateAll(links=>links.flatMap(link=>[...link.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim()).map(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length;})));
  assert.ok(labelLines.length>0&&labelLines.every(lines=>lines===1),'Korte Nederlandse tablabels blijven hele woorden bij grote systeemtekst');
  await page.getByRole('button',{name:t('profile.logout'),exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/native-nl-dynamic-type-310.png`,fullPage:false});
  await page.evaluate(()=>{window.__glassOriginalShowModal=HTMLDialogElement.prototype.showModal;HTMLDialogElement.prototype.showModal=undefined;});
  try{
    await page.getByRole('button',{name:t('profile.logout'),exact:true}).click();
    const legacy=page.getByRole('dialog');await legacy.waitFor();
    assert.equal(await legacy.evaluate(el=>el.tagName),'DIV','iOS zonder showModal behoudt een bruikbare bevestiging');
    const oldWebKitFocus=await legacy.evaluate(el=>{
      const at=Array.prototype.at,buttons=el.querySelectorAll('button');
      const first=buttons[0],last=buttons[buttons.length-1];
      try{
        Array.prototype.at=undefined;
        first.focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
        const backward=document.activeElement===last;
        last.focus();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
        return {backward,forward:document.activeElement===first};
      }finally{Array.prototype.at=at;}
    });
    assert.deepEqual(oldWebKitFocus,{backward:true,forward:true},'Ook zonder Array.at (oude WebKit) werkt de compatibiliteitsfocusgrens in beide richtingen');
    for(let i=0;i<4;i++){await page.keyboard.press('Tab');assert.equal(await legacy.evaluate(el=>el.contains(document.activeElement)),true,'Ook de compatibiliteitsdialoog houdt de focus binnen');}
    assert.equal(await legacy.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'Ook de compatibiliteitsdialoog houdt grote tekst binnen het paneel');
    await page.screenshot({path:`${out}/native-nl-compatible-sheet-large.png`,fullPage:false});
    await page.keyboard.press('Escape');await legacy.waitFor({state:'detached'});
  }finally{await page.evaluate(()=>{HTMLDialogElement.prototype.showModal=window.__glassOriginalShowModal;delete window.__glassOriginalShowModal;});}
  await set({});await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:t('profile.changeHandle'),exact:true}).click();
  const input=page.getByRole('textbox',{name:t('profile.changeHandle'),exact:true});await input.focus();
  await page.setViewportSize({width:390,height:500});
  await page.waitForFunction(()=>document.documentElement.hasAttribute('data-keyboard'));
  assert.equal(await page.locator('[data-main-nav]').isVisible(),false,'De zwevende tabbar volgt de bestaande toetsenbordregel');
  await input.scrollIntoViewIfNeeded();
  assert.ok(await input.evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),'Het invoerveld blijft bereikbaar boven de gemodelleerde keyboardrand');
  await page.screenshot({path:`${out}/native-nl-keyboard-geometry.png`,fullPage:false});
  await page.setViewportSize({width:390,height:844});await input.blur();
  await page.getByRole('button',{name:t('activeGames.cancel'),exact:true}).click();
  await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-keyboard'));
  await checkGlassShell(page);
  console.log('Liquid Glass: UIKit-voorkeurprotocol, ondoorzichtig contrast, reduced motion, Dynamic Type 200%, focusval/Escape en keyboardgeometrie geslaagd. Geen fysieke acceptatie.');
}

export async function checkGlassPalette(page,scheme) {
  await page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,scheme==='dark');
  const value=await page.locator('[data-app-global-header]').evaluate(el=>{const style=getComputedStyle(el),body=getComputedStyle(document.body);return {expected:style.getPropertyValue('--vs-glass-tint').trim().split(/\s+/).map(Number),actual:(style.backgroundColor.match(/[.0-9]+/g)??[]).map(Number),bodyExpected:style.getPropertyValue('--vs-app').trim().split(/\s+/).map(Number),bodyActual:(body.backgroundColor.match(/[.0-9]+/g)??[]).map(Number)};});
  for(let i=0;i<3;i++){assert.ok(Math.abs(value.expected[i]-value.actual[i])<1,'Een paletwissel veroorzaakt geen contrastrijke kleurcrossfade');assert.ok(Math.abs(value.bodyExpected[i]-value.bodyActual[i])<1,'Ook het canvas wisselt atomisch van palet');}
}
