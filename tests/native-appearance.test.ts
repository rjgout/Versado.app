import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { startNativeAppearance } from "../src/lib/native/appearance";

const normal = {version:1,reduceTransparency:false,reduceMotion:false,increaseContrast:false,fontScale:1};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(platform="ios") {
  const attributes = new Map<string,string>(), styles = new Map<string,string>();
  let event: (value:unknown)=>void = () => {}, removed=0;
  let resolveRead!: (value:unknown)=>void;
  const read = new Promise(resolve => {resolveRead=resolve;});
  const root = {getAttribute:(key:string)=>attributes.get(key)??null,setAttribute:(key:string,value:string)=>{attributes.set(key,value);},removeAttribute:(key:string)=>{attributes.delete(key);},style:{setProperty:(key:string,value:string)=>{styles.set(key,value);},getPropertyValue:(key:string)=>styles.get(key)??"",removeProperty:(key:string)=>{const old=styles.get(key)??"";styles.delete(key);return old;}}};
  const stop=startNativeAppearance({read:()=>read,listen:async callback=>{event=callback;return {remove:async()=>{removed++;}};}},{platform,root,onChange(){}});
  return {attributes,styles,stop,resolveRead,emit:(value:unknown)=>event(value),removed:()=>removed};
}
test("alleen iOS kiest materiaal; vóór bevestigde UIKit-voorkeuren is het ondoorzichtig",async()=>{
  const ios=fixture();assert.equal(ios.attributes.get("data-vs-material"),"glass");assert.equal(ios.attributes.get("data-vs-reduce-transparency"),"true");
  await flush();ios.resolveRead({...normal,fontScale:2});await flush();
  assert.equal(ios.attributes.get("data-vs-reduce-transparency"),"false");assert.equal(ios.styles.get("--vs-native-type-scale"),"2");ios.stop();await flush();assert.equal(ios.removed(),1);assert.equal(ios.attributes.size,0);assert.equal(ios.styles.size,0);
  for(const platform of ["web","android"]){const f=fixture(platform);await flush();f.resolveRead(normal);await flush();assert.equal(f.attributes.size,0);f.stop();assert.equal(f.removed(),0);}
});
test("late initiële voorkeuren zetten een recent systeemsignaal niet terug",async()=>{
  const f=fixture();await flush();f.emit({...normal,reduceTransparency:true,reduceMotion:true,increaseContrast:true,fontScale:3});f.resolveRead(normal);await flush();
  assert.equal(f.attributes.get("data-vs-reduce-transparency"),"true");assert.equal(f.attributes.get("data-vs-reduce-motion"),"true");assert.equal(f.attributes.get("data-vs-increase-contrast"),"true");assert.equal(f.styles.get("--vs-native-type-scale"),"3");f.stop();
});
test("ongeldige of onbekende voorkeuren blijven veilig; late events na cleanup doen niets",async()=>{
  const f=fixture();await flush();f.resolveRead(normal);await flush();
  for(const raw of [{...normal,version:2},{...normal,fontScale:Infinity},{...normal,fontScale:0},{...normal,reduceMotion:"false"},{...normal,token:"unexpected"}]){f.emit(raw);assert.equal(f.attributes.get("data-vs-reduce-transparency"),"true");}
  f.stop();f.emit(normal);assert.equal(f.attributes.size,0);
});
test("iOS leest alleen lokale UIKit-instellingen en registreert echte wijzigingssignalen",()=>{
  const swift=readFileSync("ios/App/App/VersadoNativePlugin.swift","utf8");
  assert.match(swift,/@objc func interfacePreferences[\s\S]*?guard localOnly\(call\)/);
  for(const name of ["isReduceTransparencyEnabled","isReduceMotionEnabled","isDarkerSystemColorsEnabled","UIContentSizeCategory.didChangeNotification","reduceTransparencyStatusDidChangeNotification"])assert.ok(swift.includes(name));
  assert.ok(swift.includes('UIFont.preferredFont(forTextStyle: .body).pointSize / 17.0'));
});
function luminance(rgb:number[]){return rgb.map(n=>{const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);}
test("glas behoudt minimaal 4,5:1 voor de zwakste VS-tekst op beide uiterste achtergronden",()=>{
  const css=readFileSync("src/app/globals.css","utf8");
  for(const dark of [false,true]){
    const palette=css.match(dark?/\n\.dark \{([\s\S]*?)\}/:/\n:root \{([\s\S]*?--vs-surface[\s\S]*?)\}/)![1];
    const material=css.match(dark?/html\.dark\[data-vs-material="glass"\] \{([\s\S]*?)\}/:/html\[data-vs-material="glass"\] \{([\s\S]*?)\}/)![1];
    const rgb=(name:string)=>palette.match(new RegExp(`--${name}: ([0-9 ]+);`))![1].trim().split(/\s+/).map(Number);
    const tint=rgb("vs-elevated"),ink=rgb("vs-fg-3"),alpha=Number(material.match(/--vs-glass-alpha: ([.0-9]+)/)![1]);
    for(const under of [0,255]){const bg=tint.map(n=>n*alpha+under*(1-alpha));const a=luminance(bg),b=luminance(ink);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);}
    const card=css.match(/html\[data-vs-material="glass"\] :is\(\[data-vs-surface="card"\], \.vs-material-card\) \{([\s\S]*?)\}/)![1];
    const cardAlpha=Number(card.match(/background-color: rgb\(var\(--vs-glass-tint\) \/ ([.0-9]+)/)![1]);
    const shine=Number(card.match(/--vs-glass-highlight\) \/ ([.0-9]+)/)![1]);
    for(const under of [0,255]){const bg=tint.map(n=>(n*cardAlpha+under*(1-cardAlpha))*(1-shine)+255*shine);const a=luminance(bg),b=luminance(ink);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'Ook de reflectie op een kaart behoudt tekstcontrast');}
  }
});
